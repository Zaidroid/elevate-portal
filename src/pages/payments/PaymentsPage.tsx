import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, CheckCircle2, XCircle, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { useModuleData } from '../../data/useModuleData';
import type { Payment, PR, Company } from '../../data/types';
import { keepCompaniesSection } from '../../lib/sheets/sections';
import { canonicalCohortName } from '../../config/cohort3Aliases';
import { buildCompanyLookup } from '../../data/companyLookup';
import { COHORT3_BUDGET_TOTAL_USD } from '../../config/interventions';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, PageHeader, statusTone, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import { PaymentsSourceComparisonView } from './SourceComparisonView';

const PAYEE_TYPES = ['Vendor', 'Advisor', 'Participant', 'Conference'];
const PAYMENT_STATUSES = ['Pending Approval', 'Approved', 'Sent to Finance', 'Paid', 'Rejected'];
const FUND_CODES = ['97060', '91763'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

function fmtUsd0(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fundDonor(fund: string | undefined): 'Dutch' | 'SIDA' | null {
  const f = (fund || '').trim();
  if (!f) return null;
  if (/dutch/i.test(f) || f === '97060') return 'Dutch';
  if (/sida/i.test(f) || f === '91763') return 'SIDA';
  return null;
}

export function PaymentsPage() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user.email) : false;

  const payHook = useModuleData<Payment>('payments', 'payments');
  const masterHook = useModuleData<Company>('companies', 'companies');
  const q1 = useModuleData<PR>('procurement', 'q1');
  const q2 = useModuleData<PR>('procurement', 'q2');
  const q3 = useModuleData<PR>('procurement', 'q3');
  const q4 = useModuleData<PR>('procurement', 'q4');

  // Section-aware: pull only Companies-section payment rows. Without
  // this, vendor / individual / advisor sub-section rows leak in and
  // the table renders blank cells because the columns don't match.
  // This was the no-data root cause from the audit.
  const rows = useMemo(
    () => keepCompaniesSection(payHook.rows, payHook.headers) as Payment[],
    [payHook.rows, payHook.headers],
  );

  // All cohort PRs across the 4 quarters — used by the CreatePaymentDrawer
  // to auto-fill company / fund / amount when the user types a pr_id.
  const allPrs = useMemo<PR[]>(() => [
    ...keepCompaniesSection(q1.rows, q1.headers) as PR[],
    ...keepCompaniesSection(q2.rows, q2.headers) as PR[],
    ...keepCompaniesSection(q3.rows, q3.headers) as PR[],
    ...keepCompaniesSection(q4.rows, q4.headers) as PR[],
  ], [q1.rows, q1.headers, q2.rows, q2.headers, q3.rows, q3.headers, q4.rows, q4.headers]);

  // company_id → derived view (canonical name + AM + donor + budget cap).
  // Shape + builder live in src/data/companyLookup so Procurement can use
  // the same derivation without duplication.
  const companyLookup = useMemo(() => buildCompanyLookup(masterHook.rows), [masterHook.rows]);

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

  // ── Donor burn (Dutch / SIDA) ─────────────────────────────────
  // Same shape as the procurement summary: paid (settled Payments) vs
  // planned (sum of cohort PR.total_cost_usd) vs the 2026 cap.
  const donorBurn = useMemo(() => {
    const dutch = { paid: 0, planned: 0 };
    const sida  = { paid: 0, planned: 0 };
    const isCohortRow = (companyId: string | undefined): boolean => {
      const lk = companyLookup.get(companyId || '');
      if (!lk) return false;
      return canonicalCohortName(lk.name) !== null;
    };
    for (const p of rows) {
      if (!isCohortRow(p.company_id)) continue;
      if ((p.status || '').toLowerCase() !== 'paid') continue;
      const v = parseFloat(String(p.amount_usd || '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v)) continue;
      const d = fundDonor(p.fund_code);
      if (d === 'Dutch') dutch.paid += v;
      else if (d === 'SIDA') sida.paid += v;
    }
    for (const pr of allPrs) {
      if (!isCohortRow(pr.company_id)) continue;
      const v = parseFloat(String(pr.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v)) continue;
      const d = fundDonor(pr.fund_code);
      if (d === 'Dutch') dutch.planned += v;
      else if (d === 'SIDA') sida.planned += v;
    }
    return {
      Dutch: { ...dutch, cap: COHORT3_BUDGET_TOTAL_USD.dutch },
      SIDA:  { ...sida,  cap: COHORT3_BUDGET_TOTAL_USD.sida },
    };
  }, [rows, allPrs, companyLookup]);

  const columns: Column<Payment>[] = [
    { key: 'payee_name', header: 'Payee' },
    { key: 'payee_type', header: 'Type', width: '110px' },
    {
      key: 'company',
      header: 'Company / AM',
      width: '210px',
      render: r => {
        const lk = companyLookup.get(r.company_id);
        if (!lk) return <span className="text-2xs text-slate-400">{r.company_id || '—'}</span>;
        return (
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy-500 dark:text-white">{lk.name}</div>
            <div className="text-2xs text-slate-500">
              {lk.amName || '—'}{lk.donor ? ` · ${lk.donor}` : ''}
            </div>
          </div>
        );
      },
    },
    { key: 'amount_usd', header: 'Amount USD', width: '120px' },
    { key: 'fund_code', header: 'Fund', width: '90px' },
    { key: 'payment_date', header: 'Date', width: '110px' },
    {
      key: 'status',
      header: 'Status',
      render: r => <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Payments"
        badges={[{ label: `${rows.length} cohort entries`, tone: 'teal' }]}
        actions={
          <>
            <Button variant="ghost" onClick={payHook.refresh} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadCsv(timestampedFilename('payments'), filtered)}
              disabled={filtered.length === 0}
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </>
        }
      />

      {/* Donor burn — paid vs planned vs cap, same numbers procurement shows. */}
      <Card>
        <CardHeader title="Donor burn" subtitle="Settled Payments vs planned PRs vs the 2026 cap, scoped to cohort 3." />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {(['Dutch', 'SIDA'] as const).map(d => {
            const b = donorBurn[d];
            const fill = d === 'Dutch' ? 'bg-brand-orange' : 'bg-brand-teal';
            const planPct = b.cap > 0 ? Math.min(150, Math.round((b.planned / b.cap) * 100)) : 0;
            const paidPct = b.cap > 0 ? Math.min(100, Math.round((b.paid / b.cap) * 100)) : 0;
            return (
              <div key={d}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-bold text-navy-500 dark:text-white">{d}</span>
                  <span className="text-xs text-slate-500">
                    <span className="font-mono">{fmtUsd0(b.paid)}</span> / <span className="font-mono">{fmtUsd0(b.cap)}</span> <span className="ml-1 font-mono">({paidPct}%)</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                  <div className="relative h-full">
                    <div className={`absolute left-0 top-0 h-full ${fill} opacity-50`} style={{ width: `${Math.min(100, planPct)}%` }} />
                    <div className={`absolute left-0 top-0 h-full ${fill}`} style={{ width: `${paidPct}%` }} />
                  </div>
                </div>
                <div className="mt-0.5 text-2xs uppercase tracking-wider text-slate-500">
                  <span className="font-mono">{fmtUsd0(b.planned)}</span> committed (PRs)
                </div>
              </div>
            );
          })}
        </div>
      </Card>

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

      {payHook.error && view === 'output' && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {payHook.error.message}</p>
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
          <DataTable columns={columns} rows={filtered} loading={payHook.loading} onRowClick={r => setSelected(r)} />
        </>
      )}

      <PaymentDrawer
        payment={selected}
        admin={admin}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          await payHook.updateRow(selected.payment_id, updates);
          setSelected(null);
        }}
      />

      <CreatePaymentDrawer
        open={creating}
        onClose={() => setCreating(false)}
        prs={allPrs}
        onCreate={async row => {
          await payHook.createRow(row);
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
  useEffect(() => { setDraft(payment); }, [payment]);

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
  open, onClose, onCreate, prs,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Payment>) => Promise<void>;
  /** All cohort PRs across the 4 quarters, used to auto-fill on pr_id. */
  prs: PR[];
}) {
  const [draft, setDraft] = useState<Partial<Payment>>({
    status: 'Pending Approval', currency: 'USD', finance_contact: 'Khamis Eweis',
  });
  const [saving, setSaving] = useState(false);
  // Whether the latest pr_id input matched a cohort PR — affects the
  // green/amber hint shown under the field.
  const [lastMatchedPr, setLastMatchedPr] = useState<PR | null>(null);

  // PR ID → PR map for fast O(1) lookup as the user types.
  const prById = useMemo(() => {
    const m = new Map<string, PR>();
    for (const p of prs) if (p.pr_id) m.set(p.pr_id.trim(), p);
    return m;
  }, [prs]);

  const onPrIdChange = (next: string) => {
    const trimmed = next.trim();
    const found = trimmed ? prById.get(trimmed) : undefined;
    setLastMatchedPr(found ?? null);
    if (found) {
      // Pull the company / fund / intervention / amount across into
      // the draft, but only fill fields the user hasn't already
      // overridden so we don't clobber edits in flight.
      setDraft(prev => ({
        ...prev,
        pr_id: trimmed,
        company_id: prev.company_id || found.company_id || '',
        intervention_type: prev.intervention_type || found.intervention_type || '',
        fund_code: prev.fund_code || found.fund_code || '',
        amount_usd: prev.amount_usd || found.total_cost_usd || '',
      }));
    } else {
      setDraft(prev => ({ ...prev, pr_id: trimmed }));
    }
  };

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
              setLastMatchedPr(null);
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
        <Field label="PR ID (optional — auto-fills company / fund / amount when matched)">
          <input className={inputClass} value={draft.pr_id || ''}
            onChange={e => onPrIdChange(e.target.value)} placeholder="PR-E3-001" />
          {(draft.pr_id || '').trim().length > 0 && (
            <p className={`mt-1 text-2xs ${lastMatchedPr ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}`}>
              {lastMatchedPr
                ? `Matched: ${lastMatchedPr.activity || lastMatchedPr.item_description || lastMatchedPr.pr_id} · company ${lastMatchedPr.company_id || '—'}`
                : 'No matching PR yet — fields stay editable.'}
            </p>
          )}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company ID">
            <input className={inputClass} value={draft.company_id || ''}
              onChange={e => setDraft({ ...draft, company_id: e.target.value })} />
          </Field>
          <Field label="Fund Code">
            <select className={inputClass} value={draft.fund_code || ''}
              onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
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
