// /companies — applicant + cohort reference: a card grid covering the
// full selection funnel.
//
// Three scopes (toggle, mutually exclusive):
//   - Mine        — selected (cohort 3) companies whose AM is the signed-in user
//   - Selected    — every cohort 3 company (the 41 from cohort3Aliases.ts)
//   - Waitlist    — every Source Data applicant whose name does NOT resolve to
//                   a cohort 3 canonical (i.e. ~61 = 102 applicants − 41 selected)
//
// "Selected" rows are master-row backed (full operational data: AM, fund,
// assignments, comments, activity). "Waitlist" rows are synthesized from
// the Selection workbook's Source Data tab — no AM / no assignments — and
// link to /companies/<sourceDataId> so CompanyDetailPage can render the
// applicant dossier even without a master row.
//
// Cohort scoping uses the canonical alias map (the same authoritative
// source the dashboards + my-hub use), not the unreliable cohort
// field on the master row.

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building2, MapPin, ClipboardList, MessageCircle,
  Search, RefreshCw, Filter as FilterIcon, X, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useModuleData } from '../../data/useModuleData';
import type { Company, Assignment, Applicant } from '../../data/types';
import type { ActivityRow, CompanyComment } from './reviewTypes';
import { displayName, ACCOUNT_MANAGERS } from '../../config/team';
import { canonicalCohortName, COHORT3_ALIASES } from '../../config/cohort3Aliases';
import { pillarFor, resolveIntervention, CORE_PILLARS } from '../../config/interventions';
import { fuzzyNorm } from '../../lib/normalize';
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

// Pull the most likely company-name field out of a Source Data row.
function applicantName(a: Applicant): string {
  return (
    (a.name as string) ||
    (a.companyName as string) ||
    (a.company_name as string) ||
    (a['Company Name'] as string) ||
    ''
  );
}

// Looser cohort matcher used only for waitlist exclusion. Strict
// canonical lookup first; if that misses, try (a) any whitespace-token
// in the applicant name exactly equals a canonical/alias fuzzyNorm,
// and (b) substring containment when both sides are ≥6 chars (so we
// don't false-match on short tokens like "tech" or "hexa"). Without
// this fallback, applicants whose Source Data name includes extra
// words ("AI Pilot for Software Development") or a missing alias
// silently leak into the waitlist.
function looseCohortMatch(name: string): string | null {
  const strict = canonicalCohortName(name);
  if (strict) return strict;
  const aKey = fuzzyNorm(name);
  if (!aKey) return null;
  const aTokens = new Set(aKey.split(' ').filter(t => t.length >= 4));

  let best: { canonical: string; score: number } | null = null;
  for (const entry of COHORT3_ALIASES) {
    for (const cand of [entry.canonical, ...entry.aliases]) {
      const cKey = fuzzyNorm(cand);
      if (!cKey) continue;
      // (a) token-exact: any word in the applicant name equals the
      // entire alias (handles "Hexa Studio" → "Hexa", "Polaris Tech
      // Hub" → "Polaris"). Requires the alias to be ≥4 chars to
      // avoid false matches on common 3-letter tokens.
      if (cKey.length >= 4 && aTokens.has(cKey)) {
        const score = 1000 + cKey.length;
        if (!best || score > best.score) best = { canonical: entry.canonical, score };
        continue;
      }
      // (b) substring containment, both sides ≥6 chars.
      if (cKey.length < 6 || aKey.length < 6) continue;
      if (aKey.includes(cKey)) {
        const score = 500 + cKey.length;
        if (!best || score > best.score) best = { canonical: entry.canonical, score };
      } else if (cKey.includes(aKey)) {
        const score = 250 + aKey.length;
        if (!best || score > best.score) best = { canonical: entry.canonical, score };
      }
    }
  }
  return best?.canonical || null;
}

// Synthesize a Company-shaped object from a Source Data applicant row,
// so waitlist entries can flow through the existing card.
function applicantToCard(a: Applicant): Company {
  const name = applicantName(a);
  return {
    company_id: (a.id as string) || name,
    company_name: name,
    legal_name: (a.legalName as string) || name,
    sector: (a.businessType as string) || (a.sector as string) || '',
    city: (a.city as string) || '',
    governorate: (a.governorate as string) || '',
    employee_count: (a.totalEmployees as string) || (a.numEmployees as string) || '',
    revenue_bracket: (a.revenueBracket as string) || '',
    international_revenue_pct: (a.revenueInternational as string) || '',
    readiness_score: (a.readinessScore as string) || '',
    fund_code: '',
    cohort: '',
    status: 'Waitlist',
    stage: 'Applied',
    profile_manager_email: '',
    selection_date: '',
    onboarding_date: '',
    drive_folder_url: '',
    notes: '',
    updated_at: '',
    updated_by: '',
  };
}

type Scope = 'mine' | 'selected' | 'waitlist';

// ─── page ────────────────────────────────────────────────────────────

export function CompaniesPage() {
  const { user } = useAuth();
  const me = (user?.email || '').toLowerCase();

  const masterHook = useModuleData<Company>('companies', 'companies');
  const assignments = useModuleData<Assignment>('companies', 'assignments');
  const comments = useModuleData<CompanyComment>('companies', 'comments');
  const activity = useModuleData<ActivityRow>('companies', 'activity');
  // Source Data from the Selection workbook — the universe of 102
  // applicants. Waitlist = these minus the 41 selected (cohort3Aliases).
  const sourceData = useModuleData<Applicant>('selection', 'sourceData');

  // Cohort 3 only — canonical alias map is the truth.
  const cohort = useMemo(() => masterHook.rows.filter(inCohort3), [masterHook.rows]);

  // Waitlist = source-data rows whose name does NOT resolve to a cohort 3
  // canonical (strict OR loose match). Diagnostic surfaces unmatched
  // canonicals so the user can see which selected names are missing
  // aliases — without this you can't tell why the count drifts.
  const { waitlist, matchedCanonicals, unmatchedCanonicals } = useMemo(() => {
    const seen = new Set<string>();
    const wl: Company[] = [];
    const matched = new Set<string>();
    for (const a of sourceData.rows) {
      const name = applicantName(a);
      if (!name.trim()) continue;
      const canon = looseCohortMatch(name);
      if (canon) {
        matched.add(canon);
        continue; // belongs to the 41 selected
      }
      const key = name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      wl.push(applicantToCard(a));
    }
    const unmatched = COHORT3_ALIASES
      .filter(e => !matched.has(e.canonical))
      .map(e => e.canonical);
    return { waitlist: wl, matchedCanonicals: matched, unmatchedCanonicals: unmatched };
  }, [sourceData.rows]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void matchedCanonicals;

  // Mine scope = subset of cohort whose AM is the signed-in user.
  const mine = useMemo(
    () => cohort.filter(c => (c.profile_manager_email || '').toLowerCase() === me),
    [cohort, me],
  );

  // Filters
  const [query, setQuery] = useState('');
  const [filterAm, setFilterAm] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPillar, setFilterPillar] = useState<string>('');
  const [filterFund, setFilterFund] = useState<string>('');

  // Deep-link filters from /admin home cards: ?city=Ramallah, ?sub=C-Suite.
  // Read via search params so removing the chip can clear the URL too.
  const [searchParams, setSearchParams] = useSearchParams();
  const filterCity = searchParams.get('city') || '';
  const filterSub = searchParams.get('sub') || '';
  const clearDeepLink = (key: 'city' | 'sub') => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  // Scope persisted in the URL so navigating away & back keeps it.
  const scopeParam = (searchParams.get('scope') as Scope | null);
  const defaultScope: Scope = mine.length > 0 ? 'mine' : 'selected';
  const scope: Scope = scopeParam === 'mine' || scopeParam === 'selected' || scopeParam === 'waitlist'
    ? scopeParam
    : defaultScope;
  const setScope = (next: Scope) => {
    const p = new URLSearchParams(searchParams);
    if (next === defaultScope) p.delete('scope');
    else p.set('scope', next);
    setSearchParams(p, { replace: true });
  };

  // Per-company aggregates (only meaningful for selected/mine — waitlist has none).
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

  const baseRows: Company[] = scope === 'mine' ? mine
                            : scope === 'selected' ? cohort
                            : waitlist;
  const isWaitlistScope = scope === 'waitlist';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cityNorm = filterCity.trim().toLowerCase();
    return baseRows.filter(c => {
      const cAsg = asgByCompany.get(c.company_id) ?? [];
      const text = `${c.company_name} ${c.city} ${c.governorate} ${c.sector}`.toLowerCase();
      if (q && !text.includes(q)) return false;
      // AM / status / pillar / fund filters only apply to master-row scopes.
      if (!isWaitlistScope) {
        const am = (c.profile_manager_email || '').toLowerCase();
        if (filterAm === '__none__' && am) return false;
        if (filterAm && filterAm !== '__none__' && am !== filterAm) return false;
        if (filterStatus && (c.status || '').trim() !== filterStatus) return false;
        if (filterFund && (c.fund_code || '').trim() !== filterFund) return false;
        if (filterPillar) {
          const pillars = new Set(cAsg.map(a => pillarFor(a.intervention_type)?.code).filter(Boolean) as string[]);
          if (!pillars.has(filterPillar)) return false;
        }
        if (filterSub) {
          const subs = new Set(cAsg.map(a => resolveIntervention(a.intervention_type)?.sub).filter(Boolean) as string[]);
          if (!subs.has(filterSub)) return false;
        }
      }
      // Deep-link filters from HomePage / MyHub insight cards:
      if (cityNorm && (c.city || '').trim().toLowerCase() !== cityNorm) return false;
      return true;
    });
  }, [baseRows, asgByCompany, query, filterAm, filterStatus, filterFund, filterPillar, filterCity, filterSub, isWaitlistScope]);

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
    sourceData.refresh();
  };

  const hasActiveFilter = !!(query || filterAm || filterStatus || filterPillar || filterFund || filterCity || filterSub);
  const cohortSize = COHORT3_ALIASES.length;
  const cohortInterventions = useMemo(
    () => assignments.rows.filter(a => cohort.some(c => c.company_id === a.company_id)).length,
    [assignments.rows, cohort],
  );

  const matchedCount = cohortSize - unmatchedCanonicals.length;
  const subtitle = scope === 'mine'
    ? `Mine · ${mine.length} of ${cohortSize} selected companies are assigned to you.`
    : scope === 'selected'
      ? `Selected · ${cohortSize} cohort 3 companies.`
      : `Waitlist · ${waitlist.length} applicants (Source Data ${sourceData.rows.length} − ${matchedCount} matched of ${cohortSize} selected).`;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Companies"
        subtitle={subtitle}
        badges={
          isWaitlistScope
            ? [{ label: `${sorted.length} of ${waitlist.length}`, tone: 'amber' }]
            : [
                { label: `${sorted.length} of ${baseRows.length}`, tone: 'teal' },
                { label: `${cohortInterventions} interventions`, tone: 'teal' },
              ]
        }
        actions={
          <div className="flex items-center gap-2">
            <ScopeToggle
              scope={scope}
              mineCount={mine.length}
              selectedCount={cohort.length || cohortSize}
              waitlistCount={waitlist.length}
              onChange={setScope}
            />
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
          {!isWaitlistScope && (
            <>
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
            </>
          )}
          {hasActiveFilter && (
            <Button variant="ghost" onClick={() => { setQuery(''); setFilterAm(''); setFilterStatus(''); setFilterPillar(''); setFilterFund(''); }}>
              <FilterIcon className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
        {(filterCity || filterSub) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-bold uppercase tracking-wider text-slate-400">From Home:</span>
            {filterCity && (
              <button
                type="button"
                onClick={() => clearDeepLink('city')}
                className="inline-flex items-center gap-1 rounded-full border border-brand-teal/30 bg-brand-teal/10 px-2 py-0.5 text-2xs font-semibold text-brand-teal hover:bg-brand-teal/20"
                title="Remove city filter"
              >
                <MapPin className="h-3 w-3" /> {filterCity}
                <X className="h-3 w-3 opacity-70" />
              </button>
            )}
            {filterSub && (
              <button
                type="button"
                onClick={() => clearDeepLink('sub')}
                className="inline-flex items-center gap-1 rounded-full border border-brand-red/30 bg-brand-red/10 px-2 py-0.5 text-2xs font-semibold text-brand-red hover:bg-brand-red/20"
                title="Remove sub-intervention filter"
              >
                {filterSub}
                <X className="h-3 w-3 opacity-70" />
              </button>
            )}
          </div>
        )}
      </Card>

      {scope === 'waitlist' && unmatchedCanonicals.length > 0 && sourceData.rows.length > 0 && (
        <Card className="border-l-4 border-l-amber-400">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                {unmatchedCanonicals.length} of {COHORT3_ALIASES.length} selected companies couldn't be matched in Source Data
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                These canonicals from <code>cohort3Aliases.ts</code> have no Source Data row that resolved to them (strict + loose matching tried).
                Their applicants are likely sitting in the waitlist below under a spelling not in the alias list — inflating the count from {COHORT3_ALIASES.length - unmatchedCanonicals.length + waitlist.length} to {waitlist.length}.
                Add the Source Data spelling as an alias to fix.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {unmatchedCanonicals.map(n => (
                  <li key={n} className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={
              hasActiveFilter
                ? 'No companies match these filters'
                : scope === 'waitlist'
                  ? 'No waitlist applicants found'
                  : scope === 'mine'
                    ? 'You have no assigned companies'
                    : 'No cohort 3 companies yet'
            }
            description={
              hasActiveFilter
                ? 'Try clearing a filter or widening your search.'
                : scope === 'waitlist'
                  ? 'Either the Source Data tab is empty, or every applicant resolved to the selected 41.'
                  : 'Run the cohort allocation seed in /import to populate the cohort.'
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map(c => (
            <CompanyCard
              key={c.company_id}
              company={c}
              assignments={isWaitlistScope ? [] : (asgByCompany.get(c.company_id) ?? [])}
              commentCount={isWaitlistScope ? 0 : (commentCountByCompany.get(c.company_id) ?? 0)}
              lastActivity={isWaitlistScope ? undefined : lastActivityByCompany.get(c.company_id)}
              isWaitlist={isWaitlistScope}
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
  isWaitlist,
}: {
  company: Company;
  assignments: Assignment[];
  commentCount: number;
  lastActivity?: ActivityRow;
  isWaitlist?: boolean;
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
  const amName = amEmail ? displayName(amEmail).split(' ')[0] : (isWaitlist ? null : 'Unassigned');
  const isWithdrawn = (company.status || '').toLowerCase() === 'withdrawn';
  const railClass = isWaitlist ? 'bg-slate-300 dark:bg-navy-600' : (AM_RAIL[amEmail] || 'bg-slate-300');

  return (
    <Link
      to={`/companies/${encodeURIComponent(company.company_id)}`}
      className={`group relative flex overflow-hidden rounded-lg border bg-white text-sm transition-all hover:border-brand-teal/50 hover:shadow-sm dark:bg-navy-900 ${
        isWithdrawn
          ? 'border-red-200 opacity-70 hover:opacity-100 dark:border-red-900'
          : isWaitlist
            ? 'border-slate-200 border-dashed dark:border-navy-700'
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
              {amName && <span>· {amName}</span>}
            </div>
          </div>
          <Badge tone={isWaitlist ? 'amber' : statusTone(company.status || 'Active') as Tone}>
            {isWaitlist ? 'Waitlist' : (company.status || 'Active')}
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
            {!isWaitlist && (
              <>
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
              </>
            )}
            {isWaitlist && company.employee_count && (
              <span title="Team size">{company.employee_count} emp</span>
            )}
          </div>
          {lastActivity && !isWaitlist && (
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
  scope, mineCount, selectedCount, waitlistCount, onChange,
}: {
  scope: Scope;
  mineCount: number;
  selectedCount: number;
  waitlistCount: number;
  onChange: (next: Scope) => void;
}) {
  const btn = (key: Scope, label: string, count: number) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      className={`px-3 py-1.5 text-xs font-semibold ${
        scope === key ? 'bg-brand-teal text-white'
          : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-navy-800 dark:text-slate-300'
      }`}
    >
      {label} ({count})
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
      {btn('mine', 'Mine', mineCount)}
      {btn('selected', 'All selected', selectedCount)}
      {btn('waitlist', 'Waitlist', waitlistCount)}
    </div>
  );
}
