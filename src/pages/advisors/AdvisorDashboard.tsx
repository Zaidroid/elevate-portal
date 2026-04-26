// Dashboard view inside the Advisors module. Mirrors the Dashboard tab in
// the E3 - Non-Technical Advisors workbook so app and sheet stay aligned.

import { useMemo } from 'react';
import { AlertTriangle, Award, GraduationCap, TrendingUp, Users, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader } from '../../lib/ui';
import { CATEGORY_META, PIPELINE_COLUMNS } from '../../lib/advisor-scoring';
import type { ActivityRow } from '../../types/advisor';
import type { EnrichedAdvisor } from './utils';
import { normalizeCountry } from './utils';

export function AdvisorDashboard({
  advisors,
  activity = [],
}: {
  advisors: EnrichedAdvisor[];
  activity?: ActivityRow[];
}) {
  const stats = useMemo(() => {
    const total = advisors.length;
    const passed = advisors.filter(a => a.stage1.pass).length;
    const matched = advisors.filter(a => a.pipeline_status === 'Matched').length;
    const onHold = advisors.filter(a => a.pipeline_status === 'On Hold').length;
    const avgS1 = total > 0
      ? Math.round(advisors.reduce((s, a) => s + a.stage1.total, 0) / total)
      : 0;

    const byCountry: Record<string, number> = {};
    for (const a of advisors) {
      const c = normalizeCountry(a.country) || 'Unknown';
      byCountry[c] = (byCountry[c] || 0) + 1;
    }
    const byCategory: Record<string, number> = {};
    for (const a of advisors) {
      const c = a.stage2.primary || 'Unqualified';
      byCategory[c] = (byCategory[c] || 0) + 1;
    }
    const byPipeline: Record<string, number> = {};
    for (const a of advisors) {
      const p = a.pipeline_status || 'New';
      byPipeline[p] = (byPipeline[p] || 0) + 1;
    }
    const today = new Date().toISOString().slice(0, 10);
    const overdueAdvisors = advisors.filter(a => a.overdue_followups > 0).length;
    const dueSoon = advisors.filter(a => {
      return a.followups_for.some(f => {
        if (f.status !== 'Open') return false;
        if (!f.due_date) return false;
        return f.due_date >= today && f.due_date <= addDaysIso(today, 7);
      });
    }).length;

    // Stuck count for the SLA card
    const stuck = advisors.filter(a => a.is_stuck && a.pipeline_status !== 'Archived').length;
    const stuckByStatus: Record<string, number> = {};
    for (const a of advisors) {
      if (!a.is_stuck || a.pipeline_status === 'Archived') continue;
      const s = a.pipeline_status || 'New';
      stuckByStatus[s] = (stuckByStatus[s] || 0) + 1;
    }

    // Conflict of interest count
    const coiCount = advisors.filter(a => a.conflict_company_id).length;

    // Profile Manager workload — group by assignee_email (excluding empty
    // and Archived). Show count + open follow-ups + stuck count per PM.
    const byPM = new Map<string, {
      count: number;
      open_followups: number;
      stuck: number;
      stages: Record<string, number>;
    }>();
    for (const a of advisors) {
      if (a.pipeline_status === 'Archived') continue;
      const pm = (a.assignee_email || '').trim();
      if (!pm) continue;
      if (!byPM.has(pm)) byPM.set(pm, { count: 0, open_followups: 0, stuck: 0, stages: {} });
      const e = byPM.get(pm)!;
      e.count += 1;
      e.open_followups += a.open_followups;
      if (a.is_stuck) e.stuck += 1;
      const s = a.pipeline_status || 'New';
      e.stages[s] = (e.stages[s] || 0) + 1;
    }
    const unassigned = advisors.filter(a =>
      a.pipeline_status !== 'Archived' && !a.assignee_email
    ).length;

    return {
      total, passed, matched, onHold, avgS1,
      byCountry, byCategory, byPipeline,
      overdueAdvisors, dueSoon,
      stuck, stuckByStatus,
      coiCount,
      pmRows: Array.from(byPM.entries()).map(([pm, v]) => ({ pm, ...v })),
      unassigned,
    };
  }, [advisors]);

  // Capacity forecasting — naive but useful: how many transitions in each
  // direction over the trailing 30 / 60 / 90 days? Project the same rate
  // forward to predict next-30 outflow at each gate.
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
    const interesting = ['New->Acknowledged', 'Allocated->Intro Scheduled', 'Assessment->Approved', 'Approved->Matched'];
    return interesting.map(k => ({
      gate: k,
      last30: transitions[k]?.last30 || 0,
      // Run-rate projection: average of (last30) and (last90/3) gives a
      // smoother projection that is less spiked by a single recent burst.
      next30Projection: Math.round(((transitions[k]?.last30 || 0) + (transitions[k]?.last90 || 0) / 3) / 2),
    }));
  }, [activity]);

  if (advisors.length === 0) {
    return (
      <Card>
        <CardHeader title="Advisor dashboard" subtitle="No advisors loaded yet." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile icon={<Users className="h-4 w-4" />} label="Total advisors" value={stats.total} tone="navy" />
        <Tile icon={<GraduationCap className="h-4 w-4" />} label="Stage 1 pass" value={stats.passed} sub={`${pct(stats.passed, stats.total)}%`} tone="green" />
        <Tile icon={<CheckCircle2 className="h-4 w-4" />} label="Matched" value={stats.matched} tone="teal" />
        <Tile icon={<Award className="h-4 w-4" />} label="Avg Stage 1 score" value={stats.avgS1} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pipeline funnel" subtitle="Counts per status" />
          <FunnelList rows={PIPELINE_COLUMNS.map(c => ({
            label: c.label,
            value: stats.byPipeline[c.label] || 0,
            tone: c.tone,
          }))} max={Math.max(1, ...Object.values(stats.byPipeline))} />
        </Card>
        <Card>
          <CardHeader title="Category fit (Stage 2)" subtitle="Best-fit category per advisor" />
          <FunnelList rows={Object.entries(CATEGORY_META).map(([key, meta]) => ({
            label: meta.label,
            value: stats.byCategory[key] || 0,
            tone: meta.tone,
          }))} max={Math.max(1, ...Object.values(stats.byCategory))} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="SLA health" subtitle="Advisors past the expected duration in their current status" />
          <Tile inline icon={<AlertTriangle className="h-4 w-4" />} label="Stuck advisors" value={stats.stuck} tone={stats.stuck > 0 ? 'red' : 'green'} sub="See Roster → Stuck filter" />
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
          {stats.coiCount > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              {stats.coiCount} advisor{stats.coiCount === 1 ? '' : 's'} with possible conflict of interest
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Profile Manager workload" subtitle="Active advisors per assigned PM" />
          {stats.pmRows.length === 0 ? (
            <p className="text-xs text-slate-500">No advisors assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {stats.pmRows.sort((a, b) => b.count - a.count).map(r => (
                <li key={r.pm} className="rounded-lg border border-slate-200 p-2 dark:border-navy-700">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-bold text-navy-500 dark:text-white">{r.pm}</span>
                    <div className="flex items-center gap-1.5 text-2xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-navy-700 dark:text-slate-200">{r.count} advisors</span>
                      {r.stuck > 0 && <span className="rounded bg-brand-red/15 px-1.5 py-0.5 text-brand-red">{r.stuck} stuck</span>}
                      {r.open_followups > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700">{r.open_followups} fu</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {stats.unassigned > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {stats.unassigned} advisor{stats.unassigned === 1 ? '' : 's'} with no PM assigned. Use Bulk → Set assignee on the Roster to fix.
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Capacity forecasting" subtitle="Trailing 30-day rate vs projected next 30 days" />
          {forecast.every(f => f.last30 === 0 && f.next30Projection === 0) ? (
            <p className="text-xs text-slate-500">Not enough activity yet to project capacity. Make a few status changes and check back.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {forecast.map(f => (
                <li key={f.gate} className="rounded-lg border border-slate-200 p-2 dark:border-navy-700">
                  <div className="flex items-center justify-between">
                    <span className="truncate font-mono text-navy-500 dark:text-slate-200">{f.gate}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-navy-700 dark:text-slate-200">last 30: {f.last30}</span>
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700">
                        <TrendingUp className="h-2.5 w-2.5" /> next 30: ~{f.next30Projection}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="By country" subtitle="Normalized region" />
          <FunnelList
            rows={Object.entries(stats.byCountry)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([k, v]) => ({ label: k, value: v, tone: 'slate' }))}
            max={Math.max(1, ...Object.values(stats.byCountry))}
          />
        </Card>
        <Card>
          <CardHeader title="Follow-ups due" subtitle="Open with due date in <=7 days" />
          <Tile icon={null} label="Advisors with due-soon follow-ups" value={stats.dueSoon} tone="amber" sub="next 7 days" inline />
          <Tile icon={null} label="Advisors with overdue follow-ups" value={stats.overdueAdvisors} tone="red" sub="action required" inline />
        </Card>
        <Card>
          <CardHeader title="On hold" subtitle="Triage backlog" />
          <Tile icon={null} label="Advisors on hold" value={stats.onHold} tone="slate" inline />
          <p className="mt-3 text-xs text-slate-500">
            On-hold advisors block the funnel. Review weekly and either re-activate or reject.
          </p>
        </Card>
      </div>
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
  const Wrapper = inline ? 'div' : 'div';
  return (
    <Wrapper className={inline ? 'mt-3 flex items-center justify-between' : `rounded-xl p-4 ${tones[tone]}`}>
      {!inline && (
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-80">
          {icon}
          {label}
        </div>
      )}
      {inline ? (
        <>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
            {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
          </div>
          <div className={`text-2xl font-extrabold ${tones[tone].split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
            {value}
          </div>
        </>
      ) : (
        <>
          <div className="text-3xl font-extrabold tracking-tight">{value}</div>
          {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
        </>
      )}
    </Wrapper>
  );
}

function FunnelList({
  rows,
  max,
}: {
  rows: { label: string; value: number; tone: string }[];
  max: number;
}) {
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
              <div
                className={`h-full rounded-full ${toneBg[row.tone] || 'bg-slate-400'}`}
                style={{ width: `${pctW}%` }}
              />
            </div>
            <div className="w-10 text-right text-xs font-bold text-navy-500 dark:text-slate-200">{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function pct(num: number, denom: number) {
  if (denom <= 0) return 0;
  return Math.round((num / denom) * 100);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
