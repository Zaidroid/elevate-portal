// Dashboard view inside the Advisors module. Mirrors the Dashboard tab in
// the E3 - Non-Technical Advisors workbook so app and sheet stay aligned.

import { useMemo } from 'react';
import { Award, GraduationCap, Users, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader } from '../../lib/ui';
import { CATEGORY_META, PIPELINE_COLUMNS } from '../../lib/advisor-scoring';
import type { EnrichedAdvisor } from './utils';
import { normalizeCountry } from './utils';

export function AdvisorDashboard({ advisors }: { advisors: EnrichedAdvisor[] }) {
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

    return { total, passed, matched, onHold, avgS1, byCountry, byCategory, byPipeline, overdueAdvisors, dueSoon };
  }, [advisors]);

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
