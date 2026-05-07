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
  Building2, MapPin, Users as UsersIcon, ClipboardList, MessageCircle,
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

// AM email → an accent color used as the card's left rail. Lets you scan
// the grid and spot which AM owns which company at a glance.
const AM_ACCENT: Record<string, string> = {
  'ayesh@gazaskygeeks.com': 'from-brand-red/80 to-brand-red',
  'doaa@gazaskygeeks.com':  'from-brand-teal/80 to-brand-teal',
  'muna@gazaskygeeks.com':  'from-brand-orange/80 to-brand-orange',
};
const AM_ACCENT_BAR: Record<string, string> = {
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
  const subSet = new Set<string>();
  for (const a of assignments) {
    const sub = (a.sub_intervention || '').trim();
    if (sub) subSet.add(sub);
  }
  const fundDisplay = fundLabel(fund);
  const fundTone: Tone = fund === 'Dutch' || fund === '97060' ? 'orange' : 'teal';
  const amEmail = (company.profile_manager_email || '').toLowerCase();
  const amName = amEmail ? displayName(amEmail).split(' ')[0] : 'Unassigned';
  const isWithdrawn = (company.status || '').toLowerCase() === 'withdrawn';

  return (
    <Link
      to={`/companies/${company.company_id}`}
      className={`group relative block overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card dark:bg-navy-900 ${
        isWithdrawn
          ? 'border-red-200 opacity-75 hover:opacity-100 dark:border-red-900'
          : 'border-slate-200 hover:border-brand-teal/40 dark:border-navy-700 dark:hover:border-brand-teal/40'
      }`}
    >
      {/* Top accent band — AM color + city */}
      <div className={`relative bg-gradient-to-r p-4 pb-3 text-white ${
        amEmail && AM_ACCENT[amEmail] ? AM_ACCENT[amEmail] : 'from-slate-500 to-slate-600'
      }`}>
        {/* status pill in top-right of accent band */}
        <Badge
          tone={statusTone(company.status || 'Active') as Tone}
          className="absolute right-3 top-3"
        >
          {company.status || 'Active'}
        </Badge>

        <h3 className="pr-20 text-lg font-extrabold leading-tight text-white">
          {company.company_name || company.company_id}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-white/85">
          {company.city && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" /> {company.city}
            </span>
          )}
          {company.sector && (
            <span className="inline-flex items-center gap-0.5">
              <span className="opacity-50">·</span> {company.sector}
            </span>
          )}
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-white backdrop-blur-sm">
          <UsersIcon className="h-3 w-3" />
          {amName}
        </div>
      </div>

      {/* Body — pillars + interventions + stats */}
      <div className="p-4 pt-3">
        {pillarSet.size > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {Array.from(pillarSet).map(code => {
              const p = CORE_PILLARS.find(x => x.code === code);
              if (!p) return null;
              const colorClass =
                p.code === 'CB' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : p.code === 'MA' ? 'bg-navy-100 text-navy-700 dark:bg-navy-700 dark:text-slate-200'
                : 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
              return (
                <span key={p.code} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-bold uppercase tracking-wider ${colorClass}`}>
                  {p.shortLabel}
                </span>
              );
            })}
          </div>
        )}

        {subSet.size > 0 && (
          <div className="mb-3 text-2xs leading-relaxed text-slate-600 dark:text-slate-400">
            {Array.from(subSet).join(' · ')}
          </div>
        )}

        <dl className="grid grid-cols-3 gap-1.5 text-center">
          <Stat icon={<ClipboardList className="h-3 w-3" />} label="Interv" value={String(assignments.length)} accentColor={AM_ACCENT_BAR[amEmail]} />
          <Stat icon={<MessageCircle className="h-3 w-3" />} label="Notes" value={String(commentCount)} />
          <Stat icon={<UsersIcon className="h-3 w-3" />} label="Budget" value={fmtUsd(totalBudget).replace('$', '$')} />
        </dl>
      </div>

      {/* Footer — fund + last activity */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2 text-2xs dark:border-navy-700 dark:bg-navy-700/40">
        <div className="flex items-center gap-2">
          {fundDisplay
            ? <Badge tone={fundTone}>{fundDisplay}</Badge>
            : <span className="text-slate-400">no donor</span>}
        </div>
        {lastActivity ? (
          <span className="truncate text-slate-500" title={`${lastActivity.action} · ${lastActivity.user_email}`}>
            {timeAgo(lastActivity.timestamp || '')} · {lastActivity.action.replace(/_/g, ' ')}
          </span>
        ) : (
          <span className="text-slate-400">no activity yet</span>
        )}
      </div>
    </Link>
  );
}

function Stat({ icon, label, value, accentColor }: { icon: React.ReactNode; label: string; value: string; accentColor?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
      {accentColor && <div className={`h-0.5 ${accentColor}`} />}
      <div className="px-2 py-1.5">
        <div className="flex items-center justify-center gap-1 text-2xs uppercase tracking-wider text-slate-500">{icon} {label}</div>
        <div className="mt-0.5 truncate text-sm font-bold text-navy-500 dark:text-white">{value}</div>
      </div>
    </div>
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
