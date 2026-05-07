// Computed + formatted dashboard rebuilder.
//
// The original Python builder (sheet-builders/builders/companies_master.py
// + gsg_sheets/dashboard.py) produces a polished dashboard with:
//   - Navy banner title at row 1 (white text, 18pt bold, merged A1:L1)
//   - Italic gray subtitle at row 2
//   - Navy section headers (12pt bold, white on navy, merged 12 cols)
//   - KPI tiles: 4 across (cols A-C, D-F, G-I, J-L), each 2 rows tall,
//     with tone-colored backgrounds (label upper band + big value lower band)
//   - Horizontal bar charts using REPT('█', n) with brand colors
//
// The previous Companies dashboard had drifted into a plain vertical
// list because someone manually edited the live tab. We rebuild it from
// scratch here, matching the freelancers / payments / etc. design.
//
// Computed values are derived from the LIVE portal data (cohort filter +
// interviewed override applied), not from sheet formulas — that's what
// fixes the "interviewed=29 vs portal-says-52" mismatch.

import type { Company, Assignment } from '../../data/types';
import type { Review } from '../companies/reviewTypes';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import { INTERVIEWED_NAMES, isInterviewed } from '../companies/interviewedSource';
import { COHORT3_ALIASES, canonicalCohortName } from '../../config/cohort3Aliases';

// ─── Brand palette (mirrors gsg_sheets/brand.py) ────────────────────

function hex(h: string): { red: number; green: number; blue: number } {
  const n = parseInt(h.replace(/^#/, ''), 16);
  return { red: ((n >> 16) & 0xff) / 255, green: ((n >> 8) & 0xff) / 255, blue: (n & 0xff) / 255 };
}

const COLOR = {
  navy: hex('1F3036'),
  white: hex('FFFFFF'),
  brandRed: hex('DE6336'),
  brandTeal: hex('309DC4'),
  muted: hex('5A6A72'),
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
const BAR_FONT = 'Menlo';

// ─── Cohort + override helpers ──────────────────────────────────────
//
// Cohort 3 membership is decided by the canonical-alias map in
// src/config/cohort3Aliases.ts (41 companies). The `cohort` field on
// the master row is unreliable — it's been set inconsistently as 'E3',
// '3', empty, etc. across the workbook's history. The alias map is
// the single source of truth maintained alongside the Stage 3
// distribution; using it everywhere here keeps the dashboard's counts
// matched to what the portal displays.

function inCohort3(c: Company): boolean {
  return canonicalCohortName(c.company_name || '') !== null;
}

function effectiveStatus(c: Company): string {
  const sheetStatus = (c.status || '').trim();
  if (isInterviewed(c.company_name)) {
    const PRE_INTERVIEWED = new Set(['', 'Applicant', 'Shortlisted']);
    if (PRE_INTERVIEWED.has(sheetStatus)) return 'Interviewed';
  }
  return sheetStatus || 'Applicant';
}

const SUB_INTERVENTIONS = [
  'C-Suite', 'Train To Hire', 'Upskilling', 'Marketing Agency',
  'Marketing Resources', 'ElevateBridge', 'Legal Support', 'Conferences',
];

// ─── Bar string ─────────────────────────────────────────────────────

function bar(count: number, max: number, width = 40): string {
  if (max <= 0 || count <= 0) return '';
  const n = Math.min(width, Math.max(0, Math.round((count / max) * width)));
  return '█'.repeat(n);
}

// ─── Output type ────────────────────────────────────────────────────

export type DashboardCell = string | number;
export type DashboardGrid = DashboardCell[][];

export type FormattedDashboard = {
  values: DashboardGrid;
  /** batchUpdate requests for tab + cell formatting / merges / dims. */
  requests: unknown[];
  /** Last 1-based row of the values grid (for trailing-row wipe). */
  lastRow: number;
};

// ─── Format-request helpers ─────────────────────────────────────────

function range(tabId: number, r0: number, r1: number, c0: number, c1: number) {
  return { sheetId: tabId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 };
}

function mergeRow(tabId: number, row: number, c0: number, c1: number) {
  return { mergeCells: { range: range(tabId, row, row + 1, c0, c1), mergeType: 'MERGE_ROWS' } };
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
        gridProperties: { hideGridlines: true },
      },
      fields: 'tabColorStyle,gridProperties.hideGridlines',
    },
  };
}

// ─── KPI tile primitives ────────────────────────────────────────────
//
// 4 tiles fit across the 12-col grid; each tile is 3 cols wide and 2
// rows tall (label band + value band). The tile starts at zero-based
// column index `c0` (0, 3, 6, 9) and zero-based row `r0`.

type KpiTile = {
  label: string;
  value: string | number;
  tone: Tone;
};

function kpiTileFormat(tabId: number, r0: number, c0: number, tone: Tone): unknown[] {
  const c1 = c0 + 3;
  const labelRow = r0;
  const valueRow = r0 + 1;
  const fill = TONE_FILL[tone];
  const fg = TONE_FG[tone];
  return [
    // Merge label band cols [c0..c1)
    { mergeCells: { range: range(tabId, labelRow, labelRow + 1, c0, c1), mergeType: 'MERGE_ROWS' } },
    // Format label band
    repeatCellFormat(tabId, labelRow, labelRow + 1, c0, c1, {
      backgroundColorStyle: { rgbColor: fill },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 2, bottom: 2, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: fg } },
    }),
    // Merge value band
    { mergeCells: { range: range(tabId, valueRow, valueRow + 1, c0, c1), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, valueRow, valueRow + 1, c0, c1, {
      backgroundColorStyle: { rgbColor: fill },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 2, bottom: 6, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 22, bold: true, foregroundColorStyle: { rgbColor: fg } },
    }),
  ];
}

// ─── Section header ─────────────────────────────────────────────────

function sectionHeaderFormat(tabId: number, row: number): unknown[] {
  return [
    { mergeCells: { range: range(tabId, row, row + 1, 0, 12), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, row, row + 1, 0, 12, {
      backgroundColorStyle: { rgbColor: COLOR.navy },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 4, bottom: 4, left: 12, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 12, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
    }),
    setRowHeight(tabId, row, 26),
  ];
}

// ─── Bar row format (label | count | bar merged across cols 2..12) ─

function barRowFormat(tabId: number, row: number, barTone: Tone): unknown[] {
  const fg = TONE_FG[barTone];
  return [
    // Label (col 0) — bold navy
    repeatCellFormat(tabId, row, row + 1, 0, 1, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, bold: true, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }),
    // Count (col 1) — navy
    repeatCellFormat(tabId, row, row + 1, 1, 2, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { left: 8, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }),
    // Bar cell — Menlo, brand color
    { mergeCells: { range: range(tabId, row, row + 1, 2, 12), mergeType: 'MERGE_ROWS' } },
    repeatCellFormat(tabId, row, row + 1, 2, 12, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
      textFormat: { fontFamily: BAR_FONT, fontSize: 11, foregroundColorStyle: { rgbColor: fg } },
    }),
  ];
}

// ─── Main builder ───────────────────────────────────────────────────

export function buildCompaniesDashboard(input: {
  companies: Company[];
  assignments: Assignment[];
  reviews: Review[];
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedDashboard {
  const at = input.generatedAt ?? new Date();
  // The 41 cohort-3 companies (canonical alias map is authoritative).
  const cohort = input.companies.filter(inCohort3);
  // Authoritative cardinal sizes — these match what the portal shows.
  const interviewedCount = INTERVIEWED_NAMES.size;       // 52
  const cohortSize = COHORT3_ALIASES.length;             // 41

  // ── compute funnel by status (cohort 3 only) ─────────────
  // Every cohort row is post-Selection, so we only show post-Selection
  // statuses in the funnel. effectiveStatus collapses pre-Selected
  // labels to "Selected" so the funnel always sums to cohortSize.
  const POST_SELECTION = ['Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn'];
  const cohortStatus = (c: Company): string => {
    const eff = effectiveStatus(c);
    if (POST_SELECTION.includes(eff)) return eff;
    // Pre-selection statuses (Applicant/Shortlisted/Interviewed/
    // Reviewing/Recommended) all collapse to "Selected" — by definition,
    // every cohort 3 company has been selected.
    return 'Selected';
  };
  const statusCount: Record<string, number> = {};
  for (const s of POST_SELECTION) statusCount[s] = 0;
  for (const c of cohort) {
    const eff = cohortStatus(c);
    statusCount[eff] = (statusCount[eff] ?? 0) + 1;
  }
  const maxStatus = Math.max(1, ...Object.values(statusCount));

  const cohortIds = new Set(cohort.map(c => c.company_id));

  const fundCount: Record<string, number> = {};
  for (const c of cohort) {
    const f = (c.fund_code || '').trim() || '(no fund)';
    fundCount[f] = (fundCount[f] ?? 0) + 1;
  }
  const fundEntries = Object.entries(fundCount).sort((a, b) => b[1] - a[1]);
  const maxFund = Math.max(1, ...Object.values(fundCount));

  const amCompanies: Record<string, number> = {};
  const amAssignments: Record<string, number> = {};
  const amBudget: Record<string, number> = {};
  const amOf = (email: string) => {
    const lower = (email || '').trim().toLowerCase();
    if (!lower) return '(unassigned)';
    const am = ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === lower);
    return am ? displayName(am.email) : displayName(lower);
  };
  for (const c of cohort) {
    const k = amOf(c.profile_manager_email);
    amCompanies[k] = (amCompanies[k] ?? 0) + 1;
    if (!(k in amAssignments)) amAssignments[k] = 0;
    if (!(k in amBudget)) amBudget[k] = 0;
  }
  for (const a of input.assignments) {
    if (!cohortIds.has(a.company_id)) continue;
    const k = amOf(a.owner_email);
    amCompanies[k] = amCompanies[k] ?? 0;
    amAssignments[k] = (amAssignments[k] ?? 0) + 1;
    const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) amBudget[k] = (amBudget[k] ?? 0) + v;
  }
  const amOrder = [
    ...ACCOUNT_MANAGERS.map(a => displayName(a.email)),
    '(unassigned)',
  ].filter(k => (amCompanies[k] ?? 0) > 0 || (amAssignments[k] ?? 0) > 0 || k === '(unassigned)');

  const pillarCount: Record<string, number> = { 'Market Access': 0, 'Capacity Building': 0, 'Marketing & Branding': 0 };
  for (const a of input.assignments) {
    if (!cohortIds.has(a.company_id)) continue;
    const p = pillarFor(a.intervention_type);
    if (p) pillarCount[p.label] = (pillarCount[p.label] ?? 0) + 1;
  }
  const maxPillar = Math.max(1, ...Object.values(pillarCount));

  const subCount: Record<string, number> = {};
  for (const s of SUB_INTERVENTIONS) subCount[s] = 0;
  for (const a of input.assignments) {
    if (!cohortIds.has(a.company_id)) continue;
    const sub = (a.sub_intervention || '').trim();
    if (sub) subCount[sub] = (subCount[sub] ?? 0) + 1;
  }
  const maxSub = Math.max(1, ...Object.values(subCount));

  const reviewsCohort = input.reviews.filter(r => cohortIds.has(r.company_id));
  const reviewByDecision: Record<string, number> = { Recommend: 0, Hold: 0, Waitlist: 0, Reject: 0 };
  for (const r of reviewsCohort) {
    const d = (r.decision || '').trim();
    if (d in reviewByDecision) reviewByDecision[d] += 1;
  }

  const totalAssignments = input.assignments.filter(a => cohortIds.has(a.company_id)).length;
  const totalBudget = Object.values(amBudget).reduce((s, v) => s + v, 0);

  // ── grid + format requests ────────────────────────────────
  const grid: DashboardGrid = [];
  const requests: unknown[] = [];
  const tabId = input.tabId;

  // Tab properties + column widths
  requests.push(setTabProps(tabId));
  for (let c = 0; c < 12; c++) requests.push(setColumnWidth(tabId, c, 96));

  const blank12 = (): DashboardCell[] => Array.from({ length: 12 }, () => '');

  // Helpers that push both data and format requests, returning the
  // 0-based row index AFTER the section.
  const pushTitle = (text: string, sub: string): number => {
    grid.push([text, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 0, 0, 12));
    requests.push(repeatCellFormat(tabId, 0, 1, 0, 12, {
      backgroundColorStyle: { rgbColor: COLOR.navy },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 8, bottom: 8, left: 14, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 18, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
    }));
    requests.push(setRowHeight(tabId, 0, 36));

    grid.push([sub, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 1, 0, 12));
    requests.push(repeatCellFormat(tabId, 1, 2, 0, 12, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { top: 4, bottom: 6, left: 14, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 10, italic: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
    }));
    requests.push(setRowHeight(tabId, 1, 22));

    grid.push(blank12());
    requests.push(setRowHeight(tabId, 2, 8));
    return 3;
  };

  const pushSection = (rowZeroBased: number, label: string): number => {
    const row = blank12(); row[0] = label;
    grid.push(row);
    requests.push(...sectionHeaderFormat(tabId, rowZeroBased));
    return rowZeroBased + 1;
  };

  const pushKpiRow = (rowZeroBased: number, tiles: KpiTile[]): number => {
    // Pad to 4 tiles
    while (tiles.length < 4) tiles.push({ label: '', value: '', tone: 'navy' });
    const labelRow: DashboardCell[] = ['', '', '', '', '', '', '', '', '', '', '', ''];
    const valueRow: DashboardCell[] = ['', '', '', '', '', '', '', '', '', '', '', ''];
    [0, 3, 6, 9].forEach((c0, i) => {
      labelRow[c0] = tiles[i].label.toUpperCase();
      valueRow[c0] = tiles[i].value;
      requests.push(...kpiTileFormat(tabId, rowZeroBased, c0, tiles[i].tone));
    });
    grid.push(labelRow);
    grid.push(valueRow);
    requests.push(setRowHeight(tabId, rowZeroBased, 18));
    requests.push(setRowHeight(tabId, rowZeroBased + 1, 38));
    grid.push(blank12()); // spacer
    requests.push(setRowHeight(tabId, rowZeroBased + 2, 8));
    return rowZeroBased + 3;
  };

  const pushBarRow = (rowZeroBased: number, label: string, count: number, max: number, tone: Tone): number => {
    const row: DashboardCell[] = blank12();
    row[0] = label;
    row[1] = count;
    row[2] = bar(count, max);
    grid.push(row);
    requests.push(...barRowFormat(tabId, rowZeroBased, tone));
    requests.push(setRowHeight(tabId, rowZeroBased, 22));
    return rowZeroBased + 1;
  };

  const pushSpacer = (rowZeroBased: number): number => {
    grid.push(blank12());
    requests.push(setRowHeight(tabId, rowZeroBased, 12));
    return rowZeroBased + 1;
  };

  // ── compose ────────────────────────────────────────────────
  let r = 0;
  // Counts that match what the portal shows the user.
  const activeCount = statusCount['Active'] ?? 0;
  const onboardedCount = statusCount['Onboarded'] ?? 0;
  const withdrawnCount = statusCount['Withdrawn'] ?? 0;
  // "Active" KPI = cohort-3 size minus withdrawn (i.e. companies still
  // in the program). Matches Zaid's spec: cohort 3 size = 41 unless any
  // have withdrawn.
  const activeInProgram = cohortSize - withdrawnCount;

  r = pushTitle(
    'Companies Master Dashboard',
    `Live mirror of the Companies module · ${interviewedCount} interviewed · ${cohortSize}-company cohort 3 · generated ${at.toLocaleString()} by ${displayName(input.generatedBy) || input.generatedBy}.`,
  );

  r = pushSection(r, 'Top metrics');
  r = pushKpiRow(r, [
    { label: 'Interviewed', value: interviewedCount, tone: 'amber' },
    { label: 'Cohort 3', value: cohortSize, tone: 'navy' },
    { label: 'Active', value: activeInProgram, tone: 'green' },
    { label: 'Withdrawn', value: withdrawnCount, tone: 'red' },
  ]);

  r = pushSection(r, `Cohort 3 status breakdown · ${cohortSize} total`);
  for (const s of POST_SELECTION) {
    r = pushBarRow(r, s, statusCount[s] ?? 0, maxStatus, 'red');
  }
  r = pushSpacer(r);
  // suppress unused-warning: onboardedCount + activeCount are
  // referenced via statusCount above; the named bindings are kept for
  // future direct-readout changes without warnings.
  void onboardedCount; void activeCount;

  r = pushSection(r, 'By fund (cohort 3)');
  for (const [f, n] of fundEntries) {
    r = pushBarRow(r, f, n, maxFund, 'teal');
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By Account Manager (cohort 3)');
  // header row
  const amHeader = blank12();
  amHeader[0] = 'Account Manager';
  amHeader[1] = 'Companies';
  amHeader[2] = 'Interventions';
  amHeader[3] = 'Budget (USD)';
  grid.push(amHeader);
  requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    padding: { left: 12, right: 8, top: 4, bottom: 4 },
    textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
  }));
  r += 1;
  for (const am of amOrder) {
    const row = blank12();
    row[0] = am;
    row[1] = amCompanies[am] ?? 0;
    row[2] = amAssignments[am] ?? 0;
    row[3] = amBudget[am] ? `$${amBudget[am].toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '';
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }
  r = pushSpacer(r);

  r = pushSection(r, `Assignments by pillar (${totalAssignments} total · $${totalBudget.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
  for (const [p, n] of Object.entries(pillarCount)) {
    r = pushBarRow(r, p, n, maxPillar, 'orange');
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By sub-intervention');
  for (const sub of SUB_INTERVENTIONS) {
    r = pushBarRow(r, sub, subCount[sub] ?? 0, maxSub, 'teal');
  }
  r = pushSpacer(r);

  r = pushSection(r, `Selection reviews (${reviewsCohort.length} total)`);
  for (const k of ['Recommend', 'Hold', 'Waitlist', 'Reject']) {
    const row = blank12();
    row[0] = k;
    row[1] = reviewByDecision[k] ?? 0;
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }

  return { values: grid, requests, lastRow: grid.length };
}
