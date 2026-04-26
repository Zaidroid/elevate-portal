// Helpers that pull prior team evaluation work out of the Selection
// workbook tabs and slice it per company. Each tab uses slightly
// different header conventions (camelCase, snake_case, "Company Name"
// with spaces, etc.) so we route by header keywords instead of exact
// keys, the same way interviewedSource.ts handles the upstream sheet.

export type RawRow = Record<string, string>;

const NAME_HINTS = ['company name', 'company', 'companyname', 'name', 'organization', 'business name', 'company_name'];

function norm(s?: string): string {
  return (s || '').trim().toLowerCase();
}

function fuzzyName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find the most likely "company name" key in a row's header set.
// Tries exact-match against common variants first, then substring,
// then falls back to the first key that's neither id-like nor blank.
function findCompanyKey(row: RawRow): string | null {
  if (!row) return null;
  const keys = Object.keys(row);
  if (keys.length === 0) return null;

  // Exact match first.
  for (const hint of NAME_HINTS) {
    const k = keys.find(k => norm(k) === hint);
    if (k) return k;
  }
  // Substring fallback.
  for (const hint of NAME_HINTS) {
    const k = keys.find(k => norm(k).includes(hint));
    if (k) return k;
  }
  return null;
}

// Index a tab's rows by normalized company name, so a per-company
// lookup is a constant-time hit.
export function indexByCompanyName(rows: RawRow[]): Map<string, RawRow> {
  const out = new Map<string, RawRow>();
  if (rows.length === 0) return out;
  const sample = rows[0];
  const key = findCompanyKey(sample);
  if (!key) return out;
  for (const r of rows) {
    const n = fuzzyName(r[key] || '');
    if (n && !out.has(n)) out.set(n, r);
  }
  return out;
}

// Loose lookup: tries the exact normalized name first, then a substring
// pass to tolerate "Inc.", trailing notes, and minor spelling drift.
export function lookupByName(map: Map<string, RawRow>, companyName: string): RawRow | null {
  const k = fuzzyName(companyName);
  if (!k) return null;
  if (map.has(k)) return map.get(k)!;
  for (const [other, row] of map) {
    if (other.length < 4) continue;
    if (other.includes(k) || k.includes(other)) return row;
  }
  return null;
}

// Strip empty / id / housekeeping columns so the UI shows real signal.
const SKIP_KEY_PATTERNS = [
  /^id$/i, /^.*_id$/, /^index$/i, /^row[_ ]?number$/i,
  /^updated[_ ]?at$/i, /^created[_ ]?at$/i,
  /^updated[_ ]?by$/i, /^created[_ ]?by$/i,
];

export function meaningfulEntries(row: RawRow | null | undefined): Array<[string, string]> {
  if (!row) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(row)) {
    if (!v || !v.trim()) continue;
    if (SKIP_KEY_PATTERNS.some(p => p.test(k))) continue;
    out.push([k, v]);
  }
  return out;
}

// Group entries by header-keyword bucket so we can render an
// "Assessment notes" section, "Score", "Decision", etc. without
// hardcoding tab schemas.
export type EntryBucket = {
  label: string;
  pattern: RegExp;
  entries: Array<[string, string]>;
};

export function bucketize(entries: Array<[string, string]>, buckets: Array<{ label: string; pattern: RegExp }>): EntryBucket[] {
  const placed = new Set<string>();
  const out: EntryBucket[] = buckets.map(b => ({ label: b.label, pattern: b.pattern, entries: [] }));
  for (const [k, v] of entries) {
    for (const bucket of out) {
      if (bucket.pattern.test(k)) {
        bucket.entries.push([k, v]);
        placed.add(k);
        break;
      }
    }
  }
  const other: Array<[string, string]> = entries.filter(([k]) => !placed.has(k));
  if (other.length > 0) out.push({ label: 'Other', pattern: /./, entries: other });
  return out.filter(b => b.entries.length > 0);
}

export function humanizeKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\s*\w/, c => c.toUpperCase());
}
