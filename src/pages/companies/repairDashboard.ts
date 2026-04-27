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
// Internal row shape — keeps a tag so we know later which rows to bold,
// which to color as a value, etc. when we apply formatting via
// batchUpdate.
type DashboardRow = {
  tag: 'title' | 'subtitle' | 'section' | 'metric' | 'blank';
  cells: (string | number | boolean)[];
};

// Every dashboard row is exactly 3 columns: [label, value, bar]. The
// content gets padded to 26 columns at write time so any legacy
// multi-column content from the original Python builder gets cleared.
function buildDashboardRows(): DashboardRow[] {
  const rows: DashboardRow[] = [];

  const section = (label: string) => rows.push({ tag: 'section', cells: [label, '', ''] });
  const metric = (label: string, valueFormula: string, barFormula: string = '') =>
    rows.push({ tag: 'metric', cells: [label, valueFormula, barFormula] });
  const blank = () => rows.push({ tag: 'blank', cells: ['', '', ''] });

  // Title.
  rows.push({ tag: 'title', cells: ['Companies Master Dashboard', '', ''] });
  rows.push({ tag: 'subtitle', cells: ['Live mirror of the Companies module in the Elevate Portal.', '', ''] });
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

// Brand palette used for cell styling. Mirrors the GSG portal palette
// so the dashboard tab looks like the rest of the system.
const BRAND_NAVY = { red: 0.07, green: 0.15, blue: 0.27 };       // navy-500
const BRAND_TEAL = { red: 0.0, green: 0.66, blue: 0.74 };        // brand teal
const BRAND_BG_LIGHT = { red: 0.96, green: 0.97, blue: 0.99 };   // header row tint
const WHITE = { red: 1, green: 1, blue: 1 };

const TARGET_COL_WIDTH = 26;

export async function repairDashboard(sheetId: string): Promise<RepairResult> {
  const errors: string[] = [];

  await ensureSchema(sheetId, 'Dashboard', ['Companies Master Dashboard']);

  // Resolve the Dashboard tab's numeric sheetId for the batchUpdate
  // formatting requests later.
  let dashboardSheetId: number | null = null;
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const dash = meta.sheets.find(s => s.title === 'Dashboard');
    if (dash) dashboardSheetId = dash.sheetId;
  } catch (err) {
    errors.push(`could not look up Dashboard tab id: ${(err as Error).message}`);
  }

  // Unmerge every merged range on the Dashboard tab + reset cell
  // formatting. Non-fatal if it fails.
  if (dashboardSheetId !== null) {
    try {
      await batchUpdate(sheetId, [
        { unmergeCells: { range: rangeRef(dashboardSheetId, 0, 200, 0, TARGET_COL_WIDTH) } },
        {
          repeatCell: {
            range: rangeRef(dashboardSheetId, 0, 200, 0, TARGET_COL_WIDTH),
            cell: { userEnteredFormat: {} },
            fields: 'userEnteredFormat',
          },
        },
      ]);
    } catch (err) {
      errors.push(`unmerge / format-reset failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // Build content + write across the full 26-col width so any legacy
  // values in cells D-Z get blanked. Without this, the previous 12-col
  // 'Top metrics' row had labels like 'Active'/'Onboarded'/'Selected'
  // sitting in cols E/H/K which our 3-col write left untouched.
  const rows = buildDashboardRows();
  const padded = rows.map(r => {
    const out: (string | number | boolean)[] = [...r.cells];
    while (out.length < TARGET_COL_WIDTH) out.push('');
    return out;
  });

  const lastCol = colLetter(TARGET_COL_WIDTH - 1);
  try {
    await updateRange(sheetId, `Dashboard!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    errors.push(`content write failed: ${(err as Error).message}`);
    return { rowsWritten: 0, errors };
  }

  // Wipe stale rows below.
  const wipeStartRow = padded.length + 1;
  const wipeEndRow = padded.length + 80;
  const wipe = new Array(wipeEndRow - wipeStartRow + 1)
    .fill(0)
    .map(() => new Array(TARGET_COL_WIDTH).fill(''));
  try {
    await updateRange(sheetId, `Dashboard!A${wipeStartRow}:${lastCol}${wipeEndRow}`, wipe, { valueInput: 'RAW' });
  } catch (err) {
    errors.push(`stale-row wipe failed (non-fatal): ${(err as Error).message}`);
  }

  // Apply formatting per row tag. Title gets a large bold navy font;
  // section headers get bold + tinted background; metric rows get
  // bold first column + monospace value column.
  if (dashboardSheetId !== null) {
    const requests: unknown[] = [];

    // Column widths so the layout is readable: A label wide, B value
    // narrow, C bar wide.
    requests.push(setColWidth(dashboardSheetId, 0, 260));   // A
    requests.push(setColWidth(dashboardSheetId, 1, 90));    // B
    requests.push(setColWidth(dashboardSheetId, 2, 380));   // C

    rows.forEach((r, i) => {
      const rowIdx = i;
      switch (r.tag) {
        case 'title':
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId!, rowIdx, rowIdx + 1, 0, 4), mergeType: 'MERGE_ROWS' },
          });
          requests.push(formatRow(dashboardSheetId, rowIdx, 0, 4, {
            backgroundColor: BRAND_NAVY,
            textFormat: { fontSize: 18, bold: true, foregroundColor: WHITE, fontFamily: 'Source Sans Pro' },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'LEFT',
            padding: { top: 8, bottom: 8, left: 12, right: 12 },
          }));
          requests.push(setRowHeight(dashboardSheetId, rowIdx, 38));
          break;
        case 'subtitle':
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId!, rowIdx, rowIdx + 1, 0, 4), mergeType: 'MERGE_ROWS' },
          });
          requests.push(formatRow(dashboardSheetId, rowIdx, 0, 4, {
            textFormat: { fontSize: 11, italic: true, foregroundColor: { red: 0.4, green: 0.45, blue: 0.55 }, fontFamily: 'Source Sans Pro' },
            horizontalAlignment: 'LEFT',
            padding: { top: 4, bottom: 8, left: 12, right: 12 },
          }));
          break;
        case 'section':
          requests.push(formatRow(dashboardSheetId, rowIdx, 0, TARGET_COL_WIDTH, {
            backgroundColor: BRAND_BG_LIGHT,
            textFormat: { fontSize: 11, bold: true, foregroundColor: BRAND_NAVY, fontFamily: 'Source Sans Pro' },
            horizontalAlignment: 'LEFT',
            padding: { top: 6, bottom: 6, left: 8, right: 8 },
          }));
          requests.push(setRowHeight(dashboardSheetId, rowIdx, 26));
          // top + bottom border for section header
          requests.push({
            updateBorders: {
              range: rangeRef(dashboardSheetId!, rowIdx, rowIdx + 1, 0, 3),
              top: { style: 'SOLID', width: 1, color: BRAND_TEAL },
              bottom: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.88, blue: 0.92 } },
            },
          });
          break;
        case 'metric':
          // Label cell (col A) bold navy
          requests.push(formatRow(dashboardSheetId, rowIdx, 0, 1, {
            textFormat: { fontSize: 11, bold: true, foregroundColor: BRAND_NAVY, fontFamily: 'Source Sans Pro' },
            horizontalAlignment: 'LEFT',
            padding: { top: 4, bottom: 4, left: 12, right: 4 },
          }));
          // Value cell (col B) right-aligned mono
          requests.push(formatRow(dashboardSheetId, rowIdx, 1, 2, {
            textFormat: { fontSize: 11, bold: true, foregroundColor: BRAND_NAVY, fontFamily: 'Roboto Mono' },
            horizontalAlignment: 'RIGHT',
            padding: { top: 4, bottom: 4, left: 4, right: 12 },
          }));
          // Bar cell (col C) teal
          requests.push(formatRow(dashboardSheetId, rowIdx, 2, 3, {
            textFormat: { fontSize: 11, foregroundColor: BRAND_TEAL, fontFamily: 'Roboto Mono' },
            horizontalAlignment: 'LEFT',
            padding: { top: 4, bottom: 4, left: 8, right: 8 },
          }));
          break;
        default:
          break;
      }
    });

    if (requests.length > 0) {
      try {
        // batchUpdate has a request size cap; split into chunks of 100.
        const chunks: unknown[][] = [];
        for (let i = 0; i < requests.length; i += 100) chunks.push(requests.slice(i, i + 100));
        for (const c of chunks) await batchUpdate(sheetId, c);
      } catch (err) {
        errors.push(`formatting failed (non-fatal): ${(err as Error).message}`);
      }
    }
  }

  return { rowsWritten: padded.length, errors };
}

// ─────────── batchUpdate request helpers ───────────

function rangeRef(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startCol,
    endColumnIndex: endCol,
  };
}

function formatRow(
  sheetId: number,
  rowIdx: number,
  startCol: number,
  endCol: number,
  format: Record<string, unknown>,
): unknown {
  const fields = Object.keys(format).map(k => `userEnteredFormat.${k}`).join(',');
  return {
    repeatCell: {
      range: rangeRef(sheetId, rowIdx, rowIdx + 1, startCol, endCol),
      cell: { userEnteredFormat: format },
      fields,
    },
  };
}

function setColWidth(sheetId: number, colIdx: number, pixels: number): unknown {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
      properties: { pixelSize: pixels },
      fields: 'pixelSize',
    },
  };
}

function setRowHeight(sheetId: number, rowIdx: number, pixels: number): unknown {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
      properties: { pixelSize: pixels },
      fields: 'pixelSize',
    },
  };
}
