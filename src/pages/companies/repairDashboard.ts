// Rebuilds the Companies workbook's Dashboard tab so the live result
// is visually identical to the build-time output of
// sheet-builders/builders/companies_master.py and matches the
// helper-driven pattern used by the other workbooks
// (sheet-builders/gsg_sheets/dashboard.py).
//
// Layout: 12-column virtual grid.
//  - Title row: navy fill, white bold 18pt, merged A:L
//  - Subtitle row: muted slate, merged A:L
//  - Section header: navy bar with white bold text, merged A:L
//  - KPI tile: 3 cols wide × 2 rows (label band + value band). 4 per row.
//  - Funnel row: A=label bold navy, B=value navy, C:L merged as the bar.
//
// Formula ranges go to row 2000 to match the bumped headcount.

import { batchUpdate, ensureSchema, getSpreadsheetMeta, updateRange } from '../../lib/sheets/client';

// ─── canonical taxonomy ──────────────────────────────────────────────
const COMPANY_STATUSES = [
  'Applicant', 'Shortlisted', 'Interviewed', 'Reviewing', 'Recommended',
  'Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn',
];

const FUND_CODES: Array<{ code: string; label: string }> = [
  { code: '97060', label: '97060 (Dutch)' },
  { code: '91763', label: '91763 (SIDA)' },
];

const PILLARS = ['TTH', 'Upskilling', 'MKG', 'MA', 'ElevateBridge', 'C-Suite', 'Conferences'];

// ─── brand palette (mirrors gsg_sheets/brand.py) ─────────────────────
const BRAND_NAVY = { red: 0.07, green: 0.15, blue: 0.27 };
const BRAND_TEAL = { red: 0.0, green: 0.66, blue: 0.74 };
const BRAND_RED = { red: 0.84, green: 0.27, blue: 0.18 };
const BRAND_AMBER = { red: 0.55, green: 0.42, blue: 0.07 };
const BRAND_GREEN = { red: 0.18, green: 0.49, blue: 0.31 };
const TILE_NAVY = { fill: BRAND_NAVY, fg: { red: 1, green: 1, blue: 1 } };
const TILE_TEAL = { fill: { red: 0.90, green: 0.95, blue: 0.97 }, fg: BRAND_TEAL };
const TILE_GREEN = { fill: { red: 0.91, green: 0.96, blue: 0.92 }, fg: BRAND_GREEN };
const TILE_AMBER = { fill: { red: 0.99, green: 0.95, blue: 0.85 }, fg: BRAND_AMBER };
const TILE_RED = { fill: { red: 0.99, green: 0.93, blue: 0.91 }, fg: BRAND_RED };
const MUTED = { red: 0.4, green: 0.45, blue: 0.55 };
const WHITE = { red: 1, green: 1, blue: 1 };

const FONT = 'Source Sans Pro';
const MONO = 'Roboto Mono';

const TARGET_COL_WIDTH = 12; // 12-col virtual grid (A:L)

export type RepairResult = {
  rowsWritten: number;
  errors: string[];
};

// Range strings for the funnel formulas. Bumped to 2000 so the live
// result matches the build-time builder.
const COMPANY_STATUS_RNG = 'Companies!M2:M2000';
const COMPANY_NAME_RNG = 'Companies!B2:B2000';
const COMPANY_FUND_RNG = 'Companies!K2:K2000';
const ASSIGN_PILLAR_RNG = "'Intervention Assignments'!C2:C2000";
const REVIEWS_DECISION_RNG = 'Reviews!D2:D2000';
const REVIEWS_ID_RNG = 'Reviews!A2:A2000';

// ─── content model ───────────────────────────────────────────────────
type Block =
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'kpiRow'; tiles: Array<{ label: string; formula: string; tone: 'navy' | 'teal' | 'green' | 'amber' | 'red' }> }
  | { kind: 'bar'; label: string; valueFormula: string; barFormula: string; tone?: 'teal' | 'red' }
  | { kind: 'spacer' };

function bar(label: string, countFormula: string, totalFormula: string, tone: 'teal' | 'red' = 'red'): Block {
  return {
    kind: 'bar',
    label,
    valueFormula: countFormula,
    barFormula: `=IFERROR(REPT("█",MIN(40,ROUND(${countFormula}/MAX(1,${totalFormula})*40,0)))&REPT("░",MAX(0,40-MIN(40,ROUND(${countFormula}/MAX(1,${totalFormula})*40,0)))),"")`,
    tone,
  };
}

function buildBlocks(): Block[] {
  const blocks: Block[] = [];
  blocks.push({ kind: 'title', text: 'Companies Master Dashboard' });
  blocks.push({ kind: 'subtitle', text: 'Live mirror of the Companies module in the Elevate Portal.' });
  blocks.push({ kind: 'spacer' });

  // Top KPI tiles (4 across).
  blocks.push({ kind: 'section', text: 'Top metrics' });
  blocks.push({
    kind: 'kpiRow',
    tiles: [
      { label: 'Total in master', formula: `=COUNTA(${COMPANY_NAME_RNG})`, tone: 'navy' },
      { label: 'Interviewed+', formula: `=COUNTIF(${COMPANY_STATUS_RNG},"Interviewed")+COUNTIF(${COMPANY_STATUS_RNG},"Reviewing")+COUNTIF(${COMPANY_STATUS_RNG},"Recommended")+COUNTIF(${COMPANY_STATUS_RNG},"Selected")+COUNTIF(${COMPANY_STATUS_RNG},"Onboarded")+COUNTIF(${COMPANY_STATUS_RNG},"Active")`, tone: 'teal' },
      { label: 'Selected', formula: `=COUNTIF(${COMPANY_STATUS_RNG},"Selected")`, tone: 'green' },
      { label: 'Active', formula: `=COUNTIF(${COMPANY_STATUS_RNG},"Active")`, tone: 'amber' },
    ],
  });

  // Funnel by status.
  blocks.push({ kind: 'section', text: 'Funnel by status' });
  for (const s of COMPANY_STATUSES) {
    blocks.push(bar(s, `COUNTIF(${COMPANY_STATUS_RNG},"${s}")`, `COUNTA(${COMPANY_STATUS_RNG})`, 'red'));
  }
  blocks.push({ kind: 'spacer' });

  // By fund.
  blocks.push({ kind: 'section', text: 'By fund' });
  for (const f of FUND_CODES) {
    blocks.push(bar(f.label, `COUNTIF(${COMPANY_FUND_RNG},"${f.code}")`, `COUNTA(${COMPANY_FUND_RNG})`, 'teal'));
  }
  blocks.push({ kind: 'spacer' });

  // Assignments by intervention pillar.
  blocks.push({ kind: 'section', text: 'Assignments by intervention' });
  for (const p of PILLARS) {
    blocks.push(bar(p, `COUNTIF(${ASSIGN_PILLAR_RNG},"${p}")`, `COUNTA(${ASSIGN_PILLAR_RNG})`, 'teal'));
  }
  blocks.push({ kind: 'spacer' });

  // Reviews summary.
  blocks.push({ kind: 'section', text: 'Reviews' });
  blocks.push({
    kind: 'kpiRow',
    tiles: [
      { label: 'Total reviews', formula: `=COUNTA(${REVIEWS_ID_RNG})`, tone: 'navy' },
      { label: 'Recommend', formula: `=COUNTIF(${REVIEWS_DECISION_RNG},"Recommend")`, tone: 'green' },
      { label: 'Hold', formula: `=COUNTIF(${REVIEWS_DECISION_RNG},"Hold")`, tone: 'amber' },
      { label: 'Reject', formula: `=COUNTIF(${REVIEWS_DECISION_RNG},"Reject")`, tone: 'red' },
    ],
  });
  for (const dec of ['Recommend', 'Hold', 'Reject'] as const) {
    blocks.push(bar(dec, `COUNTIF(${REVIEWS_DECISION_RNG},"${dec}")`, `COUNTA(${REVIEWS_DECISION_RNG})`, 'teal'));
  }

  return blocks;
}

// ─── flattening: blocks → cell rows + formatting requests ────────────
type CellGrid = (string | number | boolean)[][];

type RowRange = { start: number; end: number; tag: Block['kind']; tone?: string; tilesIdx?: number };

function flattenBlocks(blocks: Block[]): { grid: CellGrid; ranges: RowRange[] } {
  const grid: CellGrid = [];
  const ranges: RowRange[] = [];

  const blank = () => new Array(TARGET_COL_WIDTH).fill('');

  for (const b of blocks) {
    switch (b.kind) {
      case 'title': {
        const idx = grid.length;
        const r = blank();
        r[0] = b.text;
        grid.push(r);
        ranges.push({ start: idx, end: idx + 1, tag: 'title' });
        break;
      }
      case 'subtitle': {
        const idx = grid.length;
        const r = blank();
        r[0] = b.text;
        grid.push(r);
        ranges.push({ start: idx, end: idx + 1, tag: 'subtitle' });
        break;
      }
      case 'spacer': {
        grid.push(blank());
        break;
      }
      case 'section': {
        const idx = grid.length;
        const r = blank();
        r[0] = b.text;
        grid.push(r);
        ranges.push({ start: idx, end: idx + 1, tag: 'section' });
        break;
      }
      case 'kpiRow': {
        // Two rows: label band (small caps) + value band (big number).
        const labelRowIdx = grid.length;
        const valueRowIdx = labelRowIdx + 1;
        const labelRow = blank();
        const valueRow = blank();
        const cols = [0, 3, 6, 9]; // start columns for the 4 tiles
        b.tiles.forEach((t, i) => {
          const c = cols[i];
          if (c === undefined) return;
          labelRow[c] = t.label.toUpperCase();
          valueRow[c] = t.formula;
        });
        grid.push(labelRow);
        grid.push(valueRow);
        // One range per tile so we can apply the tone-specific fill.
        b.tiles.forEach((t, i) => {
          const c = cols[i];
          if (c === undefined) return;
          ranges.push({ start: labelRowIdx, end: labelRowIdx + 1, tag: 'kpiRow', tone: t.tone, tilesIdx: c });
          ranges.push({ start: valueRowIdx, end: valueRowIdx + 1, tag: 'kpiRow', tone: t.tone, tilesIdx: 100 + c }); // 100+ marks "value band"
        });
        // gutter row below the tiles
        grid.push(blank());
        break;
      }
      case 'bar': {
        const idx = grid.length;
        const r = blank();
        r[0] = b.label;
        r[1] = `=${b.valueFormula}`;
        r[2] = b.barFormula;
        grid.push(r);
        ranges.push({ start: idx, end: idx + 1, tag: 'bar', tone: b.tone || 'teal' });
        break;
      }
    }
  }

  return { grid, ranges };
}

// ─── batchUpdate request helpers ─────────────────────────────────────

function rangeRef(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return {
    sheetId,
    startRowIndex: startRow,
    endRowIndex: endRow,
    startColumnIndex: startCol,
    endColumnIndex: endCol,
  };
}

function repeatCell(_dashSheetId: number, range: ReturnType<typeof rangeRef>, format: Record<string, unknown>): unknown {
  const fields = Object.keys(format).map(k => `userEnteredFormat.${k}`).join(',');
  return {
    repeatCell: { range, cell: { userEnteredFormat: format }, fields },
  };
}

function setColWidth(dashSheetId: number, startCol: number, endCol: number, pixels: number): unknown {
  return {
    updateDimensionProperties: {
      range: { sheetId: dashSheetId, dimension: 'COLUMNS', startIndex: startCol, endIndex: endCol },
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

function colLetter(n: number): string {
  let s = '';
  let m = n;
  while (m >= 0) {
    s = String.fromCharCode(65 + (m % 26)) + s;
    m = Math.floor(m / 26) - 1;
  }
  return s;
}

const TONE_TILE: Record<string, { fill: { red: number; green: number; blue: number }; fg: { red: number; green: number; blue: number } }> = {
  navy: TILE_NAVY,
  teal: TILE_TEAL,
  green: TILE_GREEN,
  amber: TILE_AMBER,
  red: TILE_RED,
};

// ─── main ────────────────────────────────────────────────────────────

export async function repairDashboard(sheetId: string): Promise<RepairResult> {
  const errors: string[] = [];

  await ensureSchema(sheetId, 'Dashboard', ['Companies Master Dashboard']);

  let dashboardSheetId: number | null = null;
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const dash = meta.sheets.find(s => s.title === 'Dashboard');
    if (dash) dashboardSheetId = dash.sheetId;
  } catch (err) {
    errors.push(`could not look up Dashboard tab id: ${(err as Error).message}`);
  }

  const blocks = buildBlocks();
  const { grid, ranges } = flattenBlocks(blocks);

  // Pad grid to the wide format that legacy dashboards used so any
  // stale content beyond column L gets blanked out.
  const WIPE_COL_WIDTH = 26;
  const padded = grid.map(r => {
    const out = [...r];
    while (out.length < WIPE_COL_WIDTH) out.push('');
    return out;
  });

  // 1) Reset formatting + unmerge across the whole working area.
  if (dashboardSheetId !== null) {
    try {
      await batchUpdate(sheetId, [
        { unmergeCells: { range: rangeRef(dashboardSheetId, 0, 250, 0, WIPE_COL_WIDTH) } },
        repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, 0, 250, 0, WIPE_COL_WIDTH), {}),
      ]);
    } catch (err) {
      errors.push(`unmerge / format-reset failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // 2) Write the cell values + formulas.
  const lastCol = colLetter(WIPE_COL_WIDTH - 1);
  try {
    await updateRange(sheetId, `Dashboard!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    errors.push(`content write failed: ${(err as Error).message}`);
    return { rowsWritten: 0, errors };
  }

  // 3) Wipe stale rows below.
  const wipeStartRow = padded.length + 1;
  const wipeEndRow = padded.length + 80;
  const wipe = new Array(wipeEndRow - wipeStartRow + 1)
    .fill(0)
    .map(() => new Array(WIPE_COL_WIDTH).fill(''));
  try {
    await updateRange(sheetId, `Dashboard!A${wipeStartRow}:${lastCol}${wipeEndRow}`, wipe, { valueInput: 'RAW' });
  } catch (err) {
    errors.push(`stale-row wipe failed (non-fatal): ${(err as Error).message}`);
  }

  // 4) Apply formatting via batchUpdate.
  if (dashboardSheetId !== null) {
    const requests: unknown[] = [];

    // 12-col grid: each col ~92px wide so the whole strip is ~1100px.
    requests.push(setColWidth(dashboardSheetId, 0, 12, 92));
    // hide gridlines on the dashboard
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: dashboardSheetId, gridProperties: { hideGridlines: true } },
        fields: 'gridProperties.hideGridlines',
      },
    });

    for (const r of ranges) {
      switch (r.tag) {
        case 'title':
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId, r.start, r.end, 0, 12), mergeType: 'MERGE_ROWS' },
          });
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 0, 12), {
            backgroundColor: WHITE,
            textFormat: { fontSize: 18, bold: true, foregroundColor: BRAND_NAVY, fontFamily: FONT },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'LEFT',
            padding: { top: 8, bottom: 4, left: 12, right: 12 },
          }));
          requests.push(setRowHeight(dashboardSheetId, r.start, 36));
          break;
        case 'subtitle':
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId, r.start, r.end, 0, 12), mergeType: 'MERGE_ROWS' },
          });
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 0, 12), {
            textFormat: { fontSize: 11, italic: true, foregroundColor: MUTED, fontFamily: FONT },
            horizontalAlignment: 'LEFT',
            padding: { top: 0, bottom: 8, left: 12, right: 12 },
          }));
          break;
        case 'section':
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId, r.start, r.end, 0, 12), mergeType: 'MERGE_ROWS' },
          });
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 0, 12), {
            backgroundColor: BRAND_NAVY,
            textFormat: { fontSize: 12, bold: true, foregroundColor: WHITE, fontFamily: FONT },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 6, bottom: 6, left: 12, right: 12 },
          }));
          requests.push(setRowHeight(dashboardSheetId, r.start, 26));
          break;
        case 'kpiRow': {
          // tone metadata: tilesIdx < 100 ⇒ label band, ≥ 100 ⇒ value band
          const tone = TONE_TILE[r.tone || 'navy'];
          const isValueBand = (r.tilesIdx || 0) >= 100;
          const startCol = (r.tilesIdx || 0) % 100;
          const endCol = startCol + 3;
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId, r.start, r.end, startCol, endCol), mergeType: 'MERGE_ROWS' },
          });
          if (isValueBand) {
            requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, startCol, endCol), {
              backgroundColor: tone.fill,
              textFormat: { fontSize: 22, bold: true, foregroundColor: tone.fg, fontFamily: FONT },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
              padding: { top: 4, bottom: 4, left: 12, right: 12 },
            }));
            requests.push(setRowHeight(dashboardSheetId, r.start, 38));
          } else {
            requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, startCol, endCol), {
              backgroundColor: tone.fill,
              textFormat: { fontSize: 9, bold: true, foregroundColor: tone.fg, fontFamily: FONT },
              horizontalAlignment: 'LEFT',
              verticalAlignment: 'MIDDLE',
              padding: { top: 4, bottom: 4, left: 12, right: 12 },
            }));
            requests.push(setRowHeight(dashboardSheetId, r.start, 18));
          }
          break;
        }
        case 'bar': {
          // Label cell A
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 0, 1), {
            textFormat: { fontSize: 11, bold: true, foregroundColor: BRAND_NAVY, fontFamily: FONT },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 4, bottom: 4, left: 12, right: 4 },
          }));
          // Value cell B
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 1, 2), {
            textFormat: { fontSize: 11, bold: true, foregroundColor: BRAND_NAVY, fontFamily: MONO },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 4, bottom: 4, left: 4, right: 8 },
          }));
          // Bar cells C:L merged
          const tone = r.tone === 'red' ? BRAND_RED : BRAND_TEAL;
          requests.push({
            mergeCells: { range: rangeRef(dashboardSheetId, r.start, r.end, 2, 12), mergeType: 'MERGE_ROWS' },
          });
          requests.push(repeatCell(dashboardSheetId, rangeRef(dashboardSheetId, r.start, r.end, 2, 12), {
            textFormat: { fontSize: 11, foregroundColor: tone, fontFamily: MONO },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 4, bottom: 4, left: 8, right: 8 },
          }));
          requests.push(setRowHeight(dashboardSheetId, r.start, 22));
          break;
        }
      }
    }

    // batchUpdate has a request size cap; ship in chunks of 100.
    const chunks: unknown[][] = [];
    for (let i = 0; i < requests.length; i += 100) chunks.push(requests.slice(i, i + 100));
    for (const c of chunks) {
      try {
        await batchUpdate(sheetId, c);
      } catch (err) {
        errors.push(`formatting chunk failed (non-fatal): ${(err as Error).message}`);
        // keep going — partial formatting is better than none
      }
    }
  }

  return { rowsWritten: padded.length, errors };
}
