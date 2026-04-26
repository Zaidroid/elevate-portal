import { useMemo, useState } from 'react';
import { Search, Plus, CheckCircle2, XCircle, Download } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import { PaymentsSourceComparisonView } from './SourceComparisonView';

type Payment = {
  payment_id: string;
  pr_id: string;
  company_id: string;
  assignment_id: string;
  payee_type: string;
  payee_name: string;
  intervention_type: string;
  fund_code: string;
  amount_usd: string;
  currency: string;
  payment_date: string;
  status: string;
  finance_contact: string;
  invoice_url: string;
  receipt_url: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

const PAYEE_TYPES = ['Vendor', 'Advisor', 'Participant', 'Conference'];
const PAYMENT_STATUSES = ['Pending Approval', 'Approved', 'Sent to Finance', 'Paid', 'Rejected'];
const FUND_CODES = ['97060', '91763'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function PaymentsPage() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user.email) : false;
  const sheetId = getSheetId('payments');
  const tab = getTab('payments', 'payments');

  const { rows, loading, error, refresh, updateRow, createRow } = useSheetDoc<Payment>(
    sheetId || null,
    tab,
    'payment_id',
    { userEmail: user?.email }
  );

  const [query, setQuery] = useState('');
  const [view, setView] = useState<'output' | 'source'>('output');
  const [selected, setSelected] = useState<Payment | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.payment_id, r.payee_name, r.pr_id, r.company_id, r.status]
        .some(v => (v || '').toLowerCase().includes(q))
    );
  }, [rows, query]);

  const columns: Column<Payment>[] = [
    { key: 'payee_name', header: 'Payee' },
    { key: 'payee_type', header: 'Type', width: '110px' },
    { key: 'amount_usd', header: 'Amount USD', width: '120px' },
    { key: 'fund_code', header: 'Fund', width: '90px' },
    { key: 'payment_date', header: 'Date', width: '110px' },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>,
    },
  ];

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="Payments" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_PAYMENTS</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Payments</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Advisor fees, vendor payments, participant stipends. {admin ? 'You can approve payments.' : 'Approvals require admin role.'}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={refresh}>Refresh</Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('payments'), filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New Payment
          </Button>
        </div>
      </header>

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-navy-700 dark:bg-navy-600">
        <button
          onClick={() => setView('output')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            view === 'output'
              ? 'bg-brand-red text-white'
              : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
          }`}
        >
          E3 Payments
        </button>
        <button
          onClick={() => setView('source')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            view === 'source'
              ? 'bg-navy-500 text-white'
              : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
          }`}
          title="Read-only view of the team's legacy Payment Tracker, compared to E3 Payments"
        >
          Team source ▸ E3
        </button>
      </div>

      {error && view === 'output' && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      {view === 'source' ? (
        <PaymentsSourceComparisonView e3Rows={rows} />
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by payee, PR, company, status..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            />
          </div>
          <DataTable columns={columns} rows={filtered} loading={loading} onRowClick={r => setSelected(r)} />
        </>
      )}

      <PaymentDrawer
        payment={selected}
        admin={admin}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          await updateRow(selected.payment_id, updates);
          setSelected(null);
        }}
      />

      <CreatePaymentDrawer
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

function PaymentDrawer({
  payment, admin, onClose, onSave,
}: {
  payment: Payment | null;
  admin: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Payment>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Payment | null>(payment);
  const [saving, setSaving] = useState(false);
  useMemo(() => setDraft(payment), [payment]);

  if (!payment || !draft) return <Drawer open={false} onClose={onClose} title="" children={null} />;

  const setStatus = async (status: string) => {
    setSaving(true);
    try { await onSave({ status }); } finally { setSaving(false); }
  };

  return (
    <Drawer
      open={!!payment}
      onClose={onClose}
      title={`${payment.payment_id} — ${payment.payee_name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
            disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {admin && draft.status === 'Pending Approval' && (
          <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <Button variant="primary" onClick={() => setStatus('Approved')} disabled={saving}>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button variant="danger" onClick={() => setStatus('Rejected')} disabled={saving}>
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
        )}

        <Field label="Payee Name">
          <input className={inputClass} value={draft.payee_name}
            onChange={e => setDraft({ ...draft, payee_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payee Type">
            <select className={inputClass} value={draft.payee_type}
              onChange={e => setDraft({ ...draft, payee_type: e.target.value })}>
              <option value="">—</option>
              {PAYEE_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
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
          <Field label="Amount USD">
            <input className={inputClass} value={draft.amount_usd}
              onChange={e => setDraft({ ...draft, amount_usd: e.target.value })} />
          </Field>
          <Field label="Currency">
            <input className={inputClass} value={draft.currency}
              onChange={e => setDraft({ ...draft, currency: e.target.value })} />
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={draft.payment_date}
              onChange={e => setDraft({ ...draft, payment_date: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PR ID">
            <input className={inputClass} value={draft.pr_id}
              onChange={e => setDraft({ ...draft, pr_id: e.target.value })} />
          </Field>
          <Field label="Company ID">
            <input className={inputClass} value={draft.company_id}
              onChange={e => setDraft({ ...draft, company_id: e.target.value })} />
          </Field>
        </div>
        <Field label="Status">
          <select
            className={inputClass}
            value={draft.status}
            disabled={!admin && (draft.status === 'Approved' || draft.status === 'Paid')}
            onChange={e => setDraft({ ...draft, status: e.target.value })}
          >
            {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice URL">
            <input className={inputClass} value={draft.invoice_url}
              onChange={e => setDraft({ ...draft, invoice_url: e.target.value })} />
          </Field>
          <Field label="Receipt URL">
            <input className={inputClass} value={draft.receipt_url}
              onChange={e => setDraft({ ...draft, receipt_url: e.target.value })} />
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

function CreatePaymentDrawer({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Payment>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Payment>>({
    status: 'Pending Approval', currency: 'USD', finance_contact: 'Khamis Eweis',
  });
  const [saving, setSaving] = useState(false);

  const canCreate = !!(draft.payment_id && draft.payee_name && draft.amount_usd);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Payment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!canCreate) return;
            setSaving(true);
            try {
              await onCreate(draft);
              setDraft({ status: 'Pending Approval', currency: 'USD', finance_contact: 'Khamis Eweis' });
            } finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Payment ID" required>
          <input className={inputClass} value={draft.payment_id || ''}
            onChange={e => setDraft({ ...draft, payment_id: e.target.value })} placeholder="PAY-E3-0001" />
        </Field>
        <Field label="Payee Name" required>
          <input className={inputClass} value={draft.payee_name || ''}
            onChange={e => setDraft({ ...draft, payee_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputClass} value={draft.payee_type || ''}
              onChange={e => setDraft({ ...draft, payee_type: e.target.value })}>
              <option value="">—</option>
              {PAYEE_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Amount USD" required>
            <input className={inputClass} value={draft.amount_usd || ''}
              onChange={e => setDraft({ ...draft, amount_usd: e.target.value })} />
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          New payments default to <b>Pending Approval</b>. An admin must approve before it can be sent to Finance.
        </p>
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
