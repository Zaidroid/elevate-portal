// Rebuild the Dashboard tab in the Companies workbook with canonical
// COUNTIF formulas keyed off the current Companies / Intervention
// Assignments / Reviews schemas. Idempotent — overwrites the tab's
// content but doesn't change the tab itself.
//
// We never touch the Companies / Assignments / Reviews data tabs; this
// only rewrites the Dashboard so its KPIs match the cohort that's
// actually in the sheet (e.g., 'Interviewed', 'Reviewing',
// 'Recommended', 'Selected', 'Onboarded', 'Active', 'Graduated',
// 'Withdrawn').

import { batchUpdate, ensureSchema, getSpreadsheetMeta, updateRange } from '../../lib/sheets/client';

const COMPANY_STATUSES = [
  'Applicant', 'Shortlisted', 'Interviewed', 'Reviewing', 'Recommended',
  'Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn',
];

const FUND_CODES = ['97060', '91763'];

const PILLARS = ['TTH', 'Upskilling', 'MKG', 'MA', 'ElevateBridge', 'C-Suite', 'Conferences'];

export type RepairResult = {
  rowsWritten: number;
  errors: string[];
};

// Builds a list of [string][] rows that get pasted into A1:onwards on
// the Dashboard tab. We use plain text + formulas so the rebuild is
// portable across Sheets / Excel and survives if the team renames the
// brand colors.
// Every dashboard row is exactly 3 columns: [label, value, bar]. Consistent
// width avoids the legacy multi-column merging that the older Python
// builder left behind from clashing with our content.
function buildDashboardRows(): (string | number | boolean)[][] {
  const rows: (string | number | boolean)[][] = [];

  const section = (label: string) => {
    rows.push([label, '', '']);
  };
  const metric = (label: string, valueFormula: string, barFormula: string = '') => {
    rows.push([label, valueFormula, barFormula]);
  };
  const blank = () => rows.push(['', '', '']);

  // Title.
  rows.push(['Companies Master Dashboard', '', '']);
  rows.push(['Live mirror of the Companies module in the Elevate Portal.', '', '']);
  blank();

  // Top metrics — vertical, one per row.
  section('Top metrics');
  metric('Total companies in master', '=COUNTA(Companies!B2:B2000)');
  metric('Interviewed', '=COUNTIF(Companies!M2:M2000,"Interviewed")');
  metric('Selected', '=COUNTIF(Companies!M2:M2000,"Selected")');
  metric('Onboarded', '=COUNTIF(Companies!M2:M2000,"Onboarded")');
  metric('Active', '=COUNTIF(Companies!M2:M2000,"Active")');
  blank();

  // Funnel by status — every current status with a count + bar.
  section('Funnel by status');
  for (const s of COMPANY_STATUSES) {
    metric(
      s,
      `=COUNTIF(Companies!M2:M2000,"${s}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Companies!M2:M2000,"${s}")/MAX(1,COUNTA(Companies!M2:M2000))*40,0))),"")`,
    );
  }
  blank();

  // By fund.
  section('By fund');
  for (const f of FUND_CODES) {
    const label = f === '97060' ? `${f} (Dutch)` : f === '91763' ? `${f} (SIDA)` : f;
    metric(
      label,
      `=COUNTIF(Companies!K2:K2000,"${f}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Companies!K2:K2000,"${f}")/MAX(1,COUNTA(Companies!K2:K2000))*40,0))),"")`,
    );
  }
  blank();

  // Assignments by intervention pillar.
  section('Assignments by intervention');
  for (const p of PILLARS) {
    metric(
      p,
      `=COUNTIF('Intervention Assignments'!C2:C2000,"${p}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF('Intervention Assignments'!C2:C2000,"${p}")/MAX(1,COUNTA('Intervention Assignments'!C2:C2000))*40,0))),"")`,
    );
  }
  blank();

  // Reviews summary — pulls from the Reviews tab.
  section('Reviews');
  metric('Total reviews', `=COUNTA(Reviews!A2:A2000)`);
  metric(
    'Recommended',
    `=COUNTIF(Reviews!D2:D2000,"Recommend")`,
    `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Recommend")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`,
  );
  metric(
    'Hold',
    `=COUNTIF(Reviews!D2:D2000,"Hold")`,
    `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Hold")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`,
  );
  metric(
    'Reject',
    `=COUNTIF(Reviews!D2:D2000,"Reject")`,
    `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Reject")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`,
  );
  blank();

  return rows;
}

function colLetter(n: number): string {
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export async function repairDashboard(sheetId: string): Promise<RepairResult> {
  const errors: string[] = [];
  // Make sure a Dashboard tab exists; if not, create one with a single
  // header cell so the write below has somewhere to land.
  await ensureSchema(sheetId, 'Dashboard', ['Companies Master Dashboard']);

  // Find the numeric sheetId for the Dashboard tab so we can issue
  // unmergeCells + clearFormatting requests.
  let dashboardSheetId: number | null = null;
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const dash = meta.sheets.find(s => s.title === 'Dashboard');
    if (dash) dashboardSheetId = dash.sheetId;
  } catch (err) {
    errors.push(`could not look up Dashboard tab id: ${(err as Error).message}`);
  }

  // Unmerge every merged range on the Dashboard tab + reset cell
  // formatting. The previous Python builder created merged cells with
  // brand colors that were clashing with our new vertical 3-col layout
  // (the 'Active' / 'Onboarded' / 'Selected' colored blocks the user
  // saw in the screenshot were merge artefacts from row 5 of the old
  // layout). batchUpdate is best-effort — non-fatal if it errors.
  if (dashboardSheetId !== null) {
    try {
      await batchUpdate(sheetId, [
        {
          unmergeCells: {
            range: {
              sheetId: dashboardSheetId,
              startRowIndex: 0,
              endRowIndex: 200,
              startColumnIndex: 0,
              endColumnIndex: 26,
            },
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: dashboardSheetId,
              startRowIndex: 0,
              endRowIndex: 200,
              startColumnIndex: 0,
              endColumnIndex: 26,
            },
            cell: { userEnteredFormat: {} },
            fields: 'userEnteredFormat',
          },
        },
      ]);
    } catch (err) {
      errors.push(`unmerge / format-reset failed (non-fatal): ${(err as Error).message}`);
    }
  }

  const rows = buildDashboardRows();
  const maxCols = Math.max(1, ...rows.map(r => r.length));
  const padded = rows.map(r => {
    const out: (string | number | boolean)[] = [...r];
    while (out.length < maxCols) out.push('');
    return out;
  });

  // Write the canonical content. If this fails we return early — the
  // unmerge ran but nothing got blanked, so the sheet is in a defined
  // (if empty) state.
  const lastCol = colLetter(maxCols - 1);
  try {
    await updateRange(sheetId, `Dashboard!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    errors.push(`content write failed: ${(err as Error).message}`);
    return { rowsWritten: 0, errors };
  }

  // Wipe anything that lingered from an older, taller dashboard layout
  // ONLY after the canonical content write succeeded.
  const wipeStartRow = padded.length + 1;
  const wipeEndRow = padded.length + 80;
  const wipe = new Array(wipeEndRow - wipeStartRow + 1).fill(0).map(() => new Array(maxCols).fill(''));
  try {
    await updateRange(sheetId, `Dashboard!A${wipeStartRow}:${lastCol}${wipeEndRow}`, wipe, { valueInput: 'RAW' });
  } catch (err) {
    errors.push(`stale-row wipe failed (non-fatal): ${(err as Error).message}`);
  }

  return { rowsWritten: padded.length, errors };
}
