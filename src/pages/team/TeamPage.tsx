import { useMemo, useState } from 'react';
import { Plus, Search, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { AUTHORIZED_USERS, isAdmin } from '../../config/team';
import { Badge, Button, Card, DataTable, Drawer, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';

const TIER_LABEL: Record<string, string> = {
  leadership: 'Leadership',
  profile_manager: 'Profile Manager',
  member: 'Team Member',
};

const FALLBACK_ROWS: TeamRow[] = AUTHORIZED_USERS.map(u => ({
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active ? 'true' : 'false',
  title: u.title || '',
  team: TIER_LABEL[u.tier] || '',
  notes: '',
}));

type TeamRow = {
  email: string;
  name: string;
  role: string;
  active: string;
  title: string;
  team: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

const ROLES = ['admin', 'user'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function TeamPage() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user.email) : false;
  const sheetId = getSheetId('teamRoster');
  const tab = getTab('teamRoster', 'roster');

  const { rows, loading, error, refresh, updateRow, createRow } = useSheetDoc<TeamRow>(
    sheetId || null, tab, 'email', { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TeamRow | null>(null);
  const [creating, setCreating] = useState(false);

  // Fall back to the hardcoded roster when the sheet isn't configured or is empty.
  const usingFallback = !sheetId || (!loading && rows.length === 0);
  const displayRows = usingFallback ? FALLBACK_ROWS : rows;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayRows;
    return displayRows.filter(r =>
      [r.name, r.email, r.title, r.team, r.role].some(v => (v || '').toLowerCase().includes(q))
    );
  }, [displayRows, query]);

  const columns: Column<TeamRow>[] = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    { key: 'title', header: 'Title' },
    { key: 'team', header: 'Team', width: '140px' },
    {
      key: 'role',
      header: 'Role',
      width: '100px',
      render: r => <Badge tone={r.role === 'admin' ? 'red' : 'neutral'}>{r.role || 'user'}</Badge>,
    },
    {
      key: 'active',
      header: 'Active',
      width: '90px',
      render: r => (
        <Badge tone={String(r.active).toLowerCase() === 'true' ? 'green' : 'neutral'}>
          {String(r.active).toLowerCase() === 'true' ? 'Yes' : 'No'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Team Roster</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Elevate program team members and portal access roles.
          </p>
        </div>
        <div className="flex gap-3">
          {sheetId && <Button variant="ghost" onClick={refresh}>Refresh</Button>}
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('team_roster'), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          {admin && sheetId && !usingFallback && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New Member
            </Button>
          )}
        </div>
      </header>

      {usingFallback && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            Showing the built-in roster from <code className="rounded bg-white/60 px-1 dark:bg-black/20">config/team.ts</code>. Set{' '}
            <code className="rounded bg-white/60 px-1 dark:bg-black/20">VITE_SHEET_TEAM_ROSTER</code> and populate the Roster tab to manage this live from Sheets.
          </p>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, email, title, team..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
        />
      </div>

      <div className="text-sm text-slate-500">
        Showing <b>{filtered.length}</b> of <b>{rows.length}</b> members
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading && !usingFallback}
        onRowClick={admin && !usingFallback ? r => setSelected(r) : undefined}
      />

      {admin && !usingFallback && (
        <TeamDrawer
          member={selected}
          onClose={() => setSelected(null)}
          onSave={async updates => {
            if (!selected) return;
            await updateRow(selected.email, updates);
            setSelected(null);
          }}
        />
      )}

      {admin && !usingFallback && (
        <CreateTeamDrawer
          open={creating}
          onClose={() => setCreating(false)}
          onCreate={async row => {
            await createRow(row);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function TeamDrawer({
  member, onClose, onSave,
}: {
  member: TeamRow | null;
  onClose: () => void;
  onSave: (updates: Partial<TeamRow>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TeamRow | null>(member);
  const [saving, setSaving] = useState(false);
  useMemo(() => setDraft(member), [member]);
  if (!member || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  return (
    <Drawer
      open={!!member}
      onClose={onClose}
      title={draft.name || draft.email}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={draft.name || ''}
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Email (read-only)">
          <input className={`${inputClass} opacity-60`} value={draft.email} readOnly />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <select className={inputClass} value={draft.role || 'user'}
              onChange={e => setDraft({ ...draft, role: e.target.value })}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Active">
            <select className={inputClass} value={String(draft.active).toLowerCase()}
              onChange={e => setDraft({ ...draft, active: e.target.value })}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <input className={inputClass} value={draft.title || ''}
              onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Team">
            <input className={inputClass} value={draft.team || ''}
              onChange={e => setDraft({ ...draft, team: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={draft.notes || ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function CreateTeamDrawer({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<TeamRow>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<TeamRow>>({ role: 'user', active: 'true' });
  const [saving, setSaving] = useState(false);

  const canCreate = !!(draft.email && draft.name);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Team Member"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try { await onCreate(draft); setDraft({ role: 'user', active: 'true' }); }
            finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email" required>
          <input className={inputClass} value={draft.email || ''}
            onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="name@gazaskygeeks.com" />
        </Field>
        <Field label="Full Name" required>
          <input className={inputClass} value={draft.name || ''}
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <select className={inputClass} value={draft.role || 'user'}
              onChange={e => setDraft({ ...draft, role: e.target.value })}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Active">
            <select className={inputClass} value={draft.active || 'true'}
              onChange={e => setDraft({ ...draft, active: e.target.value })}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title">
            <input className={inputClass} value={draft.title || ''}
              onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Team">
            <input className={inputClass} value={draft.team || ''}
              onChange={e => setDraft({ ...draft, team: e.target.value })} />
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
