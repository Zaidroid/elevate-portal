import { useMemo, useState } from 'react';
import { Search, Plus, ExternalLink, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';

type Agreement = {
  agreement_id: string;
  company_id: string;
  agreement_type: string;
  signed_date: string;
  signatory_name: string;
  signatory_title: string;
  gsg_signatory: string;
  drive_url: string;
  status: string;
  related_intervention: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

const AGREEMENT_TYPES = ['MJPSA', 'Addendum', 'NDA', 'Commitment Letter'];
const STATUSES = ['Drafted', 'Sent', 'Signed', 'Countersigned', 'Executed'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function DocsPage() {
  const { user } = useAuth();
  const sheetId = getSheetId('docs');
  const tab = getTab('docs', 'agreements');

  const { rows, loading, error, refresh, updateRow, createRow } = useSheetDoc<Agreement>(
    sheetId || null,
    tab,
    'agreement_id',
    { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Agreement | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.company_id, r.agreement_type, r.signatory_name, r.status]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [rows, query]);

  const columns: Column<Agreement>[] = [
    { key: 'agreement_type', header: 'Type' },
    { key: 'signatory_name', header: 'Signatory' },
    { key: 'signed_date', header: 'Signed' },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>,
    },
    {
      key: 'drive_url',
      header: 'Link',
      width: '70px',
      render: r =>
        r.drive_url ? (
          <a
            href={r.drive_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-brand-teal hover:text-brand-teal-dark"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null,
    },
  ];

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="Docs and Agreements" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_DOCS</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Docs and Agreements</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            MJPSAs, addenda, NDAs, commitment letters. Edits sync to the sheet in 30 s.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('agreements'), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New Agreement
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by company, type, signatory, status..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
        />
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        loading={loading}
        onRowClick={r => setSelected(r)}
      />

      <AgreementDrawer
        agreement={selected}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          await updateRow(selected.agreement_id, updates);
          setSelected(null);
        }}
      />

      <CreateAgreementDrawer
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

function AgreementDrawer({
  agreement,
  onClose,
  onSave,
}: {
  agreement: Agreement | null;
  onClose: () => void;
  onSave: (updates: Partial<Agreement>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Agreement | null>(agreement);
  const [saving, setSaving] = useState(false);
  useMemo(() => setDraft(agreement), [agreement]);

  if (!agreement || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  return (
    <Drawer
      open={!!agreement}
      onClose={onClose}
      title={agreement.agreement_id}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Company ID">
          <input className={inputClass} value={draft.company_id}
            onChange={e => setDraft({ ...draft, company_id: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputClass} value={draft.agreement_type}
              onChange={e => setDraft({ ...draft, agreement_type: e.target.value })}>
              <option value="">—</option>
              {AGREEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
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
          <Field label="Signatory Name">
            <input className={inputClass} value={draft.signatory_name}
              onChange={e => setDraft({ ...draft, signatory_name: e.target.value })} />
          </Field>
          <Field label="Signatory Title">
            <input className={inputClass} value={draft.signatory_title}
              onChange={e => setDraft({ ...draft, signatory_title: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Signed Date">
            <input type="date" className={inputClass} value={draft.signed_date}
              onChange={e => setDraft({ ...draft, signed_date: e.target.value })} />
          </Field>
          <Field label="GSG Signatory">
            <input className={inputClass} value={draft.gsg_signatory}
              onChange={e => setDraft({ ...draft, gsg_signatory: e.target.value })} />
          </Field>
        </div>
        <Field label="Drive URL">
          <input className={inputClass} value={draft.drive_url}
            onChange={e => setDraft({ ...draft, drive_url: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={draft.notes}
            onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function CreateAgreementDrawer({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Agreement>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Agreement>>({ status: 'Drafted', agreement_type: 'MJPSA' });
  const [saving, setSaving] = useState(false);

  const canCreate = !!(draft.agreement_id && draft.company_id);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Agreement"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try { await onCreate(draft); setDraft({ status: 'Drafted', agreement_type: 'MJPSA' }); }
            finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Agreement ID" required>
          <input className={inputClass} value={draft.agreement_id || ''}
            onChange={e => setDraft({ ...draft, agreement_id: e.target.value })}
            placeholder="AGR-E3-0001" />
        </Field>
        <Field label="Company ID" required>
          <input className={inputClass} value={draft.company_id || ''}
            onChange={e => setDraft({ ...draft, company_id: e.target.value })}
            placeholder="E3-0001" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputClass} value={draft.agreement_type || ''}
              onChange={e => setDraft({ ...draft, agreement_type: e.target.value })}>
              {AGREEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
