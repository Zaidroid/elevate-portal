// Read-only parser for the team's legacy Payment Tracker sheet
// (1XCWocyCX1SycojmDlrAUlBBr7wGDyXKISLpOmJIxWgY). Surfaces every row
// in the source so the team can compare what the audit has recorded
// against what's in our E3 Payments output.
//
// The portal NEVER writes to this sheet — it's the team's working
// copy, kept authoritative.

import { batchGet, getSpreadsheetMetaCached } from '../sheets/client';

export type SourcePaymentRow = {
  source_tab: string;
  source_row: number;
  payee_name: string;
  amount_usd: string;
  currency: string;
  fund_code: string;
  intervention_type: string;
  payment_date: string;
  status: string;
  invoice_url: string;
  pr_id: string;
  notes: string;
  raw: string[];
};

const COLUMN_RULES: Array<[keyof SourcePaymentRow, string[]]> = [
  ['payee_name', ['payee']],
  ['payee_name', ['vendor']],
  ['payee_name', ['advisor']],
  ['payee_name', ['recipient']],
  ['amount_usd', ['amount']],
  ['amount_usd', ['total']],
  ['currency', ['currency']],
  ['fund_code', ['fund']],
  ['intervention_type', ['intervention']],
  ['intervention_type', ['pillar']],
  ['payment_date', ['payment date']],
  ['payment_date', ['paid on']],
  ['payment_date', ['date']],
  ['status', ['status']],
  ['invoice_url', ['invoice']],
  ['invoice_url', ['receipt']],
  ['pr_id', ['pr#']],
  ['pr_id', ['pr no']],
  ['pr_id', ['pr id']],
  ['pr_id', ['pr number']],
  ['notes', ['note']],
  ['notes', ['comment']],
];

function routeColumn(header: string): keyof SourcePaymentRow | null {
  if (!header) return null;
  const low = header.toLowerCase();
  for (const [canonical, needles] of COLUMN_RULES) {
    if (needles.every(n => low.includes(n))) return canonical;
  }
  return null;
}

// We don't know the exact tab layout of this sheet — read EVERY tab and
// parse what we can.
async function listAllTabs(sheetId: string): Promise<string[]> {
  const meta = await getSpreadsheetMetaCached(sheetId);
  return meta.sheets.map(s => s.title).filter(t => !/^lookups?$/i.test(t));
}

function findHeaderRow(rows: string[][]): { headerIdx: number; routing: Array<keyof SourcePaymentRow | null> } {
  let bestIdx = 0;
  let bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    let hits = 0;
    for (const c of r) if (routeColumn(c)) hits += 1;
    if (hits > bestHits) { bestHits = hits; bestIdx = i; }
  }
  const headerRow = rows[bestIdx] || [];
  const routing: Array<keyof SourcePaymentRow | null> = headerRow.map(c => routeColumn(c));
  return { headerIdx: bestIdx, routing };
}

function readEntry(
  row: string[],
  routing: Array<keyof SourcePaymentRow | null>,
  tabName: string,
  rowNumber: number
): SourcePaymentRow {
  const entry: SourcePaymentRow = {
    source_tab: tabName,
    source_row: rowNumber,
    payee_name: '',
    amount_usd: '',
    currency: '',
    fund_code: '',
    intervention_type: '',
    payment_date: '',
    status: '',
    invoice_url: '',
    pr_id: '',
    notes: '',
    raw: row.slice(),
  };
  for (let i = 0; i < routing.length && i < row.length; i++) {
    const target = routing[i];
    if (!target) continue;
    const v = (row[i] || '').trim();
    if (!v) continue;
    if (target === 'raw' || target === 'source_tab' || target === 'source_row') continue;
    entry[target] = v as never;
  }
  return entry;
}

export async function fetchPaymentsSource(sheetId: string): Promise<{
  rows: SourcePaymentRow[];
  tabs: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  if (!sheetId) {
    errors.push('No source sheet id configured (set VITE_SHEET_PAYMENTS_SOURCE).');
    return { rows: [], tabs: [], errors };
  }
  let tabs: string[] = [];
  try { tabs = await listAllTabs(sheetId); }
  catch (err) {
    errors.push(`Failed to read tab list: ${(err as Error).message}`);
    return { rows: [], tabs: [], errors };
  }
  if (tabs.length === 0) {
    errors.push('Source sheet has no usable tabs.');
    return { rows: [], tabs: [], errors };
  }

  let valueRanges: Array<{ range: string; values?: string[][] }> = [];
  try {
    valueRanges = await batchGet(sheetId, tabs.map(t => `${t}!A:ZZ`));
  } catch (err) {
    errors.push(`batchGet failed: ${(err as Error).message}`);
    return { rows: [], tabs, errors };
  }

  const out: SourcePaymentRow[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const rows = valueRanges[i]?.values || [];
    if (rows.length === 0) continue;
    const { headerIdx, routing } = findHeaderRow(rows);
    if (routing.every(c => !c)) continue; // tab doesn't look like a payment table
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.every(c => !(c || '').trim())) continue;
      const entry = readEntry(row, routing, tab, r + 1);
      if (!entry.payee_name && !entry.amount_usd) continue;
      out.push(entry);
    }
  }
  return { rows: out, tabs, errors };
}

export type E3Payment = {
  payment_id?: string;
  pr_id?: string;
  payee_name?: string;
  amount_usd?: string;
  payment_date?: string;
  status?: string;
};

export function findE3PaymentMatch(src: SourcePaymentRow, e3: E3Payment[]): E3Payment | null {
  if (src.pr_id) {
    const hit = e3.find(r => (r.pr_id || '').trim().toLowerCase() === src.pr_id.toLowerCase());
    if (hit) return hit;
  }
  const norm = (s: string) => (s || '').replace(/\s+/g, ' ').toLowerCase().trim();
  if (src.payee_name && src.amount_usd) {
    const total = parseFloat(src.amount_usd) || 0;
    const hit = e3.find(r =>
      norm(r.payee_name || '') === norm(src.payee_name) &&
      Math.abs((parseFloat(r.amount_usd || '0') || 0) - total) < 0.5
    );
    if (hit) return hit;
  }
  return null;
}
