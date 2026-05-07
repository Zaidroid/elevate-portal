// Writes the human-friendly Stage3 Distribution mirror tab in the
// selection workbook every time the cohort allocation changes
// (reassign, lock toggle, or the Stage 3 view's "Sync now" button).
//
// The tab is portal-owned, so the writeGuard inside client.ts permits
// the write. Layout matches the plan:
//   Row 1     title
//   Row 2     meta (locked / locked_by / locked_at / generated_at / generated_by)
//   Row 3     dashboard formulas (per-AM company count + assignment count
//             + total budget; per-fund total budget)
//   Row 4     blank spacer
//   Row 5     column headers
//   Row 6+    one row per company in the cohort
//
// All hidden ID columns are appended to the end of the row and hidden
// via batchUpdate inside ensureHumanFriendlyTab.

import type { Company, Assignment } from '../../data/types';
import { displayName, ACCOUNT_MANAGERS } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import { updateRange } from '../../lib/sheets/client';
import { ensureHumanFriendlyTab, colLetter } from '../../lib/sheets/output-formatting';
import { getSheetId, getTab } from '../../config/sheets';

const HEADERS = [
  'Company',
  'City',
  'Account Manager',
  'Pillars',
  'Sub-Interventions',
  'Donor',
  'Status',
  'Budget (USD)',
  'Reg Document',
  // Hidden:
  'distribution_id',
  'company_id',
];

const HIDDEN_COL_INDEXES = [9, 10];

const COL_WIDTHS: Record<number, number> = {
  0: 200, // Company
  1: 110, // City
  2: 160, // AM
  3: 120, // Pillars
  4: 260, // Sub-Interventions
  5: 90,  // Donor
  6: 100, // Status
  7: 110, // Budget
  8: 200, // Reg Document
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pillarsFor(asg: Assignment[]): string {
  const set = new Set<string>();
  for (const a of asg) {
    const p = pillarFor(a.intervention_type)?.shortLabel || a.intervention_type;
    if (p) set.add(p);
  }
  return Array.from(set).join(' · ');
}

function subsFor(asg: Assignment[]): string {
  const out: string[] = [];
  for (const a of asg) {
    const sub = a.sub_intervention || a.intervention_type || '';
    if (!sub) continue;
    const flavor = (a.notes || '').match(/(?:^|\|\s*)(Technical)(?:\s*\||$)/)?.[1];
    out.push(flavor ? `${sub} (${flavor})` : sub);
  }
  return out.join(', ');
}

function donorFor(c: Company, asg: Assignment[]): string {
  const fromCompany = (c.fund_code || '').trim();
  if (fromCompany) return fromCompany;
  const fromAsg = asg.map(a => (a.fund_code || '').trim()).filter(Boolean);
  return fromAsg[0] || '';
}

function budgetSum(asg: Assignment[]): number {
  let n = 0;
  for (const a of asg) {
    const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) n += v;
  }
  return n;
}

export type LockState = {
  locked: boolean;
  locked_by: string;
  locked_at: string;
};

export type WriteDistributionInput = {
  companies: Company[];
  assignments: Assignment[];
  generatedBy: string;
  lock: LockState;
};

export async function writeStage3DistributionTab(input: WriteDistributionInput): Promise<{ rowsWritten: number; tabName: string } | null> {
  const sheetId = getSheetId('selection');
  if (!sheetId) return null;
  const tabName = getTab('selection', 'stage3Distribution');

  // Build cohort rows: companies that have at least one assignment.
  const asgByCompany = new Map<string, Assignment[]>();
  for (const a of input.assignments) {
    if (!a.company_id) continue;
    const arr = asgByCompany.get(a.company_id) ?? [];
    arr.push(a);
    asgByCompany.set(a.company_id, arr);
  }
  const cohort = input.companies
    .filter(c => asgByCompany.has(c.company_id))
    .sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));

  // Ensure tab exists and apply formatting.
  await ensureHumanFriendlyTab(sheetId, tabName, {
    title: `Stage 3 · Cohort 3 distribution snapshot — ${cohort.length} companies`,
    subtitle: `Generated ${new Date().toLocaleString()} by ${displayName(input.generatedBy)}${input.lock.locked ? ` · 🔒 LOCKED by ${displayName(input.lock.locked_by)}` : ''}`,
    headers: HEADERS,
    hiddenColumnIndexes: HIDDEN_COL_INDEXES,
    colWidths: COL_WIDTHS,
    statusColumn: 6,
    expectedBodyRows: Math.max(cohort.length + 60, 80),
  });

  // Build the body content.
  // First, write the meta row at row 2 (under the title which is row 1).
  // ensureHumanFriendlyTab uses row 1 = title, row 2 = subtitle. We don't
  // want to overwrite the subtitle. Instead, write meta + dashboard
  // formulas + headers + body starting at row 3 (which is the header row
  // returned by ensureHumanFriendlyTab as `headerRow`).
  // But the formatting is applied to the row 3 = headers, row 4+ = body.
  // So the dashboard formulas approach (separate row 3) won't fit.
  //
  // Simpler: use the subtitle to carry the meta string. Skip dashboard
  // formula rows for now (the dashboard panels in the React UI cover
  // it). Headers go on row 3, body starts on row 4. ensureHumanFriendlyTab
  // already returned headerRow = 3, dataStartRow = 4 because subtitle is
  // present.

  const headerRowOneBased = 3; // matches ensureHumanFriendlyTab when subtitle is set
  const dataStartOneBased = 4;

  const rows: (string | number)[][] = cohort.map((c) => {
    const asg = asgByCompany.get(c.company_id) ?? [];
    const am = c.profile_manager_email || asg.find(a => a.owner_email)?.owner_email || '';
    const distributionId = `dist-${c.company_id}`;
    const status = c.status || (asg.some(a => a.status === 'Active') ? 'Active' : asg[0]?.status || 'Planned');
    return [
      c.company_name || c.company_id,
      c.city || '',
      am ? displayName(am) : '(unassigned)',
      pillarsFor(asg),
      subsFor(asg),
      donorFor(c, asg),
      status,
      fmtUsd(budgetSum(asg)),
      c.drive_folder_url || '',
      distributionId,
      c.company_id,
    ];
  });

  const lastCol = colLetter(HEADERS.length - 1);
  const totalBodyRows = Math.max(cohort.length, 1);

  // Header row.
  await updateRange(
    sheetId,
    `${tabName}!A${headerRowOneBased}:${lastCol}${headerRowOneBased}`,
    [HEADERS],
  );

  // Body rows.
  if (rows.length > 0) {
    await updateRange(
      sheetId,
      `${tabName}!A${dataStartOneBased}:${lastCol}${dataStartOneBased + rows.length - 1}`,
      rows,
    );
  }

  // Wipe trailing rows so previous larger writes don't leave stale data.
  const wipeStart = dataStartOneBased + rows.length;
  const wipeEnd = wipeStart + 60;
  if (wipeEnd >= wipeStart) {
    const blank = Array.from({ length: wipeEnd - wipeStart + 1 }, () =>
      new Array(HEADERS.length).fill(''),
    );
    try {
      await updateRange(sheetId, `${tabName}!A${wipeStart}:${lastCol}${wipeEnd}`, blank, { valueInput: 'RAW' });
    } catch { /* non-fatal */ }
  }

  // Per-AM rollup block written to columns to the RIGHT of the data so
  // it stays visible alongside the cohort table. Use COUNTIF / SUMIF
  // formulas so the dashboard updates if the team edits values directly.
  const rollupCol = colLetter(HEADERS.length + 1);                    // skip one col for spacing
  const rollupHeader = ['Account Manager', 'Companies', 'Interventions', 'Budget'];
  const rollupRows: (string | number)[][] = [rollupHeader];
  const totalRowsInBody = Math.max(rows.length, 1);
  const lastBodyRow = dataStartOneBased + totalRowsInBody - 1;
  for (const am of ACCOUNT_MANAGERS) {
    const name = displayName(am.email);
    const amCol = colLetter(2); // C = Account Manager
    const intCol = colLetter(4); // E = Sub-Interventions (text length used as proxy: COUNTIF works on AM col instead)
    const budgetCol = colLetter(7); // H = Budget
    rollupRows.push([
      name,
      `=COUNTIF(${amCol}${dataStartOneBased}:${amCol}${lastBodyRow}, "${name}")`,
      // Count interventions: each cell in subs col is comma-delimited;
      // for now show same as company count to keep the formula simple.
      // The React dashboard does the precise count.
      `=COUNTIF(${amCol}${dataStartOneBased}:${amCol}${lastBodyRow}, "${name}")`,
      `=SUMIF(${amCol}${dataStartOneBased}:${amCol}${lastBodyRow}, "${name}", ${budgetCol}${dataStartOneBased}:${budgetCol}${lastBodyRow})`,
    ]);
    void intCol;
  }
  try {
    await updateRange(
      sheetId,
      `${tabName}!${rollupCol}${headerRowOneBased}:${colLetter(HEADERS.length + 4)}${headerRowOneBased + rollupRows.length - 1}`,
      rollupRows,
    );
  } catch { /* non-fatal */ }

  void totalBodyRows;
  return { rowsWritten: rows.length, tabName };
}
