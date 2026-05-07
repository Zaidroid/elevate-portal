// /my-hub — Account Manager landing page.
//
// AMs (Mohammad / Doaa / Muna) get a dedicated home: their pool of
// companies, their interventions in flight, what's needing them today,
// and recent activity scoped to that pool. Admins / leadership can also
// open the hub but default to scope=all.
//
// All reads use the existing centralized data layer; nothing in the hub
// writes — every action deep-links into the existing detail pages.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useModuleData } from '../../data/useModuleData';
import { useScopedView } from '../../data/useScopedView';
import type { Company, Assignment, PR, Payment, Agreement } from '../../data/types';
import { PersonalGreeting } from '../../lib/greeting';
import { pillarFor } from '../../config/interventions';
import { canonicalCohortName, COHORT3_ALIASES } from '../../config/cohort3Aliases';
import { computeAlerts, type Alert } from '../../lib/alerts/index';
import { keepCompaniesSection } from '../../lib/sheets/sections';
import { aggregateByCity, aggregateBySub } from '../../data/aggregations';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  PageHeader,
  statusTone,
} from '../../lib/ui';
import type { Column, Tone } from '../../lib/ui';
import { ActivityTimeline } from '../companies/ActivityTimeline';
import type { ActivityRow } from '../companies/reviewTypes';

const FUND_LABELS: Record<string, string> = {
  '97060': 'Dutch',
  Dutch: 'Dutch',
  '91763': 'SIDA',
  SIDA: 'SIDA',
};

function fundLabel(code: string): string {
  return FUND_LABELS[code?.trim()] || code || '';
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtUsdOrDash(n: number): string {
  // For inline cells where a 0 is genuinely "no budget set" and looks
  // better as an em-dash than "$0".
  if (!Number.isFinite(n) || n === 0) return '—';
  return fmtUsd(n);
}

// Alert.kind → short verb-first action label that hints at what the AM
// is being asked to do (vs. the generic "Open"). Phase D / E / G will
// turn each of these into in-place resolution actions; the phrasing
// here already matches the eventual action so it doesn't need rewording.
function alertActionLabel(kind: Alert['kind']): string {
  switch (kind) {
    case 'pr_overdue':
    case 'pr_due_soon':            return 'Resolve PR';
    case 'payment_pending_approval': return 'Review payment';
    case 'agreement_unsigned':      return 'Mark signed';
    case 'followup_overdue':        return 'Open follow-up';
    case 'conf_visa_pending':       return 'Open visa';
    case 'advisor_mention':         return 'View comment';
    case 'advisor_stuck':           return 'Move advisor';
    default:                        return 'Open';
  }
}

export function MyHubPage() {
  const { user } = useAuth();
  const me = (user?.email || '').toLowerCase();

  // Read everything we need.
  const master       = useModuleData<Company>('companies', 'companies');
  const assignments  = useModuleData<Assignment>('companies', 'assignments');
  const activity     = useModuleData<ActivityRow>('companies', 'activity');
  const payments     = useModuleData<Payment>('payments', 'payments');
  const q1           = useModuleData<PR>('procurement', 'q1');
  const q2           = useModuleData<PR>('procurement', 'q2');
  const q3           = useModuleData<PR>('procurement', 'q3');
  const q4           = useModuleData<PR>('procurement', 'q4');
  const agreements   = useModuleData<Agreement>('docs', 'agreements');

  // Filter each quarter to the "Companies" section only (the team's
  // procurement sheets group rows under team labels — without filtering
  // we read individuals + vendors + stray header rows).
  const allPrs = useMemo<PR[]>(() => [
    ...keepCompaniesSection(q1.rows, q1.headers),
    ...keepCompaniesSection(q2.rows, q2.headers),
    ...keepCompaniesSection(q3.rows, q3.headers),
    ...keepCompaniesSection(q4.rows, q4.headers),
  ] as PR[], [q1.rows, q1.headers, q2.rows, q2.headers, q3.rows, q3.headers, q4.rows, q4.headers]);

  // Filter master rows to cohort 3 BEFORE scoping. The cohort is decided
  // by the canonical alias map (src/config/cohort3Aliases.ts), not by
  // the unreliable `cohort` column. This means admin's "All" view shows
  // the 41-company cohort, not the noisy 62-row master that includes
  // pre-cohort applicants and historical entries.
  const cohortRows = useMemo(
    () => master.rows.filter(c => canonicalCohortName(c.company_name || '') !== null),
    [master.rows],
  );

  // Scope: AMs default to mine; admins to all (within cohort 3).
  const view = useScopedView<Company>(
    cohortRows,
    c => c.profile_manager_email,
    me,
  );

  // Companies in the user's view.
  const myCompanyIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of view.scoped) if (c.company_id) s.add(c.company_id);
    return s;
  }, [view.scoped]);

  // Cohort 3 company IDs (used to exclude orphan / pre-cohort assignments
  // even when scope === 'all').
  const cohortCompanyIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of cohortRows) if (c.company_id) s.add(c.company_id);
    return s;
  }, [cohortRows]);

  const myAssignments = useMemo(
    () => assignments.rows.filter(a => {
      if (!cohortCompanyIds.has(a.company_id)) return false;
      if (view.scope === 'all') return true;
      return (a.owner_email || '').toLowerCase() === me || myCompanyIds.has(a.company_id);
    }),
    [assignments.rows, view.scope, me, myCompanyIds, cohortCompanyIds],
  );

  // Alerts scoped first to cohort 3 (drops noise from pre-cohort PRs /
  // payments / agreements), then to my pool when scope === 'mine'.
  // Alerts without a traceable company_id (e.g. global follow-ups,
  // conference visa pings) pass through both filters.
  const myAlerts: Alert[] = useMemo(() => {
    const all = computeAlerts({
      prs: allPrs as unknown as Record<string, string>[],
      payments: payments.rows as unknown as Record<string, string>[],
      agreements: agreements.rows as unknown as Record<string, string>[],
      followups: [],
      confTracker: [],
      userEmail: me,
      isAdmin: false,
    });
    return all.filter(a => {
      const id = a.id.split('-').slice(1).join('-');
      const pr = allPrs.find(r => r.pr_id === id);
      const pay = payments.rows.find(r => r.payment_id === id);
      const ag = agreements.rows.find(r => r.agreement_id === id);
      const ownerCompanyId = pr?.company_id || pay?.company_id || ag?.company_id || '';

      // Drop alerts whose source row points at a non-cohort-3 company.
      if (ownerCompanyId && !cohortCompanyIds.has(ownerCompanyId)) return false;
      if (view.scope === 'all') return true;
      // 'mine' scope: must also be in this user's pool, OR carry no
      // traceable company id (likely global / cross-pool item).
      if (!ownerCompanyId) return true;
      return myCompanyIds.has(ownerCompanyId);
    });
  }, [allPrs, payments.rows, agreements.rows, me, view.scope, myCompanyIds, cohortCompanyIds]);

  // Recent activity — cohort 3 only; my-pool further when 'mine'.
  const myActivity = useMemo(() => {
    return activity.rows.filter(r => {
      if (!r.company_id) return true; // global / cohort-level events
      if (!cohortCompanyIds.has(r.company_id)) return false;
      if (view.scope === 'all') return true;
      return myCompanyIds.has(r.company_id);
    });
  }, [activity.rows, view.scope, myCompanyIds, cohortCompanyIds]);

  // Per-company aggregates for the My Companies table.
  const asgByCompany = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments.rows) {
      if (!a.company_id) continue;
      const arr = m.get(a.company_id) ?? [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return m;
  }, [assignments.rows]);

  // Total committed budget across my pool.
  const myBudget = useMemo(() => {
    let n = 0;
    for (const a of myAssignments) {
      const v = parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) n += v;
    }
    return n;
  }, [myAssignments]);

  // Total paid across my pool, for the insight card.
  const myPaid = useMemo(() => {
    let n = 0;
    for (const p of payments.rows) {
      if ((p.status || '').toLowerCase() !== 'paid') continue;
      if (view.scope === 'all' ? !cohortCompanyIds.has(p.company_id) : !myCompanyIds.has(p.company_id)) continue;
      const v = parseFloat(String(p.amount_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) n += v;
    }
    return n;
  }, [payments.rows, view.scope, myCompanyIds, cohortCompanyIds]);

  // Pool-scoped rollups (same helpers HomePage uses, scoped to view.scoped
  // instead of the whole cohort). Kept in MyHubPage so 'mine' vs 'all'
  // toggle is honoured automatically.
  const cityRollup = useMemo(
    () => aggregateByCity(view.scoped, myAssignments, payments.rows),
    [view.scoped, myAssignments, payments.rows],
  );
  const subRollup = useMemo(
    () => aggregateBySub(view.scoped, myAssignments, payments.rows),
    [view.scoped, myAssignments, payments.rows],
  );

  // ─── render ────────────────────────────────────────────────────────

  const greeting = <PersonalGreeting email={user?.email} fallback="My hub" />;
  const cohortSize = COHORT3_ALIASES.length;

  const refreshAll = () => {
    master.refresh();
    assignments.refresh();
    activity.refresh();
    payments.refresh();
    q1.refresh(); q2.refresh(); q3.refresh(); q4.refresh();
    agreements.refresh();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={greeting}
        subtitle={
          view.scope === 'mine'
            ? `Cohort 3 · scoped to your ${view.mineCount} compan${view.mineCount === 1 ? 'y' : 'ies'}.`
            : `Cohort 3 · all ${cohortSize} companies.`
        }
        badges={[
          { label: `${view.scoped.length} of ${cohortSize} companies`, tone: 'teal' },
          { label: `${myAssignments.length} interventions`, tone: 'teal' },
          { label: `${myAlerts.length} action${myAlerts.length === 1 ? '' : 's'}`, tone: myAlerts.length > 0 ? 'red' : 'neutral' },
          { label: fmtUsd(myBudget), tone: 'amber' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <ScopeToggle scope={view.scope} mineCount={view.mineCount} totalCount={cohortSize} onChange={view.setScope} />
            <Button variant="ghost" onClick={refreshAll} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Things needing me */}
      <Card>
        <CardHeader
          title="Things needing me"
          subtitle={myAlerts.length === 0 ? 'Nothing to do right now.' : `${myAlerts.length} item${myAlerts.length === 1 ? '' : 's'} flagged.`}
        />
        {myAlerts.length === 0 ? (
          <EmptyState title="Inbox zero" description="No overdue PRs, pending payments, or unsigned agreements in your pool." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-navy-700">
            {myAlerts.slice(0, 12).map(a => (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <span
                  className={`mt-1 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                    a.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-navy-500 dark:text-white">{a.title}</div>
                  <div className="truncate text-xs text-slate-500">{a.detail}</div>
                </div>
                <Link
                  to={a.href}
                  className="flex-shrink-0 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-2xs font-bold uppercase tracking-wider text-brand-teal transition hover:bg-brand-teal/20"
                >
                  {alertActionLabel(a.kind)} <ExternalLink className="inline h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* My companies */}
      <Card>
        <CardHeader
          title={view.scope === 'mine' ? 'My companies' : 'All companies'}
          subtitle={`${view.scoped.length} compan${view.scoped.length === 1 ? 'y' : 'ies'} in scope.`}
        />
        <CompaniesTable
          rows={view.scoped}
          asgByCompany={asgByCompany}
          onStatusChange={async (companyId, nextStatus) => {
            await master.updateRow(companyId, { status: nextStatus });
          }}
        />
      </Card>

      {/* My pool insights — same shape as the admin Home, scoped to mine. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={view.scope === 'mine' ? 'My cities' : 'Cohort cities'}
            subtitle={cityRollup.length === 0 ? 'No cities to summarise yet.' : `${cityRollup.length} cit${cityRollup.length === 1 ? 'y' : 'ies'} in scope · ${fmtUsd(myPaid)} paid out of ${fmtUsd(myBudget)} committed.`}
          />
          {cityRollup.length === 0 ? (
            <EmptyState title="No city data yet" />
          ) : (
            <ul className="space-y-2 text-sm">
              {cityRollup.map(c => {
                const max = Math.max(1, ...cityRollup.map(x => x.companies));
                return (
                  <li key={c.city}>
                    <div className="flex items-center justify-between">
                      <Link
                        to={`/companies?city=${encodeURIComponent(c.city)}`}
                        className="font-semibold text-navy-500 hover:text-brand-teal hover:underline dark:text-white"
                      >
                        {c.city}
                      </Link>
                      <span className="text-2xs text-slate-500">
                        <span className="font-mono">{c.companies}</span> co · <span className="font-mono">{c.interventions}</span> int · <span className="font-mono">{fmtUsd(c.paidUsd)}</span> paid
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                      <div className="h-full rounded-full bg-brand-teal" style={{ width: `${Math.round((c.companies / max) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title={view.scope === 'mine' ? 'My sub-interventions' : 'All sub-interventions'}
            subtitle="Where the work is — companies covered and assignment count per sub."
          />
          {subRollup.every(s => s.companies === 0 && s.assignmentsTotal === 0) ? (
            <EmptyState title="No interventions yet" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-navy-700">
              {subRollup.filter(s => s.companies > 0 || s.assignmentsTotal > 0).map(s => (
                <li key={`${s.pillar}::${s.sub}`} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      to={`/companies?sub=${encodeURIComponent(s.sub)}`}
                      className="truncate font-semibold text-navy-500 hover:text-brand-teal hover:underline dark:text-white"
                    >
                      {s.sub}
                    </Link>
                    <span className="flex-shrink-0 text-2xs text-slate-500">
                      <span className="font-mono">{s.companies}</span> co · <span className="font-mono">{s.assignmentsTotal}</span> assigned · <span className="font-mono">{fmtUsd(s.paidUsd)}</span> paid
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* My interventions + Activity */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={view.scope === 'mine' ? 'My interventions' : 'All interventions'}
            subtitle={`${myAssignments.length} assignment${myAssignments.length === 1 ? '' : 's'}.`}
          />
          <InterventionsList rows={myAssignments} masterById={master.rows} />
        </Card>
        <Card>
          <CardHeader
            title={view.scope === 'mine' ? 'My pool · activity' : 'Recent activity'}
            subtitle="Latest 50 events across reviews, comments, locks."
          />
          {myActivity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ActivityTimeline rows={myActivity} limit={50} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── helper components ────────────────────────────────────────────────

function ScopeToggle({
  scope,
  mineCount,
  totalCount,
  onChange,
}: {
  scope: 'mine' | 'all';
  mineCount: number;
  totalCount: number;
  onChange: (next: 'mine' | 'all') => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
      <button
        type="button"
        onClick={() => onChange('mine')}
        className={`px-3 py-1.5 text-xs font-semibold ${
          scope === 'mine'
            ? 'bg-brand-teal text-white'
            : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
        }`}
      >
        Mine ({mineCount})
      </button>
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`px-3 py-1.5 text-xs font-semibold ${
          scope === 'all'
            ? 'bg-brand-teal text-white'
            : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
        }`}
      >
        All ({totalCount})
      </button>
    </div>
  );
}

// Statuses an AM may move a company through inline. Tracks the canonical
// pipeline labels used elsewhere in the portal (matches statusTone()).
const STATUS_OPTIONS = ['Active', 'Onboarding', 'Withdrawn', 'Graduated'];

function CompaniesTable({
  rows,
  asgByCompany,
  onStatusChange,
}: {
  rows: Company[];
  asgByCompany: Map<string, Assignment[]>;
  onStatusChange?: (companyId: string, nextStatus: string) => void | Promise<void>;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '')),
    [rows],
  );
  const columns: Column<Company>[] = [
    {
      key: 'company_name',
      header: 'Company',
      render: c => (
        <Link to={`/companies/${c.company_id}`} className="font-semibold text-navy-500 hover:underline dark:text-white">
          {c.company_name || c.company_id}
        </Link>
      ),
    },
    { key: 'city', header: 'City', render: c => c.city || '—' },
    {
      key: 'status',
      header: 'Status',
      render: c => {
        const s = c.status || 'Active';
        return <Badge tone={statusTone(s) as Tone}>{s}</Badge>;
      },
    },
    {
      key: 'ints',
      header: 'Interventions',
      render: c => {
        const a = asgByCompany.get(c.company_id) ?? [];
        return a.length === 0 ? '—' : `${a.length}`;
      },
    },
    {
      key: 'donor',
      header: 'Donor',
      render: c => {
        const a = asgByCompany.get(c.company_id) ?? [];
        const fund = c.fund_code || a.find(x => x.fund_code)?.fund_code || '';
        return fundLabel(fund) || '—';
      },
    },
    {
      key: 'budget',
      header: 'Budget',
      render: c => {
        const a = asgByCompany.get(c.company_id) ?? [];
        const sum = a.reduce((s, x) => s + (parseFloat(String(x.budget_usd || '').replace(/[^0-9.\-]/g, '')) || 0), 0);
        return fmtUsdOrDash(sum);
      },
    },
    {
      key: 'actions',
      header: '',
      width: '40px',
      render: c => <RowActions company={c} onStatusChange={onStatusChange} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={sorted as unknown as Record<string, unknown>[] as Company[]}
      emptyState={<EmptyState title="No companies" description="Once you have companies in your pool, they appear here." />}
    />
  );
}

// Inline row action menu (native <details>, no portals or click-outside
// plumbing). Three deep links into the company detail page + a quick
// status change. Status writes go through master.updateRow which hits
// the sheet directly and refreshes the SheetDataProvider.
function RowActions({
  company,
  onStatusChange,
}: {
  company: Company;
  onStatusChange?: (companyId: string, nextStatus: string) => void | Promise<void>;
}) {
  const currentStatus = company.status || 'Active';
  return (
    <details className="group relative inline-block">
      <summary
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-navy-500 dark:hover:bg-navy-700 dark:hover:text-white [&::-webkit-details-marker]:hidden"
        title="Row actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div
        className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-navy-700 dark:bg-navy-700"
      >
        <Link
          to={`/companies/${company.company_id}`}
          className="block px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-600"
        >
          Open detail
        </Link>
        <Link
          to={`/companies/${company.company_id}#assignments`}
          className="block px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-600"
        >
          View interventions
        </Link>
        <Link
          to={`/companies/${company.company_id}#advisors`}
          className="block px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-600"
        >
          View advisors
        </Link>
        {onStatusChange && (
          <div className="border-t border-slate-100 dark:border-navy-600">
            <div className="px-3 pb-1 pt-2 text-2xs font-bold uppercase tracking-wider text-slate-400">
              Set status
            </div>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                type="button"
                disabled={s === currentStatus}
                onClick={async () => {
                  await onStatusChange(company.company_id, s);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition ${
                  s === currentStatus
                    ? 'cursor-default text-slate-400 dark:text-slate-500'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-600'
                }`}
              >
                <span>{s}</span>
                {s === currentStatus && <span className="text-2xs">current</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function InterventionsList({
  rows,
  masterById,
}: {
  rows: Assignment[];
  masterById: Company[];
}) {
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of masterById) if (c.company_id) m.set(c.company_id, c.company_name || c.company_id);
    return m;
  }, [masterById]);

  const grouped = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of rows) {
      const arr = m.get(a.company_id) ?? [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return Array.from(m.entries())
      .map(([cid, list]) => ({ cid, name: nameById.get(cid) || cid, list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, nameById]);

  if (grouped.length === 0) {
    return <EmptyState title="No interventions yet" description="Assignments appear here once they're committed in Stage 3." />;
  }

  return (
    <ul className="space-y-3">
      {grouped.slice(0, 20).map(g => (
        <li key={g.cid}>
          <Link to={`/companies/${g.cid}`} className="text-sm font-bold text-navy-500 hover:underline dark:text-white">
            {g.name}
          </Link>
          <ul className="mt-1 space-y-1 pl-2 text-xs">
            {g.list.map(a => {
              const sub = a.sub_intervention || a.intervention_type || '';
              const flavor = (a.notes || '').match(/(?:^|\|\s*)(Technical)(?:\s*\||$)/)?.[1];
              return (
                <li key={a.assignment_id} className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-teal" />
                  <span className="font-semibold">
                    {pillarFor(a.intervention_type)?.shortLabel || a.intervention_type}{sub ? ` · ${sub}` : ''}
                    {flavor ? ` (${flavor})` : ''}
                  </span>
                  {a.budget_usd && <span className="text-slate-500">{fmtUsdOrDash(parseFloat(String(a.budget_usd).replace(/[^0-9.\-]/g, '')) || 0)}</span>}
                  <span className="ml-auto text-2xs uppercase tracking-wider text-slate-400">{a.status || 'Planned'}</span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
