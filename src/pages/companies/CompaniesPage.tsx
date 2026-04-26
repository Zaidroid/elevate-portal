import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, EmptyState, FilterBar, statusTone, useToast, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column, FilterGroup, FilterValues } from '../../lib/ui';
import { displayName, getProfileManagers } from '../../config/team';

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

export function CompaniesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

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

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValues>({ pm: [], stage: [], status: [], fund: [] });
  const [creating, setCreating] = useState(false);

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
        status: m?.status || 'Applicant',
        profile_manager_email: m?.profile_manager_email || '',
        contact_email: a.contactEmail || a.email || '',
        source: m ? 'both' : 'applicant',
      });
    }

    // Include Master rows that don't correspond to any applicant (admin-added companies).
    for (const m of masterE3) {
      if (!m.company_id || seenMasterIds.has(m.company_id)) continue;
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
        status: m.status || '',
        profile_manager_email: m.profile_manager_email || '',
        contact_email: '',
        source: 'master',
      });
    }

    return out;
  }, [applicants.rows, masterE3, masterByName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pm = filters.pm || [];
    const stage = filters.stage || [];
    const status = filters.status || [];
    const fund = filters.fund || [];
    return joined.filter(r => {
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
  }, [joined, query, filters]);

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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Companies</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cohort 3 only. {applicants.rows.length} applicants, {masterE3.length} master records. Showing {counts.filtered} of {counts.total}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => { applicants.refresh(); master.refresh(); }}>
            Refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('companies'), joined as unknown as Record<string, unknown>[])}
            disabled={joined.length === 0}
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

      <DataTable
        columns={columns}
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
