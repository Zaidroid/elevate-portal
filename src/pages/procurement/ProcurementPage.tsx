import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Download } from 'lucide-react';
import { derivePRFields } from '../../lib/procurement/compute';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';

type Quarter = 'q1' | 'q2' | 'q3' | 'q4';

type PR = {
  pr_id: string;
  activity: string;
  intervention_type: string;
  company_id: string;
  office_code: string;
  gl_account: string;
  fund_code: string;
  lin_code: string;
  item_description: string;
  unit: string;
  qty: string;
  unit_cost_usd: string;
  total_cost_usd: string;
  threshold_class: string;
  sla_working_days: string;
  target_award_date: string;
  pr_submit_date: string;
  pr_deadline: string;
  local_international: string;
  requester_email: string;
  status: string;
  procurement_contact: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

const QUARTER_LABELS: Record<Quarter, string> = {
  q1: 'Q1 2026',
  q2: 'Q2 2026',
  q3: 'Q3 2026',
  q4: 'Q4 2026',
};

const PR_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Awarded', 'Delivered', 'Cancelled'];
const FUND_CODES = ['97060', '91763'];
const INTERVENTIONS = [
  'TTH', 'Upskilling', 'MKG', 'MA', 'MA-ElevateBridge', 'MA-Market Registration',
  'MA-MKG Agency', 'MA-Resource Placement', 'MA-Legal', 'C-Suite', 'Conferences',
];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

function thresholdTone(cls: string): 'neutral' | 'teal' | 'amber' | 'red' | 'green' {
  switch (cls) {
    case 'Micro': return 'teal';
    case 'Small': return 'green';
    case 'Standard': return 'amber';
    case 'High Value': return 'red';
    default: return 'neutral';
  }
}

export function ProcurementPage() {
  const { user } = useAuth();
  const sheetId = getSheetId('procurement');
  const [quarter, setQuarter] = useState<Quarter>('q1');
  const tab = getTab('procurement', quarter);

  const { rows, loading, error, refresh, updateRow, createRow } = useSheetDoc<PR>(
    sheetId || null,
    tab,
    'pr_id',
    { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PR | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.pr_id, r.activity, r.company_id, r.intervention_type, r.status, r.item_description]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [rows, query]);

  const columns: Column<PR>[] = [
    { key: 'pr_id', header: 'PR ID', width: '120px' },
    { key: 'activity', header: 'Activity' },
    { key: 'intervention_type', header: 'Intervention', width: '130px' },
    { key: 'company_id', header: 'Company', width: '90px' },
    { key: 'total_cost_usd', header: 'Total USD', width: '110px' },
    {
      key: 'threshold_class',
      header: 'Threshold',
      width: '110px',
      render: r => <Badge tone={thresholdTone(r.threshold_class)}>{r.threshold_class || '—'}</Badge>,
    },
    { key: 'pr_deadline', header: 'Deadline', width: '110px' },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>,
    },
  ];

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="Procurement" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_PROCUREMENT</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Procurement</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quarterly purchase requests. Thresholds and deadlines compute in the sheet.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename(`procurement_${quarter}`), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New PR
          </Button>
        </div>
      </header>

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-navy-700 dark:bg-navy-600">
        {(Object.keys(QUARTER_LABELS) as Quarter[]).map(q => (
          <button
            key={q}
            onClick={() => setQuarter(q)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              quarter === q
                ? 'bg-brand-red text-white'
                : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
            }`}
          >
            {QUARTER_LABELS[q]}
          </button>
        ))}
      </div>

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
          placeholder="Search by PR, activity, company, status..."
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
        />
      </div>

      <DataTable columns={columns} rows={filtered} loading={loading} onRowClick={r => setSelected(r)} />

      <PRDrawer
        pr={selected}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          await updateRow(selected.pr_id, updates);
          setSelected(null);
        }}
      />

      <CreatePRDrawer
        open={creating}
        onClose={() => setCreating(false)}
        requester={user?.email || ''}
        onCreate={async row => {
          await createRow(row);
          setCreating(false);
        }}
      />
    </div>
  );
}

function PRDrawer({
  pr, onClose, onSave,
}: {
  pr: PR | null;
  onClose: () => void;
  onSave: (updates: Partial<PR>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PR | null>(pr);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(pr); }, [pr]);

  const derived = useMemo(() => {
    if (!draft) return null;
    return derivePRFields({
      qty: draft.qty,
      unit_cost_usd: draft.unit_cost_usd,
      target_award_date: draft.target_award_date,
    });
  }, [draft]);

  if (!pr || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  return (
    <Drawer
      open={!!pr}
      onClose={onClose}
      title={`${pr.pr_id} — ${pr.activity || 'Untitled'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            setSaving(true);
            try {
              const merged = { ...draft, ...(derived || {}) } as PR;
              await onSave(merged);
            } finally { setSaving(false); }
          }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Activity">
          <input className={inputClass} value={draft.activity}
            onChange={e => setDraft({ ...draft, activity: e.target.value })} />
        </Field>
        <Field label="Item Description">
          <textarea rows={2} className={inputClass} value={draft.item_description}
            onChange={e => setDraft({ ...draft, item_description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Intervention">
            <select className={inputClass} value={draft.intervention_type}
              onChange={e => setDraft({ ...draft, intervention_type: e.target.value })}>
              <option value="">—</option>
              {INTERVENTIONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Fund Code">
            <select className={inputClass} value={draft.fund_code}
              onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Qty">
            <input className={inputClass} value={draft.qty}
              onChange={e => setDraft({ ...draft, qty: e.target.value })} />
          </Field>
          <Field label="Unit Cost USD">
            <input className={inputClass} value={draft.unit_cost_usd}
              onChange={e => setDraft({ ...draft, unit_cost_usd: e.target.value })} />
          </Field>
          <Field label="Total USD (auto)">
            <input className={inputClass} value={derived?.total_cost_usd || draft.total_cost_usd} readOnly />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target Award Date">
            <input type="date" className={inputClass} value={draft.target_award_date}
              onChange={e => setDraft({ ...draft, target_award_date: e.target.value })} />
          </Field>
          <Field label={`PR Deadline (auto, ${derived?.sla_working_days || draft.sla_working_days || '—'} workdays)`}>
            <input className={inputClass} value={derived?.pr_deadline || draft.pr_deadline} readOnly />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Threshold (auto)">
            <div className="pt-1.5">
              <Badge tone={thresholdTone(derived?.threshold_class || draft.threshold_class)}>
                {derived?.threshold_class || draft.threshold_class || '—'}
              </Badge>
            </div>
          </Field>
          <Field label="Status">
            <select className={inputClass} value={draft.status}
              onChange={e => setDraft({ ...draft, status: e.target.value })}>
              {PR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Company ID">
          <input className={inputClass} value={draft.company_id}
            onChange={e => setDraft({ ...draft, company_id: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea rows={3} className={inputClass} value={draft.notes}
            onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function CreatePRDrawer({
  open, onClose, onCreate, requester,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<PR>) => Promise<void>;
  requester: string;
}) {
  const [draft, setDraft] = useState<Partial<PR>>({
    status: 'Draft', procurement_contact: 'Donia Shadeed', requester_email: requester,
  });
  const [saving, setSaving] = useState(false);

  const derived = useMemo(() => derivePRFields({
    qty: draft.qty,
    unit_cost_usd: draft.unit_cost_usd,
    target_award_date: draft.target_award_date,
  }), [draft.qty, draft.unit_cost_usd, draft.target_award_date]);

  const canCreate = !!(draft.pr_id && draft.activity);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Purchase Request"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try {
              const merged = { ...draft, ...derived };
              await onCreate(merged);
              setDraft({ status: 'Draft', procurement_contact: 'Donia Shadeed', requester_email: requester });
            } finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="PR ID" required>
          <input className={inputClass} value={draft.pr_id || ''}
            onChange={e => setDraft({ ...draft, pr_id: e.target.value })} placeholder="PR-E3-001" />
        </Field>
        <Field label="Activity" required>
          <input className={inputClass} value={draft.activity || ''}
            onChange={e => setDraft({ ...draft, activity: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Intervention">
            <select className={inputClass} value={draft.intervention_type || ''}
              onChange={e => setDraft({ ...draft, intervention_type: e.target.value })}>
              <option value="">—</option>
              {INTERVENTIONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Fund Code">
            <select className={inputClass} value={draft.fund_code || ''}
              onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qty">
            <input className={inputClass} value={draft.qty || ''}
              onChange={e => setDraft({ ...draft, qty: e.target.value })} />
          </Field>
          <Field label="Unit Cost USD">
            <input className={inputClass} value={draft.unit_cost_usd || ''}
              onChange={e => setDraft({ ...draft, unit_cost_usd: e.target.value })} />
          </Field>
        </div>
        <Field label="Target Award Date">
          <input type="date" className={inputClass} value={draft.target_award_date || ''}
            onChange={e => setDraft({ ...draft, target_award_date: e.target.value })} />
        </Field>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-navy-700 dark:bg-navy-700">
          <div className="mb-2 font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Auto-computed
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>Total: <b className="text-navy-500 dark:text-white">{derived.total_cost_usd ? `$${Number(derived.total_cost_usd).toLocaleString()}` : '—'}</b></div>
            <div>Threshold: <Badge tone={thresholdTone(derived.threshold_class)}>{derived.threshold_class || '—'}</Badge></div>
            <div>SLA: <b className="text-navy-500 dark:text-white">{derived.sla_working_days ? `${derived.sla_working_days} workdays` : '—'}</b></div>
            <div>Deadline: <b className="text-navy-500 dark:text-white">{derived.pr_deadline || '—'}</b></div>
          </div>
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
