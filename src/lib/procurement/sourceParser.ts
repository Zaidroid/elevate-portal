// Read-only parser for the GSG team's monthly procurement plan
// (1nKoKiJL0p8pfhLlkgIv-fyPUhg8e5cOP). Each tab is one month for the
// whole org. The Elevate Companies team's section starts after a
// merged-cell separator row that contains the literal word "companies"
// (case-insensitive). Rows below that separator and above the next
// section break (or the bottom of the data) are our entries.
//
// The portal NEVER writes to this sheet. We import + normalise + diff
// against our E3 Procurement Plan and surface the comparison to the
// team. The source remains the team's authoritative working copy.

import { batchGet, fetchRange, getSpreadsheetMetaCached } from '../sheets/client';

export type SourceProcurementRow = {
  source_tab: string;          // month tab name (e.g. "Nov 2025")
  source_row: number;          // 1-based row number within the tab
  // Sortable yyyymm derived from the tab name. 0 when unparseable.
  source_month_yyyymm: number;
  pr_id: string;               // PR# from the team's column when present
  company_name: string;        // routed from a Company / Beneficiary / Recipient column
  activity: string;
  item_description: string;
  qty: string;
  unit_cost_usd: string;
  total_cost_usd: string;
  fund_code: string;
  office_code: string;
  gl_account: string;
  status: string;
  vendor: string;
  target_award_date: string;
  pr_submit_date: string;
  notes: string;
  raw: string[];               // entire row, in case the team adds columns we miss
};

// Column-name aliases the team uses across the months. We route by keyword
// rather than exact match because the team's headers drift over time.
const COLUMN_RULES: Array<[keyof SourceProcurementRow, string[]]> = [
  ['pr_id', ['pr#']],
  ['pr_id', ['pr no']],
  ['pr_id', ['pr number']],
  ['company_name', ['company']],
  ['company_name', ['beneficiary']],
  ['company_name', ['recipient']],
  ['company_name', ['business']],
  ['activity', ['activity']],
  ['item_description', ['item description']],
  ['item_description', ['description']],
  ['qty', ['qty']],
  ['qty', ['quantity']],
  ['unit_cost_usd', ['unit cost']],
  ['unit_cost_usd', ['unit price']],
  ['total_cost_usd', ['total cost']],
  ['total_cost_usd', ['total amount']],
  ['total_cost_usd', ['total']],
  ['fund_code', ['fund']],
  ['office_code', ['office code']],
  ['office_code', ['office']],
  ['gl_account', ['gl account']],
  ['gl_account', ['gl']],
  ['status', ['status']],
  ['vendor', ['vendor']],
  ['vendor', ['supplier']],
  ['target_award_date', ['target award']],
  ['target_award_date', ['award date']],
  ['pr_submit_date', ['submit date']],
  ['pr_submit_date', ['pr date']],
  ['notes', ['note']],
  ['notes', ['comment']],
];

function routeColumn(header: string): keyof SourceProcurementRow | null {
  if (!header) return null;
  const low = header.toLowerCase();
  for (const [canonical, needles] of COLUMN_RULES) {
    if (needles.every(n => low.includes(n))) return canonical;
  }
  return null;
}

const MONTH_PATTERNS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];

// Map of month-name fragments → 1..12 so we can convert "Nov 2025" /
// "November 2025" / "11-2025" / "2025-11" into a sortable yyyymm number.
const MONTH_TO_NUM: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// Parse a tab name into a sortable yyyymm integer (e.g. "Nov 2025" → 202511).
// Returns 0 when no year is recoverable.
export function parseTabYyyymm(tabName: string): number {
  if (!tabName) return 0;
  const low = tabName.toLowerCase();
  // Look for a 4-digit year first.
  const yearMatch = low.match(/(20\d{2})/);
  let year = yearMatch ? parseInt(yearMatch[1], 10) : 0;

  // Month from name first, then numeric.
  let month = 0;
  for (const k of Object.keys(MONTH_TO_NUM).sort((a, b) => b.length - a.length)) {
    if (low.includes(k)) { month = MONTH_TO_NUM[k]; break; }
  }
  if (!month) {
    // Try patterns like "11-2025" / "2025-11" / "11/2025"
    const m1 = low.match(/\b(\d{1,2})[\/\-\s_](20\d{2})\b/);
    const m2 = low.match(/\b(20\d{2})[\/\-\s_](\d{1,2})\b/);
    if (m1) {
      month = parseInt(m1[1], 10);
      year = year || parseInt(m1[2], 10);
    } else if (m2) {
      year = year || parseInt(m2[1], 10);
      month = parseInt(m2[2], 10);
    }
  }

  if (!year) {
    // Default to the current year when the tab name only mentions a month.
    // The team usually rolls forward without re-stamping years.
    year = new Date().getFullYear();
  }
  if (!month || month < 1 || month > 12) return 0;
  return year * 100 + month;
}

// A separator row is a row that contains the literal word "companies" in
// any cell, in a row where most other cells are blank (the team uses
// merged cells for these, which Sheets returns as a value in the first
// merged cell only).
function isCompaniesSeparator(row: string[]): boolean {
  const filled = row.filter(c => (c || '').trim()).length;
  if (filled > 3) return false;
  return row.some(c => (c || '').toLowerCase().trim().includes('companies'));
}

// A "next section" separator — when the team starts another department's
// block. We detect by finding a near-empty row whose only filled cell
// names a different team. Conservatively: any row with one filled cell
// that does NOT contain 'companies' and matches typical team names.
const OTHER_TEAM_HINTS = ['advisors', 'mentors', 'tth', 'm&b', 'mkg', 'marketing', 'upskilling', 'hr', 'finance', 'admin', 'logistics', 'operations'];
function isOtherTeamSeparator(row: string[]): boolean {
  const filled = row.filter(c => (c || '').trim()).length;
  if (filled > 3) return false;
  for (const c of row) {
    const v = (c || '').toLowerCase().trim();
    if (!v) continue;
    if (v.includes('companies')) return false;
    if (OTHER_TEAM_HINTS.some(h => v.includes(h))) return true;
  }
  return false;
}

async function listMonthlyTabs(sheetId: string): Promise<string[]> {
  const meta = await getSpreadsheetMetaCached(sheetId);
  return meta.sheets
    .map(s => s.title)
    .filter(t => MONTH_PATTERNS.some(p => t.toLowerCase().includes(p)));
}

// Find the most recent header row above the separator. Walk upward from
// `sepIdx - 1` looking for a row with several non-blank cells that match
// our column rules. Falls back to the row immediately above the separator
// when no good candidate is found.
function findHeaderRow(rows: string[][], sepIdx: number): { headerIdx: number; routing: Array<keyof SourceProcurementRow | null> } {
  let bestIdx = sepIdx - 1;
  let bestHits = 0;
  for (let i = sepIdx - 1; i >= Math.max(0, sepIdx - 10); i--) {
    const r = rows[i] || [];
    let hits = 0;
    for (const c of r) if (routeColumn(c)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      bestIdx = i;
    }
  }
  const headerRow = rows[bestIdx] || [];
  const routing: Array<keyof SourceProcurementRow | null> = headerRow.map(c => routeColumn(c));
  return { headerIdx: bestIdx, routing };
}

function readEntry(
  row: string[],
  routing: Array<keyof SourceProcurementRow | null>,
  tabName: string,
  rowNumber: number
): SourceProcurementRow {
  const entry: SourceProcurementRow = {
    source_tab: tabName,
    source_row: rowNumber,
    source_month_yyyymm: parseTabYyyymm(tabName),
    pr_id: '',
    company_name: '',
    activity: '',
    item_description: '',
    qty: '',
    unit_cost_usd: '',
    total_cost_usd: '',
    fund_code: '',
    office_code: '',
    gl_account: '',
    status: '',
    vendor: '',
    target_award_date: '',
    pr_submit_date: '',
    notes: '',
    raw: row.slice(),
  };
  for (let i = 0; i < routing.length && i < row.length; i++) {
    const target = routing[i];
    if (!target) continue;
    const v = (row[i] || '').trim();
    if (!v) continue;
    if (target === 'raw' || target === 'source_tab' || target === 'source_row' || target === 'source_month_yyyymm') continue;
    entry[target] = v as never;
  }
  return entry;
}

export async function fetchProcurementSource(
  sheetId: string
): Promise<{ rows: SourceProcurementRow[]; tabs: string[]; errors: string[] }> {
  const errors: string[] = [];
  if (!sheetId) {
    errors.push('No source sheet id configured (set VITE_SHEET_PROCUREMENT_SOURCE).');
    return { rows: [], tabs: [], errors };
  }

  let tabs: string[] = [];
  try {
    tabs = await listMonthlyTabs(sheetId);
  } catch (err) {
    errors.push(`Failed to read tab list: ${(err as Error).message}`);
    return { rows: [], tabs: [], errors };
  }
  if (tabs.length === 0) {
    errors.push('No monthly tabs detected on source sheet.');
    return { rows: [], tabs: [], errors };
  }

  // Pull every tab in one batchGet to limit API hits.
  let valueRanges: Array<{ range: string; values?: string[][] }> = [];
  try {
    valueRanges = await batchGet(sheetId, tabs.map(t => `${t}!A:ZZ`));
  } catch (err) {
    // Fall back to per-tab fetches if batchGet fails (rare).
    errors.push(`batchGet failed (${(err as Error).message}); falling back to per-tab fetch.`);
    for (const t of tabs) {
      try {
        const data = await fetchRange(sheetId, `${t}!A:ZZ`);
        valueRanges.push({ range: `${t}!A:ZZ`, values: data });
      } catch (err2) {
        errors.push(`Failed to read tab "${t}": ${(err2 as Error).message}`);
      }
    }
  }

  const out: SourceProcurementRow[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const rows = valueRanges[i]?.values || [];
    if (rows.length === 0) continue;

    let sepIdx = -1;
    for (let r = 0; r < rows.length; r++) {
      if (isCompaniesSeparator(rows[r])) { sepIdx = r; break; }
    }
    if (sepIdx < 0) continue;

    const { routing } = findHeaderRow(rows, sepIdx);

    // Walk forward from one row past the separator, collecting non-empty
    // rows until we hit another team's separator OR three consecutive
    // empty rows.
    let blank = 0;
    for (let r = sepIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const filled = row.filter(c => (c || '').trim()).length;
      if (filled === 0) {
        blank += 1;
        if (blank >= 3) break;
        continue;
      }
      blank = 0;
      if (isOtherTeamSeparator(row)) break;
      if (isCompaniesSeparator(row)) continue; // skip stray repeats
      const entry = readEntry(row, routing, tab, r + 1);
      // Skip rows that have no useful content after routing.
      const usefulHits = (entry.activity || entry.item_description || entry.pr_id || entry.total_cost_usd || entry.vendor);
      if (!usefulHits) continue;
      out.push(entry);
    }
  }

  return { rows: out, tabs, errors };
}

// Diff a source PR against the E3 output PRs. We match on pr_id when both
// have one; otherwise on (activity + total_cost_usd) which is rough but
// the team often inserts entries without PR ids. Returns the matching E3
// row id, or null when the source row is unmatched.
export type E3Row = { pr_id?: string; activity?: string; total_cost_usd?: string; status?: string };

export function findE3Match(src: SourceProcurementRow, e3Rows: E3Row[]): E3Row | null {
  if (src.pr_id) {
    const hit = e3Rows.find(r => (r.pr_id || '').trim().toLowerCase() === src.pr_id.toLowerCase());
    if (hit) return hit;
  }
  if (src.activity && src.total_cost_usd) {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').toLowerCase().trim();
    const total = parseFloat(src.total_cost_usd) || 0;
    const hit = e3Rows.find(r =>
      norm(r.activity || '') === norm(src.activity) &&
      Math.abs((parseFloat(r.total_cost_usd || '0') || 0) - total) < 0.01
    );
    if (hit) return hit;
  }
  return null;
}
