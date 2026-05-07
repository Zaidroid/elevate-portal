// Live import from the linked Google Form responses sheet.
//
// On demand (button click) or on app boot (auto), pull the latest rows from
// the form-responses sheet, diff against what is already in the E3 advisors
// tab, and append any new entries with pipeline_status='New'.
//
// The form-response columns differ wildly in wording from the canonical E3
// schema (full questions, trailing whitespace, etc.) so we route by keyword
// using the same rules as the Python migrator.

import { fetchRange, appendRows } from '../../lib/sheets/client';
import type { Advisor } from '../../types/advisor';

const COHORT_3_START = '2026-01-01';

// Mirror of HEADER_RULES in sheet-builders/migrators/non_technical_advisors.py.
// Keep these two in sync when the form changes.
//
// Rule order matters: routeHeader returns the FIRST match per column, so
// MORE-SPECIFIC rules must come before MORE-GENERIC ones.
//
// Tightened 2026-05-07 after a column collision was found: the form has
// two questions starting "Which of the following…" — one for experience
// areas (exp_areas) and one for engagement modes (opportunities). The
// previous `['which of the following']` needle matched both, and because
// they share a column index in the form, the second silently overwrote
// the first. Both rules now require a discriminator substring.
const HEADER_RULES: Array<[keyof Advisor, string[]]> = [
  ['timestamp', ['timestamp']],
  // Mercy Corps safeguarding consent (form column 2, kept as a new field).
  ['safeguarding_consent', ['safeguarding']],
  ['full_name', ['full name']],
  ['gender', ['gender']],
  ['country', ['country']],
  ['email', ['email']],
  ['whatsapp', ['whatsapp']],
  ['linkedin', ['linkedin']],
  ['tech_rating', ['rate', 'experience', 'tech industry']],
  ['tech_rating', ['technical knowledge']],
  ['eco_rating', ['palestinian tech']],
  ['eco_rating', ['ecosystem']],
  ['c_level', ['c-level managers']],
  ['c_level', ['c-level role']],
  ['c_level_detail', ['if yes, please share']],
  // exp_areas: must mention "experience in" so we don't false-match the
  // "engaging with palestinian talent" column (routed below to opportunities).
  ['exp_areas', ['which of the following', 'experience in']],
  ['exp_detail', ['if any of the above']],
  // opportunities: distinct discriminator for the "engagement modes" column.
  ['opportunities', ['engaging with palestinian']],
  ['opportunities', ['opportunities related']],
  ['position', ['current position']],
  ['employer', ['current employer']],
  ['years', ['years of experience']],
  ['non_tech_subjects', ['non-technical']],
  ['non_tech_subjects', ['non technical']],
  ['tech_specs', ['technical:', 'specializations']],
  ['gsg_past', ['worked', 'gsg before']],
  ['gsg_past', ['volunteered with gsg']],
  ['paid_or_vol', ['paid or volunteering']],
  ['hourly_rate', ['hourly rate']],
  ['cv_link', ['upload your cv']],
  ['cv_link', ['cv link']],
  ['notes', ['anything else']],
  ['heard_from', ['how did you hear']],
  ['support_in', ['like to support in']],
  ['support_via', ['supporting gsg through']],
  // Form spells "News letter" with a space; older variants without.
  ['newsletter', ['news letter']],
  ['newsletter', ['newsletter']],
  // Markets / regions (added when the form gained these columns).
  ['markets_experience', ['markets', 'experience working']],
  ['markets_experience', ['markets/regions']],
  ['markets_detail', ['briefly describe', 'markets']],
  // Sub-intervention preferences — best-effort needles. The form may
  // not collect these explicitly today; once it does, the import picks
  // them up without a code change. Tighter needles win first match.
  ['sub_interventions', ['sub-intervention', 'preferred']],
  ['sub_interventions', ['sub intervention', 'interest']],
  ['sub_interventions', ['c-suite', 'marketing agency', 'train']],
  ['pillar_focus', ['pillar', 'focus']],
  ['pillar_focus', ['capacity building', 'market access']],
];

function routeHeader(legacy: string): keyof Advisor | null {
  if (!legacy) return null;
  const low = legacy.toLowerCase();
  for (const [canonical, needles] of HEADER_RULES) {
    if (needles.every(n => low.includes(n))) return canonical;
  }
  return null;
}

// Form-response timestamps come back as whatever string Sheets renders
// (e.g. "11/15/2025 14:32:01", "2026-02-01 09:11:00", "2026-02-01T09:11:00").
// Normalize to a single canonical "YYYY-MM-DD HH:MM:SS" so dedupe matches
// the Python migrator's _coerce(datetime) output exactly.
function normalizeTimestamp(s: string): string {
  if (!s) return '';
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const fmt = (y: number, mo: number, d: number, h: number, mi: number, se: number) =>
    `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
  // ISO with T separator → space
  let iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, y, mo, d, h, mi, se = '0'] = iso;
    return fmt(+y, +mo, +d, +h, +mi, +se);
  }
  // ISO date-only
  iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, mo, d] = iso;
    return fmt(+y, +mo, +d, 0, 0, 0);
  }
  // US m/d/yyyy h:mm:ss
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    const [, mo, d, y, h = '0', mi = '0', se = '0'] = us;
    return fmt(+y, +mo, +d, +h, +mi, +se);
  }
  return s.trim();
}

/**
 * Mint a deterministic advisor_id from email + timestamp.
 *
 * Format: `adv-<email-slug>-<YYYYMMDDHHMMSS>`. The same input always
 * produces the same id, so re-running the import on the same form row
 * yields a stable id that subsequent updates can write to.
 *
 * Exported so the dedupe / synthesise path in utils.ts uses the same
 * algorithm — never two functions of truth.
 */
export function mintAdvisorId(email: string, timestamp: string): string {
  const slug = (email || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
  const ts = (timestamp || '').replace(/[^0-9]+/g, '').slice(0, 14);
  if (!slug && !ts) return '';
  if (!slug) return `adv-ts-${ts}`;
  if (!ts)   return `adv-${slug}`;
  return `adv-${slug}-${ts}`;
}

function dedupeKey(email: string, timestampIso: string): string {
  // Match on email + calendar date only. The original (email + full timestamp)
  // form was too brittle: the migrator wrote "2024-06-03 15:35:20" while
  // form pulls came back as "2024-06-03T15:35:20" or "6/3/2024 15:35:20"
  // depending on locale, and the smallest format drift created phantom
  // duplicates. Same email + same day is a near-certain dedupe; cross-day
  // resubmissions still register as new (rare, intentional case).
  const dateOnly = timestampIso.slice(0, 10);
  return `${email.toLowerCase().trim()}|${dateOnly}`;
}

export type RowDecision = {
  rowIndex: number;          // 1-based, position in the form responses sheet
  email: string;
  timestampRaw: string;
  timestampNormalized: string;
  dedupeKey: string;
  outcome: 'imported' | 'duplicate' | 'skipped-no-email' | 'archived-pre-2026';
  reason?: string;
};

export type ImportResult = {
  fetched: number;
  alreadyKnown: number;
  imported: number;
  archived: number;
  errors: string[];
  importedRows: Partial<Advisor>[];
  /** Form-response columns the matcher could not route to any Advisor field.
   *  Surface in the UI so the team sees "you renamed the form column;
   *  update HEADER_RULES" without needing to open devtools. */
  unmappedHeaders: string[];
  /** All form-response columns we DID route, with their target field. */
  mappedHeaders: { source: string; target: string }[];
  /** Rows skipped because the email cell was blank or unparseable. */
  skippedNoEmail: number;
  /** Wall-clock time the import ran (ISO). */
  ranAt: string;
  /** Per-row decision for the last sync — what happened to each form row. */
  decisions: RowDecision[];
  /** Source / dest sheet metadata so the diagnostic UI can surface them. */
  sourceSheetId: string;
  sourceTabName: string;
  destSheetId: string;
  destTabName: string;
};

export async function importNewFormResponses(opts: {
  formSheetId: string;
  formTabName: string;
  destSheetId: string;
  destTabName: string;
  destHeaders: string[];
  existingAdvisors: Advisor[];
  userEmail: string;
}): Promise<ImportResult> {
  const result: ImportResult = {
    fetched: 0,
    alreadyKnown: 0,
    imported: 0,
    archived: 0,
    errors: [],
    importedRows: [],
    unmappedHeaders: [],
    mappedHeaders: [],
    skippedNoEmail: 0,
    ranAt: new Date().toISOString(),
    decisions: [],
    sourceSheetId: opts.formSheetId,
    sourceTabName: opts.formTabName,
    destSheetId: opts.destSheetId,
    destTabName: opts.destTabName,
  };

  if (!opts.destHeaders || opts.destHeaders.length === 0) {
    // Guard: if the destination tab hasn't loaded yet, refuse to write
    // empty rows. The caller schedules a retry shortly.
    result.errors.push('Destination headers not loaded yet — skipping this tick.');
    return result;
  }

  // 1. Fetch from form-responses sheet
  let raw: string[][] = [];
  try {
    raw = await fetchRange(opts.formSheetId, `${opts.formTabName}!A:ZZ`);
  } catch (err) {
    result.errors.push(`Failed to read form responses: ${(err as Error).message}`);
    return result;
  }
  if (raw.length < 2) {
    result.errors.push('Form responses sheet is empty or missing data rows');
    return result;
  }

  const headers = raw[0];
  const rows = raw.slice(1);
  result.fetched = rows.length;

  // 2. Map each source column to a canonical destination column.
  //    Track headers that had a value somewhere but couldn't be routed
  //    so the UI can show the team WHICH form columns drifted.
  const colRouting: Array<keyof Advisor | null> = headers.map(h => routeHeader(h));
  for (let i = 0; i < headers.length; i++) {
    const headerName = String(headers[i] ?? '').trim();
    const target = colRouting[i];
    if (target) {
      if (headerName) result.mappedHeaders.push({ source: headerName, target: String(target) });
      continue;
    }
    if (!headerName) continue;
    const hasAny = rows.some(r => String(r[i] ?? '').trim() !== '');
    if (hasAny) result.unmappedHeaders.push(headerName);
  }

  // 3. Build an existing-key set to dedupe against
  const knownKeys = new Set<string>();
  for (const a of opts.existingAdvisors) {
    if (!a.email) continue;
    knownKeys.add(dedupeKey(a.email, normalizeTimestamp(a.timestamp || '')));
  }

  // 4. Walk rows; append unknowns to the destination
  const newRows: Partial<Advisor>[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const r = rows[rowIdx];
    const sheetRowNumber = rowIdx + 2; // +1 for header, +1 for 1-based
    if (r.every(v => !v)) continue;
    const draft: Partial<Advisor> = {};
    for (let i = 0; i < headers.length && i < r.length; i++) {
      const target = colRouting[i];
      if (!target) continue;
      draft[target] = String(r[i] ?? '').trim() as Advisor[typeof target];
    }
    const rawTs = String(draft.timestamp || '').trim();
    if (!draft.email) {
      result.skippedNoEmail += 1;
      result.decisions.push({
        rowIndex: sheetRowNumber,
        email: '',
        timestampRaw: rawTs,
        timestampNormalized: normalizeTimestamp(rawTs),
        dedupeKey: '',
        outcome: 'skipped-no-email',
        reason: 'email cell was blank or unparseable',
      });
      continue;
    }
    draft.email = String(draft.email).trim();
    const tsIso = normalizeTimestamp(rawTs);
    draft.timestamp = tsIso;
    const key = dedupeKey(draft.email, tsIso);
    if (knownKeys.has(key)) {
      result.alreadyKnown += 1;
      result.decisions.push({
        rowIndex: sheetRowNumber,
        email: draft.email,
        timestampRaw: rawTs,
        timestampNormalized: tsIso,
        dedupeKey: key,
        outcome: 'duplicate',
        reason: 'matched an existing advisor by email + date',
      });
      continue;
    }
    knownKeys.add(key);

    const isPre2026 = !!tsIso && tsIso < COHORT_3_START;
    draft.pipeline_status = isPre2026 ? 'Archived' : 'New';
    if (isPre2026) result.archived += 1;
    draft.updated_at = new Date().toISOString().slice(0, 10);
    draft.updated_by = opts.userEmail || 'form-import';
    newRows.push(draft);
    result.decisions.push({
      rowIndex: sheetRowNumber,
      email: draft.email,
      timestampRaw: rawTs,
      timestampNormalized: tsIso,
      dedupeKey: key,
      outcome: isPre2026 ? 'archived-pre-2026' : 'imported',
    });
  }

  if (newRows.length === 0) return result;

  // 5. Append in destination header order.
  // advisor_id MUST be minted client-side: the original design assumed
  // a sheet formula in row 1 of the Advisors tab would auto-fill the id
  // from email on insert. That formula doesn't fire reliably (and many
  // workbooks were rebuilt without it). When advisor_id is blank, the
  // page's dedupeAdvisorRows drops the row, so imports land in the sheet
  // but never appear in the UI. Mint a stable id from email + timestamp
  // so each submission has a unique, persistent key.
  const matrix: (string | number | boolean)[][] = newRows.map(draft => {
    return opts.destHeaders.map(h => {
      if (h === 'advisor_id') {
        return mintAdvisorId(draft.email || '', draft.timestamp || '');
      }
      const v = (draft as Record<string, unknown>)[h];
      if (v === undefined || v === null) return '';
      return String(v);
    });
  });

  try {
    await appendRows(opts.destSheetId, `${opts.destTabName}!A:A`, matrix);
    result.imported = newRows.length;
    result.importedRows = newRows;
  } catch (err) {
    result.errors.push(`Failed to append: ${(err as Error).message}`);
  }
  return result;
}
