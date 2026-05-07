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

import type { Company, Assignment, PR, Payment } from '../../data/types';
import type { Review } from '../companies/reviewTypes';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';
import { pillarFor, COHORT3_BUDGET_TOTAL_USD } from '../../config/interventions';
import { INTERVIEWED_NAMES, isInterviewed } from '../companies/interviewedSource';
import { COHORT3_ALIASES, canonicalCohortName, cohortEntryFor } from '../../config/cohort3Aliases';

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

// ─── Payments dashboard ─────────────────────────────────────────────
//
// Same primitives as Companies / Procurement. KPIs by status, donor
// burn vs the 2026 cap, per-AM table, top-10 spend, by month strip.

export function buildPaymentsDashboard(input: {
  payments: Payment[];
  prs: PR[];                                    // for planned (committed) totals
  companies: Company[];                         // for AM + canonical name lookup
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedDashboard {
  const at = input.generatedAt ?? new Date();
  const tabId = input.tabId;

  const masterById = new Map<string, Company>();
  for (const c of input.companies) if (c.company_id) masterById.set(c.company_id, c);
  const isCohort = (companyId: string): boolean => {
    const c = masterById.get(companyId);
    if (!c) return false;
    return canonicalCohortName(c.company_name || '') !== null;
  };
  const amOf = (companyId: string): string => {
    const c = masterById.get(companyId);
    const lower = (c?.profile_manager_email || cohortEntryFor(c?.company_name || '')?.am || '').toLowerCase();
    if (!lower) return '(unassigned)';
    const am = ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === lower);
    return am ? displayName(am.email) : displayName(lower);
  };
  const fundDonor = (fund: string | undefined): 'Dutch' | 'SIDA' | null => {
    const f = (fund || '').trim();
    if (!f) return null;
    if (/dutch/i.test(f) || f === '97060') return 'Dutch';
    if (/sida/i.test(f) || f === '91763') return 'SIDA';
    return null;
  };
  const num = (s: string | undefined) => {
    const v = parseFloat(String(s || '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(v) ? v : 0;
  };

  // Cohort-only payments + planned PR sum.
  const cohortPayments = input.payments.filter(p => isCohort(p.company_id || ''));
  const cohortPRs = input.prs.filter(p => isCohort(p.company_id || ''));

  // KPIs by status
  const PAY_STATUSES = ['Pending Approval', 'Approved', 'Sent to Finance', 'Paid', 'Rejected'];
  const statusCount: Record<string, number> = {};
  const statusUsd: Record<string, number> = {};
  for (const s of PAY_STATUSES) { statusCount[s] = 0; statusUsd[s] = 0; }
  for (const p of cohortPayments) {
    const s = (p.status || '').trim();
    if (s in statusCount) {
      statusCount[s] += 1;
      statusUsd[s]   += num(p.amount_usd);
    }
  }

  const totalPaid = statusUsd['Paid'] ?? 0;
  const totalPlanned = cohortPRs.reduce((s, pr) => s + num(pr.total_cost_usd), 0);

  // Donor burn (Dutch / SIDA)
  type DonorAgg = { paid: number; planned: number; cap: number };
  const donor: { Dutch: DonorAgg; SIDA: DonorAgg } = {
    Dutch: { paid: 0, planned: 0, cap: COHORT3_BUDGET_TOTAL_USD.dutch },
    SIDA:  { paid: 0, planned: 0, cap: COHORT3_BUDGET_TOTAL_USD.sida },
  };
  for (const p of cohortPayments) {
    if ((p.status || '').toLowerCase() !== 'paid') continue;
    const d = fundDonor(p.fund_code);
    if (d) donor[d].paid += num(p.amount_usd);
  }
  for (const pr of cohortPRs) {
    const d = fundDonor(pr.fund_code);
    if (d) donor[d].planned += num(pr.total_cost_usd);
  }

  // Per-AM (companies, paid count, paid USD, planned USD)
  type AmAgg = { companies: Set<string>; paidCount: number; paidUsd: number; plannedUsd: number };
  const amBuckets = new Map<string, AmAgg>();
  const seedAm = (k: string) => {
    if (!amBuckets.has(k)) amBuckets.set(k, { companies: new Set(), paidCount: 0, paidUsd: 0, plannedUsd: 0 });
    return amBuckets.get(k)!;
  };
  for (const am of ACCOUNT_MANAGERS) seedAm(displayName(am.email));
  seedAm('(unassigned)');
  for (const p of cohortPayments) {
    const k = amOf(p.company_id || '');
    const b = seedAm(k);
    if (p.company_id) b.companies.add(p.company_id);
    if ((p.status || '').toLowerCase() === 'paid') {
      b.paidCount += 1;
      b.paidUsd += num(p.amount_usd);
    }
  }
  for (const pr of cohortPRs) {
    seedAm(amOf(pr.company_id || '')).plannedUsd += num(pr.total_cost_usd);
  }

  // By month — payment_date YYYY-MM bucket. Sorted asc.
  const byMonth = new Map<string, { count: number; paid: number }>();
  for (const p of cohortPayments) {
    const ym = (p.payment_date || '').slice(0, 7); // YYYY-MM
    if (!ym) continue;
    if (!byMonth.has(ym)) byMonth.set(ym, { count: 0, paid: 0 });
    const b = byMonth.get(ym)!;
    b.count += 1;
    if ((p.status || '').toLowerCase() === 'paid') b.paid += num(p.amount_usd);
  }
  const monthRows = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
  const maxMonth = Math.max(1, ...monthRows.map(([, b]) => b.paid));

  // Top 10 paid
  const topPaid = cohortPayments
    .filter(p => (p.status || '').toLowerCase() === 'paid')
    .map(p => ({ p, v: num(p.amount_usd) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);

  // ── grid + format ──────────────────────────────────────────
  const grid: DashboardGrid = [];
  const requests: unknown[] = [];

  requests.push(setTabProps(tabId));
  for (let c = 0; c < 12; c++) requests.push(setColumnWidth(tabId, c, 96));

  const blank12 = (): DashboardCell[] => Array.from({ length: 12 }, () => '');

  const pushTitle = (text: string, sub: string): number => {
    grid.push([text, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 0, 0, 12));
    requests.push(repeatCellFormat(tabId, 0, 1, 0, 12, {
      backgroundColorStyle: { rgbColor: COLOR.navy },
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { top: 8, bottom: 8, left: 14, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 18, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
    }));
    requests.push(setRowHeight(tabId, 0, 36));
    grid.push([sub, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 1, 0, 12));
    requests.push(repeatCellFormat(tabId, 1, 2, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
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
    while (tiles.length < 4) tiles.push({ label: '', value: '', tone: 'navy' });
    const labelRow: DashboardCell[] = blank12();
    const valueRow: DashboardCell[] = blank12();
    [0, 3, 6, 9].forEach((c0, i) => {
      labelRow[c0] = tiles[i].label.toUpperCase();
      valueRow[c0] = tiles[i].value;
      requests.push(...kpiTileFormat(tabId, rowZeroBased, c0, tiles[i].tone));
    });
    grid.push(labelRow);
    grid.push(valueRow);
    requests.push(setRowHeight(tabId, rowZeroBased, 18));
    requests.push(setRowHeight(tabId, rowZeroBased + 1, 38));
    grid.push(blank12());
    requests.push(setRowHeight(tabId, rowZeroBased + 2, 8));
    return rowZeroBased + 3;
  };
  const pushSpacer = (rowZeroBased: number): number => {
    grid.push(blank12());
    requests.push(setRowHeight(tabId, rowZeroBased, 12));
    return rowZeroBased + 1;
  };

  // ── compose ────────────────────────────────────────────────
  let r = 0;
  r = pushTitle(
    'Payments Dashboard',
    `Live mirror of the Payments module · ${cohortPayments.length} cohort entries · ${fmtUsd0(totalPaid)} paid of ${fmtUsd0(totalPlanned)} planned · generated ${at.toLocaleString()} by ${displayName(input.generatedBy) || input.generatedBy}.`,
  );

  r = pushSection(r, 'Top metrics');
  r = pushKpiRow(r, [
    { label: 'Cohort entries', value: cohortPayments.length, tone: 'navy' },
    { label: 'Pending',  value: statusCount['Pending Approval'] ?? 0, tone: 'amber' },
    { label: 'Paid',     value: statusCount['Paid'] ?? 0, tone: 'green' },
    { label: 'Rejected', value: statusCount['Rejected'] ?? 0, tone: 'red' },
  ]);

  r = pushSection(r, 'By status (count · USD)');
  const maxStatusCount = Math.max(1, ...Object.values(statusCount));
  for (const s of PAY_STATUSES) {
    const row = blank12();
    row[0] = s;
    row[1] = statusCount[s] ?? 0;
    row[2] = bar(statusCount[s] ?? 0, maxStatusCount);
    row[10] = fmtUsd0(statusUsd[s] ?? 0);
    grid.push(row);
    requests.push(...barRowFormat(tabId, r, 'amber'));
    requests.push(setRowHeight(tabId, r, 22));
    r += 1;
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By donor (cohort 3, paid)');
  const maxDonorCap = Math.max(donor.Dutch.cap, donor.SIDA.cap);
  for (const d of ['Dutch', 'SIDA'] as const) {
    const b = donor[d];
    const row = blank12();
    row[0] = `${d} · ${fmtUsd0(b.paid)} paid · ${fmtUsd0(b.planned)} planned · cap ${fmtUsd0(b.cap)}`;
    row[1] = `${b.cap > 0 ? Math.round((b.paid / b.cap) * 100) : 0}%`;
    row[2] = bar(b.paid, maxDonorCap);
    grid.push(row);
    requests.push(...barRowFormat(tabId, r, d === 'Dutch' ? 'orange' : 'teal'));
    requests.push(setRowHeight(tabId, r, 22));
    r += 1;
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By Account Manager (cohort 3)');
  const amHeader = blank12();
  amHeader[0] = 'Account Manager';
  amHeader[1] = 'Companies';
  amHeader[2] = 'Paid #';
  amHeader[3] = 'Paid USD';
  amHeader[4] = 'Planned USD';
  grid.push(amHeader);
  requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 12, right: 8, top: 4, bottom: 4 },
    textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
  }));
  r += 1;
  const amOrder = [
    ...ACCOUNT_MANAGERS.map(a => displayName(a.email)),
    '(unassigned)',
  ].filter(k => {
    const b = amBuckets.get(k);
    return !!b && (b.companies.size > 0 || b.paidCount > 0 || b.plannedUsd > 0);
  });
  for (const k of amOrder) {
    const b = amBuckets.get(k)!;
    const row = blank12();
    row[0] = k;
    row[1] = b.companies.size;
    row[2] = b.paidCount;
    row[3] = fmtUsd0(b.paidUsd);
    row[4] = fmtUsd0(b.plannedUsd);
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }
  r = pushSpacer(r);

  if (monthRows.length > 0) {
    r = pushSection(r, 'By month (paid USD)');
    for (const [ym, b] of monthRows) {
      const row = blank12();
      row[0] = ym;
      row[1] = b.count;
      row[2] = bar(b.paid, maxMonth);
      row[10] = fmtUsd0(b.paid);
      grid.push(row);
      requests.push(...barRowFormat(tabId, r, 'teal'));
      requests.push(setRowHeight(tabId, r, 22));
      r += 1;
    }
    r = pushSpacer(r);
  }

  r = pushSection(r, 'Top 10 paid');
  const topHeader = blank12();
  topHeader[0] = 'Payment';
  topHeader[1] = 'Date';
  topHeader[2] = 'Payee';
  topHeader[5] = 'Company';
  topHeader[10] = 'USD';
  grid.push(topHeader);
  requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 12, right: 8, top: 4, bottom: 4 },
    textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
  }));
  r += 1;
  for (const { p, v } of topPaid) {
    const row = blank12();
    row[0] = p.payment_id || '';
    row[1] = p.payment_date || '';
    row[2] = p.payee_name || '';
    const c = masterById.get(p.company_id || '');
    row[5] = c?.company_name || p.company_id || '';
    row[10] = fmtUsd0(v);
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }

  return { values: grid, requests, lastRow: grid.length };
}

// ─── Procurement dashboard ──────────────────────────────────────────
//
// Mirrors the Companies dashboard layout: navy banner + 4 KPI tiles +
// a series of bar sections + an AM table. Same primitives, different
// inputs. Cohort filtering uses cohortEntryFor() against the company
// master so non-cohort PRs don't leak into the spend bars.

function fmtUsd0(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const PR_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Awarded', 'Delivered', 'Cancelled'];
const PR_OPEN_STATUSES = new Set(['draft', 'submitted', 'under review']);

export function buildProcurementDashboard(input: {
  prsByQuarter: { q1: PR[]; q2: PR[]; q3: PR[]; q4: PR[] };
  companies: Company[];                         // master rows for AM/cohort lookup
  payments: Payment[];                          // for paid totals
  generatedBy: string;
  generatedAt?: Date;
  tabId: number;
}): FormattedDashboard {
  const at = input.generatedAt ?? new Date();
  const tabId = input.tabId;

  // Index master rows by company_id so we can attach AM + cohort flag
  // without re-parsing the company name on every PR.
  const masterById = new Map<string, Company>();
  for (const c of input.companies) {
    if (c.company_id) masterById.set(c.company_id, c);
  }
  const isCohortCompany = (companyId: string): boolean => {
    const c = masterById.get(companyId);
    if (!c) return false;
    return canonicalCohortName(c.company_name || '') !== null;
  };
  const amOf = (companyId: string): string => {
    const c = masterById.get(companyId);
    const lower = (c?.profile_manager_email || cohortEntryFor(c?.company_name || '')?.am || '').toLowerCase();
    if (!lower) return '(unassigned)';
    const am = ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === lower);
    return am ? displayName(am.email) : displayName(lower);
  };

  // Flat cohort PR list with quarter tag.
  type TaggedPR = PR & { __quarter: 'Q1 2026' | 'Q2 2026' | 'Q3 2026' | 'Q4 2026' };
  const allPrs: TaggedPR[] = [
    ...input.prsByQuarter.q1.map(p => ({ ...p, __quarter: 'Q1 2026' as const })),
    ...input.prsByQuarter.q2.map(p => ({ ...p, __quarter: 'Q2 2026' as const })),
    ...input.prsByQuarter.q3.map(p => ({ ...p, __quarter: 'Q3 2026' as const })),
    ...input.prsByQuarter.q4.map(p => ({ ...p, __quarter: 'Q4 2026' as const })),
  ].filter(p => isCohortCompany(p.company_id || ''));

  // ── compute ────────────────────────────────────────────────
  let totalPlanned = 0;
  let totalPaid = 0;
  for (const p of allPrs) {
    const v = parseFloat(String(p.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) totalPlanned += v;
  }
  for (const pay of input.payments) {
    if ((pay.status || '').toLowerCase() !== 'paid') continue;
    if (!isCohortCompany(pay.company_id || '')) continue;
    const v = parseFloat(String(pay.amount_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) totalPaid += v;
  }

  const openCount    = allPrs.filter(p => PR_OPEN_STATUSES.has((p.status || '').toLowerCase().trim())).length;
  const awardedCount = allPrs.filter(p => (p.status || '').toLowerCase().trim() === 'awarded').length;
  const deliveredCount = allPrs.filter(p => (p.status || '').toLowerCase().trim() === 'delivered').length;

  // Per-quarter
  const byQuarter = {
    'Q1 2026': allPrs.filter(p => p.__quarter === 'Q1 2026'),
    'Q2 2026': allPrs.filter(p => p.__quarter === 'Q2 2026'),
    'Q3 2026': allPrs.filter(p => p.__quarter === 'Q3 2026'),
    'Q4 2026': allPrs.filter(p => p.__quarter === 'Q4 2026'),
  };
  const maxQuarter = Math.max(1, ...Object.values(byQuarter).map(arr => arr.length));

  // Per-status
  const statusCount: Record<string, number> = {};
  for (const s of PR_STATUSES) statusCount[s] = 0;
  for (const p of allPrs) {
    const s = (p.status || '').trim();
    if (s in statusCount) statusCount[s] += 1;
  }
  const maxStatus = Math.max(1, ...Object.values(statusCount));

  // Per-AM (companies, total PRs, planned, paid)
  type AmAgg = { companies: Set<string>; prs: number; planned: number; paid: number };
  const amBuckets = new Map<string, AmAgg>();
  const seedAm = (k: string) => {
    if (!amBuckets.has(k)) amBuckets.set(k, { companies: new Set(), prs: 0, planned: 0, paid: 0 });
    return amBuckets.get(k)!;
  };
  for (const am of ACCOUNT_MANAGERS) seedAm(displayName(am.email));
  seedAm('(unassigned)');
  for (const p of allPrs) {
    const k = amOf(p.company_id || '');
    const b = seedAm(k);
    if (p.company_id) b.companies.add(p.company_id);
    b.prs += 1;
    const v = parseFloat(String(p.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) b.planned += v;
  }
  for (const pay of input.payments) {
    if ((pay.status || '').toLowerCase() !== 'paid') continue;
    if (!isCohortCompany(pay.company_id || '')) continue;
    const k = amOf(pay.company_id || '');
    const v = parseFloat(String(pay.amount_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) seedAm(k).paid += v;
  }

  // Per-pillar
  const pillarCount: Record<string, { count: number; planned: number; paid: number }> = {
    'Market Access': { count: 0, planned: 0, paid: 0 },
    'Capacity Building': { count: 0, planned: 0, paid: 0 },
    'Marketing & Branding': { count: 0, planned: 0, paid: 0 },
  };
  for (const p of allPrs) {
    const pl = pillarFor(p.intervention_type)?.label;
    if (!pl) continue;
    const v = parseFloat(String(p.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
    pillarCount[pl].count += 1;
    if (Number.isFinite(v)) pillarCount[pl].planned += v;
  }
  for (const pay of input.payments) {
    if ((pay.status || '').toLowerCase() !== 'paid') continue;
    if (!isCohortCompany(pay.company_id || '')) continue;
    const pl = pillarFor(pay.intervention_type)?.label;
    if (!pl) continue;
    const v = parseFloat(String(pay.amount_usd || '').replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(v)) pillarCount[pl].paid += v;
  }
  const maxPillarPlanned = Math.max(1, ...Object.values(pillarCount).map(p => p.planned));

  // Top 10 PRs by total cost
  const topPrs = [...allPrs]
    .map(p => ({ p, v: parseFloat(String(p.total_cost_usd || '').replace(/[^0-9.\-]/g, '')) || 0 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);

  // ── grid + format ──────────────────────────────────────────
  const grid: DashboardGrid = [];
  const requests: unknown[] = [];

  requests.push(setTabProps(tabId));
  for (let c = 0; c < 12; c++) requests.push(setColumnWidth(tabId, c, 96));

  const blank12 = (): DashboardCell[] => Array.from({ length: 12 }, () => '');

  // Reuse the same primitives as Companies dashboard.
  const pushTitle = (text: string, sub: string): number => {
    grid.push([text, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 0, 0, 12));
    requests.push(repeatCellFormat(tabId, 0, 1, 0, 12, {
      backgroundColorStyle: { rgbColor: COLOR.navy },
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { top: 8, bottom: 8, left: 14, right: 8 },
      textFormat: { fontFamily: FONT, fontSize: 18, bold: true, foregroundColorStyle: { rgbColor: COLOR.white } },
    }));
    requests.push(setRowHeight(tabId, 0, 36));

    grid.push([sub, ...new Array(11).fill('')]);
    requests.push(mergeRow(tabId, 1, 0, 12));
    requests.push(repeatCellFormat(tabId, 1, 2, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
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
    while (tiles.length < 4) tiles.push({ label: '', value: '', tone: 'navy' });
    const labelRow: DashboardCell[] = blank12();
    const valueRow: DashboardCell[] = blank12();
    [0, 3, 6, 9].forEach((c0, i) => {
      labelRow[c0] = tiles[i].label.toUpperCase();
      valueRow[c0] = tiles[i].value;
      requests.push(...kpiTileFormat(tabId, rowZeroBased, c0, tiles[i].tone));
    });
    grid.push(labelRow);
    grid.push(valueRow);
    requests.push(setRowHeight(tabId, rowZeroBased, 18));
    requests.push(setRowHeight(tabId, rowZeroBased + 1, 38));
    grid.push(blank12());
    requests.push(setRowHeight(tabId, rowZeroBased + 2, 8));
    return rowZeroBased + 3;
  };
  const pushBarRow = (rowZeroBased: number, label: string, count: number | string, max: number, tone: Tone): number => {
    const row: DashboardCell[] = blank12();
    row[0] = label;
    row[1] = count;
    if (typeof count === 'number') row[2] = bar(count, max);
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
  r = pushTitle(
    'Procurement Dashboard',
    `Live mirror of the Procurement module · ${allPrs.length} cohort PRs across 4 quarters · generated ${at.toLocaleString()} by ${displayName(input.generatedBy) || input.generatedBy}.`,
  );

  r = pushSection(r, 'Top metrics');
  r = pushKpiRow(r, [
    { label: 'Total PRs', value: allPrs.length, tone: 'navy' },
    { label: 'Open',      value: openCount,    tone: 'amber' },
    { label: 'Awarded',   value: awardedCount, tone: 'teal' },
    { label: 'Delivered', value: deliveredCount, tone: 'green' },
  ]);

  r = pushSection(r, `Spend (cohort 3 · ${fmtUsd0(totalPaid)} paid of ${fmtUsd0(totalPlanned)} planned · cap ${fmtUsd0(COHORT3_BUDGET_TOTAL_USD.combined)})`);
  r = pushBarRow(r, 'Planned', totalPlanned, Math.max(totalPlanned, totalPaid, COHORT3_BUDGET_TOTAL_USD.combined), 'orange');
  r = pushBarRow(r, 'Paid', totalPaid, Math.max(totalPlanned, totalPaid, COHORT3_BUDGET_TOTAL_USD.combined), 'teal');
  r = pushBarRow(r, '2026 cap', COHORT3_BUDGET_TOTAL_USD.combined, Math.max(totalPlanned, totalPaid, COHORT3_BUDGET_TOTAL_USD.combined), 'navy');
  r = pushSpacer(r);

  r = pushSection(r, 'By quarter');
  for (const [label, arr] of Object.entries(byQuarter)) {
    r = pushBarRow(r, label, arr.length, maxQuarter, 'red');
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By status');
  for (const s of PR_STATUSES) {
    r = pushBarRow(r, s, statusCount[s] ?? 0, maxStatus, 'amber');
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By Account Manager (cohort 3)');
  // table header
  const amHeader = blank12();
  amHeader[0] = 'Account Manager';
  amHeader[1] = 'Companies';
  amHeader[2] = 'PRs';
  amHeader[3] = 'Planned';
  amHeader[4] = 'Paid';
  grid.push(amHeader);
  requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 12, right: 8, top: 4, bottom: 4 },
    textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
  }));
  r += 1;
  const amOrder = [
    ...ACCOUNT_MANAGERS.map(a => displayName(a.email)),
    '(unassigned)',
  ].filter(k => (amBuckets.get(k)?.prs ?? 0) > 0);
  for (const k of amOrder) {
    const b = amBuckets.get(k)!;
    const row = blank12();
    row[0] = k;
    row[1] = b.companies.size;
    row[2] = b.prs;
    row[3] = fmtUsd0(b.planned);
    row[4] = fmtUsd0(b.paid);
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }
  r = pushSpacer(r);

  r = pushSection(r, 'By pillar — planned spend');
  for (const [label, agg] of Object.entries(pillarCount)) {
    r = pushBarRow(r, `${label} · ${fmtUsd0(agg.paid)} paid`, agg.planned, maxPillarPlanned, 'teal');
  }
  r = pushSpacer(r);

  r = pushSection(r, 'Top 10 highest-value PRs');
  const topHeader = blank12();
  topHeader[0] = 'PR';
  topHeader[1] = 'Quarter';
  topHeader[2] = 'Company';
  topHeader[5] = 'Activity';
  topHeader[10] = 'USD';
  grid.push(topHeader);
  requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
    horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
    padding: { left: 12, right: 8, top: 4, bottom: 4 },
    textFormat: { fontFamily: FONT, fontSize: 9, bold: true, foregroundColorStyle: { rgbColor: COLOR.muted } },
  }));
  r += 1;
  for (const { p, v } of topPrs) {
    const row = blank12();
    row[0] = p.pr_id || '';
    row[1] = p.__quarter;
    const c = masterById.get(p.company_id || '');
    row[2] = c?.company_name || p.company_id || '';
    row[5] = p.activity || '';
    row[10] = fmtUsd0(v);
    grid.push(row);
    requests.push(repeatCellFormat(tabId, r, r + 1, 0, 12, {
      horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE',
      padding: { left: 12, right: 8, top: 4, bottom: 4 },
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColorStyle: { rgbColor: COLOR.navy } },
    }));
    r += 1;
  }

  return { values: grid, requests, lastRow: grid.length };
}
