// Builders for the Selection 2026 dashboard tabs in the
// `E3 - Selection Data` workbook.
//
// Three tabs are built here, all derivable from the static
// COHORT3_ALIASES map + the live Companies master. Per project
// convention, the alias map is the authoritative source for the
// 41-company cohort (sheets.ts → companies module's `cohort` column
// is unreliable).
//
// The other three tabs from the original plan (Visit Schedule, Scoring
// Matrix, Waitlist) require upstream data to be uploaded into the live
// `selection` tabs first; they will be added in a follow-up once the
// 2nd Filtration / Committee Votes / Interview Assessments tabs are
// populated. For now, the Phase C Python generator (scripts/) handles
// the corresponding Word docs from local xlsx data.
//
// Output shape mirrors `dashboardRebuilder.ts` so the same writeBuilt
// helper can drive these tabs.

import type { Company } from '../../data/types';
import { COHORT3_ALIASES, canonicalCohortName } from '../../config/cohort3Aliases';
import { displayName } from '../../config/team';

// ─── shared brand palette (mirrors dashboardRebuilder.ts) ───────────

function hex(h: string): { red: number; green: number; blue: number } {
  const n = parseInt(h.replace(/^#/, ''), 16);
  return { red: ((n >> 16) & 0xff) / 255, green: ((n >> 8) & 0xff) / 255, blue: (n & 0xff) / 255 };
}

const COLOR = {
  navy: hex('1F3036'),
  white: hex('FFFFFF'),
  brandRed: hex('DE6336'),
} as const;

type Tone = 'navy' | 'red' | 'teal' | 'orange' | 'green' | 'amber';
const TONE_FILL: Record<Tone, ReturnType<typeof hex>> = {
  navy:   hex('1F3036'),
  red:    hex('FCEDE7'),
  teal:   hex('E6F3F7'),
  orange: hex('FCEFE1'),
  green:  hex('E7F5EC'),
  amber:  hex('FDF3DA'),
};
const TONE_FG: Record<Tone, ReturnType<typeof hex>> = {
  navy:   hex('FFFFFF'),
  red:    hex('DE6336'),
  teal:   hex('309DC4'),
  orange: hex('B05E1F'),
  green:  hex('2E7D4F'),
  amber:  hex('8C6A12'),
};

const FONT = 'Source Sans Pro';

// ─── output type (matches dashboardRebuilder) ────────────────────────

export type SheetCell = string | number;
export type SheetGrid = SheetCell[][];

export type FormattedTab = {
  values: SheetGrid;
  /** batchUpdate requests for tab + cell formatting / merges / dims. */
  requests: unknown[];
  /** Last 1-based row of the values grid (for trailing-row wipe). */
  lastRow: number;
};

// ─── format helpers ─────────────────────────────────────────────────

function range(tabId: number, r0: number, r1: number, c0: number, c1: number) {
  return { sheetId: tabId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 };
}
function repeatCellFormat(tabId: number, r0: number, r1: number, c0: number, c1: number, fmt: object) {
  return { repeatCell: { range: range(tabId, r0, r1, c0, c1), cell: { userEnteredFormat: fmt }, fields: 'userEnteredFormat' } };
}
function setRowHeight(tabId: number, row: number, px: number) {
  return {
    updateDimensionProperties: {
      range: { sheetId: tabId, dimension: 'ROWS', startIndex: row, endIndex: row + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  };
}
function setColumnWidth(tabId: number, col: number, px: number) {
  return {
    updateDimensionProperties: {
      range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  };
}
function setTabProps(tabId: number) {
  return {
    updateSheetProperties: {
      properties: {
        sheetId: tabId,
        tabColorStyle: { rgbColor: COLOR.brandRed },
        gridProperties: { hideGridlines: true, frozenRowCount: 3 },
      },
      fields: 'tabColorStyle,gridProperties.hideGridlines,gridProperties.frozenRowCount',
    },
  };
}

function titleRow(tabId: number, totalCols: number, text: string): { row: SheetCell[]; reqs: unknown[] } {
  return {
    row: [text, ...Array(totalCols - 1).fill('')],
    reqs: [
      { mergeCells: { range: range(tabId, 0, 1, 0, totalCols), mergeType: 'MERGE_ROWS' } },
      repeatCellFormat(tabId, 0, 1, 0, totalCols, {
        backgroundColorStyle: { rgbColor: COLOR.navy },
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
        padding: { top: 6, bottom: 6, left: 14, right: 8 },
        textFormat: { fontFamily: FONT, fontSize: 18, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
      }),
      setRowHeight(tabId, 0, 36),
    ],
  };
}

function subtitleRow(tabId: number, totalCols: number, text: string): { row: SheetCell[]; reqs: unknown[] } {
  return {
    row: [text, ...Array(totalCols - 1).fill('')],
    reqs: [
      { mergeCells: { range: range(tabId, 1, 2, 0, totalCols), mergeType: 'MERGE_ROWS' } },
      repeatCellFormat(tabId, 1, 2, 0, totalCols, {
        backgroundColorStyle: { rgbColor: hex('F4F5F7') },
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
        padding: { top: 4, bottom: 4, left: 14, right: 8 },
        textFormat: { fontFamily: FONT, fontSize: 9, italic: true, foregroundColorStyle: { rgbColor: hex('5A6A72') } },
      }),
    ],
  };
}

function headerRow(tabId: number, row0: number, headers: string[]): { row: SheetCell[]; reqs: unknown[] } {
  return {
    row: headers,
    reqs: [
      repeatCellFormat(tabId, row0, row0 + 1, 0, headers.length, {
        backgroundColorStyle: { rgbColor: COLOR.navy },
        horizontalAlignment: 'LEFT',
        verticalAlignment: 'MIDDLE',
        padding: { top: 4, bottom: 4, left: 8, right: 8 },
        textFormat: { fontFamily: FONT, fontSize: 10, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
      }),
      setRowHeight(tabId, row0, 24),
    ],
  };
}

function bandedBodyFormat(tabId: number, row0: number, row1: number, totalCols: number): unknown[] {
  return [
    repeatCellFormat(tabId, row0, row1, 0, totalCols, {
      backgroundColorStyle: { rgbColor: COLOR.white },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 3, bottom: 3, left: 8, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: hex('1F3036') } },
    }),
    // Banding via addBanding (Sheets handles odd/even alternation)
    { addBanding: {
      bandedRange: {
        range: range(tabId, row0 - 1, row1, 0, totalCols),
        rowProperties: {
          headerColorStyle: { rgbColor: COLOR.navy },
          firstBandColorStyle: { rgbColor: COLOR.white },
          secondBandColorStyle: { rgbColor: hex('FAFAFA') },
        },
      },
    } },
  ];
}

function kpiTileFormat(tabId: number, r0: number, c0: number, tone: Tone): unknown[] {
  const c1 = c0 + 3;
  const fill = TONE_FILL[tone];
  const fg = TONE_FG[tone];
  return [
    { mergeCells: { range: range(tabId, r0, r0 + 1, c0, c1), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, r0, r0 + 1, c0, c1, {
      backgroundColorStyle: { rgbColor: fill },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 2, bottom: 2, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: fg } },
    }),
    { mergeCells: { range: range(tabId, r0 + 1, r0 + 2, c0, c1), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, r0 + 1, r0 + 2, c0, c1, {
      backgroundColorStyle: { rgbColor: fill },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 2, bottom: 6, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 22, bold: true, foregroundColorStyle: { rgbColor: fg } },
    }),
  ];
}

function sectionHeaderFormat(tabId: number, row: number, totalCols: number): unknown[] {
  return [
    { mergeCells: { range: range(tabId, row, row + 1, 0, totalCols), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, row, row + 1, 0, totalCols, {
      backgroundColorStyle: { rgbColor: COLOR.navy },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 4, bottom: 4, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 12, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
    }),
    setRowHeight(tabId, row, 26),
  ];
}

function bar(count: number, max: number, width = 40): string {
  if (max <= 0 || count <= 0) return '';
  const n = Math.min(width, Math.max(0, Math.round((count / max) * width)));
  return '█'.repeat(n);
}

// ════════════════════════════════════════════════════════════════════
// 1. Selection Funnel Dashboard
// ════════════════════════════════════════════════════════════════════

export function buildSelectionFunnelDashboard(input: {
  companies: Company[];
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedTab {
  const at = input.generatedAt ?? new Date();
  const TOTAL_COLS = 12;
  const values: SheetGrid = [];
  const requests: unknown[] = [setTabProps(input.tabId)];

  // --- Title + subtitle
  const t = titleRow(input.tabId, TOTAL_COLS, 'Elevate 2026 — Selection Funnel Dashboard');
  values.push(t.row); requests.push(...t.reqs);
  const s = subtitleRow(input.tabId, TOTAL_COLS,
    `Generated ${at.toLocaleString()} by ${input.generatedBy || 'admin'} · authoritative cohort = COHORT3_ALIASES (${COHORT3_ALIASES.length} companies)`);
  values.push(s.row); requests.push(...s.reqs);

  // --- KPI strip (row 3-4)
  const cohortSize = COHORT3_ALIASES.length;
  const sidaCount = COHORT3_ALIASES.filter(a => a.donor === 'SIDA').length;
  const dutchCount = COHORT3_ALIASES.filter(a => a.donor === 'Dutch').length;
  const amSet = new Set(COHORT3_ALIASES.map(a => a.am).filter(Boolean));
  const cityCount = new Set(COHORT3_ALIASES.map(a => a.city).filter(Boolean)).size;

  const kpiLabels: SheetCell[] = ['SELECTED', 'ACCOUNT MANAGERS', 'DONORS (SIDA / DUTCH)', 'CITIES'];
  const kpiValues: SheetCell[] = [
    `${cohortSize}`,
    `${amSet.size}`,
    `${sidaCount} / ${dutchCount}`,
    `${cityCount}`,
  ];
  // Pad to 12 cols (4 tiles × 3 cols each)
  values.push([kpiLabels[0], '', '', kpiLabels[1], '', '', kpiLabels[2], '', '', kpiLabels[3], '', '']);
  values.push([kpiValues[0], '', '', kpiValues[1], '', '', kpiValues[2], '', '', kpiValues[3], '', '']);
  requests.push(
    ...kpiTileFormat(input.tabId, 2, 0, 'teal'),
    ...kpiTileFormat(input.tabId, 2, 3, 'orange'),
    ...kpiTileFormat(input.tabId, 2, 6, 'green'),
    ...kpiTileFormat(input.tabId, 2, 9, 'navy'),
    setRowHeight(input.tabId, 3, 44),
  );

  // --- Per-AM section
  values.push(Array(TOTAL_COLS).fill(''));
  values.push(['Companies per Account Manager', ...Array(TOTAL_COLS - 1).fill('')]);
  requests.push(...sectionHeaderFormat(input.tabId, 5, TOTAL_COLS));

  const perAm = new Map<string, number>();
  for (const e of COHORT3_ALIASES) {
    if (!e.am) continue;
    perAm.set(e.am, (perAm.get(e.am) || 0) + 1);
  }
  const maxAm = Math.max(1, ...perAm.values());
  const amRows = [...perAm.entries()].sort((a, b) => b[1] - a[1]);
  for (const [am, n] of amRows) {
    values.push([displayName(am), n, bar(n, maxAm), '', '', '', '', '', '', '', '', '']);
  }

  // --- Per-donor section
  values.push(Array(TOTAL_COLS).fill(''));
  values.push(['Companies per Donor', ...Array(TOTAL_COLS - 1).fill('')]);
  const sectionRowDonor = values.length - 1;
  requests.push(...sectionHeaderFormat(input.tabId, sectionRowDonor, TOTAL_COLS));

  const perDonor = new Map<string, number>();
  for (const e of COHORT3_ALIASES) {
    const d = e.donor || '(unassigned)';
    perDonor.set(d, (perDonor.get(d) || 0) + 1);
  }
  const maxDonor = Math.max(1, ...perDonor.values());
  for (const [donor, n] of [...perDonor.entries()].sort((a, b) => b[1] - a[1])) {
    values.push([donor, n, bar(n, maxDonor), '', '', '', '', '', '', '', '', '']);
  }

  // --- Per-city section
  values.push(Array(TOTAL_COLS).fill(''));
  values.push(['Companies per City', ...Array(TOTAL_COLS - 1).fill('')]);
  const sectionRowCity = values.length - 1;
  requests.push(...sectionHeaderFormat(input.tabId, sectionRowCity, TOTAL_COLS));

  const perCity = new Map<string, number>();
  for (const e of COHORT3_ALIASES) {
    const c = e.city || '(unknown)';
    perCity.set(c, (perCity.get(c) || 0) + 1);
  }
  const maxCity = Math.max(1, ...perCity.values());
  for (const [city, n] of [...perCity.entries()].sort((a, b) => b[1] - a[1])) {
    values.push([city, n, bar(n, maxCity), '', '', '', '', '', '', '', '', '']);
  }

  // --- Funnel (placeholders for upstream stages until live tabs populated)
  values.push(Array(TOTAL_COLS).fill(''));
  values.push(['Selection Funnel', ...Array(TOTAL_COLS - 1).fill('')]);
  const sectionRowFunnel = values.length - 1;
  requests.push(...sectionHeaderFormat(input.tabId, sectionRowFunnel, TOTAL_COLS));

  const funnel: Array<[string, string | number]> = [
    ['Applications received', '[live: read selection.sourceData]'],
    ['Passed 1st Filtration', '[live: read selection.firstFiltration]'],
    ['Passed 2nd Filtration', '[live: read selection.additionalFiltration]'],
    ['Interviewed', '[live: read selection.interviewAssessments]'],
    ['Final cohort', cohortSize],
  ];
  for (const [stage, n] of funnel) {
    values.push([stage, n, '', '', '', '', '', '', '', '', '', '']);
  }

  // Column widths — title section, KPI band, etc.
  for (let c = 0; c < 12; c++) {
    requests.push(setColumnWidth(input.tabId, c, c === 0 ? 220 : 90));
  }

  return { values, requests, lastRow: values.length };
}

// ════════════════════════════════════════════════════════════════════
// 2. Final Cohort 2026 — the 41 in human-friendly format
// ════════════════════════════════════════════════════════════════════

export function buildFinalCohort2026Tab(input: {
  companies: Company[];
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedTab {
  const at = input.generatedAt ?? new Date();
  const HEADERS = ['#', 'Company', 'City', 'Account Manager', 'Donor', 'Budget (USD)', 'Reg Document'];
  const TOTAL_COLS = HEADERS.length;
  const values: SheetGrid = [];
  const requests: unknown[] = [setTabProps(input.tabId)];

  const t = titleRow(input.tabId, TOTAL_COLS, `Elevate 2026 — Final Cohort (${COHORT3_ALIASES.length} companies)`);
  values.push(t.row); requests.push(...t.reqs);
  const s = subtitleRow(input.tabId, TOTAL_COLS,
    `Generated ${at.toLocaleString()} by ${input.generatedBy || 'admin'} · authoritative source: src/config/cohort3Aliases.ts`);
  values.push(s.row); requests.push(...s.reqs);

  const h = headerRow(input.tabId, 2, HEADERS);
  values.push(h.row); requests.push(...h.reqs);

  COHORT3_ALIASES.forEach((e, i) => {
    values.push([
      i + 1,
      e.canonical,
      e.city || '',
      e.am ? displayName(e.am) : '',
      e.donor || '',
      e.budgetUsd ? `$${e.budgetUsd.toLocaleString()}` : '',
      e.regDocUrl || '',
    ]);
  });

  requests.push(...bandedBodyFormat(input.tabId, 3, values.length, TOTAL_COLS));
  requests.push(
    setColumnWidth(input.tabId, 0, 40),
    setColumnWidth(input.tabId, 1, 320),
    setColumnWidth(input.tabId, 2, 100),
    setColumnWidth(input.tabId, 3, 140),
    setColumnWidth(input.tabId, 4, 80),
    setColumnWidth(input.tabId, 5, 120),
    setColumnWidth(input.tabId, 6, 360),
  );

  return { values, requests, lastRow: values.length };
}

// ════════════════════════════════════════════════════════════════════
// 3. Allocation 2026 — per-company city/intervention/donor/budget
// (joined with companies master for sub-intervention data)
// ════════════════════════════════════════════════════════════════════

export function buildAllocation2026Tab(input: {
  companies: Company[];
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedTab {
  const at = input.generatedAt ?? new Date();
  const HEADERS = ['#', 'Company', 'City', 'AM', 'Donor', 'Budget (USD)', 'Status', 'Stage'];
  const TOTAL_COLS = HEADERS.length;
  const values: SheetGrid = [];
  const requests: unknown[] = [setTabProps(input.tabId)];

  const t = titleRow(input.tabId, TOTAL_COLS, 'Elevate 2026 — Intervention Allocation');
  values.push(t.row); requests.push(...t.reqs);
  const s = subtitleRow(input.tabId, TOTAL_COLS,
    `Generated ${at.toLocaleString()} by ${input.generatedBy || 'admin'} · ${COHORT3_ALIASES.length} companies, joined with live Companies master for status/stage`);
  values.push(s.row); requests.push(...s.reqs);

  const h = headerRow(input.tabId, 2, HEADERS);
  values.push(h.row); requests.push(...h.reqs);

  // Build a quick name→company map so we can pick up status/stage
  const companyByName = new Map<string, Company>();
  for (const c of input.companies) {
    const canon = canonicalCohortName(c.company_name);
    if (canon) companyByName.set(canon, c);
  }

  COHORT3_ALIASES.forEach((e, i) => {
    const live = companyByName.get(e.canonical);
    values.push([
      i + 1,
      e.canonical,
      e.city || '',
      e.am ? displayName(e.am) : '',
      e.donor || '',
      e.budgetUsd ? `$${e.budgetUsd.toLocaleString()}` : '',
      live?.status || '',
      live?.stage || '',
    ]);
  });

  requests.push(...bandedBodyFormat(input.tabId, 3, values.length, TOTAL_COLS));
  requests.push(
    setColumnWidth(input.tabId, 0, 40),
    setColumnWidth(input.tabId, 1, 320),
    setColumnWidth(input.tabId, 2, 100),
    setColumnWidth(input.tabId, 3, 140),
    setColumnWidth(input.tabId, 4, 80),
    setColumnWidth(input.tabId, 5, 120),
    setColumnWidth(input.tabId, 6, 110),
    setColumnWidth(input.tabId, 7, 110),
  );

  return { values, requests, lastRow: values.length };
}

// ─── Tab name constants (kept here so the card stays declarative) ───

export const SELECTION_2026_TABS = {
  funnel: 'Selection Funnel Dashboard',
  finalCohort: 'Final Cohort 2026',
  allocation: 'Allocation 2026',
} as const;
