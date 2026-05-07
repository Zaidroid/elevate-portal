// /  — Home (admin landing page)
//
// Per-role landing: AMs go to /my-hub; admins / leadership land here.
// LandingRouter in src/components/guards.tsx handles the redirect.
//
// This page is the cohort 3 control surface for leadership: how the
// cohort is doing, where the load is concentrated, what's stuck, and
// where the donor budget sits. All counts come from the canonical
// COHORT3_ALIASES (41) + INTERVIEWED_NAMES (52) lists so they match
// what the team's portal-owned dashboards show. Pre-cohort applicants
// and historical entries are filtered out everywhere.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  Building2,
  Briefcase,
  ClipboardList,
  Plane,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../services/auth';
import { Badge, Card, CardHeader, EmptyState, statusTone } from '../lib/ui';
import type { Tone } from '../lib/ui';
import { useModuleData } from '../data/useModuleData';
import type { Company, Assignment, PR, Payment, Agreement } from '../data/types';
import { ACCOUNT_MANAGERS, displayName } from '../config/team';
import { canonicalCohortName, COHORT3_ALIASES } from '../config/cohort3Aliases';
import { COHORT3_BUDGET_TOTAL_USD, pillarFor } from '../config/interventions';
import { INTERVIEWED_NAMES, isInterviewed } from './companies/interviewedSource';
import { computeAlerts, type Alert } from '../lib/alerts/index';
import { keepCompaniesSection } from '../lib/sheets/sections';
import { ActivityTimeline } from './companies/ActivityTimeline';
import type { ActivityRow } from './companies/reviewTypes';

// ─── Cohort phase + week counter ─────────────────────────────────────

const COHORT_START = new Date('2026-02-24'); // C3 kickoff
const COHORT_LENGTH_WEEKS = 24;

type Phase = 'selection' | 'onboarding' | 'execution' | 'closeout';

function cohortWeek(): number {
  const days = Math.floor((Date.now() - COHORT_START.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(COHORT_LENGTH_WEEKS, Math.floor(days / 7) + 1));
}

function detectPhase(week: number): Phase {
  if (week <= 1) return 'selection';
  if (week <= 4) return 'onboarding';
  if (week <= 22) return 'execution';
  return 'closeout';
}

const PHASE_LABEL: Record<Phase, string> = {
  selection: 'Selection',
  onboarding: 'Onboarding',
  execution: 'Execution',
  closeout: 'Closeout',
};

// ─── Status helpers ─────────────────────────────────────────────────

function effectiveStatus(c: Company): string {
  const sheetStatus = (c.status || '').trim();
  if (isInterviewed(c.company_name)) {
    const PRE_INTERVIEWED = new Set(['', 'Applicant', 'Shortlisted']);
    if (PRE_INTERVIEWED.has(sheetStatus)) return 'Interviewed';
  }
  return sheetStatus || 'Active';
}

function inCohort3(c: Company): boolean {
  return canonicalCohortName(c.company_name || '') !== null;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

// ─── Page ────────────────────────────────────────────────────────────

export function HomePage() {
  const { user } = useAuth();

  const master      = useModuleData<Company>('companies', 'companies');
  const assignments = useModuleData<Assignment>('companies', 'assignments');
  const activity    = useModuleData<ActivityRow>('companies', 'activity');
  const payments    = useModuleData<Payment>('payments', 'payments');
  const agreements  = useModuleData<Agreement>('docs', 'agreements');

  const q1Hook = useModuleData<PR>('procurement', 'q1');
  const q2Hook = useModuleData<PR>('procurement', 'q2');
  const q3Hook = useModuleData<PR>('procurement', 'q3');
  const q4Hook = useModuleData<PR>('procurement', 'q4');

  // Section-aware: only pull rows under "Companies" header in each
  // procurement tab. Without this we read individuals/vendors/marketing
  // teams' rows and the counts blow up.
  const allPRs = useMemo<PR[]>(() => [
    ...keepCompaniesSection(q1Hook.rows, q1Hook.headers) as PR[],
    ...keepCompaniesSection(q2Hook.rows, q2Hook.headers) as PR[],
    ...keepCompaniesSection(q3Hook.rows, q3Hook.headers) as PR[],
    ...keepCompaniesSection(q4Hook.rows, q4Hook.headers) as PR[],
  ], [q1Hook.rows, q1Hook.headers, q2Hook.rows, q2Hook.headers, q3Hook.rows, q3Hook.headers, q4Hook.rows, q4Hook.headers]);

  // Cohort 3 anchor: the 41 companies whose name resolves to a canonical.
  const cohort = useMemo(() => master.rows.filter(inCohort3), [master.rows]);
  const cohortIds = useMemo(() => new Set(cohort.map(c => c.company_id)), [cohort]);
  const cohortSize = COHORT3_ALIASES.length; // 41
  const interviewedSize = INTERVIEWED_NAMES.size; // 52

  // Status breakdown of the 41.
  const statusCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cohort) {
      const s = effectiveStatus(c);
      m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, [cohort]);
  const withdrawnCount = statusCount['Withdrawn'] ?? 0;
  const activeCount = cohortSize - withdrawnCount;

  // Per-AM rollup.
  const amRollup = useMemo(() => {
    const byAm = new Map<string, { companies: Set<string>; assignments: Assignment[]; budget: number }>();
    const seed = (email: string) => {
      if (!byAm.has(email)) byAm.set(email, { companies: new Set(), assignments: [], budget: 0 });
    };
    for (const am of ACCOUNT_MANAGERS) seed(am.email.toLowerCase());
    seed(''); // unassigned

    for (const c of cohort) {
      const e = (c.profile_manager_email || '').toLowerCase();
      seed(e);
      byAm.get(e)!.companies.add(c.company_id);
    }
    for (const a of assignments.rows) {
      if (!cohortIds.has(a.company_id)) continue;
      const e = (a.owner_email || '').toLowerCase();
      seed(e);
      byAm.get(e)!.assignments.push(a);
      const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) byAm.get(e)!.budget += v;
    }
    return Array.from(byAm.entries())
      .filter(([, r]) => r.companies.size > 0 || r.assignments.length > 0)
      .map(([email, r]) => ({
        email,
        label: email
          ? (ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === email)
              ? displayName(ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === email)!.email)
              : displayName(email))
          : '(unassigned)',
        companies: r.companies.size,
        assignments: r.assignments.length,
        budget: r.budget,
      }))
      .sort((a, b) => b.companies - a.companies);
  }, [cohort, assignments.rows, cohortIds]);

  // Pillar + sub-intervention spread for cohort 3.
  const pillarSpread = useMemo(() => {
    const m: Record<string, number> = { 'Market Access': 0, 'Capacity Building': 0, 'Marketing & Branding': 0 };
    for (const a of assignments.rows) {
      if (!cohortIds.has(a.company_id)) continue;
      const p = pillarFor(a.intervention_type);
      if (p) m[p.label] = (m[p.label] ?? 0) + 1;
    }
    return m;
  }, [assignments.rows, cohortIds]);

  const totalAssignments = useMemo(
    () => assignments.rows.filter(a => cohortIds.has(a.company_id)).length,
    [assignments.rows, cohortIds],
  );
  const totalCommitted = useMemo(() => {
    let n = 0;
    for (const a of assignments.rows) {
      if (!cohortIds.has(a.company_id)) continue;
      const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) n += v;
    }
    return n;
  }, [assignments.rows, cohortIds]);

  // Donor budget burn (cohort 3 scoped).
  const fundCommitted = useMemo(() => {
    let dutch = 0, sida = 0;
    for (const a of assignments.rows) {
      if (!cohortIds.has(a.company_id)) continue;
      const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v)) continue;
      const f = (a.fund_code || '').trim();
      if (/dutch/i.test(f) || f === '97060') dutch += v;
      else if (/sida/i.test(f) || f === '91763') sida += v;
    }
    return { dutch, sida };
  }, [assignments.rows, cohortIds]);

  const fundPaid = useMemo(() => {
    let dutch = 0, sida = 0;
    for (const p of payments.rows) {
      if (!cohortIds.has(p.company_id)) continue;
      if ((p.status || '').toLowerCase() !== 'paid') continue;
      const v = parseFloat(String(p.amount_usd || '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v)) continue;
      const f = (p.fund_code || '').trim();
      if (/dutch/i.test(f) || f === '97060') dutch += v;
      else if (/sida/i.test(f) || f === '91763') sida += v;
    }
    return { dutch, sida };
  }, [payments.rows, cohortIds]);

  // Alerts scoped to cohort 3.
  const alerts: Alert[] = useMemo(() => {
    const all = computeAlerts({
      prs: allPRs as unknown as Record<string, string>[],
      payments: payments.rows as unknown as Record<string, string>[],
      agreements: agreements.rows as unknown as Record<string, string>[],
      followups: [],
      confTracker: [],
      isAdmin: true,
    });
    return all.filter(a => {
      const id = a.id.split('-').slice(1).join('-');
      const pr = allPRs.find(r => r.pr_id === id);
      const pay = payments.rows.find(r => r.payment_id === id);
      const ag = agreements.rows.find(r => r.agreement_id === id);
      const ownerCompanyId = pr?.company_id || pay?.company_id || ag?.company_id || '';
      if (ownerCompanyId && !cohortIds.has(ownerCompanyId)) return false;
      return true;
    });
  }, [allPRs, payments.rows, agreements.rows, cohortIds]);

  // Recent activity for cohort 3.
  const cohortActivity = useMemo(() => {
    return activity.rows.filter(r => !r.company_id || cohortIds.has(r.company_id));
  }, [activity.rows, cohortIds]);

  // Open PR / pending payment quick stats.
  const openPRs = useMemo(
    () => allPRs.filter(p => ['Draft', 'Submitted', 'Under Review'].includes((p.status || '').trim())).length,
    [allPRs],
  );
  const pendingPayments = useMemo(
    () => payments.rows.filter(p => cohortIds.has(p.company_id) && (p.status || '').toLowerCase() === 'pending approval').length,
    [payments.rows, cohortIds],
  );
  const unsignedAgreements = useMemo(
    () => agreements.rows.filter(a => cohortIds.has(a.company_id) && (a.status || '').toLowerCase() !== 'executed').length,
    [agreements.rows, cohortIds],
  );

  // ─── render ───────────────────────────────────────────────────────
  const week = cohortWeek();
  const phase = detectPhase(week);
  const daysIn = Math.floor((Date.now() - COHORT_START.getTime()) / (1000 * 60 * 60 * 24));
  const totalDays = COHORT_LENGTH_WEEKS * 7;
  const daysRemaining = Math.max(0, totalDays - daysIn);
  const greeting = user?.email ? `Welcome, ${displayName(user.email).split(' ')[0]}` : 'Home';

  const maxLoad = Math.max(1, ...amRollup.map(a => a.companies));
  const maxPillar = Math.max(1, ...Object.values(pillarSpread));
  const dutchCap = COHORT3_BUDGET_TOTAL_USD.dutch;
  const sidaCap = COHORT3_BUDGET_TOTAL_USD.sida;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header card — cohort progress */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xs font-bold uppercase tracking-[0.15em] text-brand-red">Cohort 3 · {PHASE_LABEL[phase]}</div>
            <h1 className="mt-1 text-2xl font-extrabold text-navy-500 dark:text-white">{greeting}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Week {week} of {COHORT_LENGTH_WEEKS} · {daysRemaining} days remaining · started {COHORT_START.toISOString().slice(0, 10)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/companies" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-500 transition hover:border-brand-teal/50 dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100">
              <Building2 className="h-3.5 w-3.5" /> Companies
            </Link>
            <Link to="/selection" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-500 transition hover:border-brand-teal/50 dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100">
              <Award className="h-3.5 w-3.5" /> Selection
            </Link>
            <Link to="/alerts" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-500 transition hover:border-brand-red/50 dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100">
              <AlertTriangle className="h-3.5 w-3.5" /> Alerts <Badge tone={alerts.length > 0 ? 'red' : 'neutral'}>{alerts.length}</Badge>
            </Link>
          </div>
        </div>

        {/* Top KPIs */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Interviewed" value={interviewedSize} tone="amber" hint="from interviewed list" />
          <KpiTile label="Cohort 3" value={cohortSize} tone="navy" hint="canonical aliases" />
          <KpiTile label="Active" value={activeCount} tone="green" hint={`${withdrawnCount} withdrawn`} />
          <KpiTile label="Interventions" value={totalAssignments} tone="teal" hint={fmtUsd(totalCommitted) + ' committed'} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* AM workload */}
        <Card>
          <CardHeader title="Account Manager workload" subtitle={`${cohort.length} companies, ${totalAssignments} interventions, ${fmtUsd(totalCommitted)} committed.`} />
          {amRollup.length === 0 ? (
            <EmptyState title="No AM data yet" />
          ) : (
            <ul className="space-y-3">
              {amRollup.map(am => (
                <li key={am.email || 'unassigned'}>
                  <div className="flex items-center justify-between text-sm">
                    <Link to={`/my-hub?as=${encodeURIComponent(am.email)}`} className="font-bold text-navy-500 hover:text-brand-teal hover:underline dark:text-white">
                      {am.label}
                    </Link>
                    <span className="text-xs text-slate-500">
                      <span className="font-mono">{am.companies}</span> co · <span className="font-mono">{am.assignments}</span> int · <span className="font-mono">{fmtUsd(am.budget)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                    <div className="h-full rounded-full bg-brand-teal" style={{ width: `${pct(am.companies, maxLoad)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Pillar spread */}
        <Card>
          <CardHeader title="Intervention spread" subtitle={`${totalAssignments} interventions across the 3 pillars.`} />
          <ul className="space-y-2 text-sm">
            {Object.entries(pillarSpread).map(([label, count]) => (
              <li key={label}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-navy-500 dark:text-white">{label}</span>
                  <span className="font-mono text-xs text-slate-500">{count}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                  <div className="h-full rounded-full bg-brand-red" style={{ width: `${pct(count, maxPillar)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Donor budget */}
      <Card>
        <CardHeader title="Donor budget" subtitle="Committed (assignments) and paid (settled payments) against the 2026 cap." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DonorBar label="Dutch" committed={fundCommitted.dutch} paid={fundPaid.dutch} cap={dutchCap} tone="orange" />
          <DonorBar label="SIDA" committed={fundCommitted.sida} paid={fundPaid.sida} cap={sidaCap} tone="teal" />
        </div>
      </Card>

      {/* Things needing attention */}
      <Card>
        <CardHeader
          title="Things needing attention"
          subtitle={alerts.length === 0 ? 'Nothing flagged across the cohort right now.' : `${alerts.length} item${alerts.length === 1 ? '' : 's'} across PRs / payments / agreements.`}
          action={
            <Link to="/alerts" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-2xs font-bold uppercase tracking-wider text-brand-teal hover:bg-teal-50 dark:border-navy-700 dark:hover:bg-teal-900/30">
              See all <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <QuickStat to="/procurement" icon={<ClipboardList className="h-3.5 w-3.5" />} label="Open PRs" value={openPRs} />
          <QuickStat to="/payments" icon={<Wallet className="h-3.5 w-3.5" />} label="Pending payments" value={pendingPayments} />
          <QuickStat to="/docs" icon={<Briefcase className="h-3.5 w-3.5" />} label="Unsigned agreements" value={unsignedAgreements} />
          <QuickStat to="/conferences" icon={<Plane className="h-3.5 w-3.5" />} label="Cohort conferences" value="—" />
        </div>
        {alerts.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-navy-700">
            {alerts.slice(0, 8).map(a => (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <span className={`mt-1 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${a.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-navy-500 dark:text-white">{a.title}</div>
                  <div className="truncate text-xs text-slate-500">{a.detail}</div>
                </div>
                <Link to={a.href} className="text-xs text-brand-teal hover:underline">Open →</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Status funnel + recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cohort status" subtitle={`How the ${cohortSize}-company cohort is currently distributed.`} />
          <ul className="space-y-1.5 text-sm">
            {Object.entries(statusCount).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-32 truncate font-semibold">{s}</span>
                <Badge tone={statusTone(s) as Tone}>{n}</Badge>
                <div className="flex-1 rounded bg-slate-100 dark:bg-navy-700">
                  <div className="h-2 rounded bg-brand-teal" style={{ width: `${pct(n, cohortSize)}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-xs text-slate-500">{pct(n, cohortSize)}%</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Cohort 3 events — reviews, comments, assignments, locks." />
          {cohortActivity.length === 0 ? (
            <EmptyState icon={<Activity className="h-5 w-5" />} title="No activity yet" />
          ) : (
            <ActivityTimeline rows={cohortActivity} limit={50} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function KpiTile({ label, value, tone, hint }: { label: string; value: number | string; tone: 'navy' | 'teal' | 'green' | 'amber' | 'red'; hint?: string }) {
  const fillByTone: Record<string, string> = {
    navy: 'bg-navy-500 text-white dark:bg-navy-700',
    teal: 'bg-brand-teal/10 text-brand-teal',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    red: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  };
  return (
    <div className={`rounded-lg p-3 ${fillByTone[tone]}`}>
      <div className="text-2xs font-bold uppercase tracking-[0.1em] opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold">{value}</div>
      {hint && <div className="mt-0.5 text-2xs opacity-70">{hint}</div>}
    </div>
  );
}

function DonorBar({ label, committed, paid, cap, tone }: { label: string; committed: number; paid: number; cap: number; tone: 'orange' | 'teal' }) {
  const committedPct = pct(committed, cap);
  const paidPct = pct(paid, cap);
  const fill = tone === 'orange' ? 'bg-brand-orange' : 'bg-brand-teal';
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold text-navy-500 dark:text-white">{label}</span>
        <span className="text-xs text-slate-500">{fmtUsd(committed)} of {fmtUsd(cap)} <span className="ml-1 font-mono">({committedPct}%)</span></span>
      </div>
      <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
        {/* paid bar (darker) */}
        <div className="relative h-full">
          <div className={`absolute left-0 top-0 h-full rounded-full opacity-60 ${fill}`} style={{ width: `${committedPct}%` }} />
          <div className={`absolute left-0 top-0 h-full rounded-full ${fill}`} style={{ width: `${paidPct}%` }} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-2xs uppercase tracking-wider text-slate-500">
        <span>● Paid {fmtUsd(paid)}</span>
        <span className="opacity-60">● Committed {fmtUsd(committed)}</span>
      </div>
    </div>
  );
}

function QuickStat({ to, icon, label, value }: { to: string; icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-teal dark:border-navy-700 dark:bg-navy-700">
      <div className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-0.5 text-xl font-extrabold text-navy-500 dark:text-white">{value}</div>
    </Link>
  );
}
