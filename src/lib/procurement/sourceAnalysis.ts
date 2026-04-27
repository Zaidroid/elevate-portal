// Per-company aggregation of the procurement source rows. Builds the
// inputs the SourceAnalysisView renders: company-level totals, status
// breakdown, pillar coverage, vendor list, time-window filtering,
// anomaly + stuck-PR detection, cross-check against the interviewed
// list, and a per-company data-quality score.
//
// Read-only. The team source workbook stays the source of truth.

import type { SourceProcurementRow } from './sourceParser';
import { INTERVIEWED_RAW, isInterviewed, INTERVIEWED_NAMES } from '../../pages/companies/interviewedSource';
import { PILLARS, INTERVENTION_TYPES, pillarFor } from '../../config/interventions';

// ───────────────────── Types ─────────────────────

export type CompanyAnalysis = {
  company_name: string;
  matched_interviewed: boolean;
  pr_count: number;
  total_committed_usd: number;
  total_awarded_usd: number;          // PRs whose status indicates 'Awarded' or 'Delivered'
  total_paid_usd: number;             // PRs whose status indicates 'Paid' / 'Delivered' (proxy)
  rows: SourceProcurementRow[];
  status_breakdown: Record<string, number>;
  fund_breakdown: Record<string, number>;
  pillar_breakdown: Record<string, number>;     // pillar code → count
  vendors: Record<string, number>;              // vendor → count
  earliest_yyyymm: number;
  latest_yyyymm: number;
  months_active: number;
  has_pr_id: number;
  missing_pr_id: number;
  missing_status: number;
  missing_fund: number;
  missing_total: number;
  missing_vendor: number;
  stuck_count: number;                          // PRs past target_award_date, status not closed
  // 0..100 — composite of field completeness across this company's rows
  quality_score: number;
};

export type VendorAnalysis = {
  vendor: string;
  pr_count: number;
  total_usd: number;
  company_count: number;
  companies: string[];
  earliest_yyyymm: number;
  latest_yyyymm: number;
  status_breakdown: Record<string, number>;
};

export type StuckPR = {
  row: SourceProcurementRow;
  daysOverdue: number;
};

export type AnalysisSummary = {
  totalRows: number;
  uniqueCompanies: number;
  uniqueVendors: number;
  totalCommittedUsd: number;
  totalAwardedUsd: number;
  totalPaidUsd: number;
  byMonth: Array<{ yyyymm: number; label: string; count: number; total: number }>;
  byStatus: Record<string, number>;
  byFund: Record<string, number>;
  byPillar: Record<string, number>;
  byThreshold: Record<string, number>;          // micro / small / standard / high-value
  topVendors: VendorAnalysis[];                 // sorted desc by $, top N
  stuckPRs: StuckPR[];                          // every detected stuck PR
  pipeline: Array<{ stage: string; count: number; total: number; tone: 'amber' | 'teal' | 'green' | 'red' | 'orange' | 'neutral' }>;
  anomalies: {
    rowsWithNoCompany: SourceProcurementRow[];
    rowsWithNoPrId: number;
    rowsWithNoFund: number;
    rowsWithNoStatus: number;
    rowsWithNoTotal: number;
    rowsWithNoVendor: number;
    rowsWithBadTotal: SourceProcurementRow[];
    duplicateActivityCompanyMonth: Array<{ key: string; rows: SourceProcurementRow[] }>;
  };
  interviewedWithoutProcurement: string[];
  procurementForNonInterviewed: string[];
};

export type FilterOptions = {
  fromYyyymm?: number;
  toYyyymm?: number;
  fundCode?: string;             // exact match, e.g. '97060'
  status?: string;               // exact match
  pillar?: string;               // pillar code
};

// ───────────────────── Constants & helpers ─────────────────────

// Status normalisation. The team writes statuses with a lot of variance
// ("Pending Approval", "Pending appr.", "Approved by FA"), so we cluster
// by keyword. Used for pipeline analysis + completeness flags.
const STATUS_BUCKETS: Array<{ stage: string; tone: AnalysisSummary['pipeline'][number]['tone']; pattern: RegExp }> = [
  { stage: 'Draft', tone: 'amber', pattern: /draft|preparation|prep/i },
  { stage: 'Submitted', tone: 'teal', pattern: /submit|in progress|under review|review|pending/i },
  { stage: 'Awarded', tone: 'orange', pattern: /awarded|awarded to|signed/i },
  { stage: 'Delivered / Paid', tone: 'green', pattern: /deliver|paid|complete|closed/i },
  { stage: 'Cancelled', tone: 'red', pattern: /cancel|reject|withdrawn|on hold/i },
];

function statusToStage(status?: string): { stage: string; tone: AnalysisSummary['pipeline'][number]['tone'] } {
  if (!status) return { stage: 'Unknown', tone: 'neutral' };
  for (const b of STATUS_BUCKETS) {
    if (b.pattern.test(status)) return { stage: b.stage, tone: b.tone };
  }
  return { stage: 'Other', tone: 'neutral' };
}

function isAwardedStatus(status?: string): boolean {
  return /awarded|deliver|paid|complete|closed|signed/i.test(status || '');
}

function isPaidStatus(status?: string): boolean {
  return /paid|deliver|complete|closed/i.test(status || '');
}

function isClosedStatus(status?: string): boolean {
  return /awarded|deliver|paid|complete|closed|cancel|reject|withdrawn/i.test(status || '');
}

// Threshold class derivation from total — Mercy Corps tiers we use across
// the portal. Used for the threshold breakdown.
function thresholdFor(total: number): string {
  if (total <= 0) return 'Unknown';
  if (total < 5000) return 'Micro (< $5K)';
  if (total < 25000) return 'Small ($5K-$25K)';
  if (total < 100000) return 'Standard ($25K-$100K)';
  return 'High-value (> $100K)';
}

// Pillar inference. Tries the dedicated intervention column first (if
// the team uses one), then scans the activity / item description for
// pillar codes or sub-intervention names.
const PILLAR_NAME_RX = new RegExp(
  '\\b(' + [
    ...PILLARS.map(p => p.label),
    ...PILLARS.map(p => p.code),
    ...PILLARS.flatMap(p => p.subInterventions),
    'train.to.hire', 'tth', 'upskill', 'marketing', 'legal',
    'domain', 'coaching', 'conference', 'elevatebridge',
  ].map(s => s.replace(/\s+/g, '\\s+').replace(/[.+*?^$()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);

function inferPillar(row: SourceProcurementRow): string | null {
  const text = `${row.activity || ''} ${row.item_description || ''} ${row.notes || ''}`;
  if (!text.trim()) return null;
  // Try direct intervention-type match first (e.g., 'TTH', 'Upskilling').
  for (const code of INTERVENTION_TYPES) {
    const rx = new RegExp(`\\b${code.replace(/[.+*?^$()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (rx.test(text)) return pillarFor(code)?.code || null;
  }
  // Then try keywords.
  const m = text.match(PILLAR_NAME_RX);
  if (!m) return null;
  const tok = m[0].toLowerCase();
  if (/train.to.hire|tth/i.test(tok)) return 'TTH';
  if (/upskill/i.test(tok)) return 'Upskilling';
  if (/market|brand|mkg/i.test(tok)) return 'MKG';
  if (/legal|registration/i.test(tok)) return 'MA';
  if (/domain|coaching|c.suite/i.test(tok)) return 'C-Suite';
  if (/conference|travel/i.test(tok)) return 'Conferences';
  if (/elevatebridge|elevate.bridge/i.test(tok)) return 'ElevateBridge';
  return pillarFor(m[0])?.code || null;
}

function inferCompanyFromText(text: string): string | null {
  if (!text) return null;
  for (const name of INTERVIEWED_RAW) {
    if (!name || name.length < 4) continue;
    if (text.toLowerCase().includes(name.toLowerCase())) return name;
  }
  return null;
}

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function yyyymmLabel(yyyymm: number): string {
  if (!yyyymm) return '?';
  const y = Math.floor(yyyymm / 100);
  const m = yyyymm % 100;
  return `${y}-${m.toString().padStart(2, '0')}`;
}

function parseDate(s: string): Date | null {
  if (!s || !s.trim()) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseTotal(s: string): number {
  const n = parseFloat((s || '').replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Quality score: simple weighted completeness across the row's key fields.
// Each missing field deducts. Caller averages across a company's rows.
function rowQuality(r: SourceProcurementRow): number {
  let score = 100;
  if (!r.pr_id) score -= 15;
  if (!r.status) score -= 15;
  if (!r.fund_code) score -= 15;
  if (!r.total_cost_usd || isNaN(parseFloat(r.total_cost_usd.replace(/[^\d.\-]/g, '')))) score -= 25;
  if (!r.vendor) score -= 10;
  if (!r.activity && !r.item_description) score -= 20;
  return Math.max(0, score);
}

// ───────────────────── Main entrypoint ─────────────────────

export function analyzeProcurementSource(
  rows: SourceProcurementRow[],
  opts: FilterOptions = {}
): { summary: AnalysisSummary; perCompany: CompanyAnalysis[]; perVendor: VendorAnalysis[] } {
  // ─── Time + axis filter ───
  const filtered = rows.filter(r => {
    if (opts.fromYyyymm && r.source_month_yyyymm && r.source_month_yyyymm < opts.fromYyyymm) return false;
    if (opts.toYyyymm && r.source_month_yyyymm && r.source_month_yyyymm > opts.toYyyymm) return false;
    if (opts.fundCode && r.fund_code !== opts.fundCode) return false;
    if (opts.status && r.status !== opts.status) return false;
    return true;
  });

  // ─── Enrich each row with company_name + pillar ───
  const enriched = filtered.map(r => {
    const fromCol = (r.company_name || '').trim();
    const company = fromCol || inferCompanyFromText(`${r.activity} ${r.item_description} ${r.notes}`) || '';
    const pillar = inferPillar(r) || '';
    return { ...r, company_name: company, _pillar: pillar };
  });

  // Apply pillar filter post-inference.
  const finalRows = opts.pillar
    ? enriched.filter(r => r._pillar === opts.pillar)
    : enriched;

  // ─── Per-company aggregation ───
  const perCompanyMap = new Map<string, CompanyAnalysis & { _qualitySum: number }>();
  const rowsWithNoCompany: SourceProcurementRow[] = [];
  const rowsWithBadTotal: SourceProcurementRow[] = [];
  const today = new Date();

  for (const r of finalRows) {
    const companyName = (r.company_name || '').trim();
    if (!companyName) {
      rowsWithNoCompany.push(r);
      continue;
    }
    const key = normName(companyName);
    let entry = perCompanyMap.get(key);
    if (!entry) {
      entry = {
        company_name: companyName,
        matched_interviewed: isInterviewed(companyName, INTERVIEWED_NAMES),
        pr_count: 0,
        total_committed_usd: 0,
        total_awarded_usd: 0,
        total_paid_usd: 0,
        rows: [],
        status_breakdown: {},
        fund_breakdown: {},
        pillar_breakdown: {},
        vendors: {},
        earliest_yyyymm: 0,
        latest_yyyymm: 0,
        months_active: 0,
        has_pr_id: 0,
        missing_pr_id: 0,
        missing_status: 0,
        missing_fund: 0,
        missing_total: 0,
        missing_vendor: 0,
        stuck_count: 0,
        quality_score: 0,
        _qualitySum: 0,
      };
      perCompanyMap.set(key, entry);
    }

    entry.rows.push(r);
    entry.pr_count += 1;
    entry._qualitySum += rowQuality(r);

    const total = parseTotal(r.total_cost_usd);
    if (total > 0) {
      entry.total_committed_usd += total;
      if (isAwardedStatus(r.status)) entry.total_awarded_usd += total;
      if (isPaidStatus(r.status)) entry.total_paid_usd += total;
    } else if (r.total_cost_usd && r.total_cost_usd.trim()) {
      rowsWithBadTotal.push(r);
    }

    if (r.pr_id) entry.has_pr_id += 1; else entry.missing_pr_id += 1;
    if (!r.status) entry.missing_status += 1;
    if (!r.fund_code) entry.missing_fund += 1;
    if (!r.total_cost_usd) entry.missing_total += 1;
    if (!r.vendor) entry.missing_vendor += 1;

    const status = r.status || 'No status';
    entry.status_breakdown[status] = (entry.status_breakdown[status] || 0) + 1;
    if (r.fund_code) entry.fund_breakdown[r.fund_code] = (entry.fund_breakdown[r.fund_code] || 0) + 1;
    if (r._pillar) entry.pillar_breakdown[r._pillar] = (entry.pillar_breakdown[r._pillar] || 0) + 1;
    if (r.vendor) entry.vendors[r.vendor] = (entry.vendors[r.vendor] || 0) + 1;

    if (r.source_month_yyyymm) {
      if (!entry.earliest_yyyymm || r.source_month_yyyymm < entry.earliest_yyyymm) entry.earliest_yyyymm = r.source_month_yyyymm;
      if (r.source_month_yyyymm > entry.latest_yyyymm) entry.latest_yyyymm = r.source_month_yyyymm;
    }

    // Stuck = target_award_date in the past AND status not closed.
    const target = parseDate(r.target_award_date);
    if (target && target < today && !isClosedStatus(r.status)) {
      entry.stuck_count += 1;
    }
  }

  // Distinct months + final quality score per company.
  for (const entry of perCompanyMap.values()) {
    const months = new Set(entry.rows.map(r => r.source_month_yyyymm).filter(Boolean));
    entry.months_active = months.size;
    entry.quality_score = Math.round(entry._qualitySum / Math.max(1, entry.pr_count));
  }

  // ─── Per-vendor aggregation ───
  const vendorMap = new Map<string, VendorAnalysis & { _companies: Set<string> }>();
  for (const r of finalRows) {
    const v = (r.vendor || '').trim();
    if (!v) continue;
    let entry = vendorMap.get(v);
    if (!entry) {
      entry = {
        vendor: v,
        pr_count: 0,
        total_usd: 0,
        company_count: 0,
        companies: [],
        earliest_yyyymm: 0,
        latest_yyyymm: 0,
        status_breakdown: {},
        _companies: new Set<string>(),
      };
      vendorMap.set(v, entry);
    }
    entry.pr_count += 1;
    entry.total_usd += parseTotal(r.total_cost_usd);
    if (r.company_name) entry._companies.add(r.company_name);
    if (r.source_month_yyyymm) {
      if (!entry.earliest_yyyymm || r.source_month_yyyymm < entry.earliest_yyyymm) entry.earliest_yyyymm = r.source_month_yyyymm;
      if (r.source_month_yyyymm > entry.latest_yyyymm) entry.latest_yyyymm = r.source_month_yyyymm;
    }
    const s = r.status || 'No status';
    entry.status_breakdown[s] = (entry.status_breakdown[s] || 0) + 1;
  }
  for (const entry of vendorMap.values()) {
    entry.companies = Array.from(entry._companies);
    entry.company_count = entry.companies.length;
  }

  // ─── Roll up summary ───
  const byMonthMap = new Map<number, { count: number; total: number }>();
  const byStatus: Record<string, number> = {};
  const byFund: Record<string, number> = {};
  const byPillar: Record<string, number> = {};
  const byThreshold: Record<string, number> = {};
  const stuckPRs: StuckPR[] = [];
  let totalCommitted = 0, totalAwarded = 0, totalPaid = 0;
  let rowsWithNoPrId = 0, rowsWithNoFund = 0, rowsWithNoStatus = 0, rowsWithNoTotal = 0, rowsWithNoVendor = 0;

  for (const r of finalRows) {
    if (r.source_month_yyyymm) {
      const bucket = byMonthMap.get(r.source_month_yyyymm) || { count: 0, total: 0 };
      bucket.count += 1;
      const total = parseTotal(r.total_cost_usd);
      bucket.total += total;
      byMonthMap.set(r.source_month_yyyymm, bucket);
    }
    const total = parseTotal(r.total_cost_usd);
    totalCommitted += total;
    if (isAwardedStatus(r.status)) totalAwarded += total;
    if (isPaidStatus(r.status)) totalPaid += total;

    const status = r.status || 'No status';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (r.fund_code) byFund[r.fund_code] = (byFund[r.fund_code] || 0) + 1;
    if (r._pillar) byPillar[r._pillar] = (byPillar[r._pillar] || 0) + 1;
    if (total > 0) byThreshold[thresholdFor(total)] = (byThreshold[thresholdFor(total)] || 0) + 1;

    if (!r.pr_id) rowsWithNoPrId += 1;
    if (!r.fund_code) rowsWithNoFund += 1;
    if (!r.status) rowsWithNoStatus += 1;
    if (!r.total_cost_usd) rowsWithNoTotal += 1;
    if (!r.vendor) rowsWithNoVendor += 1;

    const target = parseDate(r.target_award_date);
    if (target && target < today && !isClosedStatus(r.status)) {
      stuckPRs.push({ row: r, daysOverdue: Math.floor((today.getTime() - target.getTime()) / (24 * 3600 * 1000)) });
    }
  }

  // Pipeline = aggregate of normalized stages with $ totals.
  const stageMap = new Map<string, { tone: AnalysisSummary['pipeline'][number]['tone']; count: number; total: number }>();
  for (const r of finalRows) {
    const { stage, tone } = statusToStage(r.status);
    const e = stageMap.get(stage) || { tone, count: 0, total: 0 };
    e.count += 1;
    e.total += parseTotal(r.total_cost_usd);
    stageMap.set(stage, e);
  }
  const pipelineOrder = ['Draft', 'Submitted', 'Awarded', 'Delivered / Paid', 'Cancelled', 'Other', 'Unknown'];
  const pipeline = pipelineOrder
    .filter(s => stageMap.has(s))
    .map(s => ({ stage: s, ...stageMap.get(s)! }));

  // Duplicates by (company + activity + month).
  const dupeMap = new Map<string, SourceProcurementRow[]>();
  for (const r of finalRows) {
    if (!r.company_name || !r.activity || !r.source_month_yyyymm) continue;
    const key = `${normName(r.company_name)}::${normName(r.activity)}::${r.source_month_yyyymm}`;
    const arr = dupeMap.get(key) || [];
    arr.push(r);
    dupeMap.set(key, arr);
  }
  const duplicates = Array.from(dupeMap.entries())
    .filter(([, rs]) => rs.length > 1)
    .map(([key, rs]) => ({ key, rows: rs }));

  // Cross-check vs interviewed list.
  const seenCompanies = new Set(Array.from(perCompanyMap.values()).map(c => normName(c.company_name)));
  const interviewedWithoutProcurement = INTERVIEWED_RAW.filter(name => !seenCompanies.has(normName(name)));
  const procurementForNonInterviewed = Array.from(perCompanyMap.values())
    .filter(c => !c.matched_interviewed)
    .map(c => c.company_name);

  const byMonth = Array.from(byMonthMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([yyyymm, v]) => ({ yyyymm, label: yyyymmLabel(yyyymm), count: v.count, total: v.total }));

  // Top vendors (cap to top 10 for the summary; full list returned separately).
  const allVendors = Array.from(vendorMap.values()).sort((a, b) => b.total_usd - a.total_usd);
  const topVendors = allVendors.slice(0, 10);

  const summary: AnalysisSummary = {
    totalRows: finalRows.length,
    uniqueCompanies: perCompanyMap.size,
    uniqueVendors: vendorMap.size,
    totalCommittedUsd: totalCommitted,
    totalAwardedUsd: totalAwarded,
    totalPaidUsd: totalPaid,
    byMonth,
    byStatus,
    byFund,
    byPillar,
    byThreshold,
    topVendors,
    stuckPRs,
    pipeline,
    anomalies: {
      rowsWithNoCompany,
      rowsWithNoPrId,
      rowsWithNoFund,
      rowsWithNoStatus,
      rowsWithNoTotal,
      rowsWithNoVendor,
      rowsWithBadTotal,
      duplicateActivityCompanyMonth: duplicates,
    },
    interviewedWithoutProcurement,
    procurementForNonInterviewed,
  };

  const perCompany = Array.from(perCompanyMap.values())
    .sort((a, b) => b.total_committed_usd - a.total_committed_usd);

  return { summary, perCompany, perVendor: allVendors };
}

export function fmtYyyymm(yyyymm: number): string {
  return yyyymmLabel(yyyymm);
}

export function fmtUsd(n: number): string {
  if (!n) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function fmtUsdFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
