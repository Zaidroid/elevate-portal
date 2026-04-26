// ElevateBridge dashboard. Mirrors the Advisors dashboard but framed
// around the matching engine: matched-vs-available capacity, producing
// freelancers (the value generators), per-PM workload, monthly income.

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, TrendingUp, Users } from 'lucide-react';
import { Card, CardHeader } from '../../lib/ui';
import type { FreelancerActivity } from '../../types/freelancer';
import type { EnrichedFreelancer } from './utils';
import { FL_PIPELINE_COLUMNS } from './utils';

export function FreelancerDashboard({
  freelancers,
  activity = [],
  monthlyIncome = [],
}: {
  freelancers: EnrichedFreelancer[];
  activity?: FreelancerActivity[];
  monthlyIncome?: Array<{ month: string; gross_income_usd: string }>;
}) {
  const stats = useMemo(() => {
    const total = freelancers.length;
    const byStatus: Record<string, number> = {};
    for (const f of freelancers) {
      const s = f.status || 'Available';
      byStatus[s] = (byStatus[s] || 0) + 1;
    }
    const byTrack: Record<string, number> = {};
    const byRole: Record<string, number> = {};
    for (const f of freelancers) {
      const t = f.track || 'Unset';
      const r = f.role_profile || 'Unset';
      byTrack[t] = (byTrack[t] || 0) + 1;
      byRole[r] = (byRole[r] || 0) + 1;
    }

    const stuck = freelancers.filter(f => f.is_stuck && f.status !== 'Archived').length;
    const stuckByStatus: Record<string, number> = {};
    for (const f of freelancers) {
      if (!f.is_stuck || f.status === 'Archived') continue;
      const s = f.status || 'Available';
      stuckByStatus[s] = (stuckByStatus[s] || 0) + 1;
    }

    // PM workload (assignee_email)
    const byPM = new Map<string, { count: number; stuck: number; followups: number; producing: number }>();
    for (const f of freelancers) {
      if (f.status === 'Archived') continue;
      const pm = (f.assignee_email || '').trim();
      if (!pm) continue;
      if (!byPM.has(pm)) byPM.set(pm, { count: 0, stuck: 0, followups: 0, producing: 0 });
      const e = byPM.get(pm)!;
      e.count += 1;
      e.followups += f.open_followups;
      if (f.is_stuck) e.stuck += 1;
      if (f.status === 'Producing') e.producing += 1;
    }
    const unassigned = freelancers.filter(f => f.status !== 'Archived' && !f.assignee_email).length;

    return { total, byStatus, byTrack, byRole, stuck, stuckByStatus, pmRows: Array.from(byPM.entries()).map(([pm, v]) => ({ pm, ...v })), unassigned };
  }, [freelancers]);

  // Capacity transitions over the trailing 30 / 90 days from activity log.
  const forecast = useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    const cutoff30 = now - 30 * day;
    const cutoff90 = now - 90 * day;
    const transitions: Record<string, { last30: number; last90: number }> = {};
    for (const a of activity) {
      if (a.action !== 'status_change') continue;
      const t = Date.parse(a.timestamp || '');
      if (!Number.isFinite(t)) continue;
      const key = `${a.old_value || '?'}->${a.new_value || '?'}`;
      if (!transitions[key]) transitions[key] = { last30: 0, last90: 0 };
      if (t >= cutoff30) transitions[key].last30 += 1;
      if (t >= cutoff90) transitions[key].last90 += 1;
    }
    const interesting = ['Available->Matched', 'Matched->Active', 'Active->Producing', 'Producing->Released'];
    return interesting.map(k => ({
      gate: k,
      last30: transitions[k]?.last30 || 0,
      next30: Math.round(((transitions[k]?.last30 || 0) + (transitions[k]?.last90 || 0) / 3) / 2),
    }));
  }, [activity]);

  // Monthly income aggregate (sum of Income Tracking rows by month).
  const incomeByMonth = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of monthlyIncome) {
      const month = r.month || '';
      const v = parseFloat(r.gross_income_usd || '0') || 0;
      if (!month) continue;
      m[month] = (m[month] || 0) + v;
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthlyIncome]);

  if (freelancers.length === 0) {
    return (
      <Card>
        <CardHeader title="ElevateBridge dashboard" subtitle="No freelancers loaded yet." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile icon={<Users className="h-4 w-4" />} label="Total in pool" value={stats.total} tone="navy" />
        <Tile icon={<Cpu className="h-4 w-4" />} label="Available now" value={stats.byStatus['Available'] || 0} tone="amber" sub="Ready to match" />
        <Tile icon={<TrendingUp className="h-4 w-4" />} label="Active engagements" value={(stats.byStatus['Active'] || 0) + (stats.byStatus['Producing'] || 0)} tone="teal" />
        <Tile icon={<CheckCircle2 className="h-4 w-4" />} label="Producing" value={stats.byStatus['Producing'] || 0} tone="green" sub="Closing deals" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pipeline" subtitle="Where the pool sits today" />
          <FunnelList rows={FL_PIPELINE_COLUMNS.map(c => ({
            label: c.label,
            value: stats.byStatus[c.label] || 0,
            tone: c.tone,
          }))} max={Math.max(1, ...Object.values(stats.byStatus))} />
        </Card>
        <Card>
          <CardHeader title="Tracks" subtitle="Where freelancers are working" />
          <FunnelList rows={Object.entries(stats.byTrack).map(([k, v]) => ({ label: k, value: v, tone: 'teal' }))} max={Math.max(1, ...Object.values(stats.byTrack))} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="SLA health" subtitle="Stuck past expected duration" />
          <Tile inline icon={<AlertTriangle className="h-4 w-4" />} label="Stuck" value={stats.stuck} tone={stats.stuck > 0 ? 'red' : 'green'} sub="See Roster → Stuck filter" />
          {Object.entries(stats.stuckByStatus).length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {Object.entries(stats.stuckByStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <li key={s} className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">{s}</span>
                  <span className="font-mono font-bold text-brand-red">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Profile Manager workload" subtitle="Active freelancers per PM" />
          {stats.pmRows.length === 0 ? (
            <p className="text-xs text-slate-500">No assignees set yet.</p>
          ) : (
            <ul className="space-y-2">
              {stats.pmRows.sort((a, b) => b.count - a.count).map(r => (
                <li key={r.pm} className="rounded-lg border border-slate-200 p-2 dark:border-navy-700">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-bold text-navy-500 dark:text-white">{r.pm}</span>
                    <div className="flex items-center gap-1.5 text-2xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-navy-700 dark:text-slate-200">{r.count}</span>
                      {r.producing > 0 && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700">{r.producing} producing</span>}
                      {r.stuck > 0 && <span className="rounded bg-brand-red/15 px-1.5 py-0.5 text-brand-red">{r.stuck} stuck</span>}
                      {r.followups > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">{r.followups} fu</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {stats.unassigned > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {stats.unassigned} freelancer{stats.unassigned === 1 ? '' : 's'} with no PM assigned.
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Capacity throughput" subtitle="Trailing 30d activity vs 30d projection" />
          {forecast.every(f => f.last30 === 0 && f.next30 === 0) ? (
            <p className="text-xs text-slate-500">Not enough activity yet to project.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {forecast.map(f => (
                <li key={f.gate} className="rounded-lg border border-slate-200 p-2 dark:border-navy-700">
                  <div className="flex items-center justify-between">
                    <span className="truncate font-mono text-navy-500 dark:text-slate-200">{f.gate}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-navy-700 dark:text-slate-200">last 30: {f.last30}</span>
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700">
                        <TrendingUp className="h-2.5 w-2.5" /> next 30: ~{f.next30}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {incomeByMonth.length > 0 && (
        <Card>
          <CardHeader title="Monthly income (program-wide)" subtitle="Sum of every Income Tracking row by month" />
          <div className="flex h-32 items-end gap-2">
            {(() => {
              const max = Math.max(1, ...incomeByMonth.map(([, v]) => v));
              return incomeByMonth.map(([m, v]) => (
                <div key={m} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-brand-orange"
                    style={{ height: `${(v / max) * 100}%` }}
                    title={`${m}: $${v.toLocaleString()}`}
                  />
                  <div className="text-2xs text-slate-500">{m.slice(5)}</div>
                </div>
              ));
            })()}
          </div>
        </Card>
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  tone,
  inline = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone: 'navy' | 'red' | 'teal' | 'orange' | 'amber' | 'green' | 'slate';
  inline?: boolean;
}) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-500/5 text-navy-500 dark:text-white',
    red: 'bg-brand-red/10 text-brand-red',
    teal: 'bg-brand-teal/10 text-brand-teal',
    orange: 'bg-brand-orange/10 text-brand-orange',
    amber: 'bg-amber-500/10 text-amber-700',
    green: 'bg-emerald-500/10 text-emerald-700',
    slate: 'bg-slate-500/10 text-slate-600',
  };
  if (inline) {
    return (
      <div className="mt-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
        </div>
        <div className={`text-2xl font-extrabold ${tones[tone].split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>{value}</div>
      </div>
    );
  }
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
    </div>
  );
}

function FunnelList({ rows, max }: { rows: { label: string; value: number; tone: string }[]; max: number }) {
  const toneBg: Record<string, string> = {
    red: 'bg-brand-red',
    teal: 'bg-brand-teal',
    navy: 'bg-navy-500',
    orange: 'bg-brand-orange',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
    slate: 'bg-slate-400',
  };
  return (
    <div className="space-y-2">
      {rows.map(row => {
        const pctW = max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0;
        return (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-32 truncate text-xs font-semibold text-navy-500 dark:text-slate-200">{row.label}</div>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
              <div className={`h-full rounded-full ${toneBg[row.tone] || 'bg-slate-400'}`} style={{ width: `${pctW}%` }} />
            </div>
            <div className="w-10 text-right text-xs font-bold text-navy-500 dark:text-slate-200">{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}
