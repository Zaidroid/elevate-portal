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
const HEADER_RULES: Array<[keyof Advisor, string[]]> = [
  ['timestamp', ['timestamp']],
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
  ['exp_areas', ['which of the following']],
  ['exp_detail', ['if any of the above']],
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
  ['opportunities', ['opportunities related']],
  ['support_in', ['like to support in']],
  ['support_via', ['supporting gsg through']],
  ['newsletter', ['newsletter']],
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

function dedupeKey(email: string, timestampIso: string): string {
  return `${email.toLowerCase().trim()}|${timestampIso.slice(0, 19)}`;
}

export type ImportResult = {
  fetched: number;
  alreadyKnown: number;
  imported: number;
  archived: number;
  errors: string[];
  importedRows: Partial<Advisor>[];
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
  };

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

  // 2. Map each source column to a canonical destination column
  const colRouting: Array<keyof Advisor | null> = headers.map(h => routeHeader(h));

  // 3. Build an existing-key set to dedupe against
  const knownKeys = new Set<string>();
  for (const a of opts.existingAdvisors) {
    if (!a.email) continue;
    knownKeys.add(dedupeKey(a.email, normalizeTimestamp(a.timestamp || '')));
  }

  // 4. Walk rows; append unknowns to the destination
  const newRows: Partial<Advisor>[] = [];
  for (const r of rows) {
    if (r.every(v => !v)) continue;
    const draft: Partial<Advisor> = {};
    for (let i = 0; i < headers.length && i < r.length; i++) {
      const target = colRouting[i];
      if (!target) continue;
      draft[target] = String(r[i] ?? '').trim() as Advisor[typeof target];
    }
    if (!draft.email) continue;
    const tsIso = normalizeTimestamp(draft.timestamp || '');
    draft.timestamp = tsIso;
    const key = dedupeKey(draft.email, tsIso);
    if (knownKeys.has(key)) {
      result.alreadyKnown += 1;
      continue;
    }
    knownKeys.add(key);

    // pipeline_status: Archived for pre-2026, New otherwise
    const isPre2026 = tsIso && tsIso < COHORT_3_START;
    draft.pipeline_status = isPre2026 ? 'Archived' : 'New';
    if (isPre2026) result.archived += 1;
    draft.updated_at = new Date().toISOString().slice(0, 10);
    draft.updated_by = opts.userEmail || 'form-import';
    newRows.push(draft);
  }

  if (newRows.length === 0) return result;

  // 5. Append in destination header order. The destination's first column
  // (advisor_id) is a formula that auto-mints when full_name is set, so we
  // leave it blank.
  const matrix: (string | number | boolean)[][] = newRows.map(draft => {
    return opts.destHeaders.map(h => {
      if (h === 'advisor_id') return ''; // formula handles
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
