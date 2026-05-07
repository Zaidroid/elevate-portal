// Reusable formatter for portal-owned output tabs. Every sheet the portal
// writes to is also meant to be opened directly in Google Sheets by the
// team — so output tabs need a polished, human-friendly look (frozen
// header, banded rows, navy title, hidden ID columns, status color
// formatting).
//
// Pattern lifted from src/lib/export/donorExport.ts:24-188 so the donor
// reports and the new Stage 3 distribution mirror tab look the same.
//
// Usage:
//   await ensureHumanFriendlyTab(sheetId, 'Stage3 Distribution', {
//     title: 'Stage 3 · Cohort 3 distribution snapshot — 41 companies',
//     subtitle: `Generated ${new Date().toLocaleString()} by ${user}`,
//     headers: ['Company', 'AM', 'Pillar', 'Sub-Intervention', 'Donor', 'Budget (USD)', 'company_id'],
//     hiddenColumnIndexes: [6],
//     colWidths: { 0: 220, 1: 150 },
//     statusColumn: 4,
//   });
//   // Returns { tabId, headerRow, dataStartRow } so callers know where
//   // to write the data rows after formatting is applied.
//
// `ensureHumanFriendlyTab` is idempotent — re-running on an existing tab
// is safe; formatting requests overwrite prior values without error.

import { batchUpdate, ensureSchema, getSpreadsheetMeta } from './client';

// ─── brand palette ──────────────────────────────────────────────────

export const NAVY      = { red: 0.07, green: 0.15, blue: 0.27 };
export const WHITE     = { red: 1,    green: 1,    blue: 1    };
export const HEADER_BG = { red: 0.96, green: 0.97, blue: 0.99 };
export const ZEBRA_ODD = { red: 0.98, green: 0.98, blue: 0.99 };
export const GREEN_BG  = { red: 0.86, green: 0.96, blue: 0.91 };
export const AMBER_BG  = { red: 1.0,  green: 0.95, blue: 0.84 };
export const RED_BG    = { red: 1.0,  green: 0.92, blue: 0.92 };

// ─── small helpers ──────────────────────────────────────────────────

export function colLetter(n: number): string {
  let s = '';
  let v = n;
  while (v >= 0) {
    s = String.fromCharCode(65 + (v % 26)) + s;
    v = Math.floor(v / 26) - 1;
  }
  return s;
}

function rangeRef(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

// ─── conditional formatting for a status column ─────────────────────

const STATUS_COLOR_PAIRS: [string, typeof GREEN_BG][] = [
  ['Completed', GREEN_BG], ['Active', GREEN_BG], ['Paid', GREEN_BG],
  ['Executed', GREEN_BG], ['Attended', GREEN_BG], ['Delivered', GREEN_BG], ['Awarded', GREEN_BG],
  ['In Progress', AMBER_BG], ['Planned', AMBER_BG], ['Pending Approval', AMBER_BG],
  ['Approved', AMBER_BG], ['Sent to Finance', AMBER_BG], ['Submitted', AMBER_BG],
  ['Under Review', AMBER_BG], ['Drafted', AMBER_BG],
  ['Cancelled', RED_BG], ['Rejected', RED_BG], ['Overdue', RED_BG], ['Withdrawn', RED_BG],
];

function statusConditionalRules(tabId: number, startRow: number, endRow: number, col: number): unknown[] {
  const rules: unknown[] = [];
  const range = [rangeRef(tabId, startRow, endRow, col, col + 1)];
  for (let i = 0; i < STATUS_COLOR_PAIRS.length; i++) {
    rules.push({
      addConditionalFormatRule: {
        rule: {
          ranges: range,
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: STATUS_COLOR_PAIRS[i][0] }] },
            format: { backgroundColor: STATUS_COLOR_PAIRS[i][1], textFormat: { bold: true } },
          },
        },
        index: i,
      },
    });
  }
  return rules;
}

// ─── public types ───────────────────────────────────────────────────

export type EnsureTabOpts = {
  /** Big merged navy title row. */
  title: string;
  /** Optional gray italic subtitle row directly under the title. */
  subtitle?: string;
  /** Column headers. Determines the total column count. */
  headers: string[];
  /** Indexes of columns to hide (e.g. ID columns). */
  hiddenColumnIndexes?: number[];
  /** Optional pixel widths per column index. */
  colWidths?: Record<number, number>;
  /** 0-based index of the column whose values get status-color formatting. */
  statusColumn?: number;
  /** Number of body rows expected; used to size the banding range. Default 200. */
  expectedBodyRows?: number;
};

export type EnsureTabResult = {
  /** Internal Google Sheets tabId (gid). */
  tabId: number;
  /** 1-based row containing the human-readable headers. */
  headerRow: number;
  /** 1-based row where data rows begin. */
  dataStartRow: number;
};

// ─── main entry ─────────────────────────────────────────────────────

export async function ensureHumanFriendlyTab(
  sheetId: string,
  tabName: string,
  opts: EnsureTabOpts,
): Promise<EnsureTabResult> {
  // Step 1: ensure the tab exists. ensureSchema creates it with `[title]`
  // as the first row if missing; otherwise it leaves the existing
  // contents alone.
  await ensureSchema(sheetId, tabName, [opts.title]);

  // Step 2: resolve tabId for formatting requests.
  const meta = await getSpreadsheetMeta(sheetId);
  const tab = meta.sheets.find(s => s.title === tabName);
  if (!tab) throw new Error(`ensureHumanFriendlyTab: tab '${tabName}' missing after ensureSchema`);
  const tabId = tab.sheetId;

  const totalCols = opts.headers.length;
  const headerRowZero = opts.subtitle ? 2 : 1;       // 0-based row of headers
  const dataStartZero = headerRowZero + 1;
  const expectedBody = Math.max(opts.expectedBodyRows ?? 200, 50);
  const totalRowsZero = dataStartZero + expectedBody;

  const requests: unknown[] = [];

  // Step 0: clear stale formatting in the data area first. Without this,
  // a previous (buggy) reformat run can leave the entire sheet painted
  // navy or with phantom merges that prevent the new title row from
  // rendering correctly. Idempotent — clearing a clean tab is a no-op.
  // The wipe is scoped to the column range we actually format below
  // (so columns the team has added past the canonical headers stay
  // untouched).
  requests.push({
    unmergeCells: { range: rangeRef(tabId, 0, totalRowsZero, 0, totalCols) },
  });
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, 0, totalRowsZero, 0, totalCols),
      cell: { userEnteredFormat: { backgroundColor: WHITE } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  });

  // Title row — navy bg, white bold, merged across all columns.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, 0, 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: { fontSize: 14, bold: true, foregroundColor: WHITE, fontFamily: 'Source Sans Pro' },
          horizontalAlignment: 'LEFT',
          padding: { top: 8, bottom: 8, left: 12, right: 12 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });
  requests.push({ mergeCells: { range: rangeRef(tabId, 0, 1, 0, totalCols), mergeType: 'MERGE_ROWS' } });

  // Subtitle row (optional) — small italic gray, merged.
  if (opts.subtitle) {
    requests.push({
      repeatCell: {
        range: rangeRef(tabId, 1, 2, 0, totalCols),
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, italic: true, foregroundColor: { red: 0.45, green: 0.5, blue: 0.58 }, fontFamily: 'Source Sans Pro' },
            padding: { top: 2, bottom: 2, left: 12, right: 12 },
          },
        },
        fields: 'userEnteredFormat',
      },
    });
    requests.push({ mergeCells: { range: rangeRef(tabId, 1, 2, 0, totalCols), mergeType: 'MERGE_ROWS' } });
  }

  // Header row — pale background, bold navy, frozen.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, headerRowZero, headerRowZero + 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: { fontSize: 10, bold: true, foregroundColor: NAVY, fontFamily: 'Source Sans Pro' },
          horizontalAlignment: 'LEFT',
          padding: { top: 4, bottom: 4, left: 8, right: 8 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });

  // Freeze: title + subtitle + header.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId: tabId, gridProperties: { frozenRowCount: headerRowZero + 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  // Banded data rows.
  for (let r = dataStartZero; r < totalRowsZero; r += 2) {
    requests.push({
      repeatCell: {
        range: rangeRef(tabId, r, Math.min(r + 1, totalRowsZero), 0, totalCols),
        cell: { userEnteredFormat: { backgroundColor: ZEBRA_ODD } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // Default font on data area.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, dataStartZero, totalRowsZero, 0, totalCols),
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 10, fontFamily: 'Source Sans Pro' },
          verticalAlignment: 'TOP',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy',
    },
  });

  // Column widths.
  if (opts.colWidths) {
    for (const [col, px] of Object.entries(opts.colWidths)) {
      const i = parseInt(col, 10);
      if (i >= totalCols) continue;
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    }
  }

  // Hidden columns.
  if (opts.hiddenColumnIndexes && opts.hiddenColumnIndexes.length > 0) {
    for (const i of opts.hiddenColumnIndexes) {
      if (i >= totalCols) continue;
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      });
    }
  }

  // Status column conditional formatting.
  if (opts.statusColumn !== undefined && opts.statusColumn >= 0 && opts.statusColumn < totalCols) {
    requests.push(...statusConditionalRules(tabId, dataStartZero, totalRowsZero, opts.statusColumn));
  }

  // Send formatting in chunks of 100 (Sheets API request soft limit).
  for (let i = 0; i < requests.length; i += 100) {
    try {
      await batchUpdate(sheetId, requests.slice(i, i + 100));
    } catch (err) {
      // Formatting is non-fatal — content writes still succeed.
      console.warn(`[output-formatting] batchUpdate chunk failed for ${tabName}:`, (err as Error).message);
    }
  }

  return {
    tabId,
    headerRow: headerRowZero + 1,       // 1-based for callers
    dataStartRow: dataStartZero + 1,
  };
}
