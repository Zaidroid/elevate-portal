import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Download, RefreshCw } from 'lucide-react';
import { derivePRFields } from '../../lib/procurement/compute';
import { useAuth } from '../../services/auth';
import { useModuleData } from '../../data/useModuleData';
import type { PR, Company, Payment } from '../../data/types';
import { keepCompaniesSection } from '../../lib/sheets/sections';
import { Badge, Button, Card, CardHeader, DataTable, Drawer, PageHeader, statusTone, downloadCsv, timestampedFilename, useToast } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import { SourceComparisonView } from './SourceComparisonView';
import { SourceAnalysisView } from './SourceAnalysisView';
import { canonicalCohortName } from '../../config/cohort3Aliases';
import { COHORT3_BUDGET_TOTAL_USD } from '../../config/interventions';
import { buildCompanyLookup } from '../../data/companyLookup';

type Quarter = 'q1' | 'q2' | 'q3' | 'q4';



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

function fmtUsd0(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

type ViewMode = Quarter | 'source' | 'analysis';

export function ProcurementPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<ViewMode>('q1');
  const isQuarter = view !== 'source' && view !== 'analysis';

  // All four quarters are always loaded by the provider (registered once).
  const q1Hook = useModuleData<PR>('procurement', 'q1');
  const q2Hook = useModuleData<PR>('procurement', 'q2');
  const q3Hook = useModuleData<PR>('procurement', 'q3');
  const q4Hook = useModuleData<PR>('procurement', 'q4');

  // Cross-module lookups so each PR row can show the company name, AM
  // and donor (instead of an opaque 6-digit company_id) and so the
  // top-of-page summary can compare planned PR spend vs paid Payments
  // vs the 2026 cap.
  const masterHook  = useModuleData<Company>('companies', 'companies');
  const paymentHook = useModuleData<Payment>('payments', 'payments');

  // Filter each quarter to the "Companies" section only — the team's
  // procurement sheets group rows by team (Companies / Individuals /
  // Marketing / etc.) using near-empty separator rows. Without this,
  // the page reads vendors + individuals + stray text rows and counts
  // get nonsensical (e.g. "1996" PRs because a year cell from a
  // separator row was being treated as data).
  const q1Companies = useMemo(() => keepCompaniesSection(q1Hook.rows, q1Hook.headers), [q1Hook.rows, q1Hook.headers]);
  const q2Companies = useMemo(() => keepCompaniesSection(q2Hook.rows, q2Hook.headers), [q2Hook.rows, q2Hook.headers]);
  const q3Companies = useMemo(() => keepCompaniesSection(q3Hook.rows, q3Hook.headers), [q3Hook.rows, q3Hook.headers]);
  const q4Companies = useMemo(() => keepCompaniesSection(q4Hook.rows, q4Hook.headers), [q4Hook.rows, q4Hook.headers]);

  const activeRows: PR[] = view === 'q1' ? q1Companies as PR[]
    : view === 'q2' ? q2Companies as PR[]
    : view === 'q3' ? q3Companies as PR[]
    : view === 'q4' ? q4Companies as PR[]
    : q1Companies as PR[];
  // Active quarter data — picks rows from the section-filtered view but
  // still uses the underlying hook for refresh/updateRow so mutations
  // land in the right place. createRow is dispatched per-quarter from
  // the CreatePRDrawer below.
  const activeHook = view === 'q1' ? q1Hook : view === 'q2' ? q2Hook : view === 'q3' ? q3Hook : q4Hook;
  const { loading, error, refresh, updateRow } = isQuarter ? activeHook : q1Hook;
  const rows = activeRows;

  const allE3Rows = useMemo(() => [
    ...q1Companies, ...q2Companies, ...q3Companies, ...q4Companies,
  ] as PR[], [q1Companies, q2Companies, q3Companies, q4Companies]);

  // company_id → derived view (canonical name, AM, donor, budget cap).
  // The cap from cohort3Aliases.ts is authoritative — PRs whose company
  // matches are budgeted; rows for non-cohort companies show plain text.
  // Builder lives in src/data/companyLookup so Payments shares the shape.
  const companyLookup = useMemo(() => buildCompanyLookup(masterHook.rows), [masterHook.rows]);

  // company_id → planned (sum of PR.total_cost_usd across all 4 quarters)
  // and paid (sum of Payment.amount_usd where status === Paid). Used both
  // for per-row bar and the top-of-page summary card.
  type SpendByCompany = { planned: number; paid: number };
  const spendByCompany = useMemo(() => {
    const m = new Map<string, SpendByCompany>();
    const seed = (id: string) => {
      if (!m.has(id)) m.set(id, { planned: 0, paid: 0 });
      return m.get(id)!;
    };
    for (const pr of allE3Rows) {
      if (!pr.company_id) continue;
      const v = parseFloat(String(pr.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) seed(pr.company_id).planned += v;
    }
    for (const pay of paymentHook.rows) {
      if (!pay.company_id) continue;
      if ((pay.status || '').toLowerCase() !== 'paid') continue;
      const v = parseFloat(String(pay.amount_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) seed(pay.company_id).paid += v;
    }
    return m;
  }, [allE3Rows, paymentHook.rows]);

  // Cohort-wide planned vs paid vs cap, for the summary card.
  const cohortTotals = useMemo(() => {
    let planned = 0, paid = 0;
    for (const pr of allE3Rows) {
      const cn = canonicalCohortName(companyLookup.get(pr.company_id || '')?.name || '');
      if (!cn) continue;
      const v = parseFloat(String(pr.total_cost_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) planned += v;
    }
    for (const pay of paymentHook.rows) {
      if ((pay.status || '').toLowerCase() !== 'paid') continue;
      const cn = canonicalCohortName(companyLookup.get(pay.company_id || '')?.name || '');
      if (!cn) continue;
      const v = parseFloat(String(pay.amount_usd || '').replace(/[^0-9.\-]/g, ''));
      if (Number.isFinite(v)) paid += v;
    }
    return {
      planned,
      paid,
      cap: COHORT3_BUDGET_TOTAL_USD.combined,
    };
  }, [allE3Rows, paymentHook.rows, companyLookup]);

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
    { key: 'pr_id', header: 'PR ID', width: '110px' },
    { key: 'activity', header: 'Activity' },
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
    { key: 'intervention_type', header: 'Intervention', width: '130px' },
    {
      key: 'budget',
      header: 'Spend / cap',
      width: '180px',
      render: r => {
        const lk = companyLookup.get(r.company_id);
        const sp = spendByCompany.get(r.company_id) ?? { planned: 0, paid: 0 };
        if (!lk || lk.budgetCap === 0) {
          // No allocation in cohort3Aliases — just show planned vs paid.
          return (
            <span className="text-2xs text-slate-500">
              {fmtUsd0(sp.planned)} planned · {fmtUsd0(sp.paid)} paid
            </span>
          );
        }
        const planPct = Math.min(150, Math.round((sp.planned / lk.budgetCap) * 100));
        const paidPct = Math.min(100, Math.round((sp.paid / lk.budgetCap) * 100));
        const overBudget = sp.planned > lk.budgetCap;
        const barFill = overBudget ? 'bg-brand-red' : 'bg-brand-teal';
        return (
          <div className="min-w-0">
            <div className="text-2xs text-slate-500">
              {fmtUsd0(sp.paid)} / {fmtUsd0(sp.planned)} <span className="opacity-60">/ {fmtUsd0(lk.budgetCap)}</span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
              <div className="relative h-full">
                <div className={`absolute left-0 top-0 h-full ${barFill} opacity-50`} style={{ width: `${Math.min(100, planPct)}%` }} />
                <div className={`absolute left-0 top-0 h-full ${barFill}`} style={{ width: `${paidPct}%` }} />
              </div>
            </div>
          </div>
        );
      },
    },
    { key: 'total_cost_usd', header: 'PR USD', width: '90px' },
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

  if (!import.meta.env.VITE_SHEET_PROCUREMENT) {
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
      <PageHeader
        title="Procurement"
        badges={[{ label: `${allE3Rows.length} PRs`, tone: 'teal' }]}
        actions={
          <>
            <Button variant="ghost" onClick={refresh} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadCsv(timestampedFilename(`procurement_${isQuarter ? view : 'q1'}`), filtered)}
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

      {/* Cohort 3 budget burn summary — same numbers Home shows. */}
      <Card>
        <CardHeader title="Cohort 3 procurement spend" subtitle="Planned PR total vs paid Payments vs the 2026 cap, across all 4 quarters." />
        <BudgetSummary planned={cohortTotals.planned} paid={cohortTotals.paid} cap={cohortTotals.cap} />
      </Card>

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-navy-700 dark:bg-navy-600">
        {(Object.keys(QUARTER_LABELS) as Quarter[]).map(q => (
          <button
            key={q}
            onClick={() => setView(q)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              view === q
                ? 'bg-brand-red text-white'
                : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
            }`}
          >
            {QUARTER_LABELS[q]}
          </button>
        ))}
        <button
          onClick={() => setView('source')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            view === 'source'
              ? 'bg-navy-500 text-white'
              : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
          }`}
          title="Read-only view of the GSG team's procurement plan, compared to our E3 output"
        >
          Team source ▸ E3
        </button>
        <button
          onClick={() => setView('analysis')}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            view === 'analysis'
              ? 'bg-brand-teal text-white'
              : 'text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
          }`}
          title="Per-company breakdown of the source sheet from Nov 2025 onwards"
        >
          Source analysis (Nov 2025 →)
        </button>
      </div>

      {error && isQuarter && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      {view === 'source' ? (
        <SourceComparisonView e3Rows={allE3Rows} />
      ) : view === 'analysis' ? (
        <SourceAnalysisView />
      ) : (
        <>
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
        </>
      )}

      <PRDrawer
        pr={selected}
        onClose={() => setSelected(null)}
        onSave={async updates => {
          if (!selected) return;
          try {
            await updateRow(selected.pr_id, updates);
            toast.success('PR saved');
            setSelected(null);
          } catch (err) {
            toast.error('Save failed', (err as Error).message);
          }
        }}
      />

      <CreatePRDrawer
        open={creating}
        onClose={() => setCreating(false)}
        requester={user?.email || ''}
        defaultQuarter={isQuarter ? (view as Quarter) : 'q1'}
        onCreate={async (targetQuarter, row) => {
          // Dispatch to the chosen quarter's hook so PRs always land in
          // the right tab regardless of which quarter the user is
          // currently viewing. Resolves the "view-switch on New" bug.
          const targetHook = targetQuarter === 'q1' ? q1Hook
            : targetQuarter === 'q2' ? q2Hook
            : targetQuarter === 'q3' ? q3Hook
            : q4Hook;
          try {
            await targetHook.createRow(row);
            toast.success(`PR created in ${targetQuarter.toUpperCase()}`);
            setCreating(false);
          } catch (err) {
            toast.error('Create failed', (err as Error).message);
          }
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
  open, onClose, onCreate, requester, defaultQuarter,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (targetQuarter: Quarter, row: Partial<PR>) => Promise<void>;
  requester: string;
  /** Which quarter the user is currently viewing — used as the default
   *  destination so the form behaves intuitively while still letting the
   *  user override it. */
  defaultQuarter: Quarter;
}) {
  const [draft, setDraft] = useState<Partial<PR>>({
    status: 'Draft', procurement_contact: 'Donia Shadeed', requester_email: requester,
  });
  const [targetQuarter, setTargetQuarter] = useState<Quarter>(defaultQuarter);
  const [saving, setSaving] = useState(false);

  // Reset target quarter to whatever the user is currently viewing each
  // time the drawer is reopened.
  useEffect(() => {
    if (open) setTargetQuarter(defaultQuarter);
  }, [open, defaultQuarter]);

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
              await onCreate(targetQuarter, merged);
              setDraft({ status: 'Draft', procurement_contact: 'Donia Shadeed', requester_email: requester });
            } finally { setSaving(false); }
          }} disabled={saving || !canCreate}>
            {saving ? 'Creating…' : `Create in ${QUARTER_LABELS[targetQuarter]}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Quarter (which tab to write to)" required>
          <select
            className={inputClass}
            value={targetQuarter}
            onChange={e => setTargetQuarter(e.target.value as Quarter)}
          >
            {(Object.keys(QUARTER_LABELS) as Quarter[]).map(q => (
              <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
            ))}
          </select>
        </Field>
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

function BudgetSummary({ planned, paid, cap }: { planned: number; paid: number; cap: number }) {
  const planPct = cap > 0 ? Math.min(150, Math.round((planned / cap) * 100)) : 0;
  const paidPct = cap > 0 ? Math.min(100, Math.round((paid / cap) * 100)) : 0;
  const overBudget = planned > cap;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          <b className="text-navy-500 dark:text-white">{fmtUsd0(paid)}</b> paid · <b className="text-navy-500 dark:text-white">{fmtUsd0(planned)}</b> planned
        </span>
        <span className="text-xs text-slate-500">
          of <span className="font-mono">{fmtUsd0(cap)}</span> cap · <span className="font-mono">{paidPct}%</span> burned
        </span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
        <div className="relative h-full">
          <div className={`absolute left-0 top-0 h-full ${overBudget ? 'bg-brand-red' : 'bg-brand-teal'} opacity-50`} style={{ width: `${Math.min(100, planPct)}%` }} />
          <div className={`absolute left-0 top-0 h-full ${overBudget ? 'bg-brand-red' : 'bg-brand-teal'}`} style={{ width: `${paidPct}%` }} />
        </div>
      </div>
      {overBudget && (
        <p className="mt-1 text-2xs font-semibold text-brand-red">
          Planned spend exceeds the 2026 cap by {fmtUsd0(planned - cap)}.
        </p>
      )}
    </div>
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
