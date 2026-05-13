import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, ExternalLink, Download } from 'lucide-react';

import { useModuleData } from '../../data/useModuleData';
import type { Conference, ConferenceTrackerRow as TrackerRow, Company } from '../../data/types';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, statusTone, downloadCsv, timestampedFilename, useToast } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import { keepCompaniesSection } from '../../lib/sheets/sections';
import { canonicalCohortName, cohortEntryFor } from '../../config/cohort3Aliases';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';

type View = 'catalogue' | 'tracker';



const TIERS = ['T1', 'T2', 'T3'];
const FUND_ELIGIBLE = ['Dutch', 'SIDA', 'Both'];
const DECISIONS = ['Nominated', 'Committed', 'Withdrawn', 'Attended'];
// Conference catalogue lifecycle. Free-text status was a footgun (Cancelled
// got typed differently each time and never matched filters); pick from a
// closed list instead.
const CONF_STATUSES = ['Tracked', 'Confirmed', 'Cancelled', 'Postponed', 'Completed'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function ConferencesPage() {
  const [view, setView] = useState<View>('catalogue');

  if (!import.meta.env.VITE_SHEET_CONFERENCES) {
    return (
      <Card>
        <CardHeader title="Conferences and Travel" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_CONFERENCES</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Conferences and Travel</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Catalogue of events + company-by-company nomination and travel tracker.
          </p>
        </div>
      </header>

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-navy-700 dark:bg-navy-600">
        {[
          { key: 'catalogue', label: 'Catalogue' },
          { key: 'tracker', label: 'Company x Conference Tracker' },
        ].map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key as View)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              view === v.key
                ? 'bg-brand-red text-white'
                : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'catalogue' ? <Catalogue /> : <Tracker />}
    </div>
  );
}

function Catalogue() {

  const hook = useModuleData<Conference>('conferences', 'catalogue');
  const { loading, error, refresh, updateRow, createRow } = hook;
  const toast = useToast();
  // Section-aware: Catalogue tab is team-grouped (Companies / Vendors /
  // Marketing) — without keepCompaniesSection, we read separator rows
  // and unrelated team blocks. Catalogue itself isn't cohort-scoped
  // (it's the worldwide event list); the section filter just keeps us
  // on the proper data block.
  const rows = useMemo(
    () => keepCompaniesSection(hook.rows, hook.headers) as Conference[],
    [hook.rows, hook.headers],
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Conference | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.name, r.city, r.country, r.tier, r.status]
      .some(v => (v || '').toLowerCase().includes(q)));
  }, [rows, query]);

  const columns: Column<Conference>[] = [
    { key: 'name', header: 'Conference' },
    { key: 'city', header: 'City', width: '120px' },
    { key: 'country', header: 'Country', width: '120px' },
    { key: 'start_date', header: 'Start', width: '110px' },
    { key: 'tier', header: 'Tier', width: '70px', render: r => <Badge tone="teal">{r.tier || '—'}</Badge> },
    { key: 'fund_eligible', header: 'Fund', width: '90px' },
    { key: 'status', header: 'Status', render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge> },
  ];

  return (
    <div className="space-y-4">
      {error && <Card className="border-red-200 bg-red-50"><p className="text-sm text-red-700">{error.message}</p></Card>}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search catalogue..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
        <Button variant="ghost" onClick={() => downloadCsv(timestampedFilename('conference_catalogue'), filtered)} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Export
        </Button>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add Conference</Button>
      </div>

      <DataTable columns={columns} rows={filtered} loading={loading} onRowClick={r => setSelected(r)} />

      <ConferenceDrawer conference={selected} onClose={() => setSelected(null)}
        onSave={async u => {
          if (!selected) return;
          try {
            await updateRow(selected.conference_id, u);
            toast.success('Conference saved');
            setSelected(null);
          } catch (err) {
            toast.error('Save failed', (err as Error).message);
          }
        }} />

      <CreateConferenceDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async r => {
          try {
            await createRow(r);
            toast.success('Conference added');
            setCreating(false);
          } catch (err) {
            toast.error('Create failed', (err as Error).message);
          }
        }}
      />
    </div>
  );
}

function Tracker() {

  const hook = useModuleData<TrackerRow>('conferences', 'tracker');
  const masterHook = useModuleData<Company>('companies', 'companies');
  const { loading, error, refresh, updateRow } = hook;
  const toast = useToast();

  // Section-aware AND cohort-scoped. Tracker rows for non-cohort
  // companies (e.g. previous cohorts the team hasn't deleted yet, or
  // pre-cohort applicants) used to leak in here — now we drop them at
  // the source so the table only shows cohort 3 nominations.
  const rows = useMemo(() => {
    const sectioned = keepCompaniesSection(hook.rows, hook.headers) as TrackerRow[];
    return sectioned.filter(r => canonicalCohortName(r.company_name || '') !== null);
  }, [hook.rows, hook.headers]);

  // company_id → AM lookup so each tracker row can show who owns it.
  const amByCompanyId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of masterHook.rows) {
      if (!c.company_id) continue;
      const lower = (c.profile_manager_email || cohortEntryFor(c.company_name || '')?.am || '').toLowerCase();
      const amName = ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === lower)?.name
        || (lower ? displayName(lower) : '');
      m.set(c.company_id, amName);
    }
    return m;
  }, [masterHook.rows]);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TrackerRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.company_name, r.conference_name, r.decision, r.signatory_name]
      .some(v => (v || '').toLowerCase().includes(q)));
  }, [rows, query]);

  const columns: Column<TrackerRow>[] = [
    {
      key: 'company',
      header: 'Company / AM',
      render: r => {
        const canon = canonicalCohortName(r.company_name || '') || r.company_name || '';
        const am = amByCompanyId.get(r.company_id) || '';
        return (
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy-500 dark:text-white">{canon}</div>
            {am && <div className="text-2xs text-slate-500">{am}</div>}
          </div>
        );
      },
    },
    { key: 'conference_name', header: 'Conference' },
    { key: 'fit_score', header: 'Fit', width: '70px' },
    {
      key: 'decision',
      header: 'Decision',
      width: '120px',
      render: r => <Badge tone={statusTone(r.decision)}>{r.decision || '—'}</Badge>,
    },
    { key: 'signatory_name', header: 'Signatory' },
    {
      key: 'commitment_letter_url',
      header: 'Letter',
      width: '70px',
      render: r =>
        r.commitment_letter_url ? (
          <a href={r.commitment_letter_url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()} className="text-brand-teal hover:text-brand-teal-dark">
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      {error && <Card className="border-red-200 bg-red-50"><p className="text-sm text-red-700">{error.message}</p></Card>}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tracker..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <Button variant="ghost" onClick={refresh}>Refresh</Button>
        <Button variant="ghost" onClick={() => downloadCsv(timestampedFilename('conference_tracker'), filtered)} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      <DataTable columns={columns} rows={filtered} loading={loading} onRowClick={r => setSelected(r)} />

      <TrackerDrawer row={selected} onClose={() => setSelected(null)}
        onSave={async u => {
          if (!selected) return;
          try {
            await updateRow(selected.tracker_id, u);
            toast.success('Tracker row saved');
            setSelected(null);
          } catch (err) {
            toast.error('Save failed', (err as Error).message);
          }
        }} />
    </div>
  );
}

function ConferenceDrawer({ conference, onClose, onSave }: {
  conference: Conference | null;
  onClose: () => void;
  onSave: (updates: Partial<Conference>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Conference | null>(conference);
  const [saving, setSaving] = useState(false);
  // setDraft must run as a side effect, not inside useMemo (which is for
  // pure computations). The useMemo form was firing setState during
  // render — sometimes the second drawer opening would still hold the
  // first conference's data.
  useEffect(() => { setDraft(conference); }, [conference]);
  if (!conference || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;
  // Hard guard against the "edited row had no conference_id, save
  // overwrote the wrong row" scenario. Surface it as a warning the user
  // sees BEFORE clicking Save instead of after the data is corrupted.
  const missingId = !draft.conference_id || !draft.conference_id.trim();

  return (
    <Drawer
      open={!!conference}
      onClose={onClose}
      title={conference.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving || missingId}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {missingId && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            This row has no <code>conference_id</code> in the sheet.
            Saving without an ID would overwrite the first ID-less row by
            mistake. Set an ID below (e.g. <code>CONF-016</code>) before
            saving.
          </div>
        )}
        <Field label="Conference ID">
          <input className={inputClass} value={draft.conference_id || ''}
            onChange={e => setDraft({ ...draft, conference_id: e.target.value })} placeholder="CONF-016" />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input className={inputClass} value={draft.city} onChange={e => setDraft({ ...draft, city: e.target.value })} />
          </Field>
          <Field label="Country">
            <input className={inputClass} value={draft.country} onChange={e => setDraft({ ...draft, country: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <input type="date" className={inputClass} value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
          </Field>
          <Field label="End Date">
            <input type="date" className={inputClass} value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tier">
            <select className={inputClass} value={draft.tier} onChange={e => setDraft({ ...draft, tier: e.target.value })}>
              <option value="">—</option>
              {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Fund">
            <select className={inputClass} value={draft.fund_eligible} onChange={e => setDraft({ ...draft, fund_eligible: e.target.value })}>
              <option value="">—</option>
              {FUND_ELIGIBLE.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
              <option value="">—</option>
              {CONF_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Website">
          <input className={inputClass} value={draft.website} onChange={e => setDraft({ ...draft, website: e.target.value })} />
        </Field>
        <Field label="Est. cost per company (USD)">
          <input className={inputClass} value={draft.estimated_cost_per_company_usd}
            onChange={e => setDraft({ ...draft, estimated_cost_per_company_usd: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function TrackerDrawer({ row, onClose, onSave }: {
  row: TrackerRow | null;
  onClose: () => void;
  onSave: (updates: Partial<TrackerRow>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TrackerRow | null>(row);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(row); }, [row]);
  if (!row || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={`${draft.company_name} → ${draft.conference_name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Decision">
            <select className={inputClass} value={draft.decision}
              onChange={e => setDraft({ ...draft, decision: e.target.value })}>
              <option value="">—</option>
              {DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Fit Score">
            <input className={inputClass} value={draft.fit_score}
              onChange={e => setDraft({ ...draft, fit_score: e.target.value })} />
          </Field>
        </div>
        <Field label="Signatory Name">
          <input className={inputClass} value={draft.signatory_name}
            onChange={e => setDraft({ ...draft, signatory_name: e.target.value })} />
        </Field>
        <Field label="Commitment Letter URL">
          <input className={inputClass} value={draft.commitment_letter_url}
            onChange={e => setDraft({ ...draft, commitment_letter_url: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Travel Dates">
            <input className={inputClass} value={draft.travel_dates}
              onChange={e => setDraft({ ...draft, travel_dates: e.target.value })} />
          </Field>
          <Field label="Visa Status">
            <input className={inputClass} value={draft.visa_status}
              onChange={e => setDraft({ ...draft, visa_status: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Flight Booked">
            <input className={inputClass} value={draft.flight_booked}
              onChange={e => setDraft({ ...draft, flight_booked: e.target.value })} />
          </Field>
          <Field label="Payment ID">
            <input className={inputClass} value={draft.payment_id}
              onChange={e => setDraft({ ...draft, payment_id: e.target.value })} />
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

function CreateConferenceDrawer({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Conference>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Conference>>({ tier: 'T2', status: 'Tracked' });
  const [saving, setSaving] = useState(false);

  const canCreate = !!(draft.conference_id && draft.name);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add Conference"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try { await onCreate(draft); setDraft({ tier: 'T2', status: 'Tracked' }); }
            finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Conference ID" required>
          <input className={inputClass} value={draft.conference_id || ''}
            onChange={e => setDraft({ ...draft, conference_id: e.target.value })} placeholder="CONF-016" />
        </Field>
        <Field label="Name" required>
          <input className={inputClass} value={draft.name || ''}
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input className={inputClass} value={draft.city || ''}
              onChange={e => setDraft({ ...draft, city: e.target.value })} />
          </Field>
          <Field label="Country">
            <input className={inputClass} value={draft.country || ''}
              onChange={e => setDraft({ ...draft, country: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input type="date" className={inputClass} value={draft.start_date || ''}
              onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
          </Field>
          <Field label="End">
            <input type="date" className={inputClass} value={draft.end_date || ''}
              onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
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
