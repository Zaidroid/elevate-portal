// Live import from the linked Google Form responses sheet for ElevateBridge.
//
// Auto-poll fires this on the FreelancersPage every 5 minutes. New form
// rows that aren't already in the destination Freelancers tab get appended
// with status='Available' so they enter the matching pool immediately.
//
// Dedupe key is (email + calendar date) — same approach as advisors,
// looser than (email + full timestamp) to tolerate timestamp format drift
// between the form's render and the migrator's write.

import { fetchRange, appendRows } from '../../lib/sheets/client';
import type { Freelancer } from '../../types/freelancer';

const HEADER_RULES: Array<[keyof Freelancer, string[]]> = [
  ['updated_at', ['timestamp']],
  ['full_name', ['full name']],
  ['full_name', ['name']],
  ['email', ['email']],
  ['phone', ['phone']],
  ['phone', ['whatsapp']],
  ['location', ['location']],
  ['location', ['city']],
  ['location', ['governorate']],
  ['track', ['track']],
  ['track', ['platform']],
  ['role_profile', ['role']],
  ['role_profile', ['profile']],
  ['notes', ['anything else']],
  ['notes', ['notes']],
];

function routeHeader(legacy: string): keyof Freelancer | null {
  if (!legacy) return null;
  const low = legacy.toLowerCase();
  for (const [canonical, needles] of HEADER_RULES) {
    if (needles.every(n => low.includes(n))) return canonical;
  }
  return null;
}

function normalizeTimestamp(s: string): string {
  if (!s) return '';
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const fmt = (y: number, mo: number, d: number, h: number, mi: number, se: number) =>
    `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se = '0'] = m;
    return fmt(+y, +mo, +d, +h, +mi, +se);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return fmt(+m[1], +m[2], +m[3], 0, 0, 0);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, mo, d, y, h = '0', mi = '0', se = '0'] = m;
    return fmt(+y, +mo, +d, +h, +mi, +se);
  }
  return s.trim();
}

function dedupeKey(email: string, timestampIso: string): string {
  const dateOnly = timestampIso.slice(0, 10);
  return `${email.toLowerCase().trim()}|${dateOnly}`;
}

export type ImportResult = {
  fetched: number;
  alreadyKnown: number;
  imported: number;
  errors: string[];
};

export async function importNewFreelancerFormResponses(opts: {
  formSheetId: string;
  formTabName: string;
  destSheetId: string;
  destTabName: string;
  destHeaders: string[];
  existingFreelancers: Freelancer[];
  userEmail: string;
}): Promise<ImportResult> {
  const result: ImportResult = { fetched: 0, alreadyKnown: 0, imported: 0, errors: [] };

  let raw: string[][] = [];
  try {
    raw = await fetchRange(opts.formSheetId, `${opts.formTabName}!A:ZZ`);
  } catch (err) {
    result.errors.push(`Failed to read form responses: ${(err as Error).message}`);
    return result;
  }
  if (raw.length < 2) {
    result.errors.push('Form responses sheet is empty');
    return result;
  }

  const headers = raw[0];
  const rows = raw.slice(1);
  result.fetched = rows.length;
  const colRouting: Array<keyof Freelancer | null> = headers.map(h => routeHeader(h));

  const knownKeys = new Set<string>();
  for (const fl of opts.existingFreelancers) {
    if (!fl.email) continue;
    knownKeys.add(dedupeKey(fl.email, normalizeTimestamp(fl.updated_at || '')));
  }

  const newRows: Partial<Freelancer>[] = [];
  for (const r of rows) {
    if (r.every(v => !v)) continue;
    const draft: Partial<Freelancer> = {};
    for (let i = 0; i < headers.length && i < r.length; i++) {
      const target = colRouting[i];
      if (!target) continue;
      draft[target] = String(r[i] ?? '').trim() as Freelancer[typeof target];
    }
    if (!draft.email) continue;
    const tsIso = normalizeTimestamp(draft.updated_at || '');
    draft.updated_at = tsIso || new Date().toISOString().slice(0, 10);
    const key = dedupeKey(draft.email, tsIso);
    if (knownKeys.has(key)) {
      result.alreadyKnown += 1;
      continue;
    }
    knownKeys.add(key);
    draft.status = 'Available';
    draft.updated_by = opts.userEmail || 'form-import';
    draft.source_sheet = 'live-form';
    newRows.push(draft);
  }

  if (newRows.length === 0) return result;

  const matrix: (string | number | boolean)[][] = newRows.map(draft =>
    opts.destHeaders.map(h => {
      if (h === 'freelancer_id') return ''; // formula auto-mints
      const v = (draft as Record<string, unknown>)[h];
      if (v === undefined || v === null) return '';
      return String(v);
    })
  );

  try {
    await appendRows(opts.destSheetId, `${opts.destTabName}!A:A`, matrix);
    result.imported = newRows.length;
  } catch (err) {
    result.errors.push(`Failed to append: ${(err as Error).message}`);
  }
  return result;
}
