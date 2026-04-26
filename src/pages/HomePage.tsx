import { useMemo } from 'react';
// PMFocus uses a local useMemo too, so it's imported via the same statement.
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calendar,
  ClipboardList,
  ExternalLink,
  FileText,
  KanbanSquare,
  MessageCircle,
  Plane,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../services/auth';
import { Badge, Card, CardHeader, EmptyState, statusTone } from '../lib/ui';
import { useSheetDoc } from '../lib/two-way-sync';
import { getSheetId, getTab } from '../config/sheets';
import { displayName, getTier } from '../config/team';
import { INTERVIEWED_RAW, isInterviewed, INTERVIEWED_NAMES } from './companies/interviewedSource';
import type { Review } from './companies/reviewTypes';

type Row = Record<string, string>;

type Master = Row & {
  company_id?: string;
  company_name?: string;
  status?: string;
  fund_code?: string;
  sector?: string;
};

type Assignment = Row & {
  assignment_id?: string;
  company_id?: string;
  intervention_type?: string;
  sub_intervention?: string;
  owner_email?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  budget_usd?: string;
};

type PR = Row & {
  pr_id?: string;
  company_id?: string;
  activity?: string;
  requester_email?: string;
  status?: string;
  threshold_class?: string;
  total_cost_usd?: string;
  target_award_date?: string;
  pr_deadline?: string;
};

type Payment = Row & {
  payment_id?: string;
  company_id?: string;
  payee_name?: string;
  amount_usd?: string;
  status?: string;
  fund_code?: string;
  payment_date?: string;
};

type ConfRow = Row & {
  conference_id?: string;
  company_id?: string;
  decision?: string;
  travel_dates?: string;
  signatory_name?: string;
};

type DocRow = Row & {
  agreement_id?: string;
  company_id?: string;
  agreement_type?: string;
  status?: string;
  signed_date?: string;
};

type TimelineEvent = {
  when: string;
  who?: string;
  kind: string;
  title: string;
  subtitle?: string;
  to?: string;
  tone?: 'red' | 'teal' | 'orange' | 'amber' | 'green' | 'neutral';
};

type ModuleTone = 'red' | 'teal' | 'orange' | 'indigo';

type CohortPhase = 'selection' | 'onboarding' | 'execution' | 'closeout';

const PHASE_LABEL: Record<CohortPhase, string> = {
  selection: 'Selection & Review',
  onboarding: 'Onboarding',
  execution: 'Execution',
  closeout: 'Closeout & Reporting',
};

const PHASE_DESCRIPTION: Record<CohortPhase, string> = {
  selection: 'Going through interviewed companies, deciding the final cohort and the intervention pack.',
  onboarding: 'Onboarding selected companies — kickoffs, agreements, first interventions.',
  execution: 'Interventions in flight. Procurement, payments, and conferences active.',
  closeout: 'Wrapping up the cohort — completion, reporting, and graduation.',
};

type ModuleDef = {
  to: string;
  label: string;
  kicker: string;
  icon: typeof Building2;
  desc: string;
  tone: ModuleTone;
  feat?: boolean;
};

const COHORT_START = new Date('2026-02-24');
const COHORT_TOTAL_WEEKS = 24;

function cohortWeek(): number {
  const diff = Date.now() - COHORT_START.getTime();
  const w = Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
  return Math.max(1, Math.min(COHORT_TOTAL_WEEKS, w));
}

export function HomePage() {
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || 'Team';
  const tier = user?.email ? getTier(user.email) : 'member';
  const greeting = greetingForHour();
  const week = cohortWeek();

  const companies = useSheetDoc<Master>(
    getSheetId('companies') || null,
    getTab('companies', 'companies'),
    'company_id',
    { userEmail: user?.email }
  );
  const assignments = useSheetDoc<Assignment>(
    getSheetId('companies') || null,
    getTab('companies', 'assignments'),
    'assignment_id',
    { userEmail: user?.email }
  );
  const payments = useSheetDoc<Payment>(
    getSheetId('payments') || null,
    getTab('payments', 'payments'),
    'payment_id',
    { userEmail: user?.email }
  );
  const q1 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q1'), 'pr_id');
  const q2 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q2'), 'pr_id');
  const q3 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q3'), 'pr_id');
  const q4 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q4'), 'pr_id');
  const confs = useSheetDoc<ConfRow>(
    getSheetId('conferences') || null,
    getTab('conferences', 'tracker'),
    'conference_id',
    { userEmail: user?.email }
  );
  const docs = useSheetDoc<DocRow>(
    getSheetId('docs') || null,
    getTab('docs', 'agreements'),
    'agreement_id',
    { userEmail: user?.email }
  );
  // Review queue — peek at the post-interview review workflow so the home
  // page surfaces "X of 52 companies reviewed" + a CTA into the Review tab.
  const reviewsDoc = useSheetDoc<Review>(
    getSheetId('companies') || null,
    getTab('companies', 'reviews'),
    'review_id',
    { userEmail: user?.email }
  );

  const allPRs: PR[] = useMemo(
    () => [...q1.rows, ...q2.rows, ...q3.rows, ...q4.rows],
    [q1.rows, q2.rows, q3.rows, q4.rows]
  );

  const companyNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of companies.rows) {
      if (c.company_id) m[c.company_id] = c.company_name || c.company_id;
    }
    return m;
  }, [companies.rows]);

  const mine = useMemo(() => {
    if (!user?.email) return { companies: [] as Master[], assignments: [], prs: [], payments: [] };
    const email = user.email.toLowerCase();
    const myAssignments = assignments.rows.filter(a => a.owner_email?.toLowerCase() === email);
    const myCompanyIds = new Set(myAssignments.map(a => a.company_id).filter(Boolean));
    const myCompanies = companies.rows.filter(c => c.company_id && myCompanyIds.has(c.company_id));
    const myPRs = allPRs.filter(p => p.requester_email?.toLowerCase() === email);
    const myPayments = payments.rows.filter(p =>
      p.company_id ? myCompanyIds.has(p.company_id) : false
    );
    return { companies: myCompanies, assignments: myAssignments, prs: myPRs, payments: myPayments };
  }, [user?.email, assignments.rows, companies.rows, allPRs, payments.rows]);

  const scope = tier === 'profile_manager' ? 'personal' : 'portfolio';

  const kpis = useMemo(() => {
    const source = scope === 'personal'
      ? { companies: mine.companies, assignments: mine.assignments, prs: mine.prs, payments: mine.payments }
      : { companies: companies.rows, assignments: assignments.rows, prs: allPRs, payments: payments.rows };

    const activeCompanies = source.companies.filter(c =>
      ['Active', 'Onboarded', 'Selected'].includes(c.status || '')
    ).length;
    const activeAssignments = source.assignments.filter(a =>
      ['Planned', 'In Progress'].includes(a.status || '')
    ).length;
    const openPRs = source.prs.filter(p =>
      !['Awarded', 'Delivered', 'Cancelled'].includes(p.status || '')
    ).length;
    const pendingPayments = source.payments.filter(p =>
      ['Pending Approval', 'Approved', 'Sent to Finance'].includes(p.status || '')
    );
    const pendingPaymentsTotal = pendingPayments.reduce(
      (s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0
    );
    const prTotal = source.prs.reduce(
      (s, p) => s + (parseFloat(p.total_cost_usd || '0') || 0), 0
    );

    return {
      activeCompanies,
      activeAssignments,
      openPRs,
      pendingPaymentsCount: pendingPayments.length,
      pendingPaymentsTotal,
      prTotal,
      companiesTotal: source.companies.length,
    };
  }, [scope, mine, companies.rows, assignments.rows, allPRs, payments.rows]);

  const queue = useMemo(() => {
    const today = new Date();
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);
    const items: {
      key: string;
      tone: 'amber' | 'red' | 'teal';
      icon: React.ComponentType<{ className?: string }>;
      title: string;
      subtitle: string;
      to: string;
      when?: string;
    }[] = [];

    const prSource = scope === 'personal' ? mine.prs : allPRs;
    for (const p of prSource) {
      if (!p.pr_deadline) continue;
      if (['Awarded', 'Delivered', 'Cancelled'].includes(p.status || '')) continue;
      const d = new Date(p.pr_deadline);
      if (isNaN(d.getTime())) continue;
      if (d < today) {
        items.push({
          key: `pr-overdue-${p.pr_id}`,
          tone: 'red',
          icon: AlertTriangle,
          title: `${p.pr_id || 'PR'} overdue`,
          subtitle: `${p.activity || 'Activity'} · ${p.threshold_class || ''}`,
          to: '/procurement',
          when: p.pr_deadline,
        });
      } else if (d <= in7) {
        items.push({
          key: `pr-soon-${p.pr_id}`,
          tone: 'amber',
          icon: ClipboardList,
          title: `${p.pr_id || 'PR'} due ${formatShortDate(d)}`,
          subtitle: `${p.activity || 'Activity'} · ${p.threshold_class || ''}`,
          to: '/procurement',
          when: p.pr_deadline,
        });
      }
    }

    const paySource = scope === 'personal' ? mine.payments : payments.rows;
    for (const p of paySource) {
      if (p.status === 'Pending Approval') {
        items.push({
          key: `pay-${p.payment_id}`,
          tone: 'teal',
          icon: Wallet,
          title: `${p.payee_name || 'Payment'} awaits approval`,
          subtitle: `$${formatAmount(p.amount_usd)} · ${companyNameById[p.company_id || ''] || p.company_id || 'Unlinked'}`,
          to: '/payments',
        });
      }
    }

    const order: Record<string, number> = { red: 0, amber: 1, teal: 2 };
    items.sort((a, b) => (order[a.tone] - order[b.tone]) || (a.when || '').localeCompare(b.when || ''));
    return items.slice(0, 10);
  }, [scope, mine.prs, mine.payments, allPRs, payments.rows, companyNameById]);

  const upcomingConfs = useMemo(() => {
    return confs.rows
      .filter(c => ['Nominated', 'Committed'].includes(c.decision || ''))
      .slice(0, 6);
  }, [confs.rows]);

  // Review queue — companies in the interview pool that need team review,
  // and how many have been reviewed already (any reviewer, plus this user).
  const reviewQueue = useMemo(() => {
    const total = INTERVIEWED_RAW.length;
    // Count interviewed companies (by name match) that have at least one review.
    const reviewedCompanyIds = new Set<string>();
    const myReviewedCompanyIds = new Set<string>();
    const lower = (user?.email || '').toLowerCase();
    for (const r of reviewsDoc.rows) {
      if (!r.decision || !r.company_id) continue;
      reviewedCompanyIds.add(r.company_id);
      if (r.reviewer_email?.toLowerCase() === lower) myReviewedCompanyIds.add(r.company_id);
    }
    // Map review company_id back to company name via the master sheet so
    // we count only those that match the interviewed list.
    let reviewed = 0;
    let mine = 0;
    for (const c of companies.rows) {
      if (!c.company_id || !c.company_name) continue;
      if (!isInterviewed(c.company_name, INTERVIEWED_NAMES)) continue;
      if (reviewedCompanyIds.has(c.company_id)) reviewed += 1;
      if (myReviewedCompanyIds.has(c.company_id)) mine += 1;
    }
    return { total, reviewed, mine };
  }, [reviewsDoc.rows, companies.rows, user?.email]);

  // Cohort progress funnel — how many post-interview companies sit in each
  // status bucket. Drives the cohort-progress strip in the hero.
  const cohortProgress = useMemo(() => {
    const buckets = { Interviewed: 0, Reviewing: 0, Recommended: 0, Selected: 0, Onboarded: 0, Active: 0, Graduated: 0 };
    const interviewedSet = new Set(INTERVIEWED_RAW.map(n => n.toLowerCase()));
    for (const c of companies.rows) {
      const isPost = isInterviewed(c.company_name || '', INTERVIEWED_NAMES) || interviewedSet.has((c.company_name || '').toLowerCase());
      if (!isPost) continue;
      const s = (c.status || 'Interviewed').trim();
      if (s in buckets) buckets[s as keyof typeof buckets] += 1;
      else buckets.Interviewed += 1;
    }
    return buckets;
  }, [companies.rows]);

  // Detect the phase the cohort is in. The home page's primary CTA pivots
  // based on this — no point showing a 'Continue review' card when the
  // team has finished review and moved into onboarding/execution.
  const phase: CohortPhase = useMemo(() => {
    const earlySelection = (cohortProgress.Interviewed || 0) + (cohortProgress.Reviewing || 0) + (cohortProgress.Recommended || 0);
    const onboarding = (cohortProgress.Selected || 0) + (cohortProgress.Onboarded || 0);
    const execution = (cohortProgress.Active || 0);
    const closeout = (cohortProgress.Graduated || 0);
    const max = Math.max(earlySelection, onboarding, execution, closeout);
    if (max === 0) return 'selection';
    if (max === earlySelection) return 'selection';
    if (max === onboarding) return 'onboarding';
    if (max === execution) return 'execution';
    return 'closeout';
  }, [cohortProgress]);

  // Per-company review summary — drives "needs my review" and "divergent"
  // signals for both PM and admin focus blocks.
  const reviewsByCompany = useMemo(() => {
    const m = new Map<string, Review[]>();
    for (const r of reviewsDoc.rows) {
      if (!r.company_id) continue;
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [reviewsDoc.rows]);

  // Workload distribution: count of companies per Profile Manager. Drives
  // the admin focus block.
  const pmWorkload = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of companies.rows) {
      const pm = (c.profile_manager_email || '').toLowerCase().trim();
      if (!pm) continue;
      m.set(pm, (m.get(pm) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [companies.rows]);

  // Bottleneck signals — companies with no PM, divergent reviews, etc.
  const bottlenecks = useMemo(() => {
    const interviewedCompanies = companies.rows.filter(c =>
      isInterviewed(c.company_name || '', INTERVIEWED_NAMES)
    );
    const unassigned = interviewedCompanies.filter(c => !c.profile_manager_email).length;
    let divergent = 0;
    let needsAnyReview = 0;
    for (const c of interviewedCompanies) {
      if (!c.company_id) continue;
      const rs = reviewsByCompany.get(c.company_id) || [];
      const decisionsActual = rs.map(r => r.decision).filter(Boolean);
      if (decisionsActual.length === 0) needsAnyReview += 1;
      const distinctDecisions = new Set(decisionsActual);
      if (distinctDecisions.size > 1) divergent += 1;
    }
    return { unassigned, divergent, needsAnyReview };
  }, [companies.rows, reviewsByCompany]);

  const activity = useMemo(() => {
    const events: TimelineEvent[] = [];
    for (const a of assignments.rows) {
      if (!a.updated_at) continue;
      events.push({
        when: a.updated_at, who: a.updated_by, kind: 'Intervention',
        title: `${a.intervention_type || 'Assignment'} ${a.status ? '· ' + a.status : ''}`,
        subtitle: companyNameById[a.company_id || ''] || a.company_id,
        to: a.company_id ? `/companies/${a.company_id}` : '/companies',
        tone: 'red',
      });
    }
    for (const p of allPRs) {
      if (!p.updated_at) continue;
      events.push({
        when: p.updated_at, who: p.updated_by, kind: 'PR',
        title: `${p.pr_id || 'PR'} · ${p.status || 'Draft'}`,
        subtitle: `${p.activity || ''} · $${formatAmount(p.total_cost_usd)}`,
        to: '/procurement', tone: 'teal',
      });
    }
    for (const p of payments.rows) {
      if (!p.updated_at) continue;
      events.push({
        when: p.updated_at, who: p.updated_by, kind: 'Payment',
        title: `${p.payee_name || 'Payment'} · ${p.status || '—'}`,
        subtitle: `$${formatAmount(p.amount_usd)}`,
        to: '/payments', tone: 'orange',
      });
    }
    for (const d of docs.rows) {
      if (!d.updated_at) continue;
      events.push({
        when: d.updated_at, who: d.updated_by, kind: 'Agreement',
        title: `${d.agreement_type || 'Doc'} · ${d.status || '—'}`,
        subtitle: companyNameById[d.company_id || ''] || d.company_id,
        to: '/docs', tone: 'neutral',
      });
    }
    for (const c of confs.rows) {
      if (!c.updated_at) continue;
      events.push({
        when: c.updated_at, who: c.updated_by, kind: 'Conference',
        title: `${c.decision || 'Nomination'} · ${c.conference_id || ''}`,
        subtitle: companyNameById[c.company_id || ''] || c.company_id,
        to: '/conferences', tone: 'amber',
      });
    }
    events.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
    return events.slice(0, 12);
  }, [assignments.rows, allPRs, payments.rows, docs.rows, confs.rows, companyNameById]);

  const anyLoading =
    companies.loading || assignments.loading || payments.loading ||
    q1.loading || confs.loading || docs.loading;
  const syncLabel = anyLoading ? 'Syncing' : 'Live';

  const modules: ModuleDef[] = useMemo(() => {
    const totalCompanies = companies.rows.length;
    const openPRs = kpis.openPRs;
    const openPayments = kpis.pendingPaymentsCount;
    const openAgreements = docs.rows.filter(d => !['Executed', 'Countersigned'].includes(d.status || '')).length;
    const liveInterventions = kpis.activeAssignments;
    return [
      { to: '/companies', label: 'Companies', kicker: 'Core · most used', icon: Building2,
        desc: 'Cohort 3 master and intervention assignments.',
        tone: 'red', feat: true,
        meta: `${totalCompanies} records`,
      } as ModuleDef & { meta: string },
      { to: '/procurement', label: 'Procurement', kicker: 'Finance', icon: ClipboardList,
        desc: 'Quarterly PRs with Mercy Corps threshold logic.',
        tone: 'teal',
        meta: `${openPRs} open`,
      } as ModuleDef & { meta: string },
      { to: '/payments', label: 'Payments', kicker: 'Finance', icon: Wallet,
        desc: 'Advisors, vendors, stipends — approval workflow.',
        tone: 'orange',
        meta: `${openPayments} in review`,
      } as ModuleDef & { meta: string },
      { to: '/conferences', label: 'Conferences', kicker: 'Programs', icon: Plane,
        desc: 'Scoring, nominations, commitment letters, travel.',
        tone: 'teal',
        meta: `${upcomingConfs.length} upcoming`,
      } as ModuleDef & { meta: string },
      { to: '/docs', label: 'Docs & agreements', kicker: 'Documents', icon: FileText,
        desc: 'MJPSAs, commitment letters, deliverables.',
        tone: 'indigo',
        meta: `${openAgreements} open`,
      } as ModuleDef & { meta: string },
      { to: '/reports', label: 'Reports', kicker: 'Reporting', icon: TrendingUp,
        desc: 'Cross-module aggregates and quarterly exports.',
        tone: 'orange',
        meta: `${liveInterventions} live`,
      } as ModuleDef & { meta: string },
    ];
  }, [companies.rows.length, kpis.openPRs, kpis.pendingPaymentsCount, kpis.activeAssignments, docs.rows, upcomingConfs.length]);

  const linkedTools = [
    { to: '/link/selection', label: 'Selection tool', kicker: 'Selection', desc: 'Score and shortlist 2026 applicants.', meta: '412 loaded' },
    { to: '/link/advisors', label: 'Advisor pipeline', kicker: 'Advisors', desc: 'Expert pool, qualification & matching.', meta: '247 advisors' },
    { to: '/link/leaves', label: 'Leaves tracker', kicker: 'HR', desc: 'Team time-off, CL hours, approvals.', meta: 'Live' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Cohort 3 · Week {week} of {COHORT_TOTAL_WEEKS}</span>
          <PhaseChip phase={phase} />
        </div>
        <h1 className="display-h1 dark:text-white">
          {greeting}, {firstName}.
        </h1>
        <p className="max-w-[720px] text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
          {PHASE_DESCRIPTION[phase]}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge tone={tier === 'leadership' ? 'red' : tier === 'profile_manager' ? 'teal' : 'neutral'}>
            {tier === 'leadership' ? 'Leadership' : tier === 'profile_manager' ? 'Profile Manager' : 'Member'}
          </Badge>
          <Link
            to="/board"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-500 transition hover:border-brand-teal/50 hover:text-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
          >
            <KanbanSquare className="h-3.5 w-3.5" /> Workboard
          </Link>
          {tier === 'profile_manager' && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              · {mine.companies.length} companies · {mine.assignments.length} interventions
            </span>
          )}
        </div>
      </header>

      {/* ── Phase-aware hero ── */}
      {phase === 'selection' && reviewQueue.total > 0 && (
        <ReviewQueueCard
          total={reviewQueue.total}
          reviewed={reviewQueue.reviewed}
          mine={reviewQueue.mine}
        />
      )}
      {phase === 'onboarding' && (
        <OnboardingHero
          selectedCount={cohortProgress.Selected || 0}
          onboardedCount={cohortProgress.Onboarded || 0}
          openAgreements={docs.rows.filter(d => !['Executed', 'Countersigned'].includes(d.status || '')).length}
        />
      )}
      {phase === 'execution' && (
        <ExecutionHero
          activeCount={cohortProgress.Active || 0}
          activeInterventions={kpis.activeAssignments}
          openPRs={kpis.openPRs}
          pendingPayments={kpis.pendingPaymentsCount}
        />
      )}
      {phase === 'closeout' && (
        <ClosetHero graduatedCount={cohortProgress.Graduated || 0} />
      )}

      {/* ── Cohort progress funnel ── */}
      <CohortProgressStrip buckets={cohortProgress} total={INTERVIEWED_RAW.length} />

      {/* ── Role-specific focus block ── */}
      {tier === 'leadership' && (
        <AdminFocus
          bottlenecks={bottlenecks}
          pmWorkload={pmWorkload}
          kpis={kpis}
        />
      )}
      {tier === 'profile_manager' && (
        <PMFocus
          mine={mine}
          interviewedSet={INTERVIEWED_NAMES}
          reviewsByCompany={reviewsByCompany}
          userEmail={user?.email || ''}
        />
      )}
      {tier === 'member' && (
        <MemberFocus
          reviewQueue={reviewQueue}
          activity={activity.filter(e => e.who?.toLowerCase() === (user?.email || '').toLowerCase()).slice(0, 5)}
        />
      )}

      <section
        aria-label="Summary"
        className="grid grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-card dark:border-navy-700 dark:bg-navy-600 md:grid-cols-4"
      >
        <SummaryCell
          label={scope === 'personal' ? 'My Companies' : 'Companies'}
          value={kpis.activeCompanies}
          sub={`${kpis.companiesTotal} total`}
        />
        <SummaryCell
          label="PRs to review"
          value={kpis.openPRs}
          sub={kpis.openPRs > 0 ? 'Awaiting approval' : 'All clear'}
          accent={kpis.openPRs > 0}
        />
        <SummaryCell
          label="Payments"
          value={kpis.pendingPaymentsCount}
          sub={`$${formatAmount(kpis.pendingPaymentsTotal)} pending`}
        />
        <SummaryCell
          label="Last synced"
          valueText={syncLabel}
          sub="Google Sheets live"
        />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold tracking-tight text-navy-500 dark:text-white">Modules</h2>
          <div className="text-xs text-slate-400 dark:text-slate-500">
            <span className="font-bold text-slate-500 dark:text-slate-300">{modules.length}</span> active · 3 linked tools
          </div>
        </div>
        <div className="stagger grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const def = m as ModuleDef & { meta: string };
            return (
              <ModuleCard key={def.to} def={def} />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold tracking-tight text-navy-500 dark:text-white">Linked tools</h2>
          <div className="text-xs text-slate-400 dark:text-slate-500">Open in a new tab</div>
        </div>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {linkedTools.map(t => (
            <Link key={t.to} to={t.to} className="group block animate-fade-in-up">
              <div className="relative flex min-h-[150px] flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-teal/40 hover:shadow-card-lg dark:border-navy-700 dark:bg-navy-600">
                <div className="mb-1 flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />
                  <span className="text-2xs font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">{t.kicker}</span>
                </div>
                <h3 className="text-[17px] font-extrabold tracking-tight text-navy-500 dark:text-white">{t.label}</h3>
                <p className="text-[13px] leading-[1.5] text-slate-500 dark:text-slate-400">{t.desc}</p>
                <div className="mt-auto flex items-center gap-2 pt-3.5 text-[11.5px] text-slate-400 dark:text-slate-500">
                  <span className="inline-flex items-center gap-1 font-bold text-brand-teal">
                    <ExternalLink className="h-3 w-3" /> External
                  </span>
                  <span>{t.meta}</span>
                </div>
                <ArrowUpRight className="absolute right-4 top-4 h-[18px] w-[18px] -translate-x-1 text-slate-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-brand-teal group-hover:opacity-100" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              overline="Needs action"
              title={<span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-brand-orange" /> Attention queue</span>}
              subtitle="Overdue PRs, upcoming deadlines, approvals to action"
              action={<Link to="/procurement" className="text-xs font-semibold text-brand-teal hover:underline">All PRs</Link>}
            />
            {queue.length === 0 ? (
              <EmptyState title="Nothing urgent" description="No deadlines in the next 7 days and no payments awaiting approval." />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-navy-700">
                {queue.map(item => {
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <Link
                        to={item.to}
                        className="flex items-center gap-3 py-3 transition hover:bg-slate-50 dark:hover:bg-navy-700"
                      >
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneBg(item.tone)}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-navy-500 dark:text-white">{item.title}</div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</div>
                        </div>
                        <Badge tone={item.tone}>{item.tone === 'red' ? 'Overdue' : item.tone === 'amber' ? 'Due soon' : 'Review'}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {tier === 'profile_manager' && mine.companies.length > 0 && (
            <Card>
              <CardHeader
                overline="My portfolio"
                title="Companies I own"
                subtitle={`${mine.companies.length} companies assigned via interventions`}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mine.companies.slice(0, 8).map(c => {
                  const activeCount = mine.assignments.filter(
                    a => a.company_id === c.company_id && ['Planned', 'In Progress'].includes(a.status || '')
                  ).length;
                  return (
                    <Link
                      key={c.company_id}
                      to={`/companies/${c.company_id}`}
                      className="rounded-xl border border-slate-200 p-3 transition hover:border-brand-teal hover:shadow-sm dark:border-navy-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-navy-500 dark:text-white">{c.company_name || c.company_id}</div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {c.sector || '—'} · {activeCount} active
                          </div>
                        </div>
                        {c.status && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              overline="Travel pipeline"
              title={<span className="inline-flex items-center gap-2"><Plane className="h-4 w-4 text-brand-teal" /> Upcoming conferences</span>}
              subtitle="Committed or nominated — travel workflows"
              action={<Link to="/conferences" className="text-xs font-semibold text-brand-teal hover:underline">All conferences</Link>}
            />
            {upcomingConfs.length === 0 ? (
              <EmptyState title="No nominations yet" description="Conference & travel decisions will appear here." />
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {upcomingConfs.map(c => (
                  <Link
                    key={`${c.conference_id}-${c.company_id}`}
                    to="/conferences"
                    className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-brand-teal dark:border-navy-700"
                  >
                    <Calendar className="h-4 w-4 text-brand-teal" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-navy-500 dark:text-white">{c.conference_id}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {companyNameById[c.company_id || ''] || c.company_id} · {c.travel_dates || 'TBD'}
                      </div>
                    </div>
                    {c.decision && <Badge tone={statusTone(c.decision)}>{c.decision}</Badge>}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader
            overline="Live"
            title={<span className="inline-flex items-center gap-2"><Activity className="h-4 w-4 text-brand-orange" /> Recent activity</span>}
            subtitle="Across all modules"
          />
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" description="Edits across modules will show here." />
          ) : (
            <ul className="space-y-3">
              {activity.map((e, i) => (
                <li key={i}>
                  <Link to={e.to || '#'} className="block rounded-lg p-2 transition hover:bg-slate-50 dark:hover:bg-navy-700">
                    <div className="flex items-center gap-2">
                      <Badge tone={e.tone || 'neutral'}>{e.kind}</Badge>
                      <span className="text-xs text-slate-400">{relativeTime(e.when)}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-navy-500 dark:text-white">{e.title}</div>
                    {e.subtitle && (
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{e.subtitle}</div>
                    )}
                    {e.who && (
                      <div className="mt-0.5 text-xs text-slate-400">by {displayName(e.who)}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  valueText,
  sub,
  accent = false,
}: {
  label: string;
  value?: number;
  valueText?: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="border-r border-slate-200 p-[18px] last:border-r-0 dark:border-navy-700 md:last:border-r-0">
      <div className="mb-2 text-2xs font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div
        className={`tabular text-[26px] font-extrabold leading-none tracking-tight ${
          accent ? 'text-brand-red' : 'text-navy-500 dark:text-white'
        } ${valueText ? '!text-[20px]' : ''}`}
      >
        {valueText ?? value}
      </div>
      {sub && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <span
            className={`h-[5px] w-[5px] rounded-full ${
              accent ? 'bg-brand-red' : 'bg-brand-teal'
            }`}
          />
          {sub}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ def }: { def: ModuleDef & { meta: string } }) {
  const toneMap: Record<ModuleTone, { dot: string; kicker: string }> = {
    red: { dot: 'bg-brand-red', kicker: 'text-brand-red' },
    teal: { dot: 'bg-brand-teal', kicker: 'text-brand-teal' },
    orange: { dot: 'bg-brand-orange', kicker: 'text-brand-orange' },
    indigo: { dot: 'bg-indigo-500', kicker: 'text-indigo-500' },
  };
  const t = toneMap[def.tone];
  const feat = def.feat;
  return (
    <Link to={def.to} className="group block animate-fade-in-up">
      <div
        className={`relative flex min-h-[160px] flex-col gap-1 rounded-2xl border p-5 shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-lg ${
          feat
            ? 'border-brand-red/30 bg-[linear-gradient(180deg,rgba(222,99,54,0.05),transparent)] hover:border-brand-red/50 dark:bg-[linear-gradient(180deg,rgba(222,99,54,0.08),transparent)]'
            : 'border-slate-200 bg-white hover:border-brand-red/30 dark:border-navy-700 dark:bg-navy-600'
        }`}
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className={`h-1.5 w-1.5 rounded-full ${feat ? 'bg-brand-red' : t.dot}`} />
          <span
            className={`text-2xs font-extrabold uppercase tracking-[0.1em] ${
              feat ? 'text-brand-red' : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {def.kicker}
          </span>
        </div>
        <h3 className="text-[17px] font-extrabold tracking-tight text-navy-500 dark:text-white">
          {def.label}
        </h3>
        <p className="text-[13px] leading-[1.5] text-slate-500 dark:text-slate-400">{def.desc}</p>
        <div className="mt-auto flex items-center gap-2 pt-3.5 text-[11.5px] text-slate-400 dark:text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-navy-700 dark:text-slate-200">
            {def.meta}
          </span>
        </div>
        <ArrowUpRight
          className={`absolute right-4 top-4 h-[18px] w-[18px] -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 ${
            feat ? 'text-brand-red' : 'text-slate-300 group-hover:text-brand-red'
          }`}
        />
      </div>
    </Link>
  );
}

function toneBg(tone: string) {
  switch (tone) {
    case 'red': return 'bg-brand-red/10 text-brand-red';
    case 'teal': return 'bg-brand-teal/10 text-brand-teal';
    case 'orange': return 'bg-brand-orange/10 text-brand-orange';
    case 'amber': return 'bg-amber-100 text-amber-700';
    case 'green': return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-slate-100 text-slate-600 dark:bg-navy-700 dark:text-slate-300';
  }
}

function formatAmount(v: string | number | undefined): string {
  const n = typeof v === 'number' ? v : parseFloat((v || '0').toString().replace(/[^\d.-]/g, ''));
  if (isNaN(n)) return '0';
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greetingForHour() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Review queue card — the active post-interview workstream surfaced at the top
// of the home page. Shows progress, the reviewer's own count, and a CTA.
function ReviewQueueCard({ total, reviewed, mine }: { total: number; reviewed: number; mine: number }) {
  const teamPct = Math.round((reviewed / Math.max(1, total)) * 100);
  const myPct = Math.round((mine / Math.max(1, total)) * 100);
  const remaining = Math.max(0, total - mine);
  return (
    <Link
      to="/companies"
      className="group block animate-fade-in-up"
    >
      <div className="relative overflow-hidden rounded-2xl border border-brand-teal/30 bg-gradient-to-br from-brand-teal/5 via-white to-emerald-50/40 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-teal/60 hover:shadow-card-lg dark:border-brand-teal/40 dark:from-brand-teal/10 dark:via-navy-600 dark:to-navy-700">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-teal text-white shadow">
              <MessageCircle className="h-6 w-6" />
            </div>
            <div>
              <div className="text-2xs font-extrabold uppercase tracking-[0.1em] text-brand-teal">Active workstream</div>
              <h2 className="mt-0.5 text-xl font-extrabold text-navy-500 dark:text-white">
                Post-interview review
              </h2>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                {remaining > 0
                  ? `You have ${remaining} compan${remaining === 1 ? 'y' : 'ies'} left to review for Cohort 3.`
                  : 'You\'ve reviewed every interviewed company. Nice.'}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 self-center rounded-lg bg-brand-teal px-3 py-2 text-sm font-bold text-white transition-transform group-hover:translate-x-0.5">
            Continue review <ArrowRight className="h-4 w-4" />
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-navy-700 dark:bg-navy-700">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Companies</div>
            <div className="mt-0.5 text-2xl font-extrabold text-navy-500 dark:text-white">{total}</div>
            <div className="text-[11px] text-slate-500">interviewed</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-navy-700 dark:bg-navy-700">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Team has reviewed</div>
            <div className="mt-0.5 text-2xl font-extrabold text-brand-teal">{reviewed}</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
              <div className="h-full bg-brand-teal" style={{ width: `${teamPct}%` }} />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-navy-700 dark:bg-navy-700">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">You</div>
            <div className="mt-0.5 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{mine}</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
              <div className="h-full bg-emerald-500" style={{ width: `${myPct}%` }} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Cohort progress strip — funnel from Interviewed to Active for the
// post-interview cohort. Each segment shows the count and a width
// proportional to its share of the total reviewed cohort.
function CohortProgressStrip({ buckets, total }: { buckets: Record<string, number>; total: number }) {
  const stages: Array<{ key: keyof typeof buckets | string; label: string; tone: string }> = [
    { key: 'Interviewed', label: 'Interviewed', tone: 'bg-slate-300 dark:bg-slate-600' },
    { key: 'Reviewing', label: 'Reviewing', tone: 'bg-amber-400' },
    { key: 'Recommended', label: 'Recommended', tone: 'bg-orange-400' },
    { key: 'Selected', label: 'Selected', tone: 'bg-brand-teal' },
    { key: 'Onboarded', label: 'Onboarded', tone: 'bg-emerald-500' },
    { key: 'Active', label: 'Active', tone: 'bg-emerald-600' },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-navy-700 dark:bg-navy-600">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-navy-500 dark:text-white">Cohort 3 progress</h3>
        <span className="text-[11px] text-slate-500">{total} interviewed companies</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {stages.map(s => {
          const v = buckets[s.key as string] || 0;
          const pct = Math.round((v / Math.max(1, total)) * 100);
          return (
            <div key={s.key as string} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 dark:border-navy-700 dark:bg-navy-700/40">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{s.label}</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-1">
                <span className="text-lg font-extrabold text-navy-500 dark:text-white">{v}</span>
                <span className="text-[10px] text-slate-400">{pct}%</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-navy-800">
                <div className={`h-full ${s.tone}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Small phase chip rendered next to the cohort week label in the header.
function PhaseChip({ phase }: { phase: CohortPhase }) {
  const tone: Record<CohortPhase, string> = {
    selection: 'bg-brand-teal/10 text-brand-teal border-brand-teal/30',
    onboarding: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-200',
    execution: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200',
    closeout: 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-navy-700 dark:text-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone[phase]}`}>
      Phase: {PHASE_LABEL[phase]}
    </span>
  );
}

// Onboarding-phase hero. Shown when most companies sit in Selected /
// Onboarded — the action shifts from review to kickoff + agreements.
function OnboardingHero({ selectedCount, onboardedCount, openAgreements }: { selectedCount: number; onboardedCount: number; openAgreements: number }) {
  return (
    <Link to="/companies" className="group block animate-fade-in-up">
      <div className="relative overflow-hidden rounded-2xl border border-orange-300/50 bg-gradient-to-br from-orange-50 via-white to-amber-50/40 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-orange-500/60 hover:shadow-card-lg dark:border-orange-800/40 dark:from-orange-950/30 dark:via-navy-600 dark:to-navy-700">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-orange text-white shadow">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <div className="text-2xs font-extrabold uppercase tracking-[0.1em] text-brand-orange">Active workstream</div>
              <h2 className="mt-0.5 text-xl font-extrabold text-navy-500 dark:text-white">Cohort onboarding</h2>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                {selectedCount} selected · {onboardedCount} onboarded · {openAgreements} open agreements.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 self-center rounded-lg bg-brand-orange px-3 py-2 text-sm font-bold text-white">
            Manage portfolio <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

// Execution-phase hero. Most companies are Active — focus shifts to PRs,
// payments, and live interventions.
function ExecutionHero({ activeCount, activeInterventions, openPRs, pendingPayments }: { activeCount: number; activeInterventions: number; openPRs: number; pendingPayments: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-300/40 bg-gradient-to-br from-emerald-50 via-white to-teal-50/40 p-5 shadow-card dark:border-emerald-800/40 dark:from-emerald-950/30 dark:via-navy-600 dark:to-navy-700">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow">
          <Activity className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-2xs font-extrabold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-300">Active workstream</div>
          <h2 className="mt-0.5 text-xl font-extrabold text-navy-500 dark:text-white">Cohort in execution</h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            {activeCount} active companies · {activeInterventions} live interventions.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Link to="/procurement" className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-700">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open PRs</div>
              <div className="mt-0.5 text-2xl font-extrabold text-navy-500 dark:text-white">{openPRs}</div>
            </Link>
            <Link to="/payments" className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-700">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payments pending</div>
              <div className="mt-0.5 text-2xl font-extrabold text-brand-orange">{pendingPayments}</div>
            </Link>
            <Link to="/board" className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-700">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Live interventions</div>
              <div className="mt-0.5 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{activeInterventions}</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Closeout-phase hero. The cohort is wrapping up — graduation + reporting.
function ClosetHero({ graduatedCount }: { graduatedCount: number }) {
  return (
    <Link to="/reports" className="group block animate-fade-in-up">
      <div className="relative overflow-hidden rounded-2xl border border-slate-300 bg-gradient-to-br from-slate-50 via-white to-slate-100 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-lg dark:border-navy-700 dark:from-navy-600 dark:via-navy-600 dark:to-navy-700">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white shadow">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xs font-extrabold uppercase tracking-[0.1em] text-slate-600 dark:text-slate-300">Active workstream</div>
            <h2 className="mt-0.5 text-xl font-extrabold text-navy-500 dark:text-white">Closeout & reporting</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
              {graduatedCount} companies graduated. Pull cross-module reports for the donor packs.
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Admin focus — bottlenecks + workload + fund pace at a glance.
function AdminFocus({
  bottlenecks,
  pmWorkload,
  kpis,
}: {
  bottlenecks: { unassigned: number; divergent: number; needsAnyReview: number };
  pmWorkload: Array<[string, number]>;
  kpis: { openPRs: number; pendingPaymentsCount: number; pendingPaymentsTotal: number; activeAssignments: number; companiesTotal: number };
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader
          overline="Bottlenecks"
          title={<span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-brand-red" /> What's stuck</span>}
          subtitle="Where the cohort needs unblocking"
        />
        <ul className="space-y-2 text-sm">
          <BottleneckRow
            label="Companies with no PM"
            count={bottlenecks.unassigned}
            severity={bottlenecks.unassigned > 0 ? 'red' : 'neutral'}
            to="/companies"
            hint="Assign owners on the company detail page"
          />
          <BottleneckRow
            label="Companies with no team review"
            count={bottlenecks.needsAnyReview}
            severity={bottlenecks.needsAnyReview > 5 ? 'amber' : 'neutral'}
            to="/companies"
            hint="Open Review tab to triage"
          />
          <BottleneckRow
            label="Divergent reviews"
            count={bottlenecks.divergent}
            severity={bottlenecks.divergent > 0 ? 'amber' : 'neutral'}
            to="/companies"
            hint="Team disagrees on the call"
          />
          <BottleneckRow
            label="Open PRs"
            count={kpis.openPRs}
            severity="neutral"
            to="/procurement"
          />
        </ul>
      </Card>

      <Card>
        <CardHeader
          overline="Team"
          title="PM workload"
          subtitle="Companies per Profile Manager"
        />
        {pmWorkload.length === 0 ? (
          <EmptyState title="No PM assignments yet" description="Once companies have owners, you'll see workload distribution here." />
        ) : (
          <ul className="space-y-2">
            {pmWorkload.slice(0, 6).map(([email, count]) => (
              <li key={email} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate font-semibold text-navy-500 dark:text-slate-100">
                  {displayName(email)}
                </span>
                <div className="flex w-32 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                    <div
                      className="h-full bg-brand-teal"
                      style={{ width: `${Math.min(100, (count / Math.max(1, pmWorkload[0][1])) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular">{count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          overline="Finance"
          title="Pace"
          subtitle="Live across the cohort"
        />
        <dl className="space-y-2 text-sm">
          <FocusRow label="Companies in master" value={kpis.companiesTotal} />
          <FocusRow label="Live interventions" value={kpis.activeAssignments} />
          <FocusRow label="Open PRs" value={kpis.openPRs} />
          <FocusRow label="Payments awaiting" value={`${kpis.pendingPaymentsCount} · $${formatAmount(kpis.pendingPaymentsTotal)}`} />
        </dl>
      </Card>
    </section>
  );
}

// PM focus — your portfolio + your reviews.
function PMFocus({
  mine,
  interviewedSet,
  reviewsByCompany,
  userEmail,
}: {
  mine: { companies: Master[]; assignments: Assignment[]; prs: PR[]; payments: Payment[] };
  interviewedSet: Set<string>;
  reviewsByCompany: Map<string, Review[]>;
  userEmail: string;
}) {
  const lower = userEmail.toLowerCase();
  // Companies I haven't reviewed yet from the interviewed cohort.
  const myReviewQueue = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const c of mine.companies) {
      if (!c.company_id) continue;
      if (!isInterviewed(c.company_name || '', interviewedSet)) continue;
      const rs = reviewsByCompany.get(c.company_id) || [];
      const reviewed = rs.some(r => r.reviewer_email?.toLowerCase() === lower && r.decision);
      if (!reviewed) out.push({ id: c.company_id, name: c.company_name || c.company_id });
    }
    return out;
  }, [mine.companies, interviewedSet, reviewsByCompany, lower]);

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          overline="Your portfolio"
          title="My companies"
          subtitle={`${mine.companies.length} companies you're the Profile Manager for`}
          action={<Link to="/companies?view=mine" className="text-xs font-semibold text-brand-teal hover:underline">All</Link>}
        />
        {mine.companies.length === 0 ? (
          <EmptyState title="No companies assigned to you yet" description="A company is assigned when an intervention names you as the owner." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mine.companies.slice(0, 8).map(c => {
              const activeCount = mine.assignments.filter(
                a => a.company_id === c.company_id && ['Planned', 'In Progress'].includes(a.status || '')
              ).length;
              return (
                <Link
                  key={c.company_id}
                  to={`/companies/${c.company_id}`}
                  className="rounded-xl border border-slate-200 p-3 transition hover:border-brand-teal dark:border-navy-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-navy-500 dark:text-white">{c.company_name || c.company_id}</div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {c.sector || '—'} · {activeCount} active
                      </div>
                    </div>
                    {c.status && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          overline="Action items"
          title="Reviews I owe"
          subtitle={myReviewQueue.length === 0 ? 'You\'re caught up.' : `${myReviewQueue.length} of your portfolio still need your review`}
          action={myReviewQueue.length > 0 ? <Link to="/companies" className="text-xs font-semibold text-brand-teal hover:underline">Open Review</Link> : undefined}
        />
        {myReviewQueue.length === 0 ? (
          <EmptyState title="All caught up" description="No outstanding reviews on your portfolio." />
        ) : (
          <ul className="space-y-1.5">
            {myReviewQueue.slice(0, 8).map(c => (
              <li key={c.id}>
                <Link to={`/companies/${c.id}`} className="block rounded-md border border-slate-200 px-2.5 py-1.5 text-sm hover:border-brand-teal dark:border-navy-700">
                  <div className="truncate font-semibold text-navy-500 dark:text-slate-100">{c.name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

// Member focus — review queue + own activity. Lighter view since members
// don't own portfolios.
function MemberFocus({
  reviewQueue,
  activity,
}: {
  reviewQueue: { total: number; reviewed: number; mine: number };
  activity: TimelineEvent[];
}) {
  const myRemaining = Math.max(0, reviewQueue.total - reviewQueue.mine);
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          overline="Action items"
          title="Reviews you can contribute"
          subtitle={myRemaining > 0 ? `${myRemaining} companies you haven't reviewed yet` : 'You\'ve reviewed every company.'}
        />
        {myRemaining > 0 ? (
          <Link to="/companies" className="inline-flex items-center gap-1 rounded-lg bg-brand-teal px-3 py-2 text-sm font-bold text-white">
            Continue review <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <EmptyState title="Done" description="No outstanding reviews." />
        )}
      </Card>
      <Card>
        <CardHeader overline="Recent" title="Your activity" />
        {activity.length === 0 ? (
          <EmptyState title="No recent activity" description="When you edit data, it shows up here." />
        ) : (
          <ul className="space-y-2">
            {activity.map((e, i) => (
              <li key={i}>
                <Link to={e.to || '#'} className="block rounded-md p-1.5 hover:bg-slate-50 dark:hover:bg-navy-700">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.tone || 'neutral'}>{e.kind}</Badge>
                    <span className="text-xs text-slate-400">{relativeTime(e.when)}</span>
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-navy-500 dark:text-white">{e.title}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function BottleneckRow({
  label,
  count,
  severity,
  to,
  hint,
}: {
  label: string;
  count: number;
  severity: 'red' | 'amber' | 'neutral';
  to: string;
  hint?: string;
}) {
  const sev: Record<string, string> = {
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    neutral: 'bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-200',
  };
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-md py-1.5 transition hover:bg-slate-50 dark:hover:bg-navy-700">
        <span className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 text-sm font-bold tabular ${sev[severity]}`}>
          {count}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-navy-500 dark:text-slate-100">{label}</div>
          {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
        </div>
      </Link>
    </li>
  );
}

function FocusRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-b-0 dark:border-navy-800">
      <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-bold tabular text-navy-500 dark:text-white">{value}</span>
    </div>
  );
}
