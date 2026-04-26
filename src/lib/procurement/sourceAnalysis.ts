// Per-company aggregation of the procurement source rows. Builds the
// inputs the SourceAnalysisView renders: company-level totals, status
// breakdown, time-window filtering, anomaly detection, cross-check
// against the interviewed list.

import type { SourceProcurementRow } from './sourceParser';
import { INTERVIEWED_RAW, isInterviewed, INTERVIEWED_NAMES } from '../../pages/companies/interviewedSource';

export type CompanyAnalysis = {
  company_name: string;
  matched_interviewed: boolean;
  pr_count: number;
  total_committed_usd: number;
  rows: SourceProcurementRow[];
  status_breakdown: Record<string, number>;
  fund_breakdown: Record<string, number>;
  earliest_yyyymm: number;
  latest_yyyymm: number;
  months_active: number;             // distinct months with at least one PR
  has_pr_id: number;
  missing_pr_id: number;
  missing_status: number;
  missing_fund: number;
  missing_total: number;
};

export type AnalysisSummary = {
  totalRows: number;
  uniqueCompanies: number;
  totalCommittedUsd: number;
  byMonth: Array<{ yyyymm: number; label: string; count: number; total: number }>;
  byStatus: Record<string, number>;
  byFund: Record<string, number>;
  // Quality signals — what should the team double-check?
  anomalies: {
    rowsWithNoCompany: SourceProcurementRow[];
    rowsWithNoPrId: number;
    rowsWithNoFund: number;
    rowsWithNoStatus: number;
    rowsWithNoTotal: number;
    rowsWithBadTotal: SourceProcurementRow[]; // numeric parse fails
    duplicateActivityCompanyMonth: Array<{ key: string; rows: SourceProcurementRow[] }>;
  };
  // Interviewed list cross-check.
  interviewedWithoutProcurement: string[];     // schedule names with NO PR rows
  procurementForNonInterviewed: string[];      // companies in procurement but NOT in the interviewed list (potential typos / wrong match)
};

// Try to detect a company name out of an unstructured row (activity /
// item description / notes) by scanning the interviewed list. Useful when
// the team's column doesn't exist or the value is blank.
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

export type FilterOptions = {
  fromYyyymm?: number;        // inclusive lower bound
  toYyyymm?: number;          // inclusive upper bound
};

export function analyzeProcurementSource(
  rows: SourceProcurementRow[],
  opts: FilterOptions = {}
): { summary: AnalysisSummary; perCompany: CompanyAnalysis[] } {
  // Time-window filter
  const filtered = rows.filter(r => {
    if (opts.fromYyyymm && r.source_month_yyyymm && r.source_month_yyyymm < opts.fromYyyymm) return false;
    if (opts.toYyyymm && r.source_month_yyyymm && r.source_month_yyyymm > opts.toYyyymm) return false;
    return true;
  });

  // Resolve a company name per row — column wins, fallback to text scan.
  const enriched = filtered.map(r => {
    const fromCol = (r.company_name || '').trim();
    if (fromCol) return { ...r, company_name: fromCol };
    const inferred = inferCompanyFromText(`${r.activity} ${r.item_description} ${r.notes}`);
    if (inferred) return { ...r, company_name: inferred };
    return r;
  });

  // Per-company aggregation
  const perCompanyMap = new Map<string, CompanyAnalysis>();
  const rowsWithNoCompany: SourceProcurementRow[] = [];
  const rowsWithBadTotal: SourceProcurementRow[] = [];

  for (const r of enriched) {
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
        rows: [],
        status_breakdown: {},
        fund_breakdown: {},
        earliest_yyyymm: 0,
        latest_yyyymm: 0,
        months_active: 0,
        has_pr_id: 0,
        missing_pr_id: 0,
        missing_status: 0,
        missing_fund: 0,
        missing_total: 0,
      };
      perCompanyMap.set(key, entry);
    }
    entry.rows.push(r);
    entry.pr_count += 1;

    const totalRaw = (r.total_cost_usd || '').replace(/[^\d.\-]/g, '');
    const total = parseFloat(totalRaw);
    if (!isNaN(total)) {
      entry.total_committed_usd += total;
    } else if (r.total_cost_usd && r.total_cost_usd.trim()) {
      rowsWithBadTotal.push(r);
    }

    if (r.pr_id) entry.has_pr_id += 1; else entry.missing_pr_id += 1;
    if (!r.status) entry.missing_status += 1;
    if (!r.fund_code) entry.missing_fund += 1;
    if (!r.total_cost_usd) entry.missing_total += 1;

    const status = r.status || 'No status';
    entry.status_breakdown[status] = (entry.status_breakdown[status] || 0) + 1;
    if (r.fund_code) entry.fund_breakdown[r.fund_code] = (entry.fund_breakdown[r.fund_code] || 0) + 1;

    if (r.source_month_yyyymm) {
      if (!entry.earliest_yyyymm || r.source_month_yyyymm < entry.earliest_yyyymm) entry.earliest_yyyymm = r.source_month_yyyymm;
      if (r.source_month_yyyymm > entry.latest_yyyymm) entry.latest_yyyymm = r.source_month_yyyymm;
    }
  }

  // distinct months per company
  for (const entry of perCompanyMap.values()) {
    const months = new Set(entry.rows.map(r => r.source_month_yyyymm).filter(Boolean));
    entry.months_active = months.size;
  }

  // Roll up summary
  const byMonthMap = new Map<number, { count: number; total: number }>();
  const byStatus: Record<string, number> = {};
  const byFund: Record<string, number> = {};
  let totalCommitted = 0;
  let rowsWithNoPrId = 0, rowsWithNoFund = 0, rowsWithNoStatus = 0, rowsWithNoTotal = 0;

  for (const r of enriched) {
    if (r.source_month_yyyymm) {
      const bucket = byMonthMap.get(r.source_month_yyyymm) || { count: 0, total: 0 };
      bucket.count += 1;
      const total = parseFloat((r.total_cost_usd || '').replace(/[^\d.\-]/g, ''));
      if (!isNaN(total)) {
        bucket.total += total;
        totalCommitted += total;
      }
      byMonthMap.set(r.source_month_yyyymm, bucket);
    }
    const status = r.status || 'No status';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (r.fund_code) byFund[r.fund_code] = (byFund[r.fund_code] || 0) + 1;

    if (!r.pr_id) rowsWithNoPrId += 1;
    if (!r.fund_code) rowsWithNoFund += 1;
    if (!r.status) rowsWithNoStatus += 1;
    if (!r.total_cost_usd) rowsWithNoTotal += 1;
  }

  // Duplicate detection: same activity + company + month appearing more
  // than once. Often a copy-paste mistake worth flagging.
  const dupeMap = new Map<string, SourceProcurementRow[]>();
  for (const r of enriched) {
    if (!r.company_name || !r.activity || !r.source_month_yyyymm) continue;
    const key = `${normName(r.company_name)}::${normName(r.activity)}::${r.source_month_yyyymm}`;
    const arr = dupeMap.get(key) || [];
    arr.push(r);
    dupeMap.set(key, arr);
  }
  const duplicates = Array.from(dupeMap.entries())
    .filter(([, rs]) => rs.length > 1)
    .map(([key, rs]) => ({ key, rows: rs }));

  // Interviewed cross-check
  const seenCompanies = new Set(Array.from(perCompanyMap.values()).map(c => normName(c.company_name)));
  const interviewedWithoutProcurement = INTERVIEWED_RAW.filter(name => !seenCompanies.has(normName(name)));
  const procurementForNonInterviewed = Array.from(perCompanyMap.values())
    .filter(c => !c.matched_interviewed)
    .map(c => c.company_name);

  const byMonth = Array.from(byMonthMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([yyyymm, v]) => ({ yyyymm, label: yyyymmLabel(yyyymm), count: v.count, total: v.total }));

  const summary: AnalysisSummary = {
    totalRows: enriched.length,
    uniqueCompanies: perCompanyMap.size,
    totalCommittedUsd: totalCommitted,
    byMonth,
    byStatus,
    byFund,
    anomalies: {
      rowsWithNoCompany,
      rowsWithNoPrId,
      rowsWithNoFund,
      rowsWithNoStatus,
      rowsWithNoTotal,
      rowsWithBadTotal,
      duplicateActivityCompanyMonth: duplicates,
    },
    interviewedWithoutProcurement,
    procurementForNonInterviewed,
  };

  const perCompany = Array.from(perCompanyMap.values())
    .sort((a, b) => b.total_committed_usd - a.total_committed_usd);

  return { summary, perCompany };
}

export function fmtYyyymm(yyyymm: number): string {
  return yyyymmLabel(yyyymm);
}

export function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
