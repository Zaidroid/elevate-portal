import { useMemo } from 'react';
import { AlertTriangle, Award, Download, TrendingUp, Users, ClipboardList, Wallet, Plane, GraduationCap } from 'lucide-react';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Card, CardHeader, Button, Badge, downloadCsv, timestampedFilename } from '../../lib/ui';
import { INTERVENTION_TYPES, CORE_PILLARS, pillarFor } from '../../config/interventions';
import type { Advisor, FollowUp } from '../../types/advisor';
import { computeStage1, computeStage2 } from '../../lib/advisor-scoring';
import type { Tone } from '../../lib/ui';

type Row = Record<string, string>;

export function ReportsPage() {
  const companiesId = getSheetId('companies');
  const paymentsId = getSheetId('payments');
  const procurementId = getSheetId('procurement');
  const conferencesId = getSheetId('conferences');

  const { rows: companies } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'companies'), 'company_id');
  const { rows: assignments } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'assignments'), 'assignment_id');
  const { rows: payments } = useSheetDoc<Row>(paymentsId || null, getTab('payments', 'payments'), 'payment_id');
  const { rows: q1 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q1'), 'pr_id');
  const { rows: q2 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q2'), 'pr_id');
  const { rows: q3 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q3'), 'pr_id');
  const { rows: q4 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q4'), 'pr_id');
  const { rows: confTracker } = useSheetDoc<Row>(conferencesId || null, getTab('conferences', 'tracker'), 'tracker_id');
  const advisorsId = getSheetId('advisors');
  const { rows: advisors } = useSheetDoc<Advisor>(advisorsId || null, getTab('advisors', 'advisors'), 'advisor_id');
  const { rows: followups } = useSheetDoc<FollowUp>(advisorsId || null, getTab('advisors', 'followups'), 'followup_id');

  const stats = useMemo(() => {
    const allPRs = [...q1, ...q2, ...q3, ...q4];

    const companyByStatus: Record<string, number> = {};
    for (const c of companies) {
      const s = c.status || 'Unset';
      companyByStatus[s] = (companyByStatus[s] || 0) + 1;
    }

    const paymentsByFund: Record<string, number> = {};
    const paymentsByStatus: Record<string, number> = {};
    const paymentsByMonth: Record<string, number> = {};
    for (const p of payments) {
      const amt = parseFloat(p.amount_usd || '0') || 0;
      const fund = p.fund_code || 'Unset';
      const status = p.status || 'Unset';
      paymentsByFund[fund] = (paymentsByFund[fund] || 0) + amt;
      paymentsByStatus[status] = (paymentsByStatus[status] || 0) + amt;
      const month = (p.payment_date || '').slice(0, 7) || 'Unset';
      paymentsByMonth[month] = (paymentsByMonth[month] || 0) + amt;
    }

    const procurementByThreshold: Record<string, number> = {};
    const procurementByQuarter = { Q1: q1.length, Q2: q2.length, Q3: q3.length, Q4: q4.length };
    const procurementByFund: Record<string, number> = {};
    const procurementByStatus: Record<string, number> = {};
    let procurementTotalUSD = 0;
    for (const pr of allPRs) {
      const t = pr.threshold_class || 'Unset';
      procurementByThreshold[t] = (procurementByThreshold[t] || 0) + 1;
      procurementTotalUSD += parseFloat(pr.total_cost_usd || '0') || 0;
      const fund = pr.fund_code || 'Unset';
      procurementByFund[fund] = (procurementByFund[fund] || 0) + (parseFloat(pr.total_cost_usd || '0') || 0);
      const st = pr.status || 'Unset';
      procurementByStatus[st] = (procurementByStatus[st] || 0) + 1;
    }

    // Intervention coverage matrix: company x intervention_type (boolean assigned).
    const coverage: Record<string, Set<string>> = {}; // intervention_type -> set of company_ids
    for (const a of assignments) {
      const t = a.intervention_type || 'Unknown';
      if (!coverage[t]) coverage[t] = new Set();
      if (a.company_id) coverage[t].add(a.company_id);
    }
    const coverageRows = INTERVENTION_TYPES.map(t => ({
      intervention: t,
      companies: coverage[t]?.size || 0,
      planned: assignments.filter(a => a.intervention_type === t && a.status === 'Planned').length,
      in_progress: assignments.filter(a => a.intervention_type === t && a.status === 'In Progress').length,
      completed: assignments.filter(a => a.intervention_type === t && a.status === 'Completed').length,
    }));

    // Fund burn: planned (PR total) vs spent (Paid payments).
    const burn: Record<string, { planned: number; spent: number }> = {};
    for (const pr of allPRs) {
      const f = pr.fund_code || 'Unset';
      burn[f] = burn[f] || { planned: 0, spent: 0 };
      burn[f].planned += parseFloat(pr.total_cost_usd || '0') || 0;
    }
    for (const p of payments) {
      if (p.status !== 'Paid') continue;
      const f = p.fund_code || 'Unset';
      burn[f] = burn[f] || { planned: 0, spent: 0 };
      burn[f].spent += parseFloat(p.amount_usd || '0') || 0;
    }

    // Conference travel pipeline
    const confsByDecision: Record<string, number> = {};
    for (const c of confTracker) {
      const d = c.decision || 'Unset';
      confsByDecision[d] = (confsByDecision[d] || 0) + 1;
    }

    // Procurement deadlines: PRs with pr_deadline within next 7 days or past due (Draft/Submitted only).
    const today = new Date().toISOString().slice(0, 10);
    const horizon = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    const deadlinesThisWeek: typeof allPRs = [];
    const pastDuePRs: typeof allPRs = [];
    for (const pr of allPRs) {
      const deadline = pr.pr_deadline || '';
      const status = pr.status || '';
      if (!deadline) continue;
      if (status !== 'Draft' && status !== 'Submitted' && status !== 'Under Review') continue;
      if (deadline < today) pastDuePRs.push(pr);
      else if (deadline <= horizon) deadlinesThisWeek.push(pr);
    }

    // Advisors stats
    const advisorsScored = advisors.map(a => {
      const s1 = computeStage1(a);
      const s2 = s1.pass ? computeStage2(a) : { ceo: 0, cto: 0, coo: 0, marketing: 0, ai: 0, primary: 'Unqualified' as const };
      return { advisor: a, s1, s2 };
    });
    const advisorPass = advisorsScored.filter(a => a.s1.pass).length;
    const advisorByPipeline: Record<string, number> = {};
    const advisorByCategory: Record<string, number> = {};
    for (const a of advisorsScored) {
      const ps = a.advisor.pipeline_status || 'New';
      advisorByPipeline[ps] = (advisorByPipeline[ps] || 0) + 1;
      const cat = a.s2.primary;
      advisorByCategory[cat] = (advisorByCategory[cat] || 0) + 1;
    }
    const followupsOpen = followups.filter(f => f.status === 'Open').length;
    const followupsOverdue = followups.filter(f => f.status === 'Open' && f.due_date && f.due_date < today).length;

    // Per-pillar rollup: count companies, assignments, planned/in_progress per pillar.
    const pillarRows = CORE_PILLARS.map(p => {
      const pillarAssignments = assignments.filter(a => {
        const ap = pillarFor(a.intervention_type || '');
        return ap?.code === p.code;
      });
      const companyIds = new Set(pillarAssignments.map(a => a.company_id).filter(Boolean));
      const planned = pillarAssignments.filter(a => a.status === 'Planned').length;
      const inProgress = pillarAssignments.filter(a => a.status === 'In Progress').length;
      const completed = pillarAssignments.filter(a => a.status === 'Completed').length;
      const pillarPRTotal = allPRs
        .filter(pr => pillarFor(pr.intervention_type || '')?.code === p.code)
        .reduce((s, pr) => s + (parseFloat(pr.total_cost_usd || '0') || 0), 0);
      const pillarPaid = payments
        .filter(p2 => p2.status === 'Paid' && pillarFor(p2.intervention_type || '')?.code === p.code)
        .reduce((s, p2) => s + (parseFloat(p2.amount_usd || '0') || 0), 0);
      return { code: p.code, label: p.label, companies: companyIds.size, planned, inProgress, completed, prTotal: pillarPRTotal, paid: pillarPaid };
    });

    return {
      companyByStatus,
      paymentsByFund,
      paymentsByStatus,
      paymentsByMonth,
      procurementByThreshold,
      procurementByQuarter,
      procurementByFund,
      procurementByStatus,
      procurementTotalUSD,
      coverageRows,
      burn,
      confsByDecision,
      deadlinesThisWeek,
      pastDuePRs,
      advisorPass,
      advisorByPipeline,
      advisorByCategory,
      followupsOpen,
      followupsOverdue,
      pillarRows,
      counts: {
        companies: companies.length,
        assignments: assignments.length,
        payments: payments.length,
        prs: allPRs.length,
        conferencesTracked: confTracker.length,
        advisors: advisors.length,
      },
      totals: {
        pending: payments
          .filter(p => ['Pending Approval', 'Approved', 'Sent to Finance'].includes(p.status || ''))
          .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0),
        paid: payments
          .filter(p => p.status === 'Paid')
          .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0),
      },
    };
  }, [companies, assignments, payments, q1, q2, q3, q4, confTracker, advisors, followups]);

  const exportAll = () => {
    downloadCsv(timestampedFilename('report_intervention_coverage'), stats.coverageRows);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Reports and Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cross-module roll-ups. Read-only view powered directly by the sheets.
          </p>
        </div>
        <Button variant="ghost" onClick={exportAll}>
          <Download className="h-4 w-4" /> Export Coverage
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Users} label="Companies" value={stats.counts.companies} sub="in master roster" />
        <StatCard icon={TrendingUp} label="Interventions" value={stats.counts.assignments} sub="assignments" tone="teal" />
        <StatCard icon={ClipboardList} label="Purchase Requests" value={stats.counts.prs} sub={`$${fmt(stats.procurementTotalUSD)}`} tone="red" />
        <StatCard icon={Wallet} label="Paid" value={`$${fmt(stats.totals.paid)}`} sub={`$${fmt(stats.totals.pending)} pending`} tone="orange" />
        <StatCard icon={Plane} label="Conferences" value={stats.counts.conferencesTracked} sub="tracked decisions" />
        <StatCard icon={GraduationCap} label="Advisors" value={stats.counts.advisors} sub={`${stats.advisorPass} Stage 1 pass`} tone="teal" />
      </section>

      <Card>
        <CardHeader title="By pillar" subtitle="Companies, assignments, $ planned vs paid per program pillar" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {stats.pillarRows.map(p => (
            <div key={p.code} className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-navy-500 dark:text-white">{p.label}</div>
                <Badge tone={interventionTone(p.code)}>{p.code}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Stat label="Companies" value={p.companies} />
                <Stat label="Planned" value={p.planned} />
                <Stat label="In progress" value={p.inProgress} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>${fmt(p.paid)} paid</span>
                <span>of ${fmt(p.prTotal)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                <div
                  className="h-full bg-brand-teal"
                  style={{ width: `${p.prTotal > 0 ? Math.min(100, (p.paid / p.prTotal) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(stats.deadlinesThisWeek.length > 0 || stats.pastDuePRs.length > 0) && (
        <Card className={stats.pastDuePRs.length > 0 ? 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20' : ''}>
          <CardHeader
            title="Procurement deadlines"
            subtitle={`${stats.pastDuePRs.length} past-due, ${stats.deadlinesThisWeek.length} due in the next 7 days`}
          />
          {stats.pastDuePRs.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-brand-red">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Past due
              </div>
              <ul className="space-y-1 text-sm">
                {stats.pastDuePRs.slice(0, 8).map((pr, i) => (
                  <li key={pr.pr_id || i} className="flex items-center justify-between rounded border border-red-200 bg-white px-2 py-1 dark:border-red-900 dark:bg-navy-700">
                    <span className="truncate"><span className="font-mono text-xs text-slate-500">{pr.pr_id}</span> {pr.activity}</span>
                    <span className="text-xs text-brand-red">{pr.pr_deadline}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stats.deadlinesThisWeek.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
                Due in 7 days
              </div>
              <ul className="space-y-1 text-sm">
                {stats.deadlinesThisWeek.slice(0, 8).map((pr, i) => (
                  <li key={pr.pr_id || i} className="flex items-center justify-between rounded border border-amber-200 bg-white px-2 py-1 dark:border-amber-900 dark:bg-navy-700">
                    <span className="truncate"><span className="font-mono text-xs text-slate-500">{pr.pr_id}</span> {pr.activity}</span>
                    <span className="text-xs text-amber-700">{pr.pr_deadline}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Fund burn"
            subtitle="Planned (PRs) vs Paid (Payments) by fund code"
            action={<ExportButton filename="report_fund_burn" rows={Object.entries(stats.burn).map(([fund, v]) => ({ fund, planned: v.planned, spent: v.spent, remaining: v.planned - v.spent }))} />}
          />
          <BurnTable burn={stats.burn} />
        </Card>

        <Card>
          <CardHeader
            title="Intervention coverage"
            subtitle="How many companies and how far each intervention has progressed"
            action={<ExportButton filename="report_intervention_coverage" rows={stats.coverageRows} />}
          />
          <CoverageTable rows={stats.coverageRows} />
        </Card>

        <Card>
          <CardHeader title="Companies by status" action={<ExportButton filename="report_companies_by_status" rows={toRows(stats.companyByStatus, 'status', 'count')} />} />
          <Breakdown data={stats.companyByStatus} formatter={v => v.toString()} />
        </Card>

        <Card>
          <CardHeader title="PR pipeline by status" action={<ExportButton filename="report_pr_by_status" rows={toRows(stats.procurementByStatus, 'status', 'count')} />} />
          <Breakdown data={stats.procurementByStatus} formatter={v => v.toString()} />
        </Card>

        <Card>
          <CardHeader title="PR threshold distribution" action={<ExportButton filename="report_pr_thresholds" rows={toRows(stats.procurementByThreshold, 'threshold', 'count')} />} />
          <Breakdown data={stats.procurementByThreshold} formatter={v => v.toString()} />
        </Card>

        <Card>
          <CardHeader title="Payments by fund" action={<ExportButton filename="report_payments_by_fund" rows={toRows(stats.paymentsByFund, 'fund', 'usd')} />} />
          <Breakdown data={stats.paymentsByFund} formatter={v => `$${fmt(v)}`} />
        </Card>

        <Card>
          <CardHeader title="Payments by status" action={<ExportButton filename="report_payments_by_status" rows={toRows(stats.paymentsByStatus, 'status', 'usd')} />} />
          <Breakdown data={stats.paymentsByStatus} formatter={v => `$${fmt(v)}`} />
        </Card>

        <Card>
          <CardHeader title="PR count by quarter" action={<ExportButton filename="report_prs_by_quarter" rows={toRows(stats.procurementByQuarter, 'quarter', 'count')} />} />
          <Breakdown data={stats.procurementByQuarter} formatter={v => v.toString()} />
        </Card>

        <Card>
          <CardHeader title="Conference pipeline" action={<ExportButton filename="report_conferences" rows={toRows(stats.confsByDecision, 'decision', 'count')} />} />
          <Breakdown data={stats.confsByDecision} formatter={v => v.toString()} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Payments by month" subtitle="Total USD logged per payment_date month" action={<ExportButton filename="report_payments_by_month" rows={toRows(stats.paymentsByMonth, 'month', 'usd')} />} />
          <MonthlyBar data={stats.paymentsByMonth} />
        </Card>

        <Card>
          <CardHeader title="Advisors pipeline" subtitle="Where every advisor sits today" action={<ExportButton filename="report_advisors_pipeline" rows={toRows(stats.advisorByPipeline, 'pipeline_status', 'count')} />} />
          <Breakdown data={stats.advisorByPipeline} formatter={v => v.toString()} />
        </Card>

        <Card>
          <CardHeader title="Advisors by category" subtitle="Stage 2 best-fit category" action={<ExportButton filename="report_advisors_categories" rows={toRows(stats.advisorByCategory, 'category', 'count')} />} />
          <Breakdown data={stats.advisorByCategory} formatter={v => v.toString()} />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Advisor follow-ups" subtitle={`${stats.followupsOpen} open · ${stats.followupsOverdue} overdue`} />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Open</div>
              <div className="text-3xl font-extrabold text-amber-700">{stats.followupsOpen}</div>
              <div className="mt-1 text-xs text-slate-500">Across all advisors</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <div className="text-xs font-bold uppercase tracking-wider text-brand-red">
                <Award className="mr-1 inline h-3.5 w-3.5" />
                Overdue
              </div>
              <div className="text-3xl font-extrabold text-brand-red">{stats.followupsOverdue}</div>
              <div className="mt-1 text-xs text-slate-500">Action required</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-base font-bold text-navy-500 dark:text-slate-100">{value}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'navy',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'navy' | 'red' | 'teal' | 'orange';
}) {
  const color =
    tone === 'red' ? 'text-brand-red' :
    tone === 'teal' ? 'text-brand-teal' :
    tone === 'orange' ? 'text-brand-orange' : 'text-navy-500 dark:text-white';
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`mt-1 text-3xl font-extrabold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </Card>
  );
}

const BAR_COLORS = ['bg-brand-red', 'bg-brand-teal', 'bg-brand-orange', 'bg-navy-500 dark:bg-slate-300', 'bg-emerald-500', 'bg-sky-500'];

function Breakdown({
  data, formatter,
}: {
  data: Record<string, number>;
  formatter: (v: number) => string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([k, v], i) => (
        <div key={k}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-navy-500 dark:text-slate-100">{k}</span>
            <span className="text-slate-500 dark:text-slate-400">{formatter(v)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-navy-700">
            <div
              className={`h-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
              style={{ width: `${(v / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BurnTable({ burn }: { burn: Record<string, { planned: number; spent: number }> }) {
  const entries = Object.entries(burn);
  if (entries.length === 0) return <p className="text-sm text-slate-500">No PRs yet.</p>;
  return (
    <div className="space-y-3">
      {entries.map(([fund, v]) => {
        const ratio = v.planned > 0 ? Math.min(100, (v.spent / v.planned) * 100) : 0;
        return (
          <div key={fund}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-navy-500 dark:text-slate-100">Fund {fund}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ${fmt(v.spent)} of ${fmt(v.planned)} · {ratio.toFixed(0)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
              <div className="h-3 bg-brand-orange" style={{ width: `${ratio}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function interventionTone(type: string): Tone {
  const p = pillarFor(type);
  if (!p) return 'neutral';
  switch (p.color) {
    case 'red': return 'red';
    case 'teal': return 'teal';
    case 'orange': return 'orange';
    case 'navy': return 'neutral';
    default: return 'neutral';
  }
}

function CoverageTable({ rows }: { rows: { intervention: string; companies: number; planned: number; in_progress: number; completed: number }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-navy-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-navy-700">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Intervention</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Companies</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Planned</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">In Progress</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.intervention} className="border-t border-slate-100 dark:border-navy-700">
              <td className="px-3 py-2"><Badge tone={interventionTone(r.intervention)}>{r.intervention}</Badge></td>
              <td className="px-3 py-2 text-right font-semibold text-navy-500 dark:text-white">{r.companies}</td>
              <td className="px-3 py-2 text-right text-slate-500">{r.planned}</td>
              <td className="px-3 py-2 text-right text-slate-500">{r.in_progress}</td>
              <td className="px-3 py-2 text-right text-slate-500">{r.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyBar({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([k]) => k !== 'Unset').sort();
  if (entries.length === 0) return <p className="text-sm text-slate-500">No payments dated yet.</p>;
  const max = entries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  return (
    <div className="flex h-32 items-end gap-2">
      {entries.map(([month, v]) => (
        <div key={month} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-brand-teal/80"
            style={{ height: `${(v / max) * 100}%` }}
            title={`${month}: $${fmt(v)}`}
          />
          <div className="text-[10px] text-slate-500">{month.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function ExportButton({ filename, rows }: { filename: string; rows: Record<string, unknown>[] }) {
  return (
    <button
      onClick={() => downloadCsv(timestampedFilename(filename), rows)}
      disabled={rows.length === 0}
      className="text-xs font-semibold text-brand-teal hover:underline disabled:text-slate-300"
    >
      Export
    </button>
  );
}

function toRows(record: Record<string, number>, keyField: string, valueField: string): Record<string, unknown>[] {
  return Object.entries(record).map(([k, v]) => ({ [keyField]: k, [valueField]: v }));
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
