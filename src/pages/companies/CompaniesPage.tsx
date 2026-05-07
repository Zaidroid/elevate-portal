// /companies — cohort 3 reference: a card grid of every cohort 3
// company with its key data and most recent updates.
//
// No kanban. No multi-tab dashboard. The page is a *reference* — you
// land here to find a company, scan its current state, and click in
// for the full detail page (CompanyDetailPage). All filters narrow
// the card grid; clicking a card deep-links to /companies/:id.
//
// Cohort scoping uses the canonical alias map (the same authoritative
// source the dashboards + my-hub use), not the unreliable cohort
// field on the master row.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, MapPin, ClipboardList, MessageCircle,
  Search, RefreshCw, Filter as FilterIcon,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useModuleData } from '../../data/useModuleData';
import { useScopedView } from '../../data/useScopedView';
import type { Company, Assignment } from '../../data/types';
import type { ActivityRow, CompanyComment } from './reviewTypes';
import { displayName, ACCOUNT_MANAGERS } from '../../config/team';
import { canonicalCohortName, COHORT3_ALIASES } from '../../config/cohort3Aliases';
import { pillarFor, CORE_PILLARS } from '../../config/interventions';
import {
  Badge, Button, Card, EmptyState, PageHeader, statusTone,
} from '../../lib/ui';
import type { Tone } from '../../lib/ui';

// ─── helpers ─────────────────────────────────────────────────────────

const FUND_LABELS: Record<string, string> = {
  '97060': 'Dutch', Dutch: 'Dutch',
  '91763': 'SIDA',  SIDA: 'SIDA',
};
function fundLabel(code: string): string {
  return FUND_LABELS[code?.trim()] || code || '';
}
function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function inCohort3(c: Company): boolean {
  return canonicalCohortName(c.company_name || '') !== null;
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// ─── page ────────────────────────────────────────────────────────────

export function CompaniesPage() {
  const { user } = useAuth();
  const me = (user?.email || '').toLowerCase();

  const masterHook = useModuleData<Company>('companies', 'companies');
  const assignments = useModuleData<Assignment>('companies', 'assignments');
  const comments = useModuleData<CompanyComment>('companies', 'comments');
  const activity = useModuleData<ActivityRow>('companies', 'activity');

  // Cohort 3 only — canonical alias map is the truth.
  const cohort = useMemo(() => masterHook.rows.filter(inCohort3), [masterHook.rows]);

  // Filters
  const [query, setQuery] = useState('');
  const [filterAm, setFilterAm] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPillar, setFilterPillar] = useState<string>('');
  const [filterFund, setFilterFund] = useState<string>('');

  // AM scoping (gold standard from MyHub).
  const view = useScopedView<Company>(cohort, c => c.profile_manager_email, me);

  // Per-company aggregates
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

  const commentCountByCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments.rows) {
      if (!c.company_id) continue;
      m.set(c.company_id, (m.get(c.company_id) ?? 0) + 1);
    }
    return m;
  }, [comments.rows]);

  const lastActivityByCompany = useMemo(() => {
    const m = new Map<string, ActivityRow>();
    for (const a of activity.rows) {
      if (!a.company_id) continue;
      const existing = m.get(a.company_id);
      if (!existing || (a.timestamp || '') > (existing.timestamp || '')) {
        m.set(a.company_id, a);
      }
    }
    return m;
  }, [activity.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return view.scoped.filter(c => {
      const cAsg = asgByCompany.get(c.company_id) ?? [];
      const text = `${c.company_name} ${c.city} ${c.governorate} ${c.sector}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      const am = (c.profile_manager_email || '').toLowerCase();
      if (filterAm === '__none__' && am) return false;
      if (filterAm && filterAm !== '__none__' && am !== filterAm) return false;
      if (filterStatus && (c.status || '').trim() !== filterStatus) return false;
      if (filterFund && (c.fund_code || '').trim() !== filterFund) return false;
      if (filterPillar) {
        const pillars = new Set(cAsg.map(a => pillarFor(a.intervention_type)?.code).filter(Boolean) as string[]);
        if (!pillars.has(filterPillar)) return false;
      }
      return true;
    });
  }, [view.scoped, asgByCompany, query, filterAm, filterStatus, filterFund, filterPillar]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '')),
    [filtered],
  );

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of cohort) {
      const s = (c.status || '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [cohort]);
  const fundOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of cohort) {
      const f = (c.fund_code || '').trim();
      if (f) set.add(f);
    }
    return Array.from(set).sort();
  }, [cohort]);

  const refresh = () => {
    masterHook.refresh();
    assignments.refresh();
    comments.refresh();
    activity.refresh();
  };

  const hasActiveFilter = !!(query || filterAm || filterStatus || filterPillar || filterFund);
  const cohortSize = COHORT3_ALIASES.length;
  const cohortInterventions = useMemo(
    () => assignments.rows.filter(a => view.scoped.some(c => c.company_id === a.company_id)).length,
    [assignments.rows, view.scoped],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Companies"
        subtitle={`Cohort 3 reference · ${view.scope === 'mine' ? `your ${view.mineCount} of ${cohortSize}` : `${cohortSize} companies`}.`}
        badges={[
          { label: `${sorted.length} of ${view.scoped.length}`, tone: 'teal' },
          { label: `${cohortInterventions} interventions`, tone: 'teal' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <ScopeToggle scope={view.scope} mineCount={view.mineCount} totalCount={cohortSize} onChange={view.setScope} />
            <Button variant="ghost" onClick={refresh} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.currentTarget.value)}
              placeholder="Search company, city, sector…"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            />
          </div>
          <FilterChip
            value={filterAm}
            onChange={setFilterAm}
            options={[
              { value: '', label: 'All AMs' },
              ...ACCOUNT_MANAGERS.map(am => ({ value: am.email.toLowerCase(), label: displayName(am.email) })),
              { value: '__none__', label: '(unassigned)' },
            ]}
          />
          <FilterChip
            value={filterStatus}
            onChange={setFilterStatus}
            options={[{ value: '', label: 'Any status' }, ...statusOptions.map(s => ({ value: s, label: s }))]}
          />
          <FilterChip
            value={filterPillar}
            onChange={setFilterPillar}
            options={[
              { value: '', label: 'Any pillar' },
              ...CORE_PILLARS.map(p => ({ value: p.code, label: p.shortLabel })),
            ]}
          />
          <FilterChip
            value={filterFund}
            onChange={setFilterFund}
            options={[{ value: '', label: 'Any donor' }, ...fundOptions.map(f => ({ value: f, label: fundLabel(f) }))]}
          />
          {hasActiveFilter && (
            <Button variant="ghost" onClick={() => { setQuery(''); setFilterAm(''); setFilterStatus(''); setFilterPillar(''); setFilterFund(''); }}>
              <FilterIcon className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </Card>

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={hasActiveFilter ? 'No companies match these filters' : 'No cohort 3 companies yet'}
            description={hasActiveFilter ? 'Try clearing a filter or widening your search.' : 'Run the cohort allocation seed in /import to populate the cohort.'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map(c => (
            <CompanyCard
              key={c.company_id}
              company={c}
              assignments={asgByCompany.get(c.company_id) ?? []}
              commentCount={commentCountByCompany.get(c.company_id) ?? 0}
              lastActivity={lastActivityByCompany.get(c.company_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

// AM email → small accent dot color. The visual signal is just a
// 3-pixel left rail in the AM's color, not a full coloured band.
const AM_RAIL: Record<string, string> = {
  'ayesh@gazaskygeeks.com': 'bg-brand-red',
  'doaa@gazaskygeeks.com':  'bg-brand-teal',
  'muna@gazaskygeeks.com':  'bg-brand-orange',
};

function CompanyCard({
  company,
  assignments,
  commentCount,
  lastActivity,
}: {
  company: Company;
  assignments: Assignment[];
  commentCount: number;
  lastActivity?: ActivityRow;
}) {
  const totalBudget = useMemo(
    () => assignments.reduce((s, a) => s + (parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, '')) || 0), 0),
    [assignments],
  );
  const fund = company.fund_code || assignments.find(a => a.fund_code)?.fund_code || '';
  const pillarSet = new Set<string>();
  for (const a of assignments) {
    const p = pillarFor(a.intervention_type);
    if (p) pillarSet.add(p.code);
  }
  const fundDisplay = fundLabel(fund);
  const fundTone: Tone = fund === 'Dutch' || fund === '97060' ? 'orange' : 'teal';
  const amEmail = (company.profile_manager_email || '').toLowerCase();
  const amName = amEmail ? displayName(amEmail).split(' ')[0] : 'Unassigned';
  const isWithdrawn = (company.status || '').toLowerCase() === 'withdrawn';
  const railClass = AM_RAIL[amEmail] || 'bg-slate-300';

  return (
    <Link
      to={`/companies/${company.company_id}`}
      className={`group relative flex overflow-hidden rounded-lg border bg-white text-sm transition-all hover:border-brand-teal/50 hover:shadow-sm dark:bg-navy-900 ${
        isWithdrawn
          ? 'border-red-200 opacity-70 hover:opacity-100 dark:border-red-900'
          : 'border-slate-200 dark:border-navy-700'
      }`}
    >
      {/* AM color rail — slim left edge, no overhead */}
      <div className={`w-1 flex-shrink-0 ${railClass}`} />

      <div className="min-w-0 flex-1 p-3">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-navy-500 group-hover:text-brand-teal dark:text-white">
              {company.company_name || company.company_id}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-slate-500">
              {company.city && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="h-2.5 w-2.5" /> {company.city}
                </span>
              )}
              {company.sector && <span>· {company.sector}</span>}
              <span>· {amName}</span>
            </div>
          </div>
          <Badge tone={statusTone(company.status || 'Active') as Tone}>
            {company.status || 'Active'}
          </Badge>
        </div>

        {/* Pillars — small chips inline */}
        {pillarSet.size > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Array.from(pillarSet).map(code => {
              const p = CORE_PILLARS.find(x => x.code === code);
              if (!p) return null;
              return (
                <span key={p.code} className="rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-semibold text-slate-700 dark:bg-navy-700 dark:text-slate-300">
                  {p.shortLabel}
                </span>
              );
            })}
          </div>
        )}

        {/* Compact stats row */}
        <div className="mt-2 flex items-center justify-between text-2xs text-slate-500">
          <div className="flex items-center gap-3">
            <span title="Interventions">
              <ClipboardList className="mr-0.5 inline h-3 w-3" />
              {assignments.length}
            </span>
            <span title="Comments">
              <MessageCircle className="mr-0.5 inline h-3 w-3" />
              {commentCount}
            </span>
            {totalBudget > 0 && (
              <span title="Budget">{fmtUsd(totalBudget)}</span>
            )}
            {fundDisplay && <Badge tone={fundTone}>{fundDisplay}</Badge>}
          </div>
          {lastActivity && (
            <span className="truncate text-slate-400" title={`${lastActivity.action} · ${lastActivity.user_email}`}>
              {timeAgo(lastActivity.timestamp || '')}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function FilterChip({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.currentTarget.value)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ScopeToggle({
  scope, mineCount, totalCount, onChange,
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
          scope === 'mine' ? 'bg-brand-teal text-white'
            : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
        }`}
      >
        Mine ({mineCount})
      </button>
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`px-3 py-1.5 text-xs font-semibold ${
          scope === 'all' ? 'bg-brand-teal text-white'
            : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
        }`}
      >
        All ({totalCount})
      </button>
    </div>
  );
}
