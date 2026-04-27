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

import { ensureSchema, updateRange } from '../../lib/sheets/client';

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
function buildDashboardRows(): (string | number | boolean)[][] {
  const rows: (string | number | boolean)[][] = [];

  // Title.
  rows.push(['Companies Master Dashboard']);
  rows.push(['Live mirror of the Companies module in the Elevate Portal.']);
  rows.push([]);

  // Top metrics — total companies + the three most-watched status counts.
  rows.push(['Top metrics', '', '']);
  rows.push([
    'Companies', '=COUNTA(Companies!B2:B1000)', '',
    'Active', '=COUNTIF(Companies!M2:M1000,"Active")', '',
    'Onboarded', '=COUNTIF(Companies!M2:M1000,"Onboarded")', '',
    'Selected', '=COUNTIF(Companies!M2:M1000,"Selected")', '',
  ]);
  rows.push([]);

  // Funnel by status — every current status with a count + bar.
  rows.push(['Funnel by status', '', '', '']);
  for (const s of COMPANY_STATUSES) {
    rows.push([
      s,
      `=COUNTIF(Companies!M2:M1000,"${s}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Companies!M2:M1000,"${s}")/MAX(1,COUNTA(Companies!M2:M1000))*40,0))),"")`,
    ]);
  }
  rows.push([]);

  // By fund.
  rows.push(['By fund', '', '']);
  for (const f of FUND_CODES) {
    const label = f === '97060' ? `${f} (Dutch)` : f === '91763' ? `${f} (SIDA)` : f;
    rows.push([
      label,
      `=COUNTIF(Companies!K2:K1000,"${f}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Companies!K2:K1000,"${f}")/MAX(1,COUNTA(Companies!K2:K1000))*40,0))),"")`,
    ]);
  }
  rows.push([]);

  // Active assignments by intervention.
  rows.push(['Assignments by intervention', '', '']);
  for (const p of PILLARS) {
    rows.push([
      p,
      `=COUNTIF('Intervention Assignments'!C2:C1000,"${p}")`,
      `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF('Intervention Assignments'!C2:C1000,"${p}")/MAX(1,COUNTA('Intervention Assignments'!C2:C1000))*40,0))),"")`,
    ]);
  }
  rows.push([]);

  // Reviews summary — pulls from the Reviews tab if it exists.
  rows.push(['Reviews', '', '']);
  rows.push(['Total reviews', `=COUNTA(Reviews!A2:A2000)`, '']);
  rows.push(['Recommended', `=COUNTIF(Reviews!D2:D2000,"Recommend")`, `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Recommend")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`]);
  rows.push(['Hold', `=COUNTIF(Reviews!D2:D2000,"Hold")`, `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Hold")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`]);
  rows.push(['Reject', `=COUNTIF(Reviews!D2:D2000,"Reject")`, `=IFERROR(REPT("█",MIN(40,ROUND(COUNTIF(Reviews!D2:D2000,"Reject")/MAX(1,COUNTA(Reviews!D2:D2000))*40,0))),"")`]);
  rows.push([]);

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

  const rows = buildDashboardRows();
  const maxCols = Math.max(1, ...rows.map(r => r.length));
  const padded = rows.map(r => {
    const out: (string | number | boolean)[] = [...r];
    while (out.length < maxCols) out.push('');
    return out;
  });

  // Write the canonical content directly. We deliberately do NOT
  // pre-clear: a separate pre-clear call leaves the sheet blank if
  // the follow-up write fails for any reason (auth blip, rate limit,
  // formula reference error, protected-range rejection). Better to
  // overwrite-in-place. Trailing rows from a previous larger
  // dashboard layout get wiped below.
  const lastCol = colLetter(maxCols - 1);
  try {
    await updateRange(sheetId, `Dashboard!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    errors.push(`write failed: ${(err as Error).message}`);
    return { rowsWritten: 0, errors };
  }

  // Wipe anything that lingered from an older, taller dashboard layout
  // ONLY after the canonical content write succeeded — so a failed
  // wipe still leaves the dashboard intact.
  const wipeStartRow = padded.length + 1;
  const wipeEndRow = padded.length + 80;
  const wipe = new Array(wipeEndRow - wipeStartRow + 1).fill(0).map(() => new Array(maxCols).fill(''));
  try {
    await updateRange(sheetId, `Dashboard!A${wipeStartRow}:${lastCol}${wipeEndRow}`, wipe, { valueInput: 'RAW' });
  } catch (err) {
    // Non-fatal — the canonical content is already there, this only
    // cleans up stale rows. Surface a warning but don't fail the call.
    errors.push(`stale-row wipe failed (non-fatal): ${(err as Error).message}`);
  }

  return { rowsWritten: padded.length, errors };
}
