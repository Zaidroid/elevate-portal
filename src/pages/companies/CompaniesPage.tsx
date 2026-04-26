import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Download,
  Kanban as KanbanIcon,
  Plus,
  RefreshCw,
  Table as TableIcon,
  Users,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  Kanban,
  Tabs,
  statusTone,
  useToast,
  downloadCsv,
  timestampedFilename,
} from '../../lib/ui';
import type { Column, FilterGroup, FilterValues, KanbanColumn, KanbanItem, TabItem, Tone } from '../../lib/ui';
import { displayName, getProfileManagers, isAdmin } from '../../config/team';
import { INTERVIEWED_NAMES, INTERVIEWED_RAW, isInterviewed } from './interviewedSource';

// Source Data row from the Selection workbook. Headers come from selection-tool's
// Company schema so keys are camelCase.
type Applicant = Record<string, string>;

// Companies Master row (operational enrichment).
type Master = {
  company_id: string;
  company_name: string;
  legal_name: string;
  city: string;
  governorate: string;
  sector: string;
  employee_count: string;
  revenue_bracket: string;
  fund_code: string;
  cohort: string;
  status: string;
  stage: string;
  profile_manager_email: string;
  selection_date: string;
  onboarding_date: string;
  drive_folder_url: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

// Joined row shown in the table.
type Row = {
  route_id: string;              // route param used for /companies/:id
  applicant_id: string;          // numeric id from Source Data, blank if Master-only
  company_id: string;            // Master's E3-XXXX if joined, else synthesized
  company_name: string;
  sector: string;
  city: string;
  governorate: string;
  employee_count: string;
  readiness_score: string;
  fund_code: string;
  stage: string;
  status: string;
  profile_manager_email: string;
  contact_email: string;
  source: 'applicant' | 'master' | 'both';
};

const STATUSES = ['Applicant', 'Shortlisted', 'Interviewed', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn'];
const STAGES = ['Applied', '1st Filtration', 'Doc Review', 'Needs Assessed', 'Scored', 'Interviewed', 'Final Assessment', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Rejected', 'Withdrew'];
const FUND_CODES = ['97060', '91763'];

const norm = (s?: string) => (s || '').trim().toLowerCase();

function padId(n: string): string {
  const num = parseInt(n || '0', 10);
  return Number.isFinite(num) && num > 0 ? `A-${num.toString().padStart(4, '0')}` : '';
}

// Order in which statuses live within the pipeline. Used to compute "the
// higher of (master.status, override)" so we never demote a company by
// applying the Interviewed override on top of an Onboarded record.
const STATUS_ORDER: Record<string, number> = {
  Applicant: 0,
  Shortlisted: 1,
  Interviewed: 2,
  Selected: 3,
  Onboarded: 4,
  Active: 5,
  Graduated: 6,
  Withdrawn: -1,
};
function maxStatus(a: string, b: string): string {
  const ra = STATUS_ORDER[a] ?? 0;
  const rb = STATUS_ORDER[b] ?? 0;
  return ra >= rb ? a : b;
}

export function CompaniesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const admin = user ? isAdmin(user.email) : false;

  const masterSheetId = getSheetId('companies');
  const selectionSheetId = getSheetId('selection');
  const masterTab = getTab('companies', 'companies');
  const sourceTab = getTab('selection', 'sourceData');

  const master = useSheetDoc<Master>(
    masterSheetId || null,
    masterTab,
    'company_id',
    { userEmail: user?.email }
  );

  const applicants = useSheetDoc<Applicant>(
    selectionSheetId || null,
    sourceTab,
    'id',
    { userEmail: user?.email }
  );

  // Static, hand-maintained list of Cohort 3 interviewed companies (see
  // interviewedSource.ts for the why). Used to overlay the "Interviewed"
  // status onto the master sheet without ever demoting a higher status.
  const interviewedSet = INTERVIEWED_NAMES;

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValues>({ pm: [], stage: [], status: [], fund: [] });
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'dashboard' | 'pipeline' | 'roster'>('dashboard');
  const [savedView, setSavedView] = useState<'' | 'mine' | 'unassigned' | 'interviewed' | 'active'>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  // The 107 Cohort 3 applicants are still the right *default* surface;
  // when the team flips the toggle we hide post-selection rows so the
  // daily roster is just the active portfolio.
  const [selectedOnly, setSelectedOnly] = useState(false);
  const SELECTED_STATUSES = ['Selected', 'Onboarded', 'Active', 'Interviewed', 'Graduated'];

  const pms = getProfileManagers();

  // Cohort 3 only — require explicit E3 tag. Blank cohorts are legacy carryover and hidden.
  const masterE3 = useMemo(
    () => master.rows.filter(r => r.cohort && r.cohort.trim().toUpperCase() === 'E3'),
    [master.rows]
  );

  // Build a master-by-name lookup so we can overlay operational fields onto each applicant.
  const masterByName = useMemo(() => {
    const m = new Map<string, Master>();
    for (const row of masterE3) {
      const k = norm(row.company_name);
      if (k) m.set(k, row);
    }
    return m;
  }, [masterE3]);

  // Build the joined set: every applicant, plus any Master-only rows that don't match one.
  const joined = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seenMasterIds = new Set<string>();

    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const key = norm(name);
      const m = key ? masterByName.get(key) : undefined;
      if (m?.company_id) seenMasterIds.add(m.company_id);

      // Status resolution:
      // 1) Start with master.status (fallback to 'Applicant' when blank)
      // 2) If the company name is in the interviewed source, lift to at
      //    least 'Interviewed' (never demote a higher status like Onboarded
      //    or Active that the master already has)
      const baseStatus = m?.status?.trim() || 'Applicant';
      const interviewed = isInterviewed(name, interviewedSet);
      const effectiveStatus = interviewed ? maxStatus(baseStatus, 'Interviewed') : baseStatus;

      out.push({
        route_id: a.id || padId(a.id) || key,
        applicant_id: a.id || '',
        company_id: m?.company_id || padId(a.id || ''),
        company_name: name,
        sector: m?.sector || a.businessType || '',
        city: a.city || m?.city || '',
        governorate: m?.governorate || '',
        employee_count: a.totalEmployees || m?.employee_count || '',
        readiness_score: a.readinessScore || '',
        fund_code: m?.fund_code || '',
        stage: m?.stage || 'Applied',
        status: effectiveStatus,
        profile_manager_email: m?.profile_manager_email || '',
        contact_email: a.contactEmail || a.email || '',
        source: m ? 'both' : 'applicant',
      });
    }

    // Include Master rows that don't correspond to any applicant (admin-added companies).
    for (const m of masterE3) {
      if (!m.company_id || seenMasterIds.has(m.company_id)) continue;
      const baseStatus = m.status?.trim() || '';
      const interviewed = isInterviewed(m.company_name || '', interviewedSet);
      const effectiveStatus = interviewed ? maxStatus(baseStatus || 'Applicant', 'Interviewed') : baseStatus;
      out.push({
        route_id: m.company_id,
        applicant_id: '',
        company_id: m.company_id,
        company_name: m.company_name || '',
        sector: m.sector || '',
        city: m.city || '',
        governorate: m.governorate || '',
        employee_count: m.employee_count || '',
        readiness_score: '',
        fund_code: m.fund_code || '',
        stage: m.stage || '',
        status: effectiveStatus,
        profile_manager_email: m.profile_manager_email || '',
        contact_email: '',
        source: 'master',
      });
    }

    return out;
  }, [applicants.rows, masterE3, masterByName, interviewedSet]);

  // The Selected-only checkbox is one knob; the saved-view chips above
  // the tabs are another. We compose them: saved-view first, then the
  // Selected-only collapse, then the per-column FilterBar filters.
  const userEmail = (user?.email || '').toLowerCase();
  const filteredBySavedView = useMemo(() => {
    switch (savedView) {
      case 'mine':
        return joined.filter(r => (r.profile_manager_email || '').toLowerCase() === userEmail);
      case 'unassigned':
        return joined.filter(r => !r.profile_manager_email);
      case 'interviewed':
        return joined.filter(r => isInterviewed(r.company_name, interviewedSet));
      case 'active':
        return joined.filter(r => r.status === 'Active' || r.status === 'Onboarded');
      default:
        return joined;
    }
  }, [savedView, joined, userEmail, interviewedSet]);

  const filteredBySelection = useMemo(() => {
    if (!selectedOnly) return filteredBySavedView;
    return filteredBySavedView.filter(r => SELECTED_STATUSES.includes(r.status));
  }, [filteredBySavedView, selectedOnly]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pm = filters.pm || [];
    const stage = filters.stage || [];
    const status = filters.status || [];
    const fund = filters.fund || [];
    return filteredBySelection.filter(r => {
      if (pm.length > 0) {
        const key = r.profile_manager_email || '__unassigned__';
        if (!pm.includes(key)) return false;
      }
      if (stage.length > 0 && !stage.includes(r.stage)) return false;
      if (status.length > 0 && !status.includes(r.status)) return false;
      if (fund.length > 0 && !fund.includes(r.fund_code)) return false;
      if (q) {
        return [r.company_name, r.company_id, r.sector, r.governorate, r.city, r.status, r.stage]
          .some(v => (v || '').toLowerCase().includes(q));
      }
      return true;
    });
  }, [filteredBySelection, query, filters]);

  const counts = useMemo(() => {
    const byPm = new Map<string, number>();
    const byStage = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byFund = new Map<string, number>();
    for (const r of joined) {
      const pmKey = r.profile_manager_email || '__unassigned__';
      byPm.set(pmKey, (byPm.get(pmKey) || 0) + 1);
      if (r.stage) byStage.set(r.stage, (byStage.get(r.stage) || 0) + 1);
      if (r.status) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
      if (r.fund_code) byFund.set(r.fund_code, (byFund.get(r.fund_code) || 0) + 1);
    }
    return { byPm, byStage, byStatus, byFund, total: joined.length, filtered: filtered.length };
  }, [joined, filtered.length]);

  const filterGroups: FilterGroup[] = useMemo(() => [
    {
      key: 'pm',
      label: 'Profile Manager',
      options: [
        { value: '__unassigned__', label: 'Unassigned', count: counts.byPm.get('__unassigned__') || 0 },
        ...pms.map(pm => ({ value: pm.email, label: pm.name, count: counts.byPm.get(pm.email) || 0 })),
      ],
    },
    {
      key: 'stage',
      label: 'Stage',
      options: STAGES.map(s => ({ value: s, label: s, count: counts.byStage.get(s) || 0 })),
    },
    {
      key: 'status',
      label: 'Status',
      options: STATUSES.map(s => ({ value: s, label: s, count: counts.byStatus.get(s) || 0 })),
    },
    {
      key: 'fund',
      label: 'Fund',
      options: FUND_CODES.map(f => ({
        value: f,
        label: f === '97060' ? 'Dutch (97060)' : 'SIDA (91763)',
        count: counts.byFund.get(f) || 0,
      })),
    },
  ], [pms, counts]);

  const columns: Column<Row>[] = [
    {
      key: 'company_name',
      header: 'Company',
      render: r => (
        <div className="flex items-center gap-3">
          <CompanyAvatar name={r.company_name} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy-500 dark:text-white">{r.company_name || '—'}</div>
            <div className="truncate text-xs text-slate-500">
              {[r.sector, [r.city, r.governorate].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'employee_count',
      header: 'Team',
      width: '72px',
      render: r => (
        <span className="inline-flex items-center gap-1 text-sm">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          {r.employee_count || '—'}
        </span>
      ),
    },
    {
      key: 'stage',
      header: 'Stage / Status',
      render: r => (
        <div className="flex flex-col gap-1">
          <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>
          {r.stage && <span className="text-[11px] text-slate-500">{r.stage}</span>}
        </div>
      ),
    },
    {
      key: 'fund_code',
      header: 'Fund',
      width: '100px',
      render: r => {
        if (!r.fund_code) return <span className="text-slate-400">—</span>;
        const dutch = r.fund_code === '97060';
        return (
          <Badge tone={dutch ? 'teal' : 'amber'}>
            {dutch ? 'Dutch' : 'SIDA'}
          </Badge>
        );
      },
    },
    {
      key: 'profile_manager_email',
      header: 'Profile Manager',
      render: r => {
        if (!r.profile_manager_email) {
          return <span className="text-xs text-slate-400">Unassigned</span>;
        }
        const name = displayName(r.profile_manager_email);
        return (
          <div className="flex items-center gap-2">
            <PMInitials name={name} />
            <span className="text-sm font-medium">{name}</span>
          </div>
        );
      },
    },
  ];

  if (!masterSheetId && !selectionSheetId) {
    return (
      <Card>
        <CardHeader title="Companies" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_SELECTION</code> and{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SHEET_COMPANIES</code> in your environment, then reload.
        </p>
      </Card>
    );
  }

  const loading = applicants.loading || master.loading;
  const error = applicants.error || master.error;

  // Bulk actions on selected rows.
  const handleBulkSetStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Set status to "${status}" for ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}?`)) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        const m = master.rows.find(r => r.company_id === id);
        if (!m) continue;
        try { await master.updateRow(id, { status } as Partial<Master>); ok += 1; }
        catch (err) { console.warn('[companies] bulk status skipped', id, err); }
      }
      toast.success('Bulk update', `${ok} of ${ids.length} updated to ${status}`);
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const handleBulkAssignPM = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const pmEmail = window.prompt('Profile Manager email (e.g. doaa@gazaskygeeks.com):');
    if (!pmEmail) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try { await master.updateRow(id, { profile_manager_email: pmEmail } as Partial<Master>); ok += 1; }
        catch (err) { console.warn('[companies] bulk PM skipped', id, err); }
      }
      toast.success('Bulk assign', `${ok} of ${ids.length} assigned to ${pmEmail}`);
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const interviewedCount = useMemo(
    () => joined.filter(r => isInterviewed(r.company_name, interviewedSet)).length,
    [joined, interviewedSet]
  );

  const tabs: TabItem[] = [
    { value: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
    { value: 'pipeline', label: 'Pipeline', icon: <KanbanIcon className="h-4 w-4" />, count: counts.total },
    { value: 'roster', label: 'Roster', icon: <TableIcon className="h-4 w-4" />, count: counts.filtered },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Companies</h1>
            <Badge tone="teal">{joined.length} cohort 3</Badge>
            {interviewedSet.size > 0 && (
              <Badge tone="amber">{interviewedCount} interviewed</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            107 Cohort 3 applicants. Status of "Interviewed" is overlaid from a static list of {INTERVIEWED_RAW.length} companies
            scheduled across Phases 1–4 (April 2026); edit{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-slate-800">interviewedSource.ts</code> to update.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={selectedOnly}
              onChange={() => setSelectedOnly(v => !v)}
              className="rounded"
            />
            Selected only
          </label>
          <Button variant="ghost" onClick={() => { applicants.refresh(); master.refresh(); }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('companies'), filteredBySelection as unknown as Record<string, unknown>[])}
            disabled={filteredBySelection.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New Company
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Quick views:</span>
        {([
          { id: '', label: 'All' },
          { id: 'mine', label: 'My portfolio' },
          { id: 'interviewed', label: `Interviewed (${interviewedCount})` },
          { id: 'active', label: `Active + Onboarded (${joined.filter(r => r.status === 'Active' || r.status === 'Onboarded').length})` },
          { id: 'unassigned', label: `Unassigned (${joined.filter(r => !r.profile_manager_email).length})` },
        ] as const).map(v => (
          <button
            key={v.id}
            onClick={() => setSavedView(v.id as typeof savedView)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              savedView === v.id
                ? 'bg-brand-teal text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Tabs items={tabs} value={view} onChange={v => setView(v as typeof view)} />

      {view === 'dashboard' && (
        <CompanyDashboard
          rows={filteredBySavedView}
          interviewedCount={interviewedCount}
          loading={loading}
        />
      )}

      {view === 'pipeline' && (
        <CompanyPipelineKanban
          rows={filteredBySelection}
          onCardClick={r => navigate(`/companies/${encodeURIComponent(r.route_id)}`)}
        />
      )}

      {view === 'roster' && (
        <>
          <FilterBar
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search by company, sector, city, governorate…"
            groups={filterGroups}
            values={filters}
            onValuesChange={setFilters}
            total={counts.total}
            filtered={counts.filtered}
            resultNoun="companies"
          />
          {selectedIds.size > 0 && admin && (
            <Card accent="teal">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-navy-500 dark:text-white">{selectedIds.size} selected</span>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Interviewed')} disabled={bulkRunning}>Mark Interviewed</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Selected')} disabled={bulkRunning}>Mark Selected</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Onboarded')} disabled={bulkRunning}>Mark Onboarded</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Active')} disabled={bulkRunning}>Mark Active</Button>
                <Button size="sm" variant="ghost" onClick={handleBulkAssignPM} disabled={bulkRunning}>Assign PM…</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkRunning}>Clear</Button>
              </div>
            </Card>
          )}
          <DataTable
            columns={admin
              ? [{
                  key: '_select',
                  header: (
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => selectedIds.has(r.company_id))}
                      ref={el => { if (el) el.indeterminate = filtered.some(r => selectedIds.has(r.company_id)) && !filtered.every(r => selectedIds.has(r.company_id)); }}
                      onChange={() => {
                        const next = new Set(selectedIds);
                        const allSel = filtered.every(r => selectedIds.has(r.company_id));
                        if (allSel) for (const r of filtered) next.delete(r.company_id);
                        else for (const r of filtered) next.add(r.company_id);
                        setSelectedIds(next);
                      }}
                    />
                  ),
                  width: '36px',
                  render: (r: Row) => (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.company_id)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => {
                        const next = new Set(selectedIds);
                        if (next.has(r.company_id)) next.delete(r.company_id); else next.add(r.company_id);
                        setSelectedIds(next);
                      }}
                    />
                  ),
                } satisfies Column<Row>, ...columns]
              : columns}
            rows={filtered}
            loading={loading}
            onRowClick={r => navigate(`/companies/${encodeURIComponent(r.route_id)}`)}
            emptyState={
              joined.length === 0 ? (
                <EmptyState
                  title="No companies yet"
                  description="Once Source Data loads from the selection workbook, the 107 Cohort 3 applicants will show up here."
                  icon={<Users className="h-8 w-8" />}
                  action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New Company</Button>}
                />
              ) : (
                'No matches for your filters.'
              )
            }
          />
        </>
      )}

      <CreateCompanyDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async row => {
          try {
            await master.createRow(row);
            toast.success('Created', `${row.company_name} added to Master.`);
            setCreating(false);
          } catch (e) {
            toast.error('Create failed', (e as Error).message);
          }
        }}
      />
    </div>
  );
}

// ----- Pipeline kanban -------------------------------------------------

const PIPELINE_COLUMNS: { id: string; label: string; tone: Tone }[] = [
  { id: 'Applicant', label: 'Applicant', tone: 'neutral' },
  { id: 'Shortlisted', label: 'Shortlisted', tone: 'amber' },
  { id: 'Interviewed', label: 'Interviewed', tone: 'teal' },
  { id: 'Selected', label: 'Selected', tone: 'orange' },
  { id: 'Onboarded', label: 'Onboarded', tone: 'green' },
  { id: 'Active', label: 'Active', tone: 'green' },
  { id: 'Graduated', label: 'Graduated', tone: 'neutral' },
  { id: 'Withdrawn', label: 'Withdrawn', tone: 'red' },
];

function CompanyPipelineKanban({
  rows,
  onCardClick,
}: {
  rows: Row[];
  onCardClick: (r: Row) => void;
}) {
  const cols: KanbanColumn<string>[] = PIPELINE_COLUMNS.map(c => ({ id: c.id, label: c.label, tone: c.tone }));
  const items: Array<KanbanItem<string> & { row: Row }> = rows.map(r => ({
    id: r.route_id || r.company_id,
    status: r.status || 'Applicant',
    row: r,
  }));
  return (
    <Kanban<string, KanbanItem<string> & { row: Row }>
      columns={cols}
      items={items}
      readOnly
      onStatusChange={async () => {}}
      onCardClick={item => onCardClick(item.row)}
      renderCard={item => (
        <div className="space-y-1">
          <div className="truncate text-sm font-bold text-navy-500 dark:text-white">{item.row.company_name || '—'}</div>
          <div className="truncate text-2xs text-slate-500">
            {[item.row.sector, item.row.governorate].filter(Boolean).join(' · ') || '—'}
          </div>
          {item.row.profile_manager_email && (
            <div className="text-2xs text-slate-500">PM: {displayName(item.row.profile_manager_email).split(' ')[0]}</div>
          )}
          {item.row.fund_code && (
            <Badge tone={item.row.fund_code === '97060' ? 'teal' : 'amber'}>
              {item.row.fund_code === '97060' ? 'Dutch' : 'SIDA'}
            </Badge>
          )}
        </div>
      )}
      emptyHint="Empty"
    />
  );
}

// ----- Dashboard --------------------------------------------------------

function CompanyDashboard({
  rows,
  interviewedCount,
  loading,
}: {
  rows: Row[];
  interviewedCount: number;
  loading: boolean;
}) {
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPM: Record<string, number> = {};
    const byFund: Record<string, number> = {};
    const bySector: Record<string, number> = {};
    let unassigned = 0;
    for (const r of rows) {
      const s = r.status || 'Applicant';
      byStatus[s] = (byStatus[s] || 0) + 1;
      const pm = r.profile_manager_email || '__unassigned__';
      byPM[pm] = (byPM[pm] || 0) + 1;
      if (!r.profile_manager_email) unassigned += 1;
      if (r.fund_code) byFund[r.fund_code] = (byFund[r.fund_code] || 0) + 1;
      if (r.sector) bySector[r.sector] = (bySector[r.sector] || 0) + 1;
    }
    return {
      total: rows.length,
      byStatus,
      byPM,
      byFund,
      bySector,
      unassigned,
    };
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<RefreshCw className="h-6 w-6 animate-spin" />} title="Loading…" description="Reading from Master + Source Data + Interviewed sources." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total" value={stats.total} tone="navy" />
        <Stat label="Interviewed" value={interviewedCount} tone="teal" sub="From the read-only source" />
        <Stat label="Onboarded + Active" value={(stats.byStatus['Onboarded'] || 0) + (stats.byStatus['Active'] || 0)} tone="green" />
        <Stat label="Unassigned" value={stats.unassigned} tone={stats.unassigned > 0 ? 'amber' : 'green'} sub="Need a Profile Manager" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By status" subtitle="Pipeline distribution" />
          <FunnelList rows={PIPELINE_COLUMNS.map(c => ({ label: c.label, value: stats.byStatus[c.id] || 0, tone: c.tone }))} max={Math.max(1, ...Object.values(stats.byStatus))} />
        </Card>
        <Card>
          <CardHeader title="By PM" subtitle="Workload per Profile Manager" />
          {Object.keys(stats.byPM).length === 0 ? (
            <p className="text-xs text-slate-500">No PMs assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(stats.byPM).sort((a, b) => b[1] - a[1]).map(([pm, n]) => (
                <li key={pm} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
                  <span className="truncate font-semibold text-navy-500 dark:text-slate-100">
                    {pm === '__unassigned__' ? 'Unassigned' : displayName(pm)}
                  </span>
                  <Badge tone={pm === '__unassigned__' ? 'amber' : 'navy' as Tone}>{n}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="By fund" subtitle="Dutch (97060) vs SIDA (91763)" />
          <ul className="space-y-2">
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">Dutch (97060)</span>
              <Badge tone="teal">{stats.byFund['97060'] || 0}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">SIDA (91763)</span>
              <Badge tone="amber">{stats.byFund['91763'] || 0}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">Not yet set</span>
              <Badge tone="neutral">{stats.total - (stats.byFund['97060'] || 0) - (stats.byFund['91763'] || 0)}</Badge>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="Top sectors" subtitle="Most-represented sectors in this view" />
          {Object.keys(stats.bySector).length === 0 ? (
            <p className="text-xs text-slate-500">No sector data yet.</p>
          ) : (
            <FunnelList
              rows={Object.entries(stats.bySector).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => ({ label: s, value: n, tone: 'teal' as Tone }))}
              max={Math.max(1, ...Object.values(stats.bySector))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone: 'navy' | 'teal' | 'green' | 'amber' }) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-500/5 text-navy-500 dark:text-white',
    teal: 'bg-brand-teal/10 text-brand-teal',
    green: 'bg-emerald-500/10 text-emerald-700',
    amber: 'bg-amber-500/10 text-amber-700',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="mb-1 text-xs font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
    </div>
  );
}

function FunnelList({ rows, max }: { rows: { label: string; value: number; tone: Tone }[]; max: number }) {
  const toneBg: Record<string, string> = {
    red: 'bg-brand-red',
    teal: 'bg-brand-teal',
    orange: 'bg-brand-orange',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
    neutral: 'bg-slate-400',
  };
  return (
    <div className="space-y-2">
      {rows.map(row => {
        const pct = max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0;
        return (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-32 truncate text-xs font-semibold text-navy-500 dark:text-slate-200">{row.label}</div>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
              <div className={`h-full rounded-full ${toneBg[row.tone] || 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="w-10 text-right text-xs font-bold text-navy-500 dark:text-slate-200">{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function CreateCompanyDrawer({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Master>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Master>>({ cohort: 'E3', status: 'Applicant' });
  const [saving, setSaving] = useState(false);
  const pms = getProfileManagers();

  const handleCreate = async () => {
    if (!draft.company_name) return;
    setSaving(true);
    try {
      await onCreate(draft);
      setDraft({ cohort: 'E3', status: 'Applicant' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Company (Master)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !draft.company_name}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Applicants from Selection Source Data already appear in the list automatically. Use this form only for companies that aren't in the applicant pool (e.g. C-Suite pilots, direct invites).
        </p>
        <Field label="Company Name" required>
          <input
            className={inputClass}
            value={draft.company_name || ''}
            onChange={e => setDraft({ ...draft, company_name: e.target.value })}
          />
        </Field>
        <Field label="Legal Name">
          <input
            className={inputClass}
            value={draft.legal_name || ''}
            onChange={e => setDraft({ ...draft, legal_name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sector">
            <input
              className={inputClass}
              value={draft.sector || ''}
              onChange={e => setDraft({ ...draft, sector: e.target.value })}
            />
          </Field>
          <Field label="Governorate">
            <input
              className={inputClass}
              value={draft.governorate || ''}
              onChange={e => setDraft({ ...draft, governorate: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fund Code">
            <select
              className={inputClass}
              value={draft.fund_code || ''}
              onChange={e => setDraft({ ...draft, fund_code: e.target.value })}
            >
              <option value="">—</option>
              {FUND_CODES.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={draft.status || ''}
              onChange={e => setDraft({ ...draft, status: e.target.value })}
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stage">
            <select
              className={inputClass}
              value={draft.stage || ''}
              onChange={e => setDraft({ ...draft, stage: e.target.value })}
            >
              <option value="">—</option>
              {STAGES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Profile Manager">
            <select
              className={inputClass}
              value={draft.profile_manager_email || ''}
              onChange={e => setDraft({ ...draft, profile_manager_email: e.target.value })}
            >
              <option value="">— unassigned —</option>
              {pms.map(pm => (
                <option key={pm.email} value={pm.email}>
                  {pm.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          The sheet auto-generates a <code>company_id</code> in the E3-0001 format via formula.
        </p>
      </div>
    </Drawer>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-brand-red">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

const AVATAR_TONES = [
  'bg-brand-teal/15 text-brand-teal',
  'bg-brand-red/15 text-brand-red',
  'bg-brand-orange/15 text-brand-orange',
  'bg-navy-500/15 text-navy-500 dark:text-slate-100',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
];

function toneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function CompanyAvatar({ name }: { name: string }) {
  const tone = toneFor(name || '·');
  return (
    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${tone}`}>
      {initialsOf(name)}
    </div>
  );
}

function PMInitials({ name }: { name: string }) {
  const tone = toneFor(name || '·');
  return (
    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone}`}>
      {initialsOf(name)}
    </div>
  );
}
