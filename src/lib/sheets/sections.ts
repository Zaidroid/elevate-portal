// Section-aware row filtering for sheets that group rows under header
// labels like "Companies", "Individuals", "Other Team", "Marketing".
//
// The team's procurement / payments / conferences sheets all follow
// the same pattern: data rows for the cohort companies live below a
// near-empty row that says "Companies", and stop when a new
// near-empty row introduces a different team's block. Without filtering,
// the portal reads everything (yielding nonsense counts like the "1996
// PRs" we saw — the parser was including individual / vendor rows from
// other teams + the literal "1996" appears as a year value in some
// stray cell).
//
// This module exposes one function: `keepCompaniesSection`. Pages that
// read PRs / payments / etc. wrap their hook output in this so they
// only see cohort-companies rows.

import type { Row } from '../../data/SheetDataProvider';

/**
 * A row is treated as a section header when it has very few filled
 * cells AND one of them matches a known section label. The "very
 * few" threshold catches merged-cell headers (Sheets returns merged
 * cells with a value only in the top-left cell) without false-matching
 * data rows that happen to mention a team name in a notes field.
 */
const SECTION_LABEL_PATTERNS: RegExp[] = [
  /\bcompanies\b/i,
  /\bindividuals?\b/i,
  /\bother\s*team[s]?\b/i,
  /\bother\b/i,
  /\badvisors?\b/i,
  /\bmentors?\b/i,
  /\bmarketing\b/i,
  /\btth\b/i,
  /\bm[&\s]+b\b/i,
  /\bmkg\b/i,
  /\bupskilling\b/i,
  /\bhr\b/i,
  /\bfinance\b/i,
  /\badmin(istration)?\b/i,
  /\blogistics\b/i,
  /\boperations\b/i,
  /\bvendors?\b/i,
  /\bcoworking\b/i,
  /\bconferences\b/i,
  /\btravel\b/i,
];

const FILLED_CELL_THRESHOLD = 3;

function detectHeader(row: Row, headers: string[]): { isHeader: boolean; label?: string } {
  let filled = 0;
  let label: string | undefined;
  for (const h of headers) {
    const v = (row[h] ?? '').trim();
    if (!v) continue;
    filled += 1;
    if (!label && SECTION_LABEL_PATTERNS.some(p => p.test(v))) {
      label = v;
    }
  }
  if (filled <= FILLED_CELL_THRESHOLD && label) return { isHeader: true, label };
  return { isHeader: false };
}

/**
 * Walk `rows` and split them into sections keyed by the header text
 * that introduces each block. Any rows before the first detected
 * header land in the `'_unsectioned'` bucket — that's how an
 * unstructured sheet (no section headers) stays readable.
 */
export function partitionRowsBySection(rows: Row[], headers: string[]): Map<string, Row[]> {
  const sections = new Map<string, Row[]>();
  let current = '_unsectioned';
  sections.set(current, []);
  for (const r of rows) {
    const check = detectHeader(r, headers);
    if (check.isHeader && check.label) {
      current = check.label;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)?.push(r);
  }
  return sections;
}

/**
 * Return only rows under a section labelled "Companies" (case-
 * insensitive substring match). When no such section header is found
 * — i.e. the sheet hasn't been laid out with team-block headers —
 * fall back to the unsectioned bucket so existing single-team sheets
 * keep working.
 */
export function keepCompaniesSection(rows: Row[], headers: string[]): Row[] {
  if (rows.length === 0) return rows;
  const sections = partitionRowsBySection(rows, headers);
  for (const [label, secRows] of sections.entries()) {
    if (/\bcompanies\b/i.test(label)) return secRows;
  }
  // No Companies header at all → assume the sheet is single-team
  // (older format). Return whatever was in _unsectioned.
  const unsectioned = sections.get('_unsectioned') ?? [];
  return unsectioned;
}

/**
 * Generic helper for any caller that wants a specific section by
 * substring match (e.g. 'individuals', 'vendors').
 */
export function keepSection(rows: Row[], headers: string[], pattern: RegExp): Row[] {
  if (rows.length === 0) return rows;
  const sections = partitionRowsBySection(rows, headers);
  for (const [label, secRows] of sections.entries()) {
    if (pattern.test(label)) return secRows;
  }
  return [];
}
