// SourceAnalysisView — deep, accuracy-focused readout of the procurement
// source sheet, scoped per-company since a configurable month (default
// Nov 2025).
//
// Sections:
//   1) Summary KPIs (rows, companies, $ committed, months covered)
//   2) Monthly trend bars
//   3) Status + fund breakdowns
//   4) Per-company table sortable by $ / count / months active
//   5) Per-company expanded panel with full PR list
//   6) Anomalies (missing fields, bad totals, duplicates)
//   7) Cross-check against the interviewed list

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Eye, RefreshCw, Search } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, downloadCsv, timestampedFilename } from '../../lib/ui';
import { getSheetId } from '../../config/sheets';
import { fetchProcurementSource, type SourceProcurementRow } from '../../lib/procurement/sourceParser';
import { analyzeProcurementSource, fmtYyyymm, fmtUsd, type CompanyAnalysis } from '../../lib/procurement/sourceAnalysis';

export function SourceAnalysisView() {
  const sourceId = getSheetId('procurementSource');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SourceProcurementRow[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  // Default lower bound = November 2025 per the user's ask.
  const [fromYyyymm, setFromYyyymm] = useState(202511);
  const [toYyyymm, setToYyyymm] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'usd' | 'count' | 'months' | 'name'>('usd');

  const reload = async () => {
    if (!sourceId) {
      setErrors(['VITE_SHEET_PROCUREMENT_SOURCE is not configured.']);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchProcurementSource(sourceId);
      setRows(r.rows);
      setTabs(r.tabs);
      setErrors(r.errors);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sourceId]);

  const { summary, perCompany } = useMemo(
    () => analyzeProcurementSource(rows, { fromYyyymm, toYyyymm }),
    [rows, fromYyyymm, toYyyymm]
  );

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? perCompany.filter(c => c.company_name.toLowerCase().includes(q)) : perCompany.slice();
    list.sort((a, b) => {
      switch (sortBy) {
        case 'count': return b.pr_count - a.pr_count;
        case 'months': return b.months_active - a.months_active;
        case 'name': return a.company_name.localeCompare(b.company_name);
        default: return b.total_committed_usd - a.total_committed_usd;
      }
    });
    return list;
  }, [perCompany, search, sortBy]);

  const peakBarValue = Math.max(1, ...summary.byMonth.map(m => m.total));

  const toggleExpanded = (k: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const exportPerCompany = () => {
    downloadCsv(timestampedFilename('procurement_source_per_company'),
      perCompany.map(c => ({
        company: c.company_name,
        matched_interviewed: c.matched_interviewed ? 'yes' : 'no',
        pr_count: c.pr_count,
        total_usd: Math.round(c.total_committed_usd),
        months_active: c.months_active,
        earliest_month: fmtYyyymm(c.earliest_yyyymm),
        latest_month: fmtYyyymm(c.latest_yyyymm),
        status_breakdown: Object.entries(c.status_breakdown).map(([k, v]) => `${k}:${v}`).join('; '),
        fund_breakdown: Object.entries(c.fund_breakdown).map(([k, v]) => `${k}:${v}`).join('; '),
        missing_pr_id: c.missing_pr_id,
        missing_status: c.missing_status,
        missing_fund: c.missing_fund,
        missing_total: c.missing_total,
      }))
    );
  };

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <Card>
        <CardHeader
          title="Source-sheet analysis"
          subtitle={`Per-company breakdown of the team procurement plan from ${fmtYyyymm(fromYyyymm)} onwards. Read-only.`}
          action={
            <div className="flex items-center gap-2">
              {sourceId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${sourceId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal hover:underline"
                >
                  Open source <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
              </Button>
              <Button variant="ghost" size="sm" onClick={exportPerCompany} disabled={perCompany.length === 0}>
                Export CSV
              </Button>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1">
            <span className="font-bold uppercase tracking-wider text-slate-500">From</span>
            <input
              type="month"
              value={fromYyyymm ? `${Math.floor(fromYyyymm / 100)}-${(fromYyyymm % 100).toString().padStart(2, '0')}` : ''}
              onChange={e => {
                const v = e.currentTarget.value;
                if (!v) { setFromYyyymm(0); return; }
                const [y, m] = v.split('-');
                setFromYyyymm(parseInt(y, 10) * 100 + parseInt(m, 10));
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            />
          </label>
          <label className="inline-flex items-center gap-1">
            <span className="font-bold uppercase tracking-wider text-slate-500">To</span>
            <input
              type="month"
              value={toYyyymm ? `${Math.floor(toYyyymm / 100)}-${(toYyyymm % 100).toString().padStart(2, '0')}` : ''}
              onChange={e => {
                const v = e.currentTarget.value;
                if (!v) { setToYyyymm(undefined); return; }
                const [y, m] = v.split('-');
                setToYyyymm(parseInt(y, 10) * 100 + parseInt(m, 10));
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            />
          </label>
          <span className="text-slate-500">{tabs.length} tabs available</span>
        </div>
        {errors.length > 0 && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            {errors[0]}
          </div>
        )}
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KPI label="Source rows" value={summary.totalRows} hint={`${tabs.length} months parsed`} tone="navy" />
        <KPI label="Unique companies" value={summary.uniqueCompanies} hint={`${summary.byMonth.length} months active`} tone="teal" />
        <KPI label="Total committed" value={fmtUsd(summary.totalCommittedUsd)} hint="Sum of total_cost_usd" tone="orange" />
        <KPI label="Months in window" value={summary.byMonth.length} hint={summary.byMonth.length > 0 ? `${summary.byMonth[0].label} → ${summary.byMonth[summary.byMonth.length - 1].label}` : '—'} tone="amber" />
      </div>

      {/* Trend by month + status / fund breakdowns */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly trend" subtitle="$ committed and PR count per month" />
          {summary.byMonth.length === 0 ? (
            <EmptyHint text="No monthly data in window." />
          ) : (
            <div className="space-y-1.5">
              {summary.byMonth.map(m => (
                <div key={m.yyyymm} className="grid grid-cols-[80px_1fr_120px] items-center gap-2 text-xs">
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
        <Card>
          <CardHeader title="By status" subtitle="From the source sheet" />
          {Object.keys(summary.byStatus).length === 0 ? (
            <EmptyHint text="No status data." />
          ) : (
            <ul className="space-y-1 text-xs">
              {Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between rounded-md border border-slate-100 px-2 py-1 dark:border-navy-700">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{k}</span>
                  <Badge tone="neutral">{v}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Per-company table */}
      <Card>
        <CardHeader
          title="Per-company breakdown"
          subtitle={`${filteredCompanies.length} of ${perCompany.length} companies`}
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter companies"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-48 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                />
              </div>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.currentTarget.value as typeof sortBy)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
              >
                <option value="usd">Sort: $ committed</option>
                <option value="count">Sort: PR count</option>
                <option value="months">Sort: months active</option>
                <option value="name">Sort: name</option>
              </select>
            </div>
          }
        />
        {filteredCompanies.length === 0 ? (
          <EmptyState icon={<Eye className="h-6 w-6" />} title={loading ? 'Reading source…' : 'No companies in window'} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
            <div className="grid grid-cols-[24px_1fr_80px_110px_72px_120px_110px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
              <span></span>
              <span>Company</span>
              <span className="text-right">PRs</span>
              <span className="text-right">Total</span>
              <span className="text-right">Months</span>
              <span>Window</span>
              <span>Issues</span>
            </div>
            <ul>
              {filteredCompanies.map(c => {
                const k = c.company_name;
                const isOpen = expanded.has(k);
                const issues = (c.missing_pr_id ? 1 : 0) + (c.missing_status ? 1 : 0) + (c.missing_fund ? 1 : 0) + (c.missing_total ? 1 : 0);
                return (
                  <li key={k} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(k)}
                      className="grid w-full grid-cols-[24px_1fr_80px_110px_72px_120px_110px] items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
                    >
                      <span className="text-slate-400">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex items-center gap-2 truncate">
                        <span className="truncate font-bold text-navy-500 dark:text-slate-100">{c.company_name}</span>
                        {!c.matched_interviewed && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title="Not in the static interviewed list — possible spelling drift">
                            unmatched
                          </span>
                        )}
                      </span>
                      <span className="text-right font-mono">{c.pr_count}</span>
                      <span className="text-right font-mono font-bold">{fmtUsd(c.total_committed_usd)}</span>
                      <span className="text-right font-mono">{c.months_active}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {c.earliest_yyyymm ? `${fmtYyyymm(c.earliest_yyyymm)}` : '—'}
                        {c.earliest_yyyymm !== c.latest_yyyymm && c.latest_yyyymm ? ` → ${fmtYyyymm(c.latest_yyyymm)}` : ''}
                      </span>
                      <span>
                        {issues > 0 ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            {issues} field{issues === 1 ? '' : 's'} sparse
                          </span>
                        ) : (
                          <span className="text-emerald-600">complete</span>
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

      {/* Anomalies */}
      <Card>
        <CardHeader title="Accuracy & anomalies" subtitle="What the team should double-check" />
        <div className="grid gap-2 md:grid-cols-2">
          <AnomalyTile label="Rows with no company name" value={summary.anomalies.rowsWithNoCompany.length} hint="Could not be routed by header keyword OR text scan" />
          <AnomalyTile label="Rows with no PR ID" value={summary.anomalies.rowsWithNoPrId} hint="Hard to track without one" />
          <AnomalyTile label="Rows with no fund code" value={summary.anomalies.rowsWithNoFund} hint="Should be 97060 (Dutch) or 91763 (SIDA)" />
          <AnomalyTile label="Rows with no status" value={summary.anomalies.rowsWithNoStatus} hint="Pipeline visibility gap" />
          <AnomalyTile label="Rows with no total $" value={summary.anomalies.rowsWithNoTotal} hint="Budget visibility gap" />
          <AnomalyTile label="Rows where total $ failed to parse" value={summary.anomalies.rowsWithBadTotal.length} hint="Likely a non-numeric value in the total cell" />
          <AnomalyTile label="Duplicate (company + activity + month)" value={summary.anomalies.duplicateActivityCompanyMonth.length} hint="Potential copy-paste duplicates" wide />
        </div>

        {summary.anomalies.rowsWithNoCompany.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Sample rows with no company</h4>
            <ul className="space-y-1 text-xs">
              {summary.anomalies.rowsWithNoCompany.slice(0, 5).map((r, i) => (
                <li key={i} className="rounded-md border border-slate-200 px-2 py-1 dark:border-navy-700">
                  <span className="font-mono text-slate-500">{r.source_tab}#{r.source_row}</span>
                  {' · '}
                  <span className="text-slate-800 dark:text-slate-200">{r.activity || r.item_description || '(no activity)'}</span>
                  {' · '}
                  <span className="text-slate-500">{r.total_cost_usd ? `$${r.total_cost_usd}` : 'no total'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.anomalies.duplicateActivityCompanyMonth.length > 0 && (
          <div className="mt-3">
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Sample duplicates</h4>
            <ul className="space-y-1 text-xs">
              {summary.anomalies.duplicateActivityCompanyMonth.slice(0, 5).map((d, i) => (
                <li key={i} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 dark:border-amber-900 dark:bg-amber-950">
                  <span className="font-bold">{d.rows.length}× </span>
                  <span className="text-slate-700 dark:text-slate-200">{d.rows[0].company_name} · {d.rows[0].activity}</span>
                  <span className="ml-1 font-mono text-slate-500">({fmtYyyymm(d.rows[0].source_month_yyyymm)})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Cross-check against interviewed list */}
      <Card>
        <CardHeader
          title="Cross-check vs interviewed list"
          subtitle="Which companies in our 52-company interview pool have / don't have entries in this window"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <h4 className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              {summary.interviewedWithoutProcurement.length} interviewed companies with NO PRs in window
            </h4>
            {summary.interviewedWithoutProcurement.length === 0 ? (
              <p className="text-xs text-emerald-600">All interviewed companies have at least one PR.</p>
            ) : (
              <ul className="max-h-[200px] space-y-1 overflow-y-auto pr-2 text-xs">
                {summary.interviewedWithoutProcurement.map(n => (
                  <li key={n} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 dark:border-amber-900 dark:bg-amber-950">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300">
              {summary.procurementForNonInterviewed.length} procurement names NOT in interviewed list
            </h4>
            {summary.procurementForNonInterviewed.length === 0 ? (
              <p className="text-xs text-emerald-600">Every company in procurement matches an interviewed name.</p>
            ) : (
              <ul className="max-h-[200px] space-y-1 overflow-y-auto pr-2 text-xs">
                {summary.procurementForNonInterviewed.map(n => (
                  <li key={n} className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-900 dark:bg-blue-950">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Spelling drift between sheets is the usual cause of mismatches. If a name on the right SHOULD be a company in the
          interviewed list, fix the spelling in the team source sheet so future cross-checks line up.
        </p>
      </Card>
    </div>
  );
}

function CompanyDetail({ c }: { c: CompanyAnalysis }) {
  return (
    <div className="border-t border-slate-100 bg-slate-50/40 px-3 py-2 dark:border-navy-800 dark:bg-navy-800/30">
      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
        <Mini label="Status breakdown" value={Object.entries(c.status_breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'} />
        <Mini label="Funds" value={Object.entries(c.fund_breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'} />
        <Mini label="Has PR ID" value={`${c.has_pr_id} / ${c.pr_count}`} />
        <Mini label="Missing fields" value={`PR ${c.missing_pr_id} · Status ${c.missing_status} · Fund ${c.missing_fund} · Total ${c.missing_total}`} />
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
        <div className="grid grid-cols-[110px_70px_1fr_90px_70px_90px] border-b border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700 dark:bg-navy-900">
          <span>Month</span>
          <span>PR</span>
          <span>Activity</span>
          <span className="text-right">Total $</span>
          <span>Fund</span>
          <span>Status</span>
        </div>
        <ul>
          {c.rows
            .slice()
            .sort((a, b) => (a.source_month_yyyymm - b.source_month_yyyymm) || a.source_row - b.source_row)
            .map((r, i) => (
              <li key={i} className="grid grid-cols-[110px_70px_1fr_90px_70px_90px] gap-1 border-b border-slate-100 px-2 py-1 text-[11px] last:border-b-0 dark:border-navy-800">
                <span className="font-mono text-slate-500">{r.source_tab}</span>
                <span className="font-mono">{r.pr_id || '—'}</span>
                <span className="truncate" title={r.activity}>{r.activity || r.item_description || '—'}</span>
                <span className="text-right font-mono">{r.total_cost_usd ? `$${r.total_cost_usd}` : '—'}</span>
                <span className="font-mono">{r.fund_code || '—'}</span>
                <span>{r.status || '—'}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone: 'navy' | 'teal' | 'orange' | 'amber' }) {
  const toneCls: Record<string, string> = {
    navy: 'border-slate-200 bg-white text-navy-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-100',
    teal: 'border-brand-teal/30 bg-brand-teal/5 text-brand-teal',
    orange: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  };
  return (
    <div className={`rounded-xl border p-3 ${toneCls[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] opacity-70">{hint}</div>}
    </div>
  );
}

function AnomalyTile({ label, value, hint, wide = false }: { label: string; value: number; hint: string; wide?: boolean }) {
  const tone = value === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div className={`${wide ? 'md:col-span-2' : ''} rounded-md border px-3 py-2 ${tone} dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200`}>
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
