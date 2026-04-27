// SourceAnalysisView — deep, multi-lens read of the team procurement
// source workbook. Default scope = November 2025 onwards.
//
// Five tabs:
//   Overview   — KPIs, monthly trend, status / fund / pillar / threshold
//                breakdowns, stuck-PR callout, top vendors quick-look.
//   Companies  — per-company sortable table with click-to-expand
//                drill-down (status / fund / pillar mix, vendor list,
//                full PR list, completeness mini-stats, quality score).
//   Vendors    — per-vendor sortable table with which companies they
//                served and a status mix.
//   Pipeline   — normalized status stages (Draft → Submitted → Awarded
//                → Delivered / Paid → Cancelled) with $ totals + a
//                stuck-PR list (target_award_date passed, not closed).
//   Anomalies  — every quality flag with full lists + actionable hints,
//                plus the interviewed-list cross-check.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Eye, RefreshCw, Search,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, downloadCsv, timestampedFilename } from '../../lib/ui';
import { getSheetId } from '../../config/sheets';
import { fetchProcurementSource, type SourceProcurementRow } from '../../lib/procurement/sourceParser';
import {
  analyzeProcurementSource, fmtYyyymm, fmtUsd, fmtUsdFull,
  type CompanyAnalysis, type VendorAnalysis, type AnalysisSummary,
} from '../../lib/procurement/sourceAnalysis';

type AnalysisTab = 'overview' | 'companies' | 'vendors' | 'pipeline' | 'anomalies';

const PILLAR_OPTIONS = ['TTH', 'Upskilling', 'MKG', 'MA', 'ElevateBridge', 'C-Suite', 'Conferences'];

export function SourceAnalysisView() {
  const sourceId = getSheetId('procurementSource');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SourceProcurementRow[]>([]);
  const [, setTabsList] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  // Filters
  const [fromYyyymm, setFromYyyymm] = useState(202511);
  const [toYyyymm, setToYyyymm] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [fundFilter, setFundFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pillarFilter, setPillarFilter] = useState('');

  // UI state
  const [activeTab, setActiveTab] = useState<AnalysisTab>('overview');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [companySort, setCompanySort] = useState<'usd' | 'count' | 'months' | 'quality' | 'stuck' | 'name'>('usd');
  const [vendorSort, setVendorSort] = useState<'usd' | 'count' | 'companies' | 'name'>('usd');

  const reload = async () => {
    if (!sourceId) {
      setErrors(['VITE_SHEET_PROCUREMENT_SOURCE is not configured.']);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchProcurementSource(sourceId);
      setRows(r.rows);
      setTabsList(r.tabs);
      setErrors(r.errors);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sourceId]);

  const { summary, perCompany, perVendor } = useMemo(
    () => analyzeProcurementSource(rows, {
      fromYyyymm,
      toYyyymm,
      fundCode: fundFilter || undefined,
      status: statusFilter || undefined,
      pillar: pillarFilter || undefined,
    }),
    [rows, fromYyyymm, toYyyymm, fundFilter, statusFilter, pillarFilter]
  );

  // ── Search-applied views for Companies + Vendors tabs ──
  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? perCompany.filter(c => c.company_name.toLowerCase().includes(q)) : perCompany.slice();
    list.sort((a, b) => {
      switch (companySort) {
        case 'count':   return b.pr_count - a.pr_count;
        case 'months':  return b.months_active - a.months_active;
        case 'quality': return a.quality_score - b.quality_score; // worst first
        case 'stuck':   return b.stuck_count - a.stuck_count;
        case 'name':    return a.company_name.localeCompare(b.company_name);
        default:        return b.total_committed_usd - a.total_committed_usd;
      }
    });
    return list;
  }, [perCompany, search, companySort]);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? perVendor.filter(v => v.vendor.toLowerCase().includes(q)) : perVendor.slice();
    list.sort((a, b) => {
      switch (vendorSort) {
        case 'count':     return b.pr_count - a.pr_count;
        case 'companies': return b.company_count - a.company_count;
        case 'name':      return a.vendor.localeCompare(b.vendor);
        default:          return b.total_usd - a.total_usd;
      }
    });
    return list;
  }, [perVendor, search, vendorSort]);

  // ── Filter chip lists ──
  const fundOptions = useMemo(() => Object.keys(summary.byFund).sort(), [summary.byFund]);
  const statusOptions = useMemo(() => Object.keys(summary.byStatus).sort(), [summary.byStatus]);

  const toggleExpanded = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const exportPerCompany = () => {
    downloadCsv(timestampedFilename('procurement_source_per_company'),
      perCompany.map(c => ({
        company: c.company_name,
        matched_interviewed: c.matched_interviewed ? 'yes' : 'no',
        pr_count: c.pr_count,
        committed_usd: Math.round(c.total_committed_usd),
        awarded_usd: Math.round(c.total_awarded_usd),
        paid_usd: Math.round(c.total_paid_usd),
        months_active: c.months_active,
        earliest_month: fmtYyyymm(c.earliest_yyyymm),
        latest_month: fmtYyyymm(c.latest_yyyymm),
        quality_score: c.quality_score,
        stuck_count: c.stuck_count,
        pillars: Object.keys(c.pillar_breakdown).join(';'),
        funds: Object.keys(c.fund_breakdown).join(';'),
        vendors: Object.keys(c.vendors).join(';'),
        missing_pr_id: c.missing_pr_id,
        missing_status: c.missing_status,
        missing_fund: c.missing_fund,
        missing_total: c.missing_total,
        missing_vendor: c.missing_vendor,
      }))
    );
  };

  const tabItems: Array<{ id: AnalysisTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'companies', label: 'Companies', count: perCompany.length },
    { id: 'vendors', label: 'Vendors', count: perVendor.length },
    { id: 'pipeline', label: 'Pipeline', count: summary.stuckPRs.length },
    { id: 'anomalies', label: 'Anomalies' },
  ];

  return (
    <div className="space-y-3">
      {/* ─── Filter bar ─── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 min-w-[220px] items-center gap-1.5 rounded-md border border-slate-200 bg-brand-editable/30 px-2 py-1.5 dark:border-navy-700 dark:bg-navy-700">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter by company / vendor name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none dark:text-slate-100"
            />
          </div>
          <FilterSelect label="Fund" value={fundFilter} onChange={setFundFilter} options={fundOptions} />
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
          <FilterSelect label="Pillar" value={pillarFilter} onChange={setPillarFilter} options={PILLAR_OPTIONS} />
          <MonthInput label="From" yyyymm={fromYyyymm} onChange={setFromYyyymm} />
          <MonthInput label="To" yyyymm={toYyyymm} onChange={v => setToYyyymm(v || undefined)} />
          <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
          </Button>
          {sourceId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${sourceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-semibold text-brand-teal hover:border-brand-teal dark:border-navy-700"
            >
              Source <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={exportPerCompany} disabled={perCompany.length === 0}>
            Export
          </Button>
        </div>
        {errors.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> {errors[0]}
          </div>
        )}
      </div>

      {/* ─── KPI strip ─── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <KPI label="Source rows" value={summary.totalRows} hint={`${summary.byMonth.length} months in window`} tone="navy" />
        <KPI label="Companies" value={summary.uniqueCompanies} hint={`${summary.uniqueVendors} vendors`} tone="teal" />
        <KPI label="Committed" value={fmtUsd(summary.totalCommittedUsd)} hint="Sum of total_cost_usd" tone="orange" />
        <KPI label="Awarded" value={fmtUsd(summary.totalAwardedUsd)} hint={pct(summary.totalAwardedUsd, summary.totalCommittedUsd) + '% of committed'} tone="amber" />
        <KPI label="Paid / delivered" value={fmtUsd(summary.totalPaidUsd)} hint={pct(summary.totalPaidUsd, summary.totalCommittedUsd) + '% of committed'} tone="green" />
        <KPI label="Stuck PRs" value={summary.stuckPRs.length} hint="Past target_award_date, still open" tone={summary.stuckPRs.length > 0 ? 'red' : 'navy'} />
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-navy-700 dark:bg-navy-900">
        {tabItems.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                active ? 'bg-brand-teal text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-navy-700'}`}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Tab content ─── */}
      {activeTab === 'overview' && <OverviewTab summary={summary} />}
      {activeTab === 'companies' && (
        <CompaniesTab
          companies={filteredCompanies}
          totalCount={perCompany.length}
          sortBy={companySort}
          onSort={setCompanySort}
          expanded={expandedCompanies}
          onToggle={k => toggleExpanded(expandedCompanies, setExpandedCompanies, k)}
          loading={loading}
        />
      )}
      {activeTab === 'vendors' && (
        <VendorsTab
          vendors={filteredVendors}
          totalCount={perVendor.length}
          sortBy={vendorSort}
          onSort={setVendorSort}
          expanded={expandedVendors}
          onToggle={k => toggleExpanded(expandedVendors, setExpandedVendors, k)}
        />
      )}
      {activeTab === 'pipeline' && <PipelineTab summary={summary} />}
      {activeTab === 'anomalies' && <AnomaliesTab summary={summary} />}
    </div>
  );
}

// ───────────────────── Tab: Overview ─────────────────────

function OverviewTab({ summary }: { summary: AnalysisSummary }) {
  const peakBarValue = Math.max(1, ...summary.byMonth.map(m => m.total));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly trend" subtitle="$ committed and PR count per month" />
          {summary.byMonth.length === 0 ? (
            <EmptyHint text="No monthly data in window." />
          ) : (
            <div className="space-y-1.5">
              {summary.byMonth.map(m => (
                <div key={m.yyyymm} className="grid grid-cols-[80px_1fr_140px] items-center gap-2 text-xs">
                  <span className="font-mono text-slate-500">{m.label}</span>
                  <div className="h-4 overflow-hidden rounded-md bg-slate-100 dark:bg-navy-800">
                    <div
                      className="h-full bg-gradient-to-r from-brand-teal to-emerald-500"
                      style={{ width: `${Math.round((m.total / peakBarValue) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-slate-700 dark:text-slate-200">
                    {fmtUsd(m.total)} · {m.count} PR{m.count === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <BreakdownCard
          title="By status"
          data={summary.byStatus}
          tone="navy"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownCard title="By fund" data={summary.byFund} tone="amber" labelMap={{ '97060': 'Dutch (97060)', '91763': 'SIDA (91763)' }} />
        <BreakdownCard title="By pillar" data={summary.byPillar} tone="teal" />
        <BreakdownCard title="By threshold" data={summary.byThreshold} tone="orange" />
      </div>

      <Card>
        <CardHeader title="Top vendors" subtitle={`${summary.topVendors.length} of ${summary.uniqueVendors} vendors`} />
        {summary.topVendors.length === 0 ? (
          <EmptyHint text="No vendors recorded." />
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
            <div className="grid grid-cols-[1fr_70px_110px_70px] border-b border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
              <span>Vendor</span>
              <span className="text-right">PRs</span>
              <span className="text-right">Total</span>
              <span className="text-right">Cos.</span>
            </div>
            <ul>
              {summary.topVendors.map(v => (
                <li key={v.vendor} className="grid grid-cols-[1fr_70px_110px_70px] gap-1 border-b border-slate-100 px-2 py-1 text-xs last:border-b-0 dark:border-navy-800">
                  <span className="truncate font-bold text-navy-500 dark:text-slate-100">{v.vendor}</span>
                  <span className="text-right font-mono">{v.pr_count}</span>
                  <span className="text-right font-mono">{fmtUsd(v.total_usd)}</span>
                  <span className="text-right font-mono">{v.company_count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {summary.stuckPRs.length > 0 && (
        <Card>
          <CardHeader title={`${summary.stuckPRs.length} stuck PRs`} subtitle="target_award_date is in the past, but status is not closed" />
          <ul className="space-y-1">
            {summary.stuckPRs.slice(0, 8).map((s, i) => (
              <li key={i} className="grid grid-cols-[80px_70px_1fr_120px_70px] gap-1 rounded-md border border-amber-200 bg-amber-50/40 px-2 py-1 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                <span className="font-mono text-slate-500">{s.row.source_tab}</span>
                <span className="font-mono">{s.row.pr_id || '—'}</span>
                <span className="truncate" title={s.row.activity}>{s.row.company_name || s.row.activity || '—'}</span>
                <span className="font-mono text-amber-800 dark:text-amber-200">{s.row.status || '—'}</span>
                <span className="text-right font-mono text-red-700 dark:text-red-300">{s.daysOverdue}d</span>
              </li>
            ))}
          </ul>
          {summary.stuckPRs.length > 8 && (
            <p className="mt-1 text-[11px] text-slate-500">…{summary.stuckPRs.length - 8} more · see Pipeline tab for full list</p>
          )}
        </Card>
      )}
    </div>
  );
}

// ───────────────────── Tab: Companies ─────────────────────

function CompaniesTab({
  companies,
  totalCount,
  sortBy,
  onSort,
  expanded,
  onToggle,
  loading,
}: {
  companies: CompanyAnalysis[];
  totalCount: number;
  sortBy: 'usd' | 'count' | 'months' | 'quality' | 'stuck' | 'name';
  onSort: (s: typeof sortBy) => void;
  expanded: Set<string>;
  onToggle: (k: string) => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Per-company breakdown"
        subtitle={`${companies.length} of ${totalCount} companies in window`}
        action={
          <select
            value={sortBy}
            onChange={e => onSort(e.currentTarget.value as typeof sortBy)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="usd">Sort: $ committed</option>
            <option value="count">Sort: PR count</option>
            <option value="months">Sort: months active</option>
            <option value="quality">Sort: quality (worst first)</option>
            <option value="stuck">Sort: stuck PRs</option>
            <option value="name">Sort: name</option>
          </select>
        }
      />
      {companies.length === 0 ? (
        <EmptyState icon={<Eye className="h-6 w-6" />} title={loading ? 'Reading source…' : 'No companies in window'} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <div className="grid grid-cols-[24px_1fr_60px_100px_100px_56px_56px_60px_70px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
            <span></span>
            <span>Company</span>
            <span className="text-right">PRs</span>
            <span className="text-right">Committed</span>
            <span className="text-right">Awarded</span>
            <span className="text-right">Mo</span>
            <span className="text-right">Stuck</span>
            <span className="text-right">Quality</span>
            <span></span>
          </div>
          <ul>
            {companies.map(c => {
              const k = c.company_name;
              const isOpen = expanded.has(k);
              const issues = (c.missing_pr_id ? 1 : 0) + (c.missing_status ? 1 : 0) + (c.missing_fund ? 1 : 0) + (c.missing_total ? 1 : 0) + (c.missing_vendor ? 1 : 0);
              return (
                <li key={k} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onToggle(k)}
                    className="grid w-full grid-cols-[24px_1fr_60px_100px_100px_56px_56px_60px_70px] items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <span className="text-slate-400">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="flex items-center gap-2 truncate">
                      <span className="truncate font-bold text-navy-500 dark:text-slate-100">{c.company_name}</span>
                      {!c.matched_interviewed && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title="Not in static interviewed list">
                          unmatched
                        </span>
                      )}
                      {Object.keys(c.pillar_breakdown).slice(0, 3).map(p => (
                        <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:bg-navy-700 dark:text-slate-200">{p}</span>
                      ))}
                    </span>
                    <span className="text-right font-mono">{c.pr_count}</span>
                    <span className="text-right font-mono font-bold">{fmtUsd(c.total_committed_usd)}</span>
                    <span className="text-right font-mono">{c.total_awarded_usd > 0 ? fmtUsd(c.total_awarded_usd) : '—'}</span>
                    <span className="text-right font-mono">{c.months_active}</span>
                    <span className={`text-right font-mono ${c.stuck_count > 0 ? 'font-bold text-red-700 dark:text-red-300' : 'text-slate-400'}`}>
                      {c.stuck_count || '—'}
                    </span>
                    <span className="text-right">
                      <QualityChip score={c.quality_score} />
                    </span>
                    <span className="text-right">
                      {issues > 0 ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          {issues} sparse
                        </span>
                      ) : (
                        <span className="text-[11px] text-emerald-600">ok</span>
                      )}
                    </span>
                  </button>
                  {isOpen && <CompanyDetail c={c} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function CompanyDetail({ c }: { c: CompanyAnalysis }) {
  return (
    <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-2 dark:border-navy-800 dark:bg-navy-800/30">
      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
        <Mini label="Status mix" value={Object.entries(c.status_breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'} />
        <Mini label="Funds" value={Object.entries(c.fund_breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'} />
        <Mini label="Pillars" value={Object.keys(c.pillar_breakdown).join(' · ') || '—'} />
        <Mini label="Vendors" value={Object.keys(c.vendors).slice(0, 3).join(' · ') + (Object.keys(c.vendors).length > 3 ? ` …+${Object.keys(c.vendors).length - 3}` : '') || '—'} />
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-5 text-xs">
        <Mini label="Committed" value={fmtUsdFull(c.total_committed_usd)} />
        <Mini label="Awarded" value={fmtUsdFull(c.total_awarded_usd)} />
        <Mini label="Paid" value={fmtUsdFull(c.total_paid_usd)} />
        <Mini label="Window" value={`${fmtYyyymm(c.earliest_yyyymm)}${c.earliest_yyyymm !== c.latest_yyyymm ? ` → ${fmtYyyymm(c.latest_yyyymm)}` : ''}`} />
        <Mini label="Missing" value={`PR ${c.missing_pr_id} · St ${c.missing_status} · F ${c.missing_fund} · $ ${c.missing_total} · V ${c.missing_vendor}`} />
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
        <div className="grid grid-cols-[80px_70px_1fr_70px_90px_70px_90px] border-b border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700 dark:bg-navy-900">
          <span>Month</span>
          <span>PR</span>
          <span>Activity / vendor</span>
          <span className="text-right">$</span>
          <span>Fund</span>
          <span>Status</span>
          <span>Target award</span>
        </div>
        <ul>
          {c.rows
            .slice()
            .sort((a, b) => (a.source_month_yyyymm - b.source_month_yyyymm) || a.source_row - b.source_row)
            .map((r, i) => (
              <li key={i} className="grid grid-cols-[80px_70px_1fr_70px_90px_70px_90px] gap-1 border-b border-slate-100 px-2 py-1 text-[11px] last:border-b-0 dark:border-navy-800">
                <span className="font-mono text-slate-500">{r.source_tab}</span>
                <span className="font-mono">{r.pr_id || '—'}</span>
                <span className="truncate">
                  <span className="text-slate-800 dark:text-slate-200">{r.activity || r.item_description || '—'}</span>
                  {r.vendor && <span className="ml-1 text-slate-400">via {r.vendor}</span>}
                </span>
                <span className="text-right font-mono">{r.total_cost_usd ? `$${r.total_cost_usd}` : '—'}</span>
                <span className="font-mono">{r.fund_code || '—'}</span>
                <span className="truncate">{r.status || '—'}</span>
                <span className="font-mono text-slate-500">{r.target_award_date || '—'}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

// ───────────────────── Tab: Vendors ─────────────────────

function VendorsTab({
  vendors,
  totalCount,
  sortBy,
  onSort,
  expanded,
  onToggle,
}: {
  vendors: VendorAnalysis[];
  totalCount: number;
  sortBy: 'usd' | 'count' | 'companies' | 'name';
  onSort: (s: typeof sortBy) => void;
  expanded: Set<string>;
  onToggle: (k: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Vendor analysis"
        subtitle={`${vendors.length} of ${totalCount} vendors in window`}
        action={
          <select
            value={sortBy}
            onChange={e => onSort(e.currentTarget.value as typeof sortBy)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="usd">Sort: $ total</option>
            <option value="count">Sort: PR count</option>
            <option value="companies">Sort: companies served</option>
            <option value="name">Sort: name</option>
          </select>
        }
      />
      {vendors.length === 0 ? (
        <EmptyState icon={<Eye className="h-6 w-6" />} title="No vendors in window" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <div className="grid grid-cols-[24px_1fr_60px_100px_70px_120px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
            <span></span>
            <span>Vendor</span>
            <span className="text-right">PRs</span>
            <span className="text-right">Total</span>
            <span className="text-right">Companies</span>
            <span>Window</span>
          </div>
          <ul>
            {vendors.map(v => {
              const isOpen = expanded.has(v.vendor);
              return (
                <li key={v.vendor} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onToggle(v.vendor)}
                    className="grid w-full grid-cols-[24px_1fr_60px_100px_70px_120px] items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <span className="text-slate-400">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="truncate font-bold text-navy-500 dark:text-slate-100">{v.vendor}</span>
                    <span className="text-right font-mono">{v.pr_count}</span>
                    <span className="text-right font-mono font-bold">{fmtUsd(v.total_usd)}</span>
                    <span className="text-right font-mono">{v.company_count}</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {fmtYyyymm(v.earliest_yyyymm)}
                      {v.earliest_yyyymm !== v.latest_yyyymm ? ` → ${fmtYyyymm(v.latest_yyyymm)}` : ''}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-2 dark:border-navy-800 dark:bg-navy-800/30">
                      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-3 text-xs">
                        <Mini label="Status mix" value={Object.entries(v.status_breakdown).map(([k, vv]) => `${k}: ${vv}`).join(' · ') || '—'} />
                        <Mini label="Companies served" value={`${v.company_count}`} />
                        <Mini label="Average $ / PR" value={fmtUsdFull(v.total_usd / Math.max(1, v.pr_count))} />
                      </div>
                      <div>
                        <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Companies</h4>
                        <div className="flex flex-wrap gap-1">
                          {v.companies.map(c => (
                            <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-navy-700 dark:text-slate-200">{c}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ───────────────────── Tab: Pipeline ─────────────────────

function PipelineTab({ summary }: { summary: AnalysisSummary }) {
  const peakCount = Math.max(1, ...summary.pipeline.map(p => p.count));
  const peakTotal = Math.max(1, ...summary.pipeline.map(p => p.total));
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Status pipeline" subtitle="Normalized stages with PR count + $ totals" />
        {summary.pipeline.length === 0 ? (
          <EmptyHint text="No status data in window." />
        ) : (
          <div className="space-y-2">
            {summary.pipeline.map(p => (
              <div key={p.stage} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-navy-700">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={p.tone}>{p.stage}</Badge>
                    <span className="font-mono text-slate-500">{p.count} PR{p.count === 1 ? '' : 's'}</span>
                  </div>
                  <span className="font-mono font-bold">{fmtUsd(p.total)}</span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Count</div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                      <div className="h-full bg-brand-teal" style={{ width: `${Math.round((p.count / peakCount) * 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">$</div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                      <div className="h-full bg-brand-orange" style={{ width: `${Math.round((p.total / peakTotal) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`Stuck PRs (${summary.stuckPRs.length})`} subtitle="target_award_date is in the past, status not closed" />
        {summary.stuckPRs.length === 0 ? (
          <EmptyHint text="None — every PR with a past target date is closed." />
        ) : (
          <div className="overflow-hidden rounded-md border border-amber-200 dark:border-amber-900">
            <div className="grid grid-cols-[80px_70px_1fr_120px_70px_80px_70px] border-b border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span>Month</span>
              <span>PR</span>
              <span>Company / activity</span>
              <span>Target award</span>
              <span className="text-right">Days</span>
              <span>Fund</span>
              <span>Status</span>
            </div>
            <ul>
              {summary.stuckPRs.map((s, i) => (
                <li key={i} className="grid grid-cols-[80px_70px_1fr_120px_70px_80px_70px] gap-1 border-b border-amber-100 bg-amber-50/30 px-2 py-1 text-[11px] last:border-b-0 dark:border-amber-900 dark:bg-amber-950/20">
                  <span className="font-mono text-slate-500">{s.row.source_tab}</span>
                  <span className="font-mono">{s.row.pr_id || '—'}</span>
                  <span className="truncate" title={s.row.activity}>
                    <span className="font-bold text-navy-500 dark:text-slate-100">{s.row.company_name || '—'}</span>
                    {' · '}
                    <span className="text-slate-700 dark:text-slate-300">{s.row.activity || '—'}</span>
                  </span>
                  <span className="font-mono text-slate-600 dark:text-slate-400">{s.row.target_award_date}</span>
                  <span className="text-right font-mono font-bold text-red-700 dark:text-red-300">{s.daysOverdue}</span>
                  <span className="font-mono">{s.row.fund_code || '—'}</span>
                  <span className="truncate">{s.row.status || '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

// ───────────────────── Tab: Anomalies ─────────────────────

function AnomaliesTab({ summary }: { summary: AnalysisSummary }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Quality flags" subtitle="What the team should double-check" />
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          <AnomalyTile label="Rows with no company name" value={summary.anomalies.rowsWithNoCompany.length} hint="Could not be routed by header keyword OR text scan" />
          <AnomalyTile label="No PR ID" value={summary.anomalies.rowsWithNoPrId} hint="Hard to track without one" />
          <AnomalyTile label="No fund code" value={summary.anomalies.rowsWithNoFund} hint="Should be 97060 (Dutch) or 91763 (SIDA)" />
          <AnomalyTile label="No status" value={summary.anomalies.rowsWithNoStatus} hint="Pipeline visibility gap" />
          <AnomalyTile label="No total $" value={summary.anomalies.rowsWithNoTotal} hint="Budget visibility gap" />
          <AnomalyTile label="No vendor" value={summary.anomalies.rowsWithNoVendor} hint="Cannot trace counterparty" />
          <AnomalyTile label="Total $ failed to parse" value={summary.anomalies.rowsWithBadTotal.length} hint="Likely a non-numeric value" />
          <AnomalyTile label="Duplicates (company+activity+month)" value={summary.anomalies.duplicateActivityCompanyMonth.length} hint="Potential copy-paste duplicates" />
        </div>
      </Card>

      {summary.anomalies.rowsWithNoCompany.length > 0 && (
        <Card>
          <CardHeader title={`Rows with no company (${summary.anomalies.rowsWithNoCompany.length})`} subtitle="Couldn't infer a company from the row's text" />
          <ul className="space-y-1 text-xs">
            {summary.anomalies.rowsWithNoCompany.slice(0, 25).map((r, i) => (
              <li key={i} className="grid grid-cols-[80px_70px_1fr_90px_70px] gap-1 rounded-md border border-slate-200 px-2 py-1 dark:border-navy-700">
                <span className="font-mono text-slate-500">{r.source_tab}#{r.source_row}</span>
                <span className="font-mono">{r.pr_id || '—'}</span>
                <span className="truncate">{r.activity || r.item_description || '(no activity)'}</span>
                <span className="text-right font-mono">{r.total_cost_usd ? `$${r.total_cost_usd}` : '—'}</span>
                <span className="font-mono text-slate-500">{r.vendor || '—'}</span>
              </li>
            ))}
          </ul>
          {summary.anomalies.rowsWithNoCompany.length > 25 && (
            <p className="mt-1 text-[11px] text-slate-500">…{summary.anomalies.rowsWithNoCompany.length - 25} more</p>
          )}
        </Card>
      )}

      {summary.anomalies.duplicateActivityCompanyMonth.length > 0 && (
        <Card>
          <CardHeader title={`Duplicates (${summary.anomalies.duplicateActivityCompanyMonth.length})`} subtitle="Same company + activity + month — verify each is intentional" />
          <ul className="space-y-1 text-xs">
            {summary.anomalies.duplicateActivityCompanyMonth.map((d, i) => (
              <li key={i} className="rounded-md border border-amber-200 bg-amber-50/40 px-2 py-1 dark:border-amber-900 dark:bg-amber-950/30">
                <span className="font-bold">{d.rows.length}× </span>
                <span className="text-slate-700 dark:text-slate-200">{d.rows[0].company_name} · {d.rows[0].activity}</span>
                <span className="ml-1 font-mono text-slate-500">({fmtYyyymm(d.rows[0].source_month_yyyymm)})</span>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  rows: {d.rows.map(r => `${r.source_tab}#${r.source_row}`).join(', ')}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Cross-check vs interviewed list"
          subtitle="Which companies in our 52-company interview pool have / don't have entries"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <h4 className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              {summary.interviewedWithoutProcurement.length} interviewed companies with NO PRs
            </h4>
            {summary.interviewedWithoutProcurement.length === 0 ? (
              <p className="text-xs text-emerald-600">All interviewed companies have at least one PR.</p>
            ) : (
              <ul className="max-h-[260px] space-y-1 overflow-y-auto pr-2 text-xs">
                {summary.interviewedWithoutProcurement.map(n => (
                  <li key={n} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 dark:border-amber-900 dark:bg-amber-950">{n}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
              {summary.procurementForNonInterviewed.length} procurement names NOT in interviewed list
            </h4>
            {summary.procurementForNonInterviewed.length === 0 ? (
              <p className="text-xs text-emerald-600">Every company in procurement matches.</p>
            ) : (
              <ul className="max-h-[260px] space-y-1 overflow-y-auto pr-2 text-xs">
                {summary.procurementForNonInterviewed.map(n => (
                  <li key={n} className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-900 dark:bg-blue-950">{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────── Primitives ─────────────────────

function KPI({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone: 'navy' | 'teal' | 'orange' | 'amber' | 'green' | 'red' }) {
  const toneCls: Record<string, string> = {
    navy: 'border-slate-200 bg-white text-navy-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-100',
    teal: 'border-brand-teal/30 bg-brand-teal/5 text-brand-teal',
    orange: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  };
  return (
    <div className={`rounded-xl border p-2.5 ${toneCls[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.currentTarget.value)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
      title={label}
    >
      <option value="">{label}: all</option>
      {options.map(o => <option key={o} value={o}>{label}: {o}</option>)}
    </select>
  );
}

function MonthInput({ label, yyyymm, onChange }: { label: string; yyyymm: number | undefined; onChange: (v: number) => void }) {
  const value = yyyymm ? `${Math.floor(yyyymm / 100)}-${(yyyymm % 100).toString().padStart(2, '0')}` : '';
  return (
    <label className="inline-flex items-center gap-1 text-xs">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type="month"
        value={value}
        onChange={e => {
          const v = e.currentTarget.value;
          if (!v) { onChange(0); return; }
          const [y, m] = v.split('-');
          onChange(parseInt(y, 10) * 100 + parseInt(m, 10));
        }}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
      />
    </label>
  );
}

function BreakdownCard({ title, data, tone, labelMap }: { title: string; data: Record<string, number>; tone: 'navy' | 'teal' | 'orange' | 'amber'; labelMap?: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const barTone: Record<string, string> = {
    navy: 'bg-navy-500',
    teal: 'bg-brand-teal',
    orange: 'bg-brand-orange',
    amber: 'bg-amber-500',
  };
  return (
    <Card>
      <CardHeader title={title} />
      {entries.length === 0 ? (
        <EmptyHint text="No data." />
      ) : (
        <ul className="space-y-1">
          {entries.map(([k, v]) => (
            <li key={k} className="grid grid-cols-[1fr_36px] items-center gap-1 text-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="truncate font-semibold text-slate-700 dark:text-slate-200" title={labelMap?.[k] || k}>{labelMap?.[k] || k}</span>
                  <span className="font-mono text-slate-500">{Math.round((v / max) * 100)}%</span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                  <div className={`h-full ${barTone[tone]}`} style={{ width: `${Math.round((v / max) * 100)}%` }} />
                </div>
              </div>
              <span className="text-right font-mono font-bold text-navy-500 dark:text-slate-100">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function QualityChip({ score }: { score: number }) {
  const tone =
    score >= 90 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' :
    score >= 70 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' :
    'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tabular ${tone}`} title={`Data quality score: ${score}/100`}>
      {score}
    </span>
  );
}

function AnomalyTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  const tone = value === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div className={`rounded-md border px-3 py-2 ${tone} dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{label}</span>
        <span className="rounded bg-white/40 px-1.5 py-0.5 text-xs font-extrabold tabular dark:bg-navy-700">{value}</span>
      </div>
      <div className="mt-0.5 text-[10px] opacity-75">{hint}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-[11px] text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-navy-700">{text}</div>;
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return '0';
  return Math.round((num / denom) * 100).toString();
}
