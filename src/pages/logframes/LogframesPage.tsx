// /logframes — Indicators view + Budget Pacing view across Dutch (97060)
// and SIDA/TechRise (91763) logframes. Auto-computes indicator actuals
// from live Companies / Assignments / Payments where the source-of-
// calculation phrase is recognised; otherwise marks Manual.

import { useMemo, useState } from 'react';
import { Activity, BarChart3, Globe2 } from 'lucide-react';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Card, CardHeader, EmptyState, Tabs } from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import { computeIndicator, parseTarget } from '../../lib/logframes/compute';

type Row = Record<string, string>;
type FundView = 'dutch' | 'sida';

const TARGET_YEAR_FALLBACK = '2026';

export function LogframesPage() {
  const [tab, setTab] = useState<string>('indicators');
  const [fund, setFund] = useState<FundView>('dutch');

  // Logframes sheet
  const logframesId = getSheetId('logframes');
  const { rows: dutch, loading: dutchLoading, error: dutchError } = useSheetDoc<Row>(
    logframesId || null,
    getTab('logframes', 'dutch'),
    'ID'
  );
  const { rows: sida } = useSheetDoc<Row>(
    logframesId || null,
    getTab('logframes', 'sida'),
    'ID'
  );

  // Live data we join against
  const companiesId = getSheetId('companies');
  const paymentsId = getSheetId('payments');
  const { rows: companies } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'companies'), 'company_id');
  const { rows: assignments } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'assignments'), 'assignment_id');
  const { rows: payments } = useSheetDoc<Row>(paymentsId || null, getTab('payments', 'payments'), 'payment_id');

  const inputs = useMemo(() => ({ companies, assignments, payments }), [companies, assignments, payments]);

  if (!logframesId) {
    return (
      <Card>
        <CardHeader title="Logframes" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_LOGFRAMES</code> in your environment.
        </p>
      </Card>
    );
  }

  const tabs: TabItem[] = [
    { value: 'indicators', label: 'Indicators', icon: <Activity className="h-4 w-4" /> },
    { value: 'budget', label: 'Budget pacing', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Logframes</h1>
          <Badge tone={fund === 'dutch' ? 'red' : 'teal'}>{fund === 'dutch' ? 'Dutch · 97060' : 'SIDA · 91763'}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Indicator targets vs auto-computed actuals from live module data. Switch funds with the toggle.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFund('dutch')}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${fund === 'dutch' ? 'bg-brand-red text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
        >
          <Globe2 className="mr-1 inline h-3.5 w-3.5" /> Dutch (97060)
        </button>
        <button
          onClick={() => setFund('sida')}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${fund === 'sida' ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
        >
          <Globe2 className="mr-1 inline h-3.5 w-3.5" /> SIDA TechRise (91763)
        </button>
      </div>

      {dutchError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {dutchError.message}</p>
        </Card>
      )}

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'indicators' && (
        <IndicatorsTable
          rows={fund === 'dutch' ? dutch : sida}
          inputs={inputs}
          loading={dutchLoading}
        />
      )}

      {tab === 'budget' && (
        <BudgetSummary inputs={inputs} fund={fund} />
      )}
    </div>
  );
}

function IndicatorsTable({
  rows,
  inputs,
  loading,
}: {
  rows: Row[];
  inputs: { companies: Row[]; assignments: Row[]; payments: Row[] };
  loading: boolean;
}) {
  const today = new Date().getFullYear();
  const targetCol = `${today} Target`;
  const targetColAlt = `${today} Target (June - July)`;

  const decorated = useMemo(() => rows
    .filter(r => (r.Indicators || r['Output Indicators'] || '').trim().length > 0)
    .map(r => {
      const indicator = r.Indicators || r['Output Indicators'] || '';
      const source = r['Exact Source of Calculation'] || r['Source of Calculation'] || '';
      const targetRaw = r[targetCol] || r[targetColAlt] || r[`${TARGET_YEAR_FALLBACK} Target`] || '';
      const target = parseTarget(targetRaw);
      const computed = computeIndicator(source, inputs, target);
      return { row: r, indicator, source, target, computed };
    }), [rows, inputs, targetCol, targetColAlt]);

  if (loading && rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Activity className="h-6 w-6 animate-pulse" />} title="Loading…" description="Reading the logframes sheet." />
      </Card>
    );
  }

  if (decorated.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Activity className="h-6 w-6" />} title="No indicators found" description="Check the sheet structure or switch fund." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`${decorated.length} indicators`}
        subtitle={`Showing ${today} targets. Auto-computed where the Source of Calculation is parseable; "Manual" otherwise.`}
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-navy-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500 dark:bg-navy-700">
            <tr>
              <th className="px-3 py-2 text-left">Indicator</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {decorated.map((d, i) => {
              const variance = d.computed.actual !== null && d.target !== null
                ? d.computed.actual - d.target
                : null;
              return (
                <tr key={i} className="border-t border-slate-100 dark:border-navy-700">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-navy-500 dark:text-slate-100">{d.indicator}</div>
                    <div className="text-2xs text-slate-500" title={d.source}>{truncate(d.source, 80)}</div>
                    <div className="text-2xs text-slate-400">{d.computed.hint}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm">{d.target ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-navy-500 dark:text-slate-100">
                    {d.computed.actual !== null ? d.computed.actual.toLocaleString() : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-sm ${variance === null ? '' : variance >= 0 ? 'text-emerald-600' : 'text-brand-red'}`}>
                    {variance === null ? '—' : (variance > 0 ? '+' : '') + variance.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(d.computed.status)}>{statusLabel(d.computed.status)}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BudgetSummary({
  inputs,
  fund,
}: {
  inputs: { companies: Row[]; assignments: Row[]; payments: Row[] };
  fund: FundView;
}) {
  const fundCode = fund === 'dutch' ? '97060' : '91763';
  const stats = useMemo(() => {
    const fundPayments = inputs.payments.filter(p => p.fund_code === fundCode);
    const totalPaid = fundPayments
      .filter(p => p.status === 'Paid')
      .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0);
    const totalPending = fundPayments
      .filter(p => ['Pending Approval', 'Approved', 'Sent to Finance'].includes(p.status || ''))
      .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0);

    const byMonth: Record<string, number> = {};
    for (const p of fundPayments) {
      if (p.status !== 'Paid') continue;
      const m = (p.payment_date || '').slice(0, 7) || 'Unset';
      byMonth[m] = (byMonth[m] || 0) + (parseFloat(p.amount_usd || '0') || 0);
    }

    const byIntervention: Record<string, number> = {};
    for (const p of fundPayments) {
      if (p.status !== 'Paid') continue;
      const it = p.intervention_type || 'Unknown';
      byIntervention[it] = (byIntervention[it] || 0) + (parseFloat(p.amount_usd || '0') || 0);
    }
    return { totalPaid, totalPending, byMonth, byIntervention };
  }, [inputs.payments, fundCode]);

  const months = Object.entries(stats.byMonth).filter(([k]) => k !== 'Unset').sort();
  const max = Math.max(1, ...months.map(([, v]) => v));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Spend totals" subtitle={`Fund ${fundCode}`} />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Paid YTD</div>
            <div className="text-3xl font-extrabold text-emerald-700">${stats.totalPaid.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Pending</div>
            <div className="text-3xl font-extrabold text-amber-700">${stats.totalPending.toLocaleString()}</div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="By intervention" subtitle={`Paid USD per pillar, fund ${fundCode}`} />
        {Object.keys(stats.byIntervention).length === 0 ? (
          <p className="text-sm text-slate-500">No paid disbursements for this fund yet.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(stats.byIntervention).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
              const maxV = Math.max(...Object.values(stats.byIntervention));
              return (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-navy-500 dark:text-slate-200">{k}</span>
                    <span className="font-mono text-slate-500">${v.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-navy-700">
                    <div className="h-full rounded-full bg-brand-teal" style={{ width: `${(v / maxV) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Monthly burn" subtitle={`Paid USD per month, fund ${fundCode}`} />
        {months.length === 0 ? (
          <p className="text-sm text-slate-500">No monthly data yet.</p>
        ) : (
          <div className="flex h-32 items-end gap-2">
            {months.map(([m, v]) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-brand-orange"
                  style={{ height: `${(v / max) * 100}%` }}
                  title={`${m}: $${v.toLocaleString()}`}
                />
                <div className="text-2xs text-slate-500">{m.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function statusTone(s: string): Tone {
  switch (s) {
    case 'on_track': return 'green';
    case 'at_risk': return 'amber';
    case 'off_track': return 'red';
    default: return 'neutral';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'on_track': return 'On track';
    case 'at_risk': return 'At risk';
    case 'off_track': return 'Off track';
    default: return 'Manual';
  }
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
