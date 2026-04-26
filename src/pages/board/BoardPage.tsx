import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  ClipboardList,
  ExternalLink,
  FileText,
  Filter,
  Plane,
  Search,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { Badge, Card, EmptyState, Kanban, Tabs, statusTone } from '../../lib/ui';
import type { KanbanColumn, TabItem, Tone } from '../../lib/ui';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { displayName, getProfileManagers, getTier } from '../../config/team';

type Row = Record<string, string>;

type Master = Row & {
  company_id?: string;
  company_name?: string;
  status?: string;
  sector?: string;
};

type Assignment = Row & {
  assignment_id?: string;
  company_id?: string;
  intervention_type?: string;
  sub_intervention?: string;
  owner_email?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  budget_usd?: string;
  fund_code?: string;
};

type PR = Row & {
  pr_id?: string;
  company_id?: string;
  activity?: string;
  requester_email?: string;
  status?: string;
  threshold_class?: string;
  total_cost_usd?: string;
  target_award_date?: string;
  pr_deadline?: string;
  fund_code?: string;
};

type Payment = Row & {
  payment_id?: string;
  company_id?: string;
  payee_name?: string;
  payee_type?: string;
  amount_usd?: string;
  status?: string;
  fund_code?: string;
  payment_date?: string;
  intervention_type?: string;
};

type Agreement = Row & {
  agreement_id?: string;
  company_id?: string;
  agreement_type?: string;
  status?: string;
  signed_date?: string;
  signatory_name?: string;
};

type ConfTracker = Row & {
  conference_id?: string;
  company_id?: string;
  decision?: string;
  travel_dates?: string;
  signatory_name?: string;
  fund_code?: string;
};

type Lens = 'companies' | 'interventions' | 'prs' | 'payments' | 'agreements' | 'conferences';
type Scope = 'mine' | 'all';

const COMPANY_COLS: KanbanColumn<string>[] = [
  { id: 'Interviewed', label: 'Interviewed', tone: 'teal' },
  { id: 'Reviewing', label: 'Reviewing', tone: 'amber' },
  { id: 'Recommended', label: 'Recommended', tone: 'orange' },
  { id: 'Selected', label: 'Selected', tone: 'orange' },
  { id: 'Onboarded', label: 'Onboarded', tone: 'green' },
  { id: 'Active', label: 'Active', tone: 'green' },
];

const ASSIGNMENT_COLS: KanbanColumn<string>[] = [
  { id: 'Planned', label: 'Planned', tone: 'amber' },
  { id: 'In Progress', label: 'In Progress', tone: 'teal' },
  { id: 'Completed', label: 'Completed', tone: 'green' },
  { id: 'Cancelled', label: 'Cancelled', tone: 'red' },
];

const PR_COLS: KanbanColumn<string>[] = [
  { id: 'Draft', label: 'Draft', tone: 'amber' },
  { id: 'Submitted', label: 'Submitted', tone: 'teal' },
  { id: 'Under Review', label: 'Under Review', tone: 'teal' },
  { id: 'Awarded', label: 'Awarded', tone: 'green' },
  { id: 'Delivered', label: 'Delivered', tone: 'green' },
  { id: 'Cancelled', label: 'Cancelled', tone: 'red' },
];

const PAYMENT_COLS: KanbanColumn<string>[] = [
  { id: 'Pending Approval', label: 'Pending Approval', tone: 'amber' },
  { id: 'Approved', label: 'Approved', tone: 'teal' },
  { id: 'Sent to Finance', label: 'Sent to Finance', tone: 'orange' },
  { id: 'Paid', label: 'Paid', tone: 'green' },
  { id: 'Rejected', label: 'Rejected', tone: 'red' },
];

const AGREEMENT_COLS: KanbanColumn<string>[] = [
  { id: 'Drafted', label: 'Drafted', tone: 'amber' },
  { id: 'Sent', label: 'Sent', tone: 'teal' },
  { id: 'Signed', label: 'Signed', tone: 'teal' },
  { id: 'Countersigned', label: 'Countersigned', tone: 'orange' },
  { id: 'Executed', label: 'Executed', tone: 'green' },
];

const CONF_COLS: KanbanColumn<string>[] = [
  { id: 'Nominated', label: 'Nominated', tone: 'amber' },
  { id: 'Committed', label: 'Committed', tone: 'teal' },
  { id: 'Attended', label: 'Attended', tone: 'green' },
  { id: 'Withdrawn', label: 'Withdrawn', tone: 'red' },
];

export function BoardPage() {
  const { user } = useAuth();
  const email = user?.email?.toLowerCase() || '';
  const tier = email ? getTier(email) : 'member';
  const userFirst = user?.name?.split(' ')[0] || 'Team';

  const [lens, setLens] = useState<Lens>('interventions');
  const [scope, setScope] = useState<Scope>(tier === 'profile_manager' ? 'mine' : 'all');
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>(''); // leadership scope only
  const [fundFilter, setFundFilter] = useState<string>('');

  const companies = useSheetDoc<Master>(
    getSheetId('companies') || null,
    getTab('companies', 'companies'),
    'company_id',
    { userEmail: user?.email }
  );
  const assignments = useSheetDoc<Assignment>(
    getSheetId('companies') || null,
    getTab('companies', 'assignments'),
    'assignment_id',
    { userEmail: user?.email }
  );
  const payments = useSheetDoc<Payment>(
    getSheetId('payments') || null,
    getTab('payments', 'payments'),
    'payment_id',
    { userEmail: user?.email }
  );
  const agreements = useSheetDoc<Agreement>(
    getSheetId('docs') || null,
    getTab('docs', 'agreements'),
    'agreement_id',
    { userEmail: user?.email }
  );
  const confs = useSheetDoc<ConfTracker>(
    getSheetId('conferences') || null,
    getTab('conferences', 'tracker'),
    'conference_id',
    { userEmail: user?.email }
  );

  const q1 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q1'), 'pr_id', { userEmail: user?.email });
  const q2 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q2'), 'pr_id', { userEmail: user?.email });
  const q3 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q3'), 'pr_id', { userEmail: user?.email });
  const q4 = useSheetDoc<PR>(getSheetId('procurement') || null, getTab('procurement', 'q4'), 'pr_id', { userEmail: user?.email });

  const companyById = useMemo(() => {
    const m: Record<string, Master> = {};
    for (const c of companies.rows) if (c.company_id) m[c.company_id] = c;
    return m;
  }, [companies.rows]);

  // Assignments owned by user → company IDs the user manages
  const myCompanyIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of assignments.rows) {
      if (a.owner_email?.toLowerCase() === email && a.company_id) s.add(a.company_id);
    }
    return s;
  }, [assignments.rows, email]);

  const matchSearch = (text: string) => {
    if (!search.trim()) return true;
    return text.toLowerCase().includes(search.trim().toLowerCase());
  };

  const matchScope = (owner?: string, company_id?: string) => {
    if (scope === 'all') {
      if (ownerFilter && owner?.toLowerCase() !== ownerFilter.toLowerCase()) return false;
      return true;
    }
    // mine — matches if user owns it directly OR owns a company this row links to
    if (owner && owner.toLowerCase() === email) return true;
    if (company_id && myCompanyIds.has(company_id)) return true;
    return false;
  };

  const matchFund = (fund?: string) => {
    if (!fundFilter) return true;
    return (fund || '').toLowerCase() === fundFilter.toLowerCase();
  };

  // --- Interventions lens ---
  const interventionItems = useMemo(() => {
    return assignments.rows
      .filter(a => matchScope(a.owner_email, a.company_id))
      .filter(a => matchFund(a.fund_code))
      .filter(a => {
        const cname = companyById[a.company_id || '']?.company_name || '';
        return matchSearch(`${a.intervention_type || ''} ${a.sub_intervention || ''} ${cname} ${a.owner_email || ''}`);
      })
      .map(a => ({
        id: a.assignment_id || '',
        status: a.status || 'Planned',
        raw: a,
      }))
      .filter(i => i.id);
  }, [assignments.rows, scope, email, myCompanyIds, ownerFilter, fundFilter, search, companyById]);

  // --- PR lens ---
  const allPRs = useMemo(
    () => [
      ...q1.rows.map(r => ({ r, q: 'q1' as const })),
      ...q2.rows.map(r => ({ r, q: 'q2' as const })),
      ...q3.rows.map(r => ({ r, q: 'q3' as const })),
      ...q4.rows.map(r => ({ r, q: 'q4' as const })),
    ],
    [q1.rows, q2.rows, q3.rows, q4.rows]
  );

  const prItems = useMemo(() => {
    return allPRs
      .filter(({ r }) => matchScope(r.requester_email, r.company_id))
      .filter(({ r }) => matchFund(r.fund_code))
      .filter(({ r }) => {
        const cname = companyById[r.company_id || '']?.company_name || '';
        return matchSearch(`${r.pr_id || ''} ${r.activity || ''} ${cname} ${r.requester_email || ''}`);
      })
      .map(({ r, q }) => ({
        id: r.pr_id || '',
        status: r.status || 'Draft',
        raw: r,
        q,
      }))
      .filter(i => i.id);
  }, [allPRs, scope, email, myCompanyIds, ownerFilter, fundFilter, search, companyById]);

  // --- Payment lens ---
  const paymentItems = useMemo(() => {
    return payments.rows
      .filter(p => matchScope(undefined, p.company_id))
      .filter(p => matchFund(p.fund_code))
      .filter(p => {
        const cname = companyById[p.company_id || '']?.company_name || '';
        return matchSearch(`${p.payee_name || ''} ${p.payee_type || ''} ${cname}`);
      })
      .map(p => ({
        id: p.payment_id || '',
        status: p.status || 'Pending Approval',
        raw: p,
      }))
      .filter(i => i.id);
  }, [payments.rows, scope, myCompanyIds, ownerFilter, fundFilter, search, companyById]);

  // --- Agreement lens ---
  const agreementItems = useMemo(() => {
    return agreements.rows
      .filter(a => matchScope(undefined, a.company_id))
      .filter(a => {
        const cname = companyById[a.company_id || '']?.company_name || '';
        return matchSearch(`${a.agreement_type || ''} ${a.signatory_name || ''} ${cname}`);
      })
      .map(a => ({
        id: a.agreement_id || '',
        status: a.status || 'Drafted',
        raw: a,
      }))
      .filter(i => i.id);
  }, [agreements.rows, scope, myCompanyIds, ownerFilter, search, companyById]);

  // --- Conferences lens ---
  const confItems = useMemo(() => {
    return confs.rows
      .filter(c => matchScope(undefined, c.company_id))
      .filter(c => matchFund(c.fund_code))
      .filter(c => {
        const cname = companyById[c.company_id || '']?.company_name || '';
        return matchSearch(`${c.conference_id || ''} ${cname} ${c.signatory_name || ''}`);
      })
      .map(c => ({
        id: `${c.conference_id}-${c.company_id}` || '',
        status: c.decision || 'Nominated',
        raw: c,
      }))
      .filter(i => i.id);
  }, [confs.rows, scope, myCompanyIds, ownerFilter, fundFilter, search, companyById]);

  // Quick stats for the hero strip
  const stats = useMemo(() => {
    const today = new Date();
    const overduePRs = prItems.filter(i => {
      const d = i.raw.pr_deadline ? new Date(i.raw.pr_deadline) : null;
      if (!d || isNaN(d.getTime())) return false;
      if (['Awarded', 'Delivered', 'Cancelled'].includes(i.raw.status || '')) return false;
      return d < today;
    }).length;
    const pendingApproval = paymentItems.filter(i => i.status === 'Pending Approval').length;
    const livePrograms = interventionItems.filter(i => i.status === 'In Progress').length;
    const agreementsPending = agreementItems.filter(
      i => !['Executed', 'Countersigned'].includes(i.status)
    ).length;
    return { overduePRs, pendingApproval, livePrograms, agreementsPending };
  }, [prItems, paymentItems, interventionItems, agreementItems]);

  // Status-change handlers — write back to the appropriate sheet doc
  const updateAssignment = (id: string, newStatus: string) =>
    assignments.updateRow(id, { status: newStatus });
  const updatePR = async (id: string, newStatus: string) => {
    // Find which quarter tab has it
    const hit = allPRs.find(({ r }) => r.pr_id === id);
    if (!hit) return;
    const doc = hit.q === 'q1' ? q1 : hit.q === 'q2' ? q2 : hit.q === 'q3' ? q3 : q4;
    await doc.updateRow(id, { status: newStatus });
  };
  const updatePayment = (id: string, newStatus: string) =>
    payments.updateRow(id, { status: newStatus });
  const updateAgreement = (id: string, newStatus: string) =>
    agreements.updateRow(id, { status: newStatus });
  const updateConf = (compoundId: string, newStatus: string) => {
    const hit = confs.rows.find(c => `${c.conference_id}-${c.company_id}` === compoundId);
    if (!hit?.conference_id) return Promise.resolve();
    return confs.updateRow(hit.conference_id, { decision: newStatus });
  };

  const funds = useMemo(() => {
    const s = new Set<string>();
    [...interventionItems, ...prItems, ...paymentItems, ...confItems].forEach(i => {
      const f = (i.raw as Row).fund_code;
      if (f) s.add(f);
    });
    return Array.from(s).sort();
  }, [interventionItems, prItems, paymentItems, confItems]);

  // --- Companies lens (post-interview cohort flowing through Reviewing → Selected → Active) ---
  const POST_INTERVIEW = new Set(['Interviewed', 'Reviewing', 'Recommended', 'Selected', 'Onboarded', 'Active']);
  const companyItems = useMemo(() => {
    return companies.rows
      .filter(c => POST_INTERVIEW.has(c.status || ''))
      .filter(c => matchScope(undefined, c.company_id))
      .filter(c => matchSearch(`${c.company_name || ''} ${c.sector || ''} ${c.company_id || ''}`))
      .map(c => ({
        id: c.company_id || '',
        status: c.status || 'Interviewed',
        raw: c,
      }))
      .filter(i => i.id);
  }, [companies.rows, scope, myCompanyIds, ownerFilter, search]);

  const updateCompanyStatus = (id: string, newStatus: string) =>
    companies.updateRow(id, { status: newStatus });

  const tabs: TabItem[] = [
    { value: 'companies', label: `Companies (${companyItems.length})` },
    { value: 'interventions', label: `Interventions (${interventionItems.length})` },
    { value: 'prs', label: `PRs (${prItems.length})` },
    { value: 'payments', label: `Payments (${paymentItems.length})` },
    { value: 'agreements', label: `Agreements (${agreementItems.length})` },
    { value: 'conferences', label: `Conferences (${confItems.length})` },
  ];

  return (
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">
              Workboard
            </h1>
            <Badge tone={scope === 'mine' ? 'teal' : 'neutral'}>
              {scope === 'mine' ? `${userFirst}'s work` : 'All work'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Drag cards between columns to update status in the source sheet. Every lane is a lens on the same data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tier !== 'profile_manager' && (
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-navy-700 dark:bg-navy-600">
              <button
                onClick={() => setScope('mine')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  scope === 'mine'
                    ? 'bg-brand-red text-white'
                    : 'text-slate-500 hover:text-navy-500 dark:text-slate-300'
                }`}
              >
                My work
              </button>
              <button
                onClick={() => setScope('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  scope === 'all'
                    ? 'bg-brand-red text-white'
                    : 'text-slate-500 hover:text-navy-500 dark:text-slate-300'
                }`}
              >
                Everyone
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <HeroStat
          label="Companies in flight"
          value={companyItems.length}
          icon={Briefcase}
          tone={companyItems.length > 0 ? 'teal' : 'neutral'}
          onClick={() => setLens('companies')}
        />
        <HeroStat
          label="Overdue PRs"
          value={stats.overduePRs}
          icon={AlertTriangle}
          tone={stats.overduePRs > 0 ? 'red' : 'neutral'}
          to="#prs"
          onClick={() => setLens('prs')}
        />
        <HeroStat
          label="Payments awaiting approval"
          value={stats.pendingApproval}
          icon={Wallet}
          tone={stats.pendingApproval > 0 ? 'orange' : 'neutral'}
          onClick={() => setLens('payments')}
        />
        <HeroStat
          label="Live interventions"
          value={stats.livePrograms}
          icon={Briefcase}
          tone="teal"
          onClick={() => setLens('interventions')}
        />
        <HeroStat
          label="Open agreements"
          value={stats.agreementsPending}
          icon={FileText}
          tone={stats.agreementsPending > 0 ? 'amber' : 'neutral'}
          onClick={() => setLens('agreements')}
        />
      </section>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-navy-700">
          <Tabs
            items={tabs}
            value={lens}
            onChange={v => setLens(v as Lens)}
          />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search cards"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-500 placeholder:text-slate-400 focus:border-brand-teal focus:outline-none dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-slate-500"
              />
            </div>

            {funds.length > 0 && (
              <div className="relative">
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={fundFilter}
                  onChange={e => setFundFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-6 text-sm text-navy-500 focus:border-brand-teal focus:outline-none dark:border-navy-600 dark:bg-navy-700 dark:text-white"
                >
                  <option value="">All funds</option>
                  {funds.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            )}

            {scope === 'all' && (
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  value={ownerFilter}
                  onChange={e => setOwnerFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-6 text-sm text-navy-500 focus:border-brand-teal focus:outline-none dark:border-navy-600 dark:bg-navy-700 dark:text-white"
                >
                  <option value="">All PMs</option>
                  {getProfileManagers().map(pm => (
                    <option key={pm.email} value={pm.email}>{pm.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="p-4">
          {lens === 'companies' && (
            <CompanyBoard
              items={companyItems}
              onStatusChange={updateCompanyStatus}
            />
          )}
          {lens === 'interventions' && (
            <InterventionBoard
              items={interventionItems}
              onStatusChange={updateAssignment}
              companyById={companyById}
            />
          )}
          {lens === 'prs' && (
            <PRBoard
              items={prItems}
              onStatusChange={updatePR}
              companyById={companyById}
            />
          )}
          {lens === 'payments' && (
            <PaymentBoard
              items={paymentItems}
              onStatusChange={updatePayment}
              companyById={companyById}
            />
          )}
          {lens === 'agreements' && (
            <AgreementBoard
              items={agreementItems}
              onStatusChange={updateAgreement}
              companyById={companyById}
            />
          )}
          {lens === 'conferences' && (
            <ConferenceBoard
              items={confItems}
              onStatusChange={updateConf}
              companyById={companyById}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

// --- Boards ---

type CompanyLookup = Record<string, Master>;

function CompanyBoard({
  items,
  onStatusChange,
}: {
  items: { id: string; status: string; raw: Master }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<Briefcase className="h-6 w-6" />} title="No companies in view" description="The post-interview cohort will show up here as they move through Reviewing → Selected → Active." />;
  }
  return (
    <Kanban
      columns={COMPANY_COLS}
      items={items}
      onStatusChange={onStatusChange}
      renderCard={it => {
        const c = it.raw;
        return (
          <Link
            to={c.company_id ? `/companies/${c.company_id}` : '/companies'}
            className="block"
          >
            <div className="truncate text-xs font-bold text-navy-500 dark:text-white">
              {c.company_name || c.company_id}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {c.sector || '—'}
            </div>
            {c.fund_code && (
              <div className="mt-1.5">
                <Badge tone={c.fund_code === '97060' ? 'teal' : 'amber'}>
                  {c.fund_code === '97060' ? 'Dutch' : 'SIDA'}
                </Badge>
              </div>
            )}
          </Link>
        );
      }}
    />
  );
}

function InterventionBoard({
  items,
  onStatusChange,
  companyById,
}: {
  items: { id: string; status: string; raw: Assignment }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
  companyById: CompanyLookup;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<Briefcase className="h-6 w-6" />} title="No interventions in view" description="Adjust scope or filters, or create an intervention from a company page." />;
  }
  return (
    <Kanban
      columns={ASSIGNMENT_COLS}
      items={items}
      onStatusChange={onStatusChange}
      columnAggregate={(xs) => {
        const t = (xs as typeof items).reduce((s, x) => s + toNum(x.raw.budget_usd), 0);
        return t ? `$${fmtAmount(t)} budgeted` : '';
      }}
      renderCard={it => {
        const a = it.raw;
        const c = companyById[a.company_id || ''];
        return (
          <Link
            to={a.company_id ? `/companies/${a.company_id}` : '/companies'}
            className="block"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-bold text-navy-500 dark:text-white">
                {a.intervention_type || 'Assignment'}
              </div>
              {a.budget_usd && <Badge tone="orange">${fmtAmount(a.budget_usd)}</Badge>}
            </div>
            {a.sub_intervention && (
              <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                {a.sub_intervention}
              </div>
            )}
            <div className="mt-2 truncate text-[11px] font-semibold text-brand-teal">
              {c?.company_name || a.company_id || 'Unlinked'}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              {a.owner_email && <span className="truncate">{displayName(a.owner_email)}</span>}
              {a.fund_code && <span className="truncate">· {a.fund_code}</span>}
            </div>
            {(a.start_date || a.end_date) && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <Calendar className="h-3 w-3" />
                {a.start_date || '—'} → {a.end_date || '—'}
              </div>
            )}
          </Link>
        );
      }}
    />
  );
}

function PRBoard({
  items,
  onStatusChange,
  companyById,
}: {
  items: { id: string; status: string; raw: PR; q: 'q1' | 'q2' | 'q3' | 'q4' }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
  companyById: CompanyLookup;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No PRs in view" description="Adjust scope or create a new PR from a company page." />;
  }
  const today = new Date();
  return (
    <Kanban
      columns={PR_COLS}
      items={items}
      onStatusChange={onStatusChange}
      columnAggregate={(xs) => {
        const t = (xs as typeof items).reduce((s, x) => s + toNum(x.raw.total_cost_usd), 0);
        return t ? `$${fmtAmount(t)}` : '';
      }}
      renderCard={it => {
        const p = it.raw;
        const c = companyById[p.company_id || ''];
        const deadline = p.pr_deadline ? new Date(p.pr_deadline) : null;
        const overdue = deadline && !isNaN(deadline.getTime()) && deadline < today && !['Awarded', 'Delivered', 'Cancelled'].includes(p.status || '');
        const due = deadline && !isNaN(deadline.getTime()) && !overdue;
        return (
          <Link to="/procurement" className="block">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-bold text-navy-500 dark:text-white">{p.pr_id || '—'}</div>
              {p.threshold_class && <Badge tone="teal">{p.threshold_class}</Badge>}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {p.activity || '—'}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-semibold text-brand-teal">
                {c?.company_name || p.company_id || 'Unlinked'}
              </span>
              {p.total_cost_usd && <span className="font-bold text-navy-500 dark:text-white">${fmtAmount(p.total_cost_usd)}</span>}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px]">
              {overdue ? (
                <Badge tone="red">Overdue · {p.pr_deadline}</Badge>
              ) : due ? (
                <Badge tone="amber">Due {p.pr_deadline}</Badge>
              ) : (
                <span className="text-slate-400">{it.q.toUpperCase()}</span>
              )}
              {p.requester_email && (
                <span className="ml-auto truncate text-slate-400">{displayName(p.requester_email)}</span>
              )}
            </div>
          </Link>
        );
      }}
    />
  );
}

function PaymentBoard({
  items,
  onStatusChange,
  companyById,
}: {
  items: { id: string; status: string; raw: Payment }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
  companyById: CompanyLookup;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<Wallet className="h-6 w-6" />} title="No payments in view" description="Log payments from a PR or a company detail page." />;
  }
  return (
    <Kanban
      columns={PAYMENT_COLS}
      items={items}
      onStatusChange={onStatusChange}
      columnAggregate={(xs) => {
        const t = (xs as typeof items).reduce((s, x) => s + toNum(x.raw.amount_usd), 0);
        return t ? `$${fmtAmount(t)}` : '';
      }}
      renderCard={it => {
        const p = it.raw;
        const c = companyById[p.company_id || ''];
        return (
          <Link to="/payments" className="block">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-bold text-navy-500 dark:text-white">
                {p.payee_name || 'Payment'}
              </div>
              {p.amount_usd && <Badge tone="orange">${fmtAmount(p.amount_usd)}</Badge>}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              {p.payee_type && <Badge tone="neutral">{p.payee_type}</Badge>}
              {p.fund_code && <span>· {p.fund_code}</span>}
            </div>
            <div className="mt-2 truncate text-[11px] font-semibold text-brand-teal">
              {c?.company_name || p.company_id || 'Unlinked'}
            </div>
            {p.payment_date && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <Calendar className="h-3 w-3" />
                {p.payment_date}
              </div>
            )}
          </Link>
        );
      }}
    />
  );
}

function AgreementBoard({
  items,
  onStatusChange,
  companyById,
}: {
  items: { id: string; status: string; raw: Agreement }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
  companyById: CompanyLookup;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<FileText className="h-6 w-6" />} title="No agreements in view" description="Create an MJPSA or commitment letter from a company page." />;
  }
  return (
    <Kanban
      columns={AGREEMENT_COLS}
      items={items}
      onStatusChange={onStatusChange}
      renderCard={it => {
        const a = it.raw;
        const c = companyById[a.company_id || ''];
        return (
          <Link to="/docs" className="block">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-bold text-navy-500 dark:text-white">
                {a.agreement_type || 'Agreement'}
              </div>
              <Badge tone={statusTone(a.status || '')}>{a.status || '—'}</Badge>
            </div>
            <div className="mt-2 truncate text-[11px] font-semibold text-brand-teal">
              {c?.company_name || a.company_id || 'Unlinked'}
            </div>
            {a.signatory_name && (
              <div className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
                Signed by {a.signatory_name}
              </div>
            )}
            {a.signed_date && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <Calendar className="h-3 w-3" />
                {a.signed_date}
              </div>
            )}
          </Link>
        );
      }}
    />
  );
}

function ConferenceBoard({
  items,
  onStatusChange,
  companyById,
}: {
  items: { id: string; status: string; raw: ConfTracker }[];
  onStatusChange: (id: string, newStatus: string) => Promise<void> | void;
  companyById: CompanyLookup;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<Plane className="h-6 w-6" />} title="No conference decisions" description="Nominate companies from the Conferences page." />;
  }
  return (
    <Kanban
      columns={CONF_COLS}
      items={items}
      onStatusChange={onStatusChange}
      renderCard={it => {
        const c = it.raw;
        const co = companyById[c.company_id || ''];
        return (
          <Link to="/conferences" className="block">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-bold text-navy-500 dark:text-white">
                {c.conference_id || 'Conference'}
              </div>
              <ExternalLink className="h-3 w-3 text-slate-400" />
            </div>
            <div className="mt-2 truncate text-[11px] font-semibold text-brand-teal">
              {co?.company_name || c.company_id || 'Unlinked'}
            </div>
            {c.signatory_name && (
              <div className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
                Rep: {c.signatory_name}
              </div>
            )}
            {c.travel_dates && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <Calendar className="h-3 w-3" />
                {c.travel_dates}
              </div>
            )}
            {c.fund_code && <div className="mt-1 text-[10px] text-slate-400">{c.fund_code}</div>}
          </Link>
        );
      }}
    />
  );
}

// --- Helpers ---

function HeroStat({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  to?: string;
  onClick?: () => void;
}) {
  const bg = toneBg(tone);
  return (
    <button
      onClick={onClick}
      className="group w-full text-left"
    >
      <Card className="h-full transition-shadow hover:shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {label}
            </div>
            <div className={`mt-1 text-3xl font-extrabold ${toneText(tone)}`}>{value}</div>
          </div>
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </Card>
    </button>
  );
}

function toneBg(tone: Tone) {
  switch (tone) {
    case 'red': return 'bg-brand-red/10 text-brand-red';
    case 'teal': return 'bg-brand-teal/10 text-brand-teal';
    case 'orange': return 'bg-brand-orange/10 text-brand-orange';
    case 'amber': return 'bg-amber-100 text-amber-700';
    case 'green': return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-slate-100 text-slate-600 dark:bg-navy-700 dark:text-slate-300';
  }
}

function toneText(tone: Tone) {
  switch (tone) {
    case 'teal': return 'text-brand-teal';
    case 'orange': return 'text-brand-orange';
    case 'amber': return 'text-amber-600';
    case 'green': return 'text-emerald-600';
    case 'red': return 'text-brand-red';
    default: return 'text-navy-500 dark:text-white';
  }
}

function toNum(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function fmtAmount(v: string | number | undefined): string {
  const n = typeof v === 'number' ? v : toNum(v as string);
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
