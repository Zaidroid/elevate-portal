// Matching tab — pair admitted ElevateBridge freelancers (the 29 active)
// with Cohort 3 tech companies that need ElevateBridge support. Built from
// scratch to fit the HQ design: KPI cards + sub-tabs + DataTable + drawer.
//
// Three sub-views:
//   Matches    — every match row (one per freelancer-company pair) with status
//   Freelancers — admitted pool, click → see suggested companies + create match
//   Companies  — Cohort 3 companies needing EB, click → see suggested freelancers
//
// Storage: a new `Matches` tab in the elevateBridge workbook. The match
// row carries denormalised name/email/company_name copies so the table
// renders without joins.

import { useMemo, useState } from 'react';
import {
  Building2,
  Handshake,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  FilterDrawer,
  FilterToggleButton,
  Tabs,
  useToast,
} from '../../lib/ui';
import type { Column, FilterDrawerValues, FilterFieldDef, TabItem } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { resolveIntervention } from '../../config/interventions';
import type {
  EbDecisionRow,
  EbMatch,
  EbTopPerformer,
} from '../../types/elevateBridge';
import { TRACK_LABEL, TRACK_TONE } from './utils';
import { appendEbActivity } from './activityLog';

// True if a row's intervention fields resolve to the ElevateBridge sub.
// Handles all legacy spellings (MA-Bridge, MA- Bridge, MA-ElevateBridge,
// Bridge) plus the canonical 'ElevateBridge' in either column or as the
// sub field on a pillar row.
function isElevateBridge(intervention_type?: string, sub_intervention?: string): boolean {
  const inputs = [intervention_type, sub_intervention].filter(Boolean) as string[];
  for (const code of inputs) {
    const resolved = resolveIntervention(code);
    if (resolved?.sub === 'ElevateBridge') return true;
  }
  return false;
}

type Props = {
  sheetId: string;
  userEmail: string;
  canEdit: boolean;
};

type AdmittedFreelancer = {
  applicant_id: string;
  name: string;
  email: string;
  phone: string;
  track: string;            // FL | SM | FL+SM
  region: string;
  specialization: string;
  performance_score: string;
  area: string;
  matches: EbMatch[];
};

type EbCompanyNeed = {
  company_id: string;
  company_name: string;
  sector: string;
  governorate: string;
  status: string;
  am_email: string;
  assignment_status: string; // e.g. 'In Progress'
  matches: EbMatch[];
};

const MATCH_TONE: Record<string, 'teal' | 'orange' | 'red' | 'neutral' | 'green' | 'amber'> = {
  Proposed: 'amber',
  Engaged: 'teal',
  Producing: 'green',
  Completed: 'neutral',
  Cancelled: 'red',
};

const MATCH_STATUSES = ['Proposed', 'Engaged', 'Producing', 'Completed', 'Cancelled'] as const;

export function MatchingTab({ sheetId, userEmail, canEdit }: Props) {
  const toast = useToast();

  // --- Data ---
  const matchesHook   = useModuleData<EbMatch>('elevateBridge', 'matches');
  const decisionsHook = useModuleData<EbDecisionRow>('elevateBridge', 'decisions');
  const topHook       = useModuleData<EbTopPerformer>('elevateBridge', 'topPerformers');
  // Companies + their open assignments AND pre-decision recommendations.
  // Pre-decisions surface companies the team has decided on for EB even
  // before an assignment row is materialized — these are the "selected
  // for the sub intervention" cases.
  const companiesHook    = useModuleData<Record<string, string>>('companies', 'companies');
  const assignmentsHook  = useModuleData<Record<string, string>>('companies', 'assignments');
  const preDecisionsHook = useModuleData<Record<string, string>>('companies', 'preDecisions');
  const reviewsHook      = useModuleData<Record<string, string>>('companies', 'reviews');

  // --- Derived: admitted freelancers ---
  const admittedFreelancers = useMemo<AdmittedFreelancer[]>(() => {
    // Source-of-truth list = anyone with decision='Admitted' OR appearing in Top Performers.
    const byEmail = new Map<string, AdmittedFreelancer>();
    for (const d of decisionsHook.rows) {
      if (d.decision !== 'Admitted') continue;
      const e = (d.email || '').toLowerCase();
      if (!e) continue;
      byEmail.set(e, {
        applicant_id: d.applicant_id,
        name: d.full_name || d.email,
        email: d.email,
        phone: '',
        track: d.track,
        region: '',
        specialization: '',
        performance_score: d.final_score,
        area: '',
        matches: [],
      });
    }
    for (const t of topHook.rows) {
      const e = (t.email || '').toLowerCase();
      if (!e) continue;
      const existing = byEmail.get(e);
      if (existing) {
        existing.phone = existing.phone || t.phone;
        existing.region = existing.region || t.area;
        existing.specialization = existing.specialization || t.specialization;
        existing.area = t.area;
        existing.performance_score = existing.performance_score || t.performance_score || t.total_earnings;
      } else {
        byEmail.set(e, {
          applicant_id: t.applicant_id,
          name: t.full_name_en || t.full_name_ar || t.email,
          email: t.email,
          phone: t.phone,
          track: t.track,
          region: t.area,
          specialization: t.specialization,
          performance_score: t.performance_score || t.total_earnings,
          area: t.area,
          matches: [],
        });
      }
    }
    // Attach matches.
    for (const m of matchesHook.rows) {
      const e = (m.freelancer_email || '').toLowerCase();
      const target = byEmail.get(e) || (m.applicant_id ? Array.from(byEmail.values()).find(f => f.applicant_id === m.applicant_id) : undefined);
      if (target) target.matches.push(m);
    }
    return Array.from(byEmail.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [decisionsHook.rows, topHook.rows, matchesHook.rows]);

  // --- Derived: companies needing EB ---
  //
  // A company is treated as "needing EB support" if ANY of these is true:
  //   1. companies::assignments has a row with intervention_type or
  //      sub_intervention resolving to ElevateBridge, and the assignment
  //      status is not Completed/Cancelled.
  //   2. companies::preDecisions has a recommendation with sub='ElevateBridge'
  //      (a team member has already locked EB as the proposed sub).
  //   3. companies::reviews has a row whose proposed_sub_interventions
  //      list includes 'ElevateBridge' and the decision is Recommend.
  //
  // Union all three by company_id and join against companies::companies
  // for display fields. The source (assignment | pre-decision | review)
  // is surfaced as `signal` so the UI can show the team where it came
  // from before the company has an assignment row.
  const companyNeeds = useMemo<EbCompanyNeed[]>(() => {
    type Signal = { status: string; am: string; source: 'assignment' | 'pre-decision' | 'review' };
    const signals = new Map<string, Signal>();

    // 1) Assignments
    for (const a of assignmentsHook.rows) {
      if (!isElevateBridge(a.intervention_type, a.sub_intervention)) continue;
      const st = (a.status || '').toLowerCase();
      if (st === 'completed' || st === 'cancelled') continue;
      const cid = a.company_id;
      if (!cid) continue;
      signals.set(cid, {
        status: a.status || 'In Progress',
        am: a.assignee_email || '',
        source: 'assignment',
      });
    }

    // 2) Pre-decisions
    for (const p of preDecisionsHook.rows) {
      const sub = (p.sub_intervention || '').trim();
      const pillar = (p.pillar || '').trim();
      if (!isElevateBridge(pillar, sub) && sub !== 'ElevateBridge') continue;
      const cid = p.company_id;
      if (!cid) continue;
      // Only set if we don't already have a stronger (assignment) signal.
      if (!signals.has(cid)) {
        signals.set(cid, { status: 'Pre-decision', am: '', source: 'pre-decision' });
      }
    }

    // 3) Reviews — proposed_sub_interventions is a comma-separated list.
    for (const r of reviewsHook.rows) {
      const decision = (r.decision || '').toLowerCase();
      if (decision !== 'recommend' && decision !== 'approve' && decision !== 'recommended') continue;
      const subs = (r.proposed_sub_interventions || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
      // Run through the canonical taxonomy so legacy spellings still match.
      if (!subs.some(s => resolveIntervention(s)?.sub === 'ElevateBridge')) continue;
      const cid = r.company_id;
      if (!cid) continue;
      if (!signals.has(cid)) {
        signals.set(cid, { status: 'Recommended', am: r.user_email || '', source: 'review' });
      }
    }

    const list: EbCompanyNeed[] = [];
    for (const c of companiesHook.rows) {
      const sig = signals.get(c.company_id);
      if (!sig) continue;
      list.push({
        company_id: c.company_id,
        company_name: c.company_name || c.company_id,
        sector: c.sector || '',
        governorate: c.governorate || '',
        status: c.status || '',
        am_email: sig.am || c.profile_manager_email || '',
        assignment_status: sig.source === 'assignment'
          ? (sig.status || 'In Progress')
          : sig.source === 'pre-decision' ? 'Pre-decision' : 'Recommended',
        matches: [],
      });
    }
    for (const m of matchesHook.rows) {
      const item = list.find(x => x.company_id === m.company_id);
      if (item) item.matches.push(m);
    }
    return list.sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [companiesHook.rows, assignmentsHook.rows, preDecisionsHook.rows, reviewsHook.rows, matchesHook.rows]);

  // --- Stats ---
  const activeMatches = matchesHook.rows.filter(m =>
    ['Proposed', 'Engaged', 'Producing'].includes(m.status)
  );
  const freelancersWithMatches = admittedFreelancers.filter(f =>
    f.matches.some(m => ['Proposed', 'Engaged', 'Producing'].includes(m.status))
  );
  const companiesMatched = companyNeeds.filter(c =>
    c.matches.some(m => ['Proposed', 'Engaged', 'Producing'].includes(m.status))
  );

  // --- Sub-tab state ---
  const [view, setView] = useState<'matches' | 'freelancers' | 'companies'>('matches');
  const [query, setQuery] = useState('');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [values, setValues] = useState<FilterDrawerValues>({
    tracks: [],
    statuses: [],
    matchState: '',
  });

  // --- Drawers ---
  const [openFreelancer, setOpenFreelancer] = useState<AdmittedFreelancer | null>(null);
  const [openCompany, setOpenCompany] = useState<EbCompanyNeed | null>(null);
  const [openMatch, setOpenMatch] = useState<EbMatch | null>(null);
  const [creatingMatch, setCreatingMatch] = useState<{ freelancer?: AdmittedFreelancer; company?: EbCompanyNeed } | null>(null);

  // --- Match handlers ---
  const createMatch = async (input: { freelancer: AdmittedFreelancer; company: EbCompanyNeed; track: string; status?: string; hours?: string; notes?: string }) => {
    const id = `MTC-${Date.now()}-${input.freelancer.applicant_id.slice(-4)}`;
    const now = new Date().toISOString();
    const payload: Partial<EbMatch> = {
      match_id: id,
      applicant_id: input.freelancer.applicant_id,
      freelancer_name: input.freelancer.name,
      freelancer_email: input.freelancer.email,
      company_id: input.company.company_id,
      company_name: input.company.company_name,
      track: input.track,
      status: input.status || 'Proposed',
      hours_per_week: input.hours || '10',
      start_date: '',
      end_date: '',
      notes: input.notes || '',
      created_by: userEmail,
      created_at: now,
      updated_at: now,
      updated_by: userEmail,
    };
    try {
      await matchesHook.createRow(payload as Partial<Record<string, string>>);
      void appendEbActivity({
        sheetId, tabName: 'ActivityLog', user_email: userEmail,
        entity_type: 'match', entity_id: id, action: 'session_created' as const,
        new_value: `${input.freelancer.name} → ${input.company.company_name}`,
        details: `${input.track} · ${input.status || 'Proposed'}`,
      });
      toast.success('Match created');
      setCreatingMatch(null);
    } catch (err) {
      toast.error('Match failed', (err as Error).message);
    }
  };

  const updateMatch = async (id: string, updates: Partial<EbMatch>) => {
    try {
      const before = matchesHook.rows.find(m => m.match_id === id);
      await matchesHook.updateRow(id, {
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: userEmail,
      } as Partial<Record<string, string>>);
      if (before && updates.status && before.status !== updates.status) {
        void appendEbActivity({
          sheetId, tabName: 'ActivityLog', user_email: userEmail,
          entity_type: 'match', entity_id: id, action: 'session_updated' as const,
          field: 'status',
          old_value: before.status,
          new_value: updates.status,
          details: `${before.freelancer_name} → ${before.company_name}`,
        });
      }
      toast.success('Match updated');
      setOpenMatch(null);
    } catch (err) {
      toast.error('Update failed', (err as Error).message);
    }
  };

  // --- Smart-match scoring ---
  function scoreFreelancerForCompany(f: AdmittedFreelancer, c: EbCompanyNeed): number {
    let s = 0;
    // Track present is a base score.
    if (f.track) s += 5;
    // Specialization vs sector keyword overlap.
    const spec = (f.specialization || '').toLowerCase();
    const sector = (c.sector || '').toLowerCase();
    if (spec && sector) {
      const overlap = spec.split(/\s|,|&|\//).some(w => w.length > 3 && sector.includes(w));
      if (overlap) s += 15;
    }
    // Existing performance score (numeric).
    const perf = Number(f.performance_score || '0') || 0;
    s += Math.min(20, perf / 5);
    // Penalty if already engaged on 2+ active matches.
    const active = f.matches.filter(m => ['Engaged', 'Producing'].includes(m.status)).length;
    s -= active * 8;
    return Math.max(0, Math.round(s));
  }

  // --- Matches table ---
  const matchesFiltered = useMemo<EbMatch[]>(() => {
    const q = query.toLowerCase().trim();
    const tracks = (Array.isArray(values.tracks) ? values.tracks : []) as string[];
    const statuses = (Array.isArray(values.statuses) ? values.statuses : []) as string[];
    return matchesHook.rows
      .filter(m => {
        if (q) {
          const hay = `${m.freelancer_name} ${m.freelancer_email} ${m.company_name}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (tracks.length > 0 && !tracks.includes(m.track || '')) return false;
        if (statuses.length > 0 && !statuses.includes(m.status || '')) return false;
        return true;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [matchesHook.rows, query, values]);

  const filterFields = useMemo<FilterFieldDef[]>(() => {
    if (view === 'matches') {
      return [
        { key: 'tracks', type: 'multiselect', label: 'Track', options: [
          { value: 'FL', label: 'FL' }, { value: 'SM', label: 'SM' }, { value: 'FL+SM', label: 'FL+SM' },
        ]},
        { key: 'statuses', type: 'multiselect', label: 'Status', options: MATCH_STATUSES.map(s => ({ value: s, label: s })) },
      ];
    }
    return [
      { key: 'tracks', type: 'multiselect', label: 'Track', options: [
        { value: 'FL', label: 'FL' }, { value: 'SM', label: 'SM' }, { value: 'FL+SM', label: 'FL+SM' },
      ]},
      { key: 'matchState', type: 'chips', label: 'Match status', options: [
        { value: 'matched', label: 'Has active match' },
        { value: 'unmatched', label: 'No active match' },
      ]},
    ];
  }, [view]);

  // --- Freelancers / Companies filtered ---
  const freelancersFiltered = useMemo<AdmittedFreelancer[]>(() => {
    const q = query.toLowerCase().trim();
    const tracks = (Array.isArray(values.tracks) ? values.tracks : []) as string[];
    const matchState = typeof values.matchState === 'string' ? values.matchState : '';
    return admittedFreelancers.filter(f => {
      if (q) {
        const hay = `${f.name} ${f.email} ${f.specialization} ${f.region}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (tracks.length > 0 && !tracks.includes(f.track || '')) return false;
      const hasActive = f.matches.some(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status));
      if (matchState === 'matched' && !hasActive) return false;
      if (matchState === 'unmatched' && hasActive) return false;
      return true;
    });
  }, [admittedFreelancers, query, values]);

  const companiesFiltered = useMemo<EbCompanyNeed[]>(() => {
    const q = query.toLowerCase().trim();
    const matchState = typeof values.matchState === 'string' ? values.matchState : '';
    return companyNeeds.filter(c => {
      if (q) {
        const hay = `${c.company_name} ${c.sector} ${c.governorate}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const hasActive = c.matches.some(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status));
      if (matchState === 'matched' && !hasActive) return false;
      if (matchState === 'unmatched' && hasActive) return false;
      return true;
    });
  }, [companyNeeds, query, values]);

  // --- Table columns ---
  const matchColumns: Column<EbMatch>[] = [
    { key: 'freelancer_name', header: 'Freelancer', render: m => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-navy-500 dark:text-white">{m.freelancer_name}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{m.freelancer_email}</div>
      </div>
    )},
    { key: 'company_name', header: 'Company', render: m => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-navy-500 dark:text-white">{m.company_name || m.company_id}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{m.company_id}</div>
      </div>
    )},
    { key: 'track', header: 'Track', render: m => m.track ? <Badge tone={TRACK_TONE[m.track] || 'neutral'}>{m.track}</Badge> : '—' },
    { key: 'status', header: 'Status', render: m => <Badge tone={MATCH_TONE[m.status] || 'neutral'}>{m.status || '—'}</Badge> },
    { key: 'hours_per_week', header: 'Hrs/wk', render: m => m.hours_per_week || '—' },
    { key: 'start_date', header: 'Start', render: m => m.start_date || '—' },
  ];

  const freelancerColumns: Column<AdmittedFreelancer>[] = [
    { key: 'name', header: 'Name', render: f => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-navy-500 dark:text-white">{f.name}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{f.email}</div>
      </div>
    )},
    { key: 'track', header: 'Track', render: f => f.track ? <Badge tone={TRACK_TONE[f.track] || 'neutral'}>{f.track}</Badge> : '—' },
    { key: 'region', header: 'Region', render: f => f.region || '—' },
    { key: 'specialization', header: 'Specialization', render: f => f.specialization || '—' },
    { key: 'performance_score', header: 'Score', render: f => <span className="font-mono">{f.performance_score || '—'}</span> },
    { key: 'matches', header: 'Active', render: f => {
      const active = f.matches.filter(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status));
      return active.length === 0
        ? <span className="text-slate-400 text-xs">—</span>
        : <Badge tone="teal">{active.length} match{active.length === 1 ? '' : 'es'}</Badge>;
    }},
  ];

  const companyColumns: Column<EbCompanyNeed>[] = [
    { key: 'company_name', header: 'Company', render: c => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-navy-500 dark:text-white">{c.company_name}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{c.company_id}</div>
      </div>
    )},
    { key: 'sector', header: 'Sector', render: c => c.sector || '—' },
    { key: 'governorate', header: 'Governorate', render: c => c.governorate || '—' },
    { key: 'am_email', header: 'AM', render: c => c.am_email || '—' },
    { key: 'assignment_status', header: 'EB Status', render: c => {
      const s = c.assignment_status || 'Open';
      const tone: 'teal' | 'amber' | 'orange' | 'neutral' =
        s === 'Recommended' ? 'orange' :
        s === 'Pre-decision' ? 'amber' :
        s === 'Completed' ? 'neutral' :
        'teal';
      return <Badge tone={tone}>{s}</Badge>;
    }},
    { key: 'matches', header: 'Active', render: c => {
      const active = c.matches.filter(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status));
      return active.length === 0
        ? <span className="text-slate-400 text-xs">—</span>
        : <Badge tone="teal">{active.length} freelancer{active.length === 1 ? '' : 's'}</Badge>;
    }},
  ];

  const subTabs: TabItem[] = [
    { value: 'matches', label: 'Matches', icon: <Handshake className="h-4 w-4" />, count: activeMatches.length },
    { value: 'freelancers', label: 'Freelancers', icon: <Users className="h-4 w-4" />, count: admittedFreelancers.length },
    { value: 'companies', label: 'Companies', icon: <Building2 className="h-4 w-4" />, count: companyNeeds.length },
  ];

  const loading = decisionsHook.loading || matchesHook.loading || companiesHook.loading;
  const error = matchesHook.error || decisionsHook.error || companiesHook.error
    || assignmentsHook.error || preDecisionsHook.error || reviewsHook.error;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Users />} label="Admitted freelancers" value={admittedFreelancers.length.toString()} hint={`${freelancersWithMatches.length} matched`} accent="teal" />
        <StatCard icon={<Building2 />} label="Companies needing EB" value={companyNeeds.length.toString()} hint={`${companiesMatched.length} matched`} accent="orange" />
        <StatCard icon={<Handshake />} label="Active matches" value={activeMatches.length.toString()} hint={`${matchesHook.rows.length} total`} accent="red" />
        <StatCard icon={<TrendingUp />} label="Producing" value={matchesHook.rows.filter(m => m.status === 'Producing').length.toString()} hint="live engagements" accent="teal" />
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load matching data: {error.message}</p>
        </Card>
      )}

      <Tabs items={subTabs} value={view} onChange={v => { setView(v as typeof view); setQuery(''); setValues({ tracks: [], statuses: [], matchState: '' }); }} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={view === 'matches' ? 'Search matches…' : view === 'freelancers' ? 'Search freelancers…' : 'Search companies…'}
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <FilterToggleButton
          count={
            (Array.isArray(values.tracks) ? values.tracks.length : 0)
            + (Array.isArray(values.statuses) ? values.statuses.length : 0)
            + (typeof values.matchState === 'string' && values.matchState ? 1 : 0)
          }
          onClick={() => setFilterDrawerOpen(true)}
        />
        {canEdit && view === 'matches' && (
          <Button variant="primary" onClick={() => setCreatingMatch({})}>
            <Plus className="mr-1 h-4 w-4" /> New match
          </Button>
        )}
        <Button variant="ghost" onClick={() => { matchesHook.refresh(); decisionsHook.refresh(); companiesHook.refresh(); assignmentsHook.refresh(); preDecisionsHook.refresh(); reviewsHook.refresh(); }} title="Reload">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Sub-view content */}
      {view === 'matches' && (
        matchesHook.rows.length === 0 && !loading
          ? <EmptyMatchesCard canEdit={canEdit} onCreate={() => setCreatingMatch({})} />
          : <DataTable<EbMatch> columns={matchColumns} rows={matchesFiltered} onRowClick={r => setOpenMatch(r)} emptyState="No matches yet." />
      )}

      {view === 'freelancers' && (
        <DataTable<AdmittedFreelancer> columns={freelancerColumns} rows={freelancersFiltered} onRowClick={r => setOpenFreelancer(r)} emptyState="No admitted freelancers. Mark applicants as Admitted in the Applicants tab." />
      )}

      {view === 'companies' && (
        <DataTable<EbCompanyNeed> columns={companyColumns} rows={companiesFiltered} onRowClick={r => setOpenCompany(r)} emptyState="No Cohort 3 companies currently need ElevateBridge support." />
      )}

      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        searchValue={query}
        onSearchChange={setQuery}
        fields={filterFields}
        values={values}
        onValuesChange={setValues}
        total={view === 'matches' ? matchesHook.rows.length : view === 'freelancers' ? admittedFreelancers.length : companyNeeds.length}
        filtered={view === 'matches' ? matchesFiltered.length : view === 'freelancers' ? freelancersFiltered.length : companiesFiltered.length}
        resultNoun={view}
      />

      {/* Freelancer drawer: suggestions for companies to pair them with */}
      {openFreelancer && (
        <Drawer
          open
          onClose={() => setOpenFreelancer(null)}
          title={openFreelancer.name}
          subtitle={`${TRACK_LABEL[openFreelancer.track] || openFreelancer.track || 'No track'} · ${openFreelancer.region || '—'} · ${openFreelancer.specialization || '—'}`}
          width="max-w-2xl"
        >
          <FreelancerSuggestions
            freelancer={openFreelancer}
            companies={companyNeeds}
            canEdit={canEdit}
            score={(c) => scoreFreelancerForCompany(openFreelancer, c)}
            onCreate={(company) => {
              setCreatingMatch({ freelancer: openFreelancer, company });
              setOpenFreelancer(null);
            }}
          />
        </Drawer>
      )}

      {/* Company drawer: suggestions for freelancers to pair them with */}
      {openCompany && (
        <Drawer
          open
          onClose={() => setOpenCompany(null)}
          title={openCompany.company_name}
          subtitle={`${openCompany.sector || 'No sector'} · ${openCompany.governorate || '—'} · AM: ${openCompany.am_email || '—'}`}
          width="max-w-2xl"
        >
          <CompanySuggestions
            company={openCompany}
            freelancers={admittedFreelancers}
            canEdit={canEdit}
            score={(f) => scoreFreelancerForCompany(f, openCompany)}
            onCreate={(freelancer) => {
              setCreatingMatch({ freelancer, company: openCompany });
              setOpenCompany(null);
            }}
          />
        </Drawer>
      )}

      {/* Match edit drawer */}
      {openMatch && (
        <MatchEditDrawer
          match={openMatch}
          canEdit={canEdit}
          onClose={() => setOpenMatch(null)}
          onSave={(updates) => updateMatch(openMatch.match_id, updates)}
        />
      )}

      {/* Create match drawer */}
      {creatingMatch && (
        <CreateMatchDrawer
          initial={creatingMatch}
          freelancers={admittedFreelancers}
          companies={companyNeeds}
          onCancel={() => setCreatingMatch(null)}
          onCreate={(payload) => createMatch(payload)}
        />
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function StatCard({ icon, label, value, hint, accent }: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
  accent: 'teal' | 'orange' | 'red' | 'navy';
}) {
  const accentClass =
    accent === 'teal' ? 'text-brand-teal' :
    accent === 'orange' ? 'text-brand-orange' :
    accent === 'red' ? 'text-brand-red' :
    'text-navy-500 dark:text-white';
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className={`flex-shrink-0 rounded-lg p-2 ${accentClass} bg-slate-100 dark:bg-navy-700`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-2xs font-bold uppercase tracking-[0.1em] text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-extrabold text-navy-500 dark:text-white">{value}</div>
          {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}

function EmptyMatchesCard({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<Handshake className="h-6 w-6" />}
        title="No matches yet"
        description="Pair an admitted freelancer with a Cohort 3 company that needs ElevateBridge support. Open the Freelancers or Companies tab to see smart-match suggestions."
        action={canEdit ? <Button variant="primary" onClick={onCreate}><Plus className="mr-1 h-4 w-4" /> Create the first match</Button> : null}
      />
    </Card>
  );
}

function FreelancerSuggestions({
  freelancer, companies, canEdit, score, onCreate,
}: {
  freelancer: AdmittedFreelancer;
  companies: EbCompanyNeed[];
  canEdit: boolean;
  score: (c: EbCompanyNeed) => number;
  onCreate: (c: EbCompanyNeed) => void;
}) {
  const matchedIds = new Set(
    freelancer.matches.filter(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status)).map(m => m.company_id)
  );
  const candidates = companies
    .filter(c => !matchedIds.has(c.company_id))
    .map(c => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s);

  return (
    <div className="space-y-4">
      {freelancer.matches.length > 0 && (
        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Existing matches</h4>
          {freelancer.matches.map(m => (
            <div key={m.match_id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm dark:border-navy-700">
              <span>{m.company_name}</span>
              <Badge tone={MATCH_TONE[m.status] || 'neutral'}>{m.status}</Badge>
            </div>
          ))}
        </section>
      )}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">
          <Sparkles className="h-3 w-3 text-brand-teal" /> Suggested companies
        </h4>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">No open Cohort 3 EB engagements to suggest.</p>
        ) : (
          candidates.slice(0, 12).map(({ c, s }) => (
            <div key={c.company_id} className="flex items-center justify-between border-b border-slate-100 py-2 dark:border-navy-700">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-navy-500 dark:text-white">{c.company_name}</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{c.sector} · {c.governorate}</div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Badge tone={s >= 25 ? 'teal' : s >= 15 ? 'orange' : 'neutral'}>fit {s}</Badge>
                {canEdit && <Button variant="ghost" onClick={() => onCreate(c)}><Plus className="h-3 w-3" /></Button>}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function CompanySuggestions({
  company, freelancers, canEdit, score, onCreate,
}: {
  company: EbCompanyNeed;
  freelancers: AdmittedFreelancer[];
  canEdit: boolean;
  score: (f: AdmittedFreelancer) => number;
  onCreate: (f: AdmittedFreelancer) => void;
}) {
  const matchedIds = new Set(
    company.matches.filter(m => ['Engaged', 'Producing', 'Proposed'].includes(m.status)).map(m => m.applicant_id)
  );
  const candidates = freelancers
    .filter(f => !matchedIds.has(f.applicant_id))
    .map(f => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s);

  return (
    <div className="space-y-4">
      {company.matches.length > 0 && (
        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Existing matches</h4>
          {company.matches.map(m => (
            <div key={m.match_id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm dark:border-navy-700">
              <span>{m.freelancer_name}</span>
              <Badge tone={MATCH_TONE[m.status] || 'neutral'}>{m.status}</Badge>
            </div>
          ))}
        </section>
      )}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">
          <Sparkles className="h-3 w-3 text-brand-teal" /> Suggested freelancers
        </h4>
        {candidates.length === 0 ? (
          <p className="text-sm text-slate-500">No admitted freelancers to suggest.</p>
        ) : (
          candidates.slice(0, 12).map(({ f, s }) => (
            <div key={f.applicant_id} className="flex items-center justify-between border-b border-slate-100 py-2 dark:border-navy-700">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-navy-500 dark:text-white">{f.name}</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {f.track && <Badge tone={TRACK_TONE[f.track] || 'neutral'}>{f.track}</Badge>}{' '}
                  {f.specialization} · {f.region}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Badge tone={s >= 25 ? 'teal' : s >= 15 ? 'orange' : 'neutral'}>fit {s}</Badge>
                {canEdit && <Button variant="ghost" onClick={() => onCreate(f)}><Plus className="h-3 w-3" /></Button>}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function MatchEditDrawer({
  match, canEdit, onClose, onSave,
}: {
  match: EbMatch;
  canEdit: boolean;
  onClose: () => void;
  onSave: (updates: Partial<EbMatch>) => void;
}) {
  const [status, setStatus] = useState(match.status || 'Proposed');
  const [hours, setHours] = useState(match.hours_per_week || '');
  const [start, setStart] = useState(match.start_date || '');
  const [end, setEnd] = useState(match.end_date || '');
  const [notes, setNotes] = useState(match.notes || '');
  const dirty = status !== (match.status || '') || hours !== (match.hours_per_week || '') || start !== (match.start_date || '') || end !== (match.end_date || '') || notes !== (match.notes || '');

  const inp = 'w-full rounded-lg border border-slate-200 bg-brand-editable px-3 py-1.5 text-sm dark:border-navy-700 dark:bg-navy-600 dark:text-white';

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${match.freelancer_name} → ${match.company_name}`}
      subtitle={`${match.track || '—'} · ${match.applicant_id}`}
      width="max-w-xl"
      footer={
        canEdit ? (
          <>
            <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" /> Cancel</Button>
            <Button variant="primary" disabled={!dirty} onClick={() => onSave({ status, hours_per_week: hours, start_date: start, end_date: end, notes })}>
              Save
            </Button>
          </>
        ) : (
          <span className="text-xs text-slate-500">Read-only</span>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} className={inp} disabled={!canEdit}>
            {MATCH_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Hours per week">
          <input type="number" value={hours} onChange={e => setHours(e.target.value)} className={inp} disabled={!canEdit} />
        </Field>
        <Field label="Start date">
          <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inp} disabled={!canEdit} />
        </Field>
        <Field label="End date">
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inp} disabled={!canEdit} />
        </Field>
        <Field label="Notes">
          <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} className={inp} disabled={!canEdit} />
        </Field>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500 dark:bg-navy-700 dark:text-slate-300">
          Created {match.created_at?.slice(0, 10) || '—'} by {match.created_by || '—'}<br/>
          Updated {match.updated_at?.slice(0, 10) || '—'} by {match.updated_by || '—'}
        </div>
      </div>
    </Drawer>
  );
}

function CreateMatchDrawer({
  initial, freelancers, companies, onCancel, onCreate,
}: {
  initial: { freelancer?: AdmittedFreelancer; company?: EbCompanyNeed };
  freelancers: AdmittedFreelancer[];
  companies: EbCompanyNeed[];
  onCancel: () => void;
  onCreate: (payload: { freelancer: AdmittedFreelancer; company: EbCompanyNeed; track: string; status?: string; hours?: string; notes?: string }) => void;
}) {
  const [freelancerId, setFreelancerId] = useState(initial.freelancer?.applicant_id || '');
  const [companyId, setCompanyId] = useState(initial.company?.company_id || '');
  const [track, setTrack] = useState(initial.freelancer?.track || 'FL');
  const [hours, setHours] = useState('10');
  const [notes, setNotes] = useState('');

  const inp = 'w-full rounded-lg border border-slate-200 bg-brand-editable px-3 py-1.5 text-sm dark:border-navy-700 dark:bg-navy-600 dark:text-white';
  const f = freelancers.find(x => x.applicant_id === freelancerId);
  const c = companies.find(x => x.company_id === companyId);
  const canSave = !!f && !!c && !!track;

  return (
    <Drawer
      open
      onClose={onCancel}
      title="New match"
      subtitle="Pair an admitted freelancer with a Cohort 3 company"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}><X className="mr-1 h-4 w-4" /> Cancel</Button>
          <Button variant="primary" disabled={!canSave} onClick={() => f && c && onCreate({ freelancer: f, company: c, track, hours, notes })}>
            <Plus className="mr-1 h-4 w-4" /> Create match
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="Freelancer">
          <select value={freelancerId} onChange={e => { setFreelancerId(e.target.value); const fl = freelancers.find(x => x.applicant_id === e.target.value); if (fl?.track) setTrack(fl.track); }} className={inp}>
            <option value="">— Select —</option>
            {freelancers.map(fl => <option key={fl.applicant_id} value={fl.applicant_id}>{fl.name} ({fl.track || 'no track'})</option>)}
          </select>
        </Field>
        <Field label="Company">
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className={inp}>
            <option value="">— Select —</option>
            {companies.map(co => <option key={co.company_id} value={co.company_id}>{co.company_name}</option>)}
          </select>
        </Field>
        <Field label="Track">
          <select value={track} onChange={e => setTrack(e.target.value)} className={inp}>
            <option value="FL">FL — Freelance / Upwork</option>
            <option value="SM">SM — Social Media / BD</option>
            <option value="FL+SM">FL+SM — Combined</option>
          </select>
        </Field>
        <Field label="Hours per week">
          <input type="number" value={hours} onChange={e => setHours(e.target.value)} className={inp} />
        </Field>
        <Field label="Notes (optional)">
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className={inp} />
        </Field>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
