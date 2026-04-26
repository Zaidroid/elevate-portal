import { useMemo, useState } from 'react';
import { Plus, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, FilterBar, Tabs, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column, FilterGroup, FilterValues, TabItem } from '../../lib/ui';

type Freelancer = {
  freelancer_id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  track: string;
  role_profile: string;
  assigned_mentor: string;
  company_id: string;
  status: string;
  start_date: string;
  source_sheet: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

const TRACKS = ['Upwork', 'Social Media', 'Other'];
const ROLE_PROFILES = ['Individual', 'Job Hunter', 'Agency'];
const STATUSES = ['Applicant', 'Accepted', 'In Program', 'Graduated', 'Dropped'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function FreelancersPage() {
  const sheetId = getSheetId('freelancers');
  const [view, setView] = useState<'roster' | 'tracks' | 'income' | 'assessments'>('roster');

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="ElevateBridge" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_FREELANCERS</code> in your environment.
        </p>
      </Card>
    );
  }

  const tabs: TabItem[] = [
    { value: 'roster', label: 'Roster' },
    { value: 'tracks', label: 'Track Assignments' },
    { value: 'income', label: 'Income Tracking' },
    { value: 'assessments', label: 'Assessments' },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">ElevateBridge</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Freelancer program under Market Access. Roster, track assignments, income tracking, and assessments.
        </p>
      </header>

      <Tabs items={tabs} value={view} onChange={v => setView(v as typeof view)} />

      {view === 'roster' && <RosterView sheetId={sheetId} />}
      {view === 'tracks' && <SimpleSheetTable sheetId={sheetId} tabKey="tracks" rowKey="track_id" title="Track Assignments" searchFields={['freelancer_id', 'track', 'mentor', 'status']} />}
      {view === 'income' && <SimpleSheetTable sheetId={sheetId} tabKey="income" rowKey="income_id" title="Income Tracking" searchFields={['freelancer_id', 'month', 'platform']} />}
      {view === 'assessments' && <SimpleSheetTable sheetId={sheetId} tabKey="assessments" rowKey="assessment_id" title="Assessments" searchFields={['freelancer_id', 'assessment_type', 'score']} />}
    </div>
  );
}

function RosterView({ sheetId }: { sheetId: string }) {
  const { user } = useAuth();
  const tab = getTab('freelancers', 'freelancers');

  const { rows, loading, error, refresh, updateRow, createRow } = useSheetDoc<Freelancer>(
    sheetId,
    tab,
    'freelancer_id',
    { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValues>({ track: [], status: [], role: [] });
  const [selected, setSelected] = useState<Freelancer | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const track = filters.track || [];
    const status = filters.status || [];
    const role = filters.role || [];
    return rows.filter(r => {
      if (track.length > 0 && !track.includes(r.track)) return false;
      if (status.length > 0 && !status.includes(r.status)) return false;
      if (role.length > 0 && !role.includes(r.role_profile)) return false;
      if (!q) return true;
      return [r.full_name, r.email, r.location, r.assigned_mentor, r.company_id]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, query, filters]);

  const counts = useMemo(() => {
    const byTrack = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byRole = new Map<string, number>();
    for (const r of rows) {
      if (r.track) byTrack.set(r.track, (byTrack.get(r.track) || 0) + 1);
      if (r.status) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
      if (r.role_profile) byRole.set(r.role_profile, (byRole.get(r.role_profile) || 0) + 1);
    }
    return { byTrack, byStatus, byRole };
  }, [rows]);

  const filterGroups: FilterGroup[] = useMemo(() => [
    { key: 'track', label: 'Track', options: TRACKS.map(t => ({ value: t, label: t, count: counts.byTrack.get(t) || 0 })) },
    { key: 'status', label: 'Status', options: STATUSES.map(s => ({ value: s, label: s, count: counts.byStatus.get(s) || 0 })) },
    { key: 'role', label: 'Role', options: ROLE_PROFILES.map(r => ({ value: r, label: r, count: counts.byRole.get(r) || 0 })) },
  ], [counts]);

  const columns: Column<Freelancer>[] = [
    { key: 'full_name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'track', header: 'Track', width: '120px' },
    { key: 'role_profile', header: 'Role', width: '110px' },
    { key: 'assigned_mentor', header: 'Mentor', width: '140px' },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
        <Button
          variant="ghost"
          onClick={() => downloadCsv(timestampedFilename('freelancers'), filtered)}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" /> Export
        </Button>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New Freelancer
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <FilterBar
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search by name, email, mentor, location…"
        groups={filterGroups}
        values={filters}
        onValuesChange={setFilters}
        total={rows.length}
        filtered={filtered.length}
        resultNoun="freelancers"
      />

      <DataTable columns={columns} rows={filtered} loading={loading} onRowClick={r => setSelected(r)} />

      <FreelancerDrawer
        freelancer={selected}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          await updateRow(selected.freelancer_id, updates);
          setSelected(null);
        }}
      />

      <CreateFreelancerDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async row => {
          await createRow(row);
          setCreating(false);
        }}
      />
    </div>
  );
}

function FreelancerDrawer({
  freelancer, onClose, onSave,
}: {
  freelancer: Freelancer | null;
  onClose: () => void;
  onSave: (updates: Partial<Freelancer>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Freelancer | null>(freelancer);
  const [saving, setSaving] = useState(false);
  useMemo(() => setDraft(freelancer), [freelancer]);
  if (!freelancer || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  return (
    <Drawer
      open={!!freelancer}
      onClose={onClose}
      title={draft.full_name || draft.freelancer_id}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full Name">
          <input className={inputClass} value={draft.full_name}
            onChange={e => setDraft({ ...draft, full_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input className={inputClass} value={draft.email}
              onChange={e => setDraft({ ...draft, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={draft.phone}
              onChange={e => setDraft({ ...draft, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Location">
          <input className={inputClass} value={draft.location}
            onChange={e => setDraft({ ...draft, location: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Track">
            <select className={inputClass} value={draft.track}
              onChange={e => setDraft({ ...draft, track: e.target.value })}>
              <option value="">—</option>
              {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Role Profile">
            <select className={inputClass} value={draft.role_profile}
              onChange={e => setDraft({ ...draft, role_profile: e.target.value })}>
              <option value="">—</option>
              {ROLE_PROFILES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assigned Mentor">
            <input className={inputClass} value={draft.assigned_mentor}
              onChange={e => setDraft({ ...draft, assigned_mentor: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={draft.status}
              onChange={e => setDraft({ ...draft, status: e.target.value })}>
              <option value="">—</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company ID">
            <input className={inputClass} value={draft.company_id}
              onChange={e => setDraft({ ...draft, company_id: e.target.value })} />
          </Field>
          <Field label="Start Date">
            <input type="date" className={inputClass} value={draft.start_date}
              onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={draft.notes}
            onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function CreateFreelancerDrawer({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Freelancer>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Freelancer>>({ status: 'Applicant', track: 'Upwork' });
  const [saving, setSaving] = useState(false);

  const canCreate = !!(draft.freelancer_id && draft.full_name);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Freelancer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try { await onCreate(draft); setDraft({ status: 'Applicant', track: 'Upwork' }); }
            finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Freelancer ID" required>
          <input className={inputClass} value={draft.freelancer_id || ''}
            onChange={e => setDraft({ ...draft, freelancer_id: e.target.value })} placeholder="FL-E3-0001" />
        </Field>
        <Field label="Full Name" required>
          <input className={inputClass} value={draft.full_name || ''}
            onChange={e => setDraft({ ...draft, full_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} value={draft.email || ''}
            onChange={e => setDraft({ ...draft, email: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Track">
            <select className={inputClass} value={draft.track || ''}
              onChange={e => setDraft({ ...draft, track: e.target.value })}>
              {TRACKS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputClass} value={draft.status || ''}
              onChange={e => setDraft({ ...draft, status: e.target.value })}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Drawer>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-brand-red">*</span>}
      </span>
      {children}
    </label>
  );
}

function SimpleSheetTable({
  sheetId, tabKey, rowKey, title, searchFields,
}: {
  sheetId: string;
  tabKey: 'tracks' | 'income' | 'assessments';
  rowKey: string;
  title: string;
  searchFields: string[];
}) {
  const { user } = useAuth();
  const tabName = getTab('freelancers', tabKey);
  const { rows, loading, error, refresh } = useSheetDoc<Record<string, string>>(
    sheetId, tabName, rowKey, { userEmail: user?.email }
  );
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => searchFields.some(f => (r[f] || '').toLowerCase().includes(q)));
  }, [rows, query, searchFields]);

  const headers = rows.length > 0
    ? Object.keys(rows[0]).filter(k => k !== 'updated_at' && k !== 'updated_by')
    : [];

  const columns: Column<Record<string, string>>[] = headers.slice(0, 8).map(h => ({
    key: h,
    header: h.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-navy-500 dark:text-white">{title}</h2>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename(`freelancers_${tabKey}`), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${title.toLowerCase()}…`}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
      />

      <div className="text-sm text-slate-500">
        Showing <b>{filtered.length}</b> of <b>{rows.length}</b> rows
      </div>

      <DataTable columns={columns} rows={filtered} loading={loading} />

      {!loading && rows.length === 0 && (
        <Card>
          <p className="text-sm text-slate-500">
            No data yet in <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{tabName}</code>. Add rows in the sheet — they will appear here within 30s.
          </p>
        </Card>
      )}
    </div>
  );
}
