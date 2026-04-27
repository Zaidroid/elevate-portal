import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Wallet,
  Plane,
  FileText,
  LayoutDashboard,
  Sparkles,
  Briefcase,
  GraduationCap,
  ExternalLink,
  Save,
  Pencil,
  X,
  Calendar,
  Activity,
  MessageCircle,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { getProfileManagers, displayName } from '../../config/team';
import { derivePRFields } from '../../lib/procurement/compute';
import { INTERVENTION_TYPES, CORE_PILLARS, pillarFor } from '../../config/interventions';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardHeader,
  Drawer,
  EmptyState,
  SkeletonCard,
  Skeleton,
  Tabs,
  statusTone,
  useToast,
} from '../../lib/ui';
import type { TabItem } from '../../lib/ui';
import type { ActivityRow, CompanyComment, PreDecisionRecommendation, Review } from './reviewTypes';
import { summarizeReviews } from './reviewTypes';
import { ActivityTimeline as AuditLogTimeline } from './ActivityTimeline';

type Company = Record<string, string>;
type Contact = Record<string, string>;
type Assignment = Record<string, string>;
type PR = Record<string, string>;
type Payment = Record<string, string>;
type ConferenceRow = Record<string, string>;
type Doc = Record<string, string>;
type SelectionRow = Record<string, string>;

const STATUSES = ['Applicant', 'Shortlisted', 'Interviewed', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn'];
const STAGES = ['Applied', '1st Filtration', 'Doc Review', 'Needs Assessed', 'Scored', 'Interviewed', 'Final Assessment', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Rejected', 'Withdrew'];
const FUND_CODES = ['97060', '91763'];
const REVENUE_BRACKETS = ['< $50K', '$50K – $250K', '$250K – $1M', '$1M – $5M', '> $5M'];
const ASSIGNMENT_STATUSES = ['Planned', 'In Progress', 'Completed', 'Cancelled'];
const PR_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Awarded', 'Delivered', 'Cancelled'];
const PAYMENT_STATUSES = ['Pending Approval', 'Approved', 'Sent to Finance', 'Paid', 'Rejected'];
const PAYEE_TYPES = ['Vendor', 'Advisor', 'Participant', 'Conference'];
const AGREEMENT_TYPES = ['MJPSA', 'Addendum', 'NDA', 'Commitment Letter'];
const AGREEMENT_STATUSES = ['Drafted', 'Sent', 'Signed', 'Countersigned', 'Executed'];

const qaInputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

// Same palette used on the Companies page kanban + roster, so the
// pillar dot strip in the hero matches what the team sees elsewhere.
const PILLAR_DOT_COLOR: Record<string, string> = {
  TTH: 'bg-brand-teal',
  Upskilling: 'bg-brand-orange',
  MKG: 'bg-brand-red',
  MA: 'bg-brand-navy',
  ElevateBridge: 'bg-amber-500',
  'C-Suite': 'bg-brand-teal',
  Conferences: 'bg-brand-orange',
};

const norm = (s?: string) => (s || '').trim().toLowerCase();
const dateOnly = (s?: string) => (s ? s.split('T')[0].split(' ')[0] : '');
const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function CompanyDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const companiesSheet = getSheetId('companies');
  const procurementSheet = getSheetId('procurement');
  const paymentsSheet = getSheetId('payments');
  const conferencesSheet = getSheetId('conferences');
  const docsSheet = getSheetId('docs');
  const selectionSheet = getSheetId('selection');

  const companies = useSheetDoc<Company>(companiesSheet || null, getTab('companies', 'companies'), 'company_id', { userEmail: user?.email });
  const contacts = useSheetDoc<Contact>(companiesSheet || null, getTab('companies', 'contacts'), 'contact_id', { userEmail: user?.email });
  const assignments = useSheetDoc<Assignment>(companiesSheet || null, getTab('companies', 'assignments'), 'assignment_id', { userEmail: user?.email });
  const reviewsDoc = useSheetDoc<Review>(companiesSheet || null, getTab('companies', 'reviews'), 'review_id', { userEmail: user?.email });
  const activityDoc = useSheetDoc<ActivityRow>(companiesSheet || null, getTab('companies', 'activity'), 'activity_id', { userEmail: user?.email });
  const commentsDoc = useSheetDoc<CompanyComment>(companiesSheet || null, getTab('companies', 'comments'), 'comment_id', { userEmail: user?.email });
  const preDecisionsDoc = useSheetDoc<PreDecisionRecommendation>(companiesSheet || null, getTab('companies', 'preDecisions'), 'recommendation_id', { userEmail: user?.email });

  // Source Data from Selection workbook is the authoritative applicant list.
  const sourceData = useSheetDoc<Record<string, string>>(
    selectionSheet || null,
    getTab('selection', 'sourceData'),
    'id',
    { userEmail: user?.email }
  );

  const q1 = useSheetDoc<PR>(procurementSheet || null, getTab('procurement', 'q1'), 'pr_id', { userEmail: user?.email });
  const q2 = useSheetDoc<PR>(procurementSheet || null, getTab('procurement', 'q2'), 'pr_id', { userEmail: user?.email });
  const q3 = useSheetDoc<PR>(procurementSheet || null, getTab('procurement', 'q3'), 'pr_id', { userEmail: user?.email });
  const q4 = useSheetDoc<PR>(procurementSheet || null, getTab('procurement', 'q4'), 'pr_id', { userEmail: user?.email });

  const payments = useSheetDoc<Payment>(paymentsSheet || null, getTab('payments', 'payments'), 'payment_id', { userEmail: user?.email });
  const confs = useSheetDoc<ConferenceRow>(conferencesSheet || null, getTab('conferences', 'tracker'), 'tracker_id', { userEmail: user?.email });
  const docs = useSheetDoc<Doc>(docsSheet || null, getTab('docs', 'agreements'), 'agreement_id', { userEmail: user?.email });

  const needs = useSheetDoc<SelectionRow>(selectionSheet || null, getTab('selection', 'companyNeeds'), 'Company ID', { userEmail: user?.email });
  const score = useSheetDoc<SelectionRow>(selectionSheet || null, getTab('selection', 'scoringMatrix'), 'Company ID', { userEmail: user?.email });
  const interviews = useSheetDoc<SelectionRow>(selectionSheet || null, getTab('selection', 'interviewAssessments'), 'id', { userEmail: user?.email });
  const discussion = useSheetDoc<SelectionRow>(selectionSheet || null, getTab('selection', 'interviewDiscussion'), 'id', { userEmail: user?.email });
  const ebAssess = useSheetDoc<SelectionRow>(selectionSheet || null, getTab('selection', 'ebAssessments'), 'companyId', { userEmail: user?.email });

  // Find applicant from Source Data by numeric id (the route param for applicants).
  const applicant = useMemo(
    () => sourceData.rows.find(r => r.id === id),
    [sourceData.rows, id]
  );
  const applicantName = applicant?.name || applicant?.companyName || '';

  // Find Master row by numeric company_id match OR by normalized name match against applicant.
  const masterRow = useMemo(() => {
    const byId = companies.rows.find(r => r.company_id === id);
    if (byId) return byId;
    if (!applicantName) return undefined;
    const key = norm(applicantName);
    return companies.rows.find(r => norm(r.company_name) === key);
  }, [companies.rows, id, applicantName]);

  // Merge: applicant is the identity backbone, Master overlays operational fields.
  const company = useMemo<Company | undefined>(() => {
    if (!applicant && !masterRow) return undefined;
    if (!applicant) return masterRow;
    // Applicant exists — build a view that uses applicant data as base, then overlays Master.
    const base: Company = {
      company_id: masterRow?.company_id || `A-${(applicant.id || '').padStart(4, '0')}`,
      company_name: applicantName,
      legal_name: masterRow?.legal_name || applicantName,
      city: applicant.city || masterRow?.city || '',
      governorate: masterRow?.governorate || '',
      sector: masterRow?.sector || applicant.businessType || '',
      employee_count: applicant.totalEmployees || masterRow?.employee_count || '',
      revenue_bracket: masterRow?.revenue_bracket || '',
      international_revenue_pct: applicant.revenueInternational || masterRow?.international_revenue_pct || '',
      readiness_score: applicant.readinessScore || masterRow?.readiness_score || '',
      fund_code: masterRow?.fund_code || '',
      cohort: masterRow?.cohort || 'E3',
      status: masterRow?.status || 'Applicant',
      stage: masterRow?.stage || 'Applied',
      profile_manager_email: masterRow?.profile_manager_email || '',
      selection_date: masterRow?.selection_date || '',
      onboarding_date: masterRow?.onboarding_date || '',
      drive_folder_url: masterRow?.drive_folder_url || '',
      notes: masterRow?.notes || '',
      updated_at: masterRow?.updated_at || '',
      updated_by: masterRow?.updated_by || '',
    };
    return base;
  }, [applicant, applicantName, masterRow]);

  const name = company?.company_name || '';
  const nameKey = norm(name);
  // Key used to write updates back to Master: prefer existing Master company_id; otherwise
  // the applicant has no Master row yet, and save will create one.
  const masterKey = masterRow?.company_id || '';

  const matches = (row: Record<string, string>) => {
    const rName = row.company_name || row['Company Name'] || row.companyName;
    return rName && norm(rName) === nameKey;
  };

  const companyContacts = useMemo(
    () => contacts.rows.filter(c => masterKey && c.company_id === masterKey),
    [contacts.rows, masterKey]
  );
  const companyAssignments = useMemo(
    () => assignments.rows.filter(a => masterKey && a.company_id === masterKey),
    [assignments.rows, masterKey]
  );
  const companyReviews = useMemo(
    () => reviewsDoc.rows.filter(r => masterKey && r.company_id === masterKey),
    [reviewsDoc.rows, masterKey]
  );
  const companyComments = useMemo(
    () => commentsDoc.rows.filter(c => masterKey && c.company_id === masterKey),
    [commentsDoc.rows, masterKey]
  );
  const companyPreDecisions = useMemo(
    () => preDecisionsDoc.rows.filter(r => masterKey && r.company_id === masterKey),
    [preDecisionsDoc.rows, masterKey]
  );
  const reviewSummary = useMemo(() => summarizeReviews(companyReviews), [companyReviews]);
  const interventionPillars = useMemo(() => {
    const set = new Set<string>();
    for (const a of companyAssignments) {
      const p = pillarFor(a.intervention_type || '')?.code;
      if (p) set.add(p);
    }
    return Array.from(set);
  }, [companyAssignments]);
  const companyPRs = useMemo(() => {
    const all = [...q1.rows, ...q2.rows, ...q3.rows, ...q4.rows];
    return all.filter(p => masterKey && p.company_id === masterKey);
  }, [q1.rows, q2.rows, q3.rows, q4.rows, masterKey]);
  const companyPayments = useMemo(
    () => payments.rows.filter(p => masterKey && p.company_id === masterKey),
    [payments.rows, masterKey]
  );
  const companyConfs = useMemo(
    () => confs.rows.filter(c => (masterKey && c.company_id === masterKey) || norm(c.company_name) === nameKey),
    [confs.rows, masterKey, nameKey]
  );
  const companyDocs = useMemo(
    () => docs.rows.filter(d => masterKey && d.company_id === masterKey),
    [docs.rows, masterKey]
  );

  const myNeeds = useMemo(() => needs.rows.find(matches), [needs.rows, nameKey]);
  const myScore = useMemo(() => score.rows.find(matches), [score.rows, nameKey]);
  const myInterview = useMemo(() => interviews.rows.find(matches), [interviews.rows, nameKey]);
  const myDiscussion = useMemo(() => discussion.rows.filter(matches), [discussion.rows, nameKey]);
  const myEB = useMemo(() => ebAssess.rows.find(matches), [ebAssess.rows, nameKey]);

  const totalPaid = useMemo(
    () => companyPayments.reduce((s, r) => s + (parseFloat(r.amount_usd || '0') || 0), 0),
    [companyPayments]
  );
  const totalBudget = useMemo(
    () => companyAssignments.reduce((s, r) => s + (parseFloat(r.budget_usd || '0') || 0), 0),
    [companyAssignments]
  );

  const activityCount =
    companyAssignments.length + companyPRs.length + companyPayments.length + companyConfs.length + companyDocs.length;

  const hasSelection = !!(applicant || myNeeds || myScore || myInterview || myEB || myDiscussion.length);

  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickAction, setQuickAction] = useState<null | 'intervention' | 'pr' | 'payment' | 'agreement'>(null);
  const [quickPrefill, setQuickPrefill] = useState<Record<string, string>>({});

  useEffect(() => {
    if (company) setDraft(company);
  }, [company]);

  if (!companiesSheet) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader title="Companies sheet not configured" />
          <p className="text-sm text-slate-500">Set VITE_SHEET_COMPANIES in your environment.</p>
        </Card>
      </div>
    );
  }

  if ((companies.loading || sourceData.loading) && !company) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumbs items={[{ label: 'Companies', to: '/companies' }, { label: id }]} />
        <EmptyState
          title={`No company with id "${id}"`}
          description="The company may have been removed or its ID changed."
          action={<Button onClick={() => navigate('/companies')}>Back to companies</Button>}
        />
      </div>
    );
  }

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (masterKey) {
        // Master row exists — update it by its company_id.
        await companies.updateRow(masterKey, draft);
        toast.success('Saved', `${company.company_name} updated.`);
      } else {
        // Applicant has no Master row yet — create one (the sheet auto-assigns company_id).
        const newRow = { ...draft };
        delete newRow.company_id;
        await companies.createRow(newRow);
        toast.success('Created', `${company.company_name} added to Master.`);
      }
      setEditing(false);
    } catch (e) {
      toast.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tabs: TabItem[] = [
    { value: 'overview', label: 'Overview', icon: <Building2 className="h-4 w-4" /> },
    { value: 'program', label: 'Program', icon: <Activity className="h-4 w-4" />, count: companyAssignments.length },
    { value: 'comments', label: 'Comments', icon: <MessageCircle className="h-4 w-4" />, count: companyComments.length + companyPreDecisions.length },
    { value: 'selection', label: 'Selection', icon: <Sparkles className="h-4 w-4" />, count: hasSelection ? 1 : 0 },
    { value: 'activity', label: 'Activity', icon: <LayoutDashboard className="h-4 w-4" />, count: activityCount },
  ];

  const currentPMEmail = company.profile_manager_email || '';
  const currentPMName = currentPMEmail ? displayName(currentPMEmail) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Breadcrumbs items={[{ label: 'Companies', to: '/companies' }, { label: company.company_name || id }]} />

      <Card className="border-l-4 border-l-brand-teal">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
              <Building2 className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <Link to="/companies" className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-brand-red">
                <ArrowLeft className="h-3 w-3" /> All companies
              </Link>
              <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">
                {company.company_name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                {company.sector && <span>{company.sector}</span>}
                {(company.city || company.governorate) && (
                  <span>{[company.city, company.governorate].filter(Boolean).join(', ')}</span>
                )}
                {company.cohort && <span>Cohort {company.cohort}</span>}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {company.status && <Badge tone={statusTone(company.status)}>{company.status}</Badge>}
                {company.stage && <Badge tone="neutral">{company.stage}</Badge>}
                {company.fund_code && (
                  <Badge tone={company.fund_code === '97060' ? 'teal' : 'amber'}>
                    {company.fund_code === '97060' ? 'Dutch (97060)' : 'SIDA (91763)'}
                  </Badge>
                )}
                {interventionPillars.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200">
                    {interventionPillars.map(p => (
                      <span key={p} className={`inline-block h-2 w-2 rounded-full ${PILLAR_DOT_COLOR[p] || 'bg-slate-400'}`} />
                    ))}
                    {companyAssignments.length}× intervention{companyAssignments.length === 1 ? '' : 's'}
                  </span>
                )}
                {reviewSummary.total > 0 && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                      reviewSummary.consensus === 'Recommend'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        : reviewSummary.consensus === 'Reject'
                        ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                        : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
                    }`}
                    title={`${reviewSummary.recommend} recommend · ${reviewSummary.hold} hold · ${reviewSummary.reject} reject`}
                  >
                    {reviewSummary.total}× {reviewSummary.consensus}
                    {reviewSummary.divergence && <span className="opacity-70">· divergent</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PMBadge email={currentPMEmail} name={currentPMName} />
            {company.drive_folder_url && (
              <a
                href={company.drive_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-navy-500 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
              >
                Drive folder <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </Card>

      <StatRow
        company={company}
        score={myScore}
        needs={myNeeds}
        assignmentsCount={companyAssignments.length}
        prsCount={companyPRs.length}
        paymentsTotal={totalPaid}
        budgetTotal={totalBudget}
        reviewSummary={reviewSummary}
      />

      <QuickActionsBar
        masterKey={masterKey}
        onOpen={(kind, prefill) => {
          setQuickPrefill(prefill || {});
          setQuickAction(kind);
        }}
      />

      <Tabs items={tabs} value={tab} onChange={setTab} />

      <div className="min-h-[280px]">
        {tab === 'overview' && draft && (
          <OverviewTab
            company={company}
            draft={draft}
            onDraftChange={setDraft}
            onSave={save}
            saving={saving}
            editing={editing}
            onEditToggle={() => {
              if (editing) setDraft(company);
              setEditing(v => !v);
            }}
            contacts={companyContacts}
            applicant={applicant}
            assignments={companyAssignments}
            prs={companyPRs}
            payments={companyPayments}
            confs={companyConfs}
            docs={companyDocs}
            needs={myNeeds}
          />
        )}
        {tab === 'selection' && (
          <div className="space-y-3">
            <Card className="border-l-4 border-l-brand-teal">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-navy-500 dark:text-slate-100">Selection workflow</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Reviews, votes, and final-decision locking now live in the dedicated Selection module so the whole team can use them simultaneously.
                  </p>
                </div>
                <Link
                  to="/selection"
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-teal px-3 py-2 text-xs font-bold text-white hover:bg-brand-teal/90"
                >
                  Open in Selection module <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>
            <SelectionTab
              applicant={applicant}
              needs={myNeeds}
              score={myScore}
              interview={myInterview}
              discussion={myDiscussion}
              eb={myEB}
              company={company}
            />
          </div>
        )}
        {tab === 'program' && (
          <ProgramTab
            assignments={companyAssignments}
            prs={companyPRs}
            payments={companyPayments}
            confs={companyConfs}
            docs={companyDocs}
            onQuickAction={(kind, prefill) => {
              setQuickPrefill(prefill || {});
              setQuickAction(kind);
            }}
            masterKey={masterKey}
          />
        )}
        {tab === 'comments' && (
          <CommentsTab
            comments={companyComments}
            preDecisions={companyPreDecisions}
            companyId={masterKey}
            onPost={async body => {
              if (!masterKey || !body.trim() || !user?.email) return;
              const now = new Date().toISOString();
              const id = `cmt-${masterKey}-${user.email.split('@')[0]}-${now}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
              await commentsDoc.createRow({
                comment_id: id,
                company_id: masterKey,
                author_email: user.email,
                body: body.trim(),
                created_at: now,
                updated_at: now,
              });
            }}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            assignments={companyAssignments}
            prs={companyPRs}
            payments={companyPayments}
            confs={companyConfs}
            docs={companyDocs}
            auditLog={activityDoc.rows}
            companyId={masterKey}
            onQuickAction={(kind, prefill) => {
              setQuickPrefill(prefill || {});
              setQuickAction(kind);
            }}
            masterKey={masterKey}
          />
        )}
      </div>

      <AssignInterventionDrawer
        open={quickAction === 'intervention'}
        onClose={() => setQuickAction(null)}
        companyId={masterKey}
        companyName={company.company_name || ''}
        onCreate={async row => {
          await assignments.createRow(row);
          toast.success('Intervention assigned', `${row.intervention_type} added to ${company.company_name}.`);
          setQuickAction(null);
        }}
      />

      <QuickPRDrawer
        open={quickAction === 'pr'}
        onClose={() => setQuickAction(null)}
        companyId={masterKey}
        companyName={company.company_name || ''}
        prefill={quickPrefill}
        requester={user?.email || ''}
        onCreate={async (quarter, row) => {
          const target = quarter === 'q1' ? q1 : quarter === 'q2' ? q2 : quarter === 'q3' ? q3 : q4;
          await target.createRow(row);
          toast.success('PR created', `${row.pr_id} filed in ${quarter.toUpperCase()}.`);
          setQuickAction(null);
        }}
      />

      <LogPaymentDrawer
        open={quickAction === 'payment'}
        onClose={() => setQuickAction(null)}
        companyId={masterKey}
        companyName={company.company_name || ''}
        prefill={quickPrefill}
        onCreate={async row => {
          await payments.createRow(row);
          toast.success('Payment logged', `$${row.amount_usd} for ${row.payee_name}.`);
          setQuickAction(null);
        }}
      />

      <NewAgreementDrawer
        open={quickAction === 'agreement'}
        onClose={() => setQuickAction(null)}
        companyId={masterKey}
        companyName={company.company_name || ''}
        onCreate={async row => {
          await docs.createRow(row);
          toast.success('Agreement created', `${row.agreement_type} for ${company.company_name}.`);
          setQuickAction(null);
        }}
      />
    </div>
  );
}

function PMBadge({ email, name }: { email?: string; name: string | null }) {
  if (!email) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-navy-700 dark:text-slate-400">
        No profile manager
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-navy-700 dark:bg-navy-600">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${heroTone(name || email)}`}>
        {heroInitials(name || email)}
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Profile Manager</div>
        <div className="text-sm font-semibold text-navy-500 dark:text-white">{name}</div>
      </div>
    </div>
  );
}

const HERO_TONES = [
  'bg-brand-teal/15 text-brand-teal',
  'bg-brand-red/15 text-brand-red',
  'bg-brand-orange/15 text-brand-orange',
  'bg-navy-500/15 text-navy-500 dark:text-slate-100',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
];

function heroTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HERO_TONES[h % HERO_TONES.length];
}

function heroInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// -------- Stat Row --------

function StatRow({
  company,
  score,
  needs,
  assignmentsCount,
  prsCount,
  paymentsTotal,
  budgetTotal,
  reviewSummary,
}: {
  company: Company;
  score?: Record<string, string>;
  needs?: Record<string, string>;
  assignmentsCount: number;
  prsCount: number;
  paymentsTotal: number;
  budgetTotal: number;
  reviewSummary?: { total: number; recommend: number; hold: number; reject: number; consensus: string | null; divergence: boolean };
}) {
  const readiness =
    needs?.['Readiness Score'] ||
    company.readiness_score ||
    '—';
  const classLetter = score?.['Class'] || '—';
  const totalScore = score?.['Total Score'] || score?.['Weighted Score'];
  const rank = score?.['Rank'];
  const employees = company.employee_count || '—';
  const revenue = company.revenue_bracket || '—';
  const intlPct = company.international_revenue_pct;

  const showClass = classLetter !== '—';

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {showClass ? (
        <Stat label="Class" value={classLetter} hint={totalScore ? `Score ${totalScore}${rank ? ` · rank ${rank}` : ''}` : undefined} />
      ) : (
        <Stat label="Employees" value={employees} hint={intlPct ? `${intlPct}% international rev` : 'Team size'} />
      )}
      <Stat label="Readiness" value={readiness} hint={needs?.['Total Interventions'] ? `${needs['Total Interventions']} interventions` : 'Baseline score'} />
      <Stat label="Revenue" value={revenue} hint="Bracket" />
      <Stat label="Interventions" value={assignmentsCount.toString()} hint={`${prsCount} PRs · ${fmtUsd(budgetTotal)} budgeted`} />
      <Stat label="Paid" value={fmtUsd(paymentsTotal)} hint="Logged to date" />
      <Stat
        label="Reviews"
        value={reviewSummary && reviewSummary.total > 0 ? String(reviewSummary.total) : '—'}
        hint={reviewSummary && reviewSummary.total > 0
          ? `${reviewSummary.recommend} rec · ${reviewSummary.hold} hold · ${reviewSummary.reject} rej${reviewSummary.divergence ? ' · divergent' : ''}`
          : 'No reviews yet'}
        accent={reviewSummary && reviewSummary.consensus === 'Recommend' ? 'green' : reviewSummary && reviewSummary.consensus === 'Reject' ? 'red' : reviewSummary && reviewSummary.consensus ? 'amber' : undefined}
      />
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'green' | 'red' | 'amber' }) {
  const accentBorder =
    accent === 'green' ? 'border-l-4 border-l-emerald-500' :
    accent === 'red' ? 'border-l-4 border-l-red-500' :
    accent === 'amber' ? 'border-l-4 border-l-amber-500' : '';
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 dark:border-navy-700 dark:bg-navy-600 ${accentBorder}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-navy-500 dark:text-white">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

// -------- Overview: dashboard view (facts + contacts + timeline + notes + inline edit) --------

function OverviewTab({
  company,
  draft,
  onDraftChange,
  onSave,
  saving,
  editing,
  onEditToggle,
  contacts,
  applicant,
  assignments,
  prs,
  payments,
  confs,
  docs,
  needs,
}: {
  company: Company;
  draft: Company;
  onDraftChange: (d: Company) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  editing: boolean;
  onEditToggle: () => void;
  contacts: Contact[];
  applicant?: SelectionRow;
  assignments: Assignment[];
  prs: PR[];
  payments: Payment[];
  confs: ConferenceRow[];
  docs: Doc[];
  needs?: SelectionRow;
}) {
  const dirty = Object.keys(draft).some(k => draft[k] !== company[k]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader
            title="Company profile"
            subtitle={company.updated_at ? `Last updated ${dateOnly(company.updated_at)} by ${company.updated_by || 'unknown'}` : 'No edits recorded yet'}
            action={
              editing ? (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={onEditToggle}>
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                  <Button onClick={onSave} disabled={!dirty || saving}>
                    <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={onEditToggle}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )
            }
          />
          {editing ? (
            <ProfileForm draft={draft} onDraftChange={onDraftChange} />
          ) : (
            <ProfileFacts company={company} needs={needs} />
          )}
        </Card>

        {company.notes && !editing && (
          <Card>
            <CardHeader title="Notes" />
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{company.notes}</p>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Recent activity"
            subtitle="Latest events across interventions, procurement, payments, conferences, and docs"
          />
          <ActivityTimeline
            assignments={assignments}
            prs={prs}
            payments={payments}
            confs={confs}
            docs={docs}
            limit={8}
          />
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Contacts"
            subtitle={contacts.length > 0 ? `${contacts.length} linked` : applicant ? 'From application' : undefined}
          />
          {contacts.length === 0 && applicant?.contactName ? (
            <ul className="space-y-3">
              <li className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-navy-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-navy-500 dark:text-white">{applicant.contactName}</div>
                  <Badge tone="neutral">Applicant</Badge>
                </div>
                {applicant.contactTitle && <div className="text-xs text-slate-500">{applicant.contactTitle}</div>}
                {applicant.contactEmail && (
                  <a href={`mailto:${applicant.contactEmail}`} className="mt-1 block text-xs text-brand-teal hover:underline">
                    {applicant.contactEmail}
                  </a>
                )}
                {applicant.contactPhone && <div className="text-xs text-slate-600 dark:text-slate-300">{applicant.contactPhone}</div>}
                {(applicant.email || applicant.phone || applicant.website) && (
                  <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-navy-700">
                    <div className="font-semibold uppercase tracking-wider">Company</div>
                    {applicant.email && <div>{applicant.email}</div>}
                    {applicant.phone && <div>{applicant.phone}</div>}
                    {applicant.website && (
                      <a href={applicant.website.startsWith('http') ? applicant.website : `https://${applicant.website}`} target="_blank" rel="noopener noreferrer" className="text-brand-teal hover:underline">
                        {applicant.website}
                      </a>
                    )}
                  </div>
                )}
              </li>
            </ul>
          ) : contacts.length === 0 ? (
            <EmptyState title="No contacts" description="Contacts with this company_id from the Contacts tab will appear here." />
          ) : (
            <ul className="space-y-3">
              {contacts.map((c, i) => (
                <li key={c.contact_id || i} className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-navy-500 dark:text-white">{c.full_name || '—'}</div>
                    {c.is_signatory === 'Yes' && <Badge tone="teal">Signatory</Badge>}
                  </div>
                  {c.title && <div className="text-xs text-slate-500">{c.title}</div>}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="mt-1 block text-xs text-brand-teal hover:underline">
                      {c.email}
                    </a>
                  )}
                  {c.phone && <div className="text-xs text-slate-600 dark:text-slate-300">{c.phone}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Key dates" />
          <dl className="space-y-2 text-sm">
            <DateRow label="Selection" value={company.selection_date} />
            <DateRow label="Onboarding" value={company.onboarding_date} />
            <DateRow label="Updated" value={dateOnly(company.updated_at)} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function ProfileFacts({ company, needs }: { company: Company; needs?: SelectionRow }) {
  const groups: { title: string; items: { label: string; value?: string }[] }[] = [
    {
      title: 'Identity',
      items: [
        { label: 'Legal Name', value: company.legal_name },
        { label: 'Sector', value: company.sector },
        { label: 'Cohort', value: company.cohort },
        { label: 'Fund', value: company.fund_code === '97060' ? 'Dutch (97060)' : company.fund_code === '91763' ? 'SIDA (91763)' : company.fund_code },
      ],
    },
    {
      title: 'Location',
      items: [
        { label: 'City', value: company.city },
        { label: 'Governorate', value: company.governorate },
      ],
    },
    {
      title: 'Size & Market',
      items: [
        { label: 'Employees', value: company.employee_count },
        { label: 'Revenue Bracket', value: company.revenue_bracket },
        { label: 'International Revenue', value: company.international_revenue_pct ? `${company.international_revenue_pct}%` : undefined },
        { label: 'Readiness', value: company.readiness_score || needs?.['Readiness Score'] },
      ],
    },
    {
      title: 'Program',
      items: [
        { label: 'Status', value: company.status },
        { label: 'Stage', value: company.stage },
        ...(needs?.['Primary Domain'] ? [{ label: 'Primary Domain', value: needs['Primary Domain'] }] : []),
        ...(needs?.['Client Type'] ? [{ label: 'Client Type', value: needs['Client Type'] }] : []),
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group.title}>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-brand-teal">
            {group.title}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            {group.items.map(item => (
              <Fact key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  const v = value && value !== '0' ? value : '—';
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-navy-500 dark:text-white">{v}</div>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-semibold text-navy-500 dark:text-white">{value || '—'}</dd>
    </div>
  );
}

function ProfileForm({
  draft,
  onDraftChange,
}: {
  draft: Company;
  onDraftChange: (d: Company) => void;
}) {
  const pms = getProfileManagers();
  return (
    <div className="space-y-3">
      <Row>
        <Field label="Company Name">
          <input className={inputClass} value={draft.company_name || ''} onChange={e => onDraftChange({ ...draft, company_name: e.target.value })} />
        </Field>
        <Field label="Legal Name">
          <input className={inputClass} value={draft.legal_name || ''} onChange={e => onDraftChange({ ...draft, legal_name: e.target.value })} />
        </Field>
      </Row>
      <Row>
        <Field label="City">
          <input className={inputClass} value={draft.city || ''} onChange={e => onDraftChange({ ...draft, city: e.target.value })} />
        </Field>
        <Field label="Governorate">
          <input className={inputClass} value={draft.governorate || ''} onChange={e => onDraftChange({ ...draft, governorate: e.target.value })} />
        </Field>
      </Row>
      <Row>
        <Field label="Sector">
          <input className={inputClass} value={draft.sector || ''} onChange={e => onDraftChange({ ...draft, sector: e.target.value })} />
        </Field>
        <Field label="Fund Code">
          <select className={inputClass} value={draft.fund_code || ''} onChange={e => onDraftChange({ ...draft, fund_code: e.target.value })}>
            <option value="">—</option>
            {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Employees">
          <input className={inputClass} type="number" value={draft.employee_count || ''} onChange={e => onDraftChange({ ...draft, employee_count: e.target.value })} />
        </Field>
        <Field label="Revenue Bracket">
          <select className={inputClass} value={draft.revenue_bracket || ''} onChange={e => onDraftChange({ ...draft, revenue_bracket: e.target.value })}>
            <option value="">—</option>
            {REVENUE_BRACKETS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="International Revenue %">
          <input className={inputClass} type="number" value={draft.international_revenue_pct || ''} onChange={e => onDraftChange({ ...draft, international_revenue_pct: e.target.value })} />
        </Field>
        <Field label="Readiness Score">
          <input className={inputClass} type="number" value={draft.readiness_score || ''} onChange={e => onDraftChange({ ...draft, readiness_score: e.target.value })} />
        </Field>
      </Row>
      <Row>
        <Field label="Status">
          <select className={inputClass} value={draft.status || ''} onChange={e => onDraftChange({ ...draft, status: e.target.value })}>
            <option value="">—</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select className={inputClass} value={draft.stage || ''} onChange={e => onDraftChange({ ...draft, stage: e.target.value })}>
            <option value="">—</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Selection Date">
          <input className={inputClass} type="date" value={draft.selection_date || ''} onChange={e => onDraftChange({ ...draft, selection_date: e.target.value })} />
        </Field>
        <Field label="Onboarding Date">
          <input className={inputClass} type="date" value={draft.onboarding_date || ''} onChange={e => onDraftChange({ ...draft, onboarding_date: e.target.value })} />
        </Field>
      </Row>
      <Field label="Profile Manager">
        <select className={inputClass} value={draft.profile_manager_email || ''} onChange={e => onDraftChange({ ...draft, profile_manager_email: e.target.value })}>
          <option value="">— unassigned —</option>
          {pms.map(pm => <option key={pm.email} value={pm.email}>{pm.name}</option>)}
        </select>
      </Field>
      <Field label="Drive Folder URL">
        <input className={inputClass} value={draft.drive_folder_url || ''} onChange={e => onDraftChange({ ...draft, drive_folder_url: e.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea rows={3} className={inputClass} value={draft.notes || ''} onChange={e => onDraftChange({ ...draft, notes: e.target.value })} />
      </Field>
    </div>
  );
}

// -------- Activity Timeline (shared on Overview) --------

type TimelineEvent = {
  date: string;
  kind: 'Intervention' | 'Procurement' | 'Payment' | 'Conference' | 'Document';
  title: string;
  subtitle?: string;
  status?: string;
};

function buildTimeline(
  assignments: Assignment[],
  prs: PR[],
  payments: Payment[],
  confs: ConferenceRow[],
  docs: Doc[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  assignments.forEach(a => {
    events.push({
      date: dateOnly(a.start_date || a.created_at || a.updated_at) || '',
      kind: 'Intervention',
      title: a.intervention_type || 'Intervention',
      subtitle: a.sub_intervention || a.owner_email,
      status: a.status,
    });
  });

  prs.forEach(p => {
    events.push({
      date: dateOnly(p.pr_submit_date || p.target_award_date || p.updated_at) || '',
      kind: 'Procurement',
      title: p.activity || p.item_description || p.pr_id || 'PR',
      subtitle: p.total_cost_usd ? fmtUsd(Number(p.total_cost_usd)) : p.threshold_class,
      status: p.status,
    });
  });

  payments.forEach(p => {
    events.push({
      date: dateOnly(p.payment_date || p.updated_at) || '',
      kind: 'Payment',
      title: `${p.payee_name || p.payee_type || 'Payment'}${p.amount_usd ? ` · ${fmtUsd(Number(p.amount_usd))}` : ''}`,
      subtitle: p.intervention_type || p.payee_type,
      status: p.status,
    });
  });

  confs.forEach(c => {
    events.push({
      date: dateOnly(c.updated_at || c.travel_start || c.start_date) || '',
      kind: 'Conference',
      title: c.conference_name || c.conference_id || 'Conference',
      subtitle: c.signatory_name,
      status: c.decision,
    });
  });

  docs.forEach(d => {
    events.push({
      date: dateOnly(d.signed_date || d.updated_at) || '',
      kind: 'Document',
      title: `${d.agreement_type || 'Agreement'}${d.signatory_name ? ` · ${d.signatory_name}` : ''}`,
      subtitle: d.related_intervention,
      status: d.status,
    });
  });

  return events.sort((a, b) => (a.date < b.date ? 1 : -1));
}

function ActivityTimeline({
  assignments,
  prs,
  payments,
  confs,
  docs,
  limit,
}: {
  assignments: Assignment[];
  prs: PR[];
  payments: Payment[];
  confs: ConferenceRow[];
  docs: Doc[];
  limit?: number;
}) {
  const all = useMemo(
    () => buildTimeline(assignments, prs, payments, confs, docs),
    [assignments, prs, payments, confs, docs]
  );
  const events = limit ? all.slice(0, limit) : all;

  if (events.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Assignments, PRs, payments, conferences, and docs for this company will show up here as they're logged."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((e, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-navy-700"
        >
          <EventIcon kind={e.kind} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-navy-500 dark:text-white">{e.title}</span>
              <Badge tone={kindTone(e.kind)}>{e.kind}</Badge>
              {e.status && <Badge tone={statusTone(e.status)}>{e.status}</Badge>}
            </div>
            {e.subtitle && <div className="mt-0.5 truncate text-xs text-slate-500">{e.subtitle}</div>}
          </div>
          <div className="whitespace-nowrap text-xs text-slate-500">{e.date || '—'}</div>
        </li>
      ))}
    </ul>
  );
}

function EventIcon({ kind }: { kind: TimelineEvent['kind'] }) {
  const cls = 'h-4 w-4 text-navy-500 dark:text-white';
  const Icon =
    kind === 'Intervention' ? LayoutDashboard :
    kind === 'Procurement' ? ClipboardList :
    kind === 'Payment' ? Wallet :
    kind === 'Conference' ? Plane :
    FileText;
  return (
    <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-navy-700">
      <Icon className={cls} />
    </div>
  );
}

function kindTone(kind: TimelineEvent['kind']): 'teal' | 'amber' | 'green' | 'red' | 'neutral' {
  switch (kind) {
    case 'Intervention': return 'teal';
    case 'Procurement': return 'amber';
    case 'Payment': return 'green';
    case 'Conference': return 'red';
    default: return 'neutral';
  }
}

// -------- Selection tab (needs + score + interview + EB + C-Suite fit) --------

function SelectionTab({
  applicant,
  needs,
  score,
  interview,
  discussion,
  eb,
  company,
}: {
  applicant?: SelectionRow;
  needs?: SelectionRow;
  score?: SelectionRow;
  interview?: SelectionRow;
  discussion: SelectionRow[];
  eb?: SelectionRow;
  company: Company;
}) {
  const hasAny = !!(applicant || needs || score || interview || eb || discussion.length);

  if (!hasAny) {
    return (
      <EmptyState
        title="No selection data yet"
        description="Once selection-tool runs Scoring / Needs / Interview / ElevateBridge for this company, the results will show up here."
      />
    );
  }

  const assessed = interview?.assessedInterventions || '';
  const interviewNotes = interview?.notes || '';
  const domain = (needs?.['Primary Domain'] || '').toLowerCase();
  const wantsCoaching = needs?.['Domain Coaching'] === 'Yes';

  return (
    <div className="space-y-4">
      {applicant && <BaselineApplicationCard applicant={applicant} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {needs && (
          <Card>
            <CardHeader title="What they need" subtitle="From Company Needs" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <KV label="Client Type" value={needs['Client Type']} />
              <KV label="Total Interventions" value={needs['Total Interventions']} />
              <KV label="Readiness" value={needs['Readiness Score']} />
              <KV label="Upskilling" value={needs['Upskilling']} />
              <KV label="Upskill Headcount" value={needs['Upskilling Employee Count']} />
              <KV label="Marketing Maturity" value={needs['Marketing Maturity']} />
              <KV label="Legal Tier" value={needs['Legal Tier']} />
              <KV label="Legal Urgency" value={needs['Legal Urgency']} />
              <KV label="Primary Domain" value={needs['Primary Domain']} />
              <KV label="ElevateBridge" value={needs['Elevate Bridge']} tone={needs['Elevate Bridge'] === 'Yes' ? 'teal' : undefined} />
            </div>
            {needs['Upskilling Topics'] && <Paragraph label="Upskilling Topics" value={needs['Upskilling Topics']} />}
            {needs['Marketing Areas'] && <Paragraph label="Marketing Areas" value={needs['Marketing Areas']} />}
            {needs['Coaching Challenge'] && <Paragraph label="Coaching Challenge" value={needs['Coaching Challenge']} />}
          </Card>
        )}

        {score && (
          <Card>
            <CardHeader title="Scoring" subtitle="From Scoring Matrix" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <KV label="Class" value={score['Class']} />
              <KV label="Rank" value={score['Rank']} />
              <KV label="Total Score" value={score['Total Score']} />
              <KV label="Weighted" value={score['Weighted Score']} />
              <KV label="Year Score" value={score['Year Score']} />
              <KV label="Employee Score" value={score['Employee Score']} />
              <KV label="Revenue Score" value={score['Revenue Score']} />
              <KV label="Client Score" value={score['Client Score']} />
              <KV label="Gender Score" value={score['Gender Score']} />
              <KV label="Size Avg" value={score['Size Average']} />
              <KV label="Market Diversification" value={score['Market Diversification']} />
              <KV label="Economic Viability" value={score['Economic Viability']} />
            </div>
            {score['Calculated At'] && (
              <p className="mt-3 text-xs text-slate-500">Calculated {dateOnly(score['Calculated At'])} by {score['Calculated By'] || 'unknown'}</p>
            )}
          </Card>
        )}
      </div>

      {(interview || discussion.length > 0) && (
        <Card>
          <CardHeader title="Interview" subtitle={discussion.length > 0 ? `${discussion.length} discussion comments` : undefined} />
          {assessed && (
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assessed Interventions</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {assessed.split(',').map((t, i) => (
                  <Badge key={i} tone="teal">{t.trim()}</Badge>
                ))}
              </div>
            </div>
          )}
          {interviewNotes && <Paragraph label="Interviewer Notes" value={interviewNotes} />}
          {discussion.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Discussion</div>
              <ul className="space-y-2">
                {discussion.map((d, i) => (
                  <li key={d.id || i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-navy-700 dark:bg-navy-700">
                    <div className="text-xs text-slate-500">
                      <b>{d.userName || d.userEmail}</b> · {dateOnly(d.timestamp)}
                    </div>
                    <p className="mt-1 text-sm">{d.comment}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(needs || company) && (
          <Card>
            <CardHeader
              title="C-Suite fit"
              subtitle="Domain Expert model · 3 tracks"
              action={<GraduationCap className="h-4 w-4 text-slate-400" />}
            />
            <div className="grid grid-cols-1 gap-3">
              <TrackCard title="Technical Strategy" desc="CTOs, AI integration, scalability." active={domain.includes('tech')} />
              <TrackCard title="Marketing & GTM" desc="CMOs/CEOs, international lead gen." active={domain.includes('market')} />
              <TrackCard title="Legal & Biz Strategy" desc="CEOs, investment readiness." active={domain.includes('legal') || domain.includes('invest')} />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-navy-700 dark:bg-navy-700">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Wants coaching</span>
              <Badge tone={wantsCoaching ? 'teal' : 'neutral'}>{wantsCoaching ? 'Yes' : 'No'}</Badge>
            </div>
          </Card>
        )}

        <Card className={eb?.vote ? 'border-brand-teal/40' : ''}>
          <CardHeader
            title="ElevateBridge"
            subtitle="Freelancer placement · sub-intervention under MA"
            action={<Briefcase className="h-4 w-4 text-slate-400" />}
          />
          {eb ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Badge tone={eb.vote === 'pass' || eb.vote === 'Yes' ? 'green' : eb.vote === 'fail' || eb.vote === 'No' ? 'red' : 'amber'}>
                  Vote: {eb.vote || 'Pending'}
                </Badge>
                {eb.reviewerEmail && <span className="text-xs text-slate-500">by {eb.reviewerEmail}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Check label="Has Upwork" value={eb.checklist_hasUpwork} />
                <Check label="Viable Client Type" value={eb.checklist_viableClientType} />
                <Check label="Job Hunter Defined" value={eb.checklist_jobHunterDefined} />
                <Check label="Tech Team Adequate" value={eb.checklist_techTeamAdequate} />
                <Check label="Revenue Viable" value={eb.checklist_revenueViable} />
                <Check label="No Blockers" value={eb.checklist_noBlockers} />
              </div>
              {eb.notes && <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">{eb.notes}</p>}
            </>
          ) : (
            <EmptyState
              title={needs?.['Elevate Bridge'] === 'Yes' ? 'Assessment pending' : 'Not requested'}
              description={
                needs?.['Elevate Bridge'] === 'Yes'
                  ? 'Company requested EB. Run the checklist in selection-tool to record the vote.'
                  : 'Company did not request EB in the baseline survey.'
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function BaselineApplicationCard({ applicant }: { applicant: SelectionRow }) {
  const asBool = (v?: string) => v === 'true' || v === 'TRUE' || v === 'Yes' || v === 'YES' || v === '1';
  const asNum = (v?: string) => (v ? parseFloat(v) || 0 : 0);
  const list = (v?: string) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

  const totalEmp = asNum(applicant.totalEmployees);
  const femalePct = asNum(applicant.femalePercentage);
  const femaleFT = asNum(applicant.femaleFullTime);
  const femalePT = asNum(applicant.femalePartTime);
  const femaleIn = asNum(applicant.femaleInterns);
  const maleFT = asNum(applicant.maleFullTime);
  const malePT = asNum(applicant.malePartTime);
  const maleIn = asNum(applicant.maleInterns);

  const geo = {
    palestine: asNum(applicant.revenuePalestine),
    inside48: asNum(applicant.revenue48),
    mena: asNum(applicant.revenueMENA),
    intl: asNum(applicant.revenueInternational),
  };
  const geoTotal = geo.palestine + geo.inside48 + geo.mena + geo.intl;

  const compliance = [
    { label: 'Valid Registration', ok: asBool(applicant.hasValidRegistration) },
    { label: 'Corporate Bank', ok: asBool(applicant.hasCorporateBankAccount) },
    { label: 'Physical HQ', ok: asBool(applicant.hasPhysicalHQ) },
    { label: 'MoNE Registered', ok: asBool(applicant.isRegisteredAtMoNE) },
    { label: 'Safeguarding', ok: asBool(applicant.agreedToSafeguarding) },
    { label: 'Research Consent', ok: asBool(applicant.consentedToResearch) },
  ];

  const capacity = [
    { label: 'Upskilling', on: asBool(applicant.wantsUpskilling), detail: applicant.upskillingTopics },
    { label: 'Train-to-Hire', on: asBool(applicant.wantsTrainToHire), detail: applicant.trainToHireCount ? `${applicant.trainToHireCount} roles` : '' },
    { label: 'Marketing', on: asBool(applicant.wantsMarketingSupport), detail: applicant.marketingImportance },
    { label: 'Domain Coaching', on: asBool(applicant.wantsDomainCoaching), detail: applicant.primaryDomain },
    { label: 'Legal', on: asBool(applicant.wantsLegalSupport), detail: applicant.legalTier },
    { label: 'ElevateBridge', on: asBool(applicant.wantsElevateBridge), detail: applicant.clientType },
    { label: 'Conferences', on: asBool(applicant.wantsConferences), detail: '' },
  ];

  return (
    <Card>
      <CardHeader
        title="Baseline application"
        subtitle={`Submitted ${applicant.date || dateOnly(applicant.timestamp) || '—'} · registration ${applicant.registrationType || '—'}${applicant.establishedYear ? ` · est. ${applicant.establishedYear}` : ''}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Team" value={totalEmp.toString()} hint={femalePct ? `${Math.round(femalePct)}% female` : undefined} />
        <MiniStat label="Revenue (6mo)" value={applicant.revenuePast6Months || '—'} hint={applicant.forecastedRevenue ? `forecast ${applicant.forecastedRevenue}` : undefined} />
        <MiniStat label="Clients 2025" value={applicant.clients2025 || '—'} hint="Paying customers" />
        <MiniStat label="Readiness" value={applicant.readinessScore || '—'} hint={applicant.economicViability ? `econ viability ${applicant.economicViability}` : undefined} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <SectionLabel>Workforce</SectionLabel>
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 dark:border-navy-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 dark:bg-navy-700">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold text-slate-500"></th>
                  <th className="px-3 py-1.5 text-right font-semibold text-slate-500">Full-time</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-slate-500">Part-time</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-slate-500">Interns</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200 dark:border-navy-700">
                  <td className="px-3 py-1.5 font-semibold">Female</td>
                  <td className="px-3 py-1.5 text-right">{femaleFT}</td>
                  <td className="px-3 py-1.5 text-right">{femalePT}</td>
                  <td className="px-3 py-1.5 text-right">{femaleIn}</td>
                </tr>
                <tr className="border-t border-slate-200 dark:border-navy-700">
                  <td className="px-3 py-1.5 font-semibold">Male</td>
                  <td className="px-3 py-1.5 text-right">{maleFT}</td>
                  <td className="px-3 py-1.5 text-right">{malePT}</td>
                  <td className="px-3 py-1.5 text-right">{maleIn}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {applicant.techTeamSize && (
            <div className="mt-2 text-xs text-slate-500">Tech team: <b>{applicant.techTeamSize}</b></div>
          )}
        </div>

        <div>
          <SectionLabel>Revenue by geography</SectionLabel>
          {geoTotal > 0 ? (
            <>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full">
                <div style={{ width: `${(geo.palestine / geoTotal) * 100}%` }} className="bg-brand-red" title={`Palestine ${geo.palestine}%`} />
                <div style={{ width: `${(geo.inside48 / geoTotal) * 100}%` }} className="bg-brand-orange" title={`48 ${geo.inside48}%`} />
                <div style={{ width: `${(geo.mena / geoTotal) * 100}%` }} className="bg-amber-400" title={`MENA ${geo.mena}%`} />
                <div style={{ width: `${(geo.intl / geoTotal) * 100}%` }} className="bg-brand-teal" title={`International ${geo.intl}%`} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <GeoLegend color="bg-brand-red" label="Palestine" pct={geo.palestine} />
                <GeoLegend color="bg-brand-orange" label="48" pct={geo.inside48} />
                <GeoLegend color="bg-amber-400" label="MENA" pct={geo.mena} />
                <GeoLegend color="bg-brand-teal" label="International" pct={geo.intl} />
              </div>
            </>
          ) : (
            <div className="mt-2 text-xs text-slate-500">No revenue geography provided.</div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <SectionLabel>Compliance (1st filtration)</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          {compliance.map(c => (
            <div key={c.label} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-navy-700">
              <div className={`h-2.5 w-2.5 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
              <span className="text-xs">{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <SectionLabel>What they want</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          {capacity.filter(c => c.on).length === 0 && (
            <span className="text-xs text-slate-500">No interventions requested.</span>
          )}
          {capacity.filter(c => c.on).map(c => (
            <div key={c.label} className="rounded-lg border border-brand-teal/40 bg-brand-teal/5 px-2.5 py-1.5">
              <div className="text-xs font-bold text-brand-teal">{c.label}</div>
              {c.detail && <div className="text-[11px] text-slate-600 dark:text-slate-300">{c.detail}</div>}
            </div>
          ))}
        </div>
      </div>

      {(applicant.businessType || list(applicant.currentMarkets).length || list(applicant.targetMarkets).length || list(applicant.itServices).length) && (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {applicant.businessType && (
            <div>
              <SectionLabel>Business type</SectionLabel>
              <p className="mt-1 text-sm">{applicant.businessType}</p>
            </div>
          )}
          {list(applicant.itServices).length > 0 && (
            <TagList label="IT services" tags={list(applicant.itServices)} />
          )}
          {list(applicant.currentMarkets).length > 0 && (
            <TagList label="Current markets" tags={list(applicant.currentMarkets)} />
          )}
          {list(applicant.targetMarkets).length > 0 && (
            <TagList label="Target markets" tags={list(applicant.targetMarkets)} />
          )}
        </div>
      )}

      {(applicant.previousElevateCohort || applicant.timesParticipated) && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-navy-700 dark:bg-navy-700">
          <span className="font-semibold uppercase tracking-wider text-slate-500">Elevate history</span>
          <div className="mt-1">
            {asBool(applicant.isNewToElevate) ? 'New to Elevate' : `Previously in ${applicant.previousElevateCohort || 'Elevate'} · ${applicant.timesParticipated || '?'} time(s)`}
          </div>
        </div>
      )}

      {applicant.strategicJustification && (
        <div className="mt-4">
          <SectionLabel>Strategic justification</SectionLabel>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{applicant.strategicJustification}</p>
        </div>
      )}
      {applicant.marketHindrances && (
        <div className="mt-3">
          <SectionLabel>Market hindrances</SectionLabel>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{applicant.marketHindrances}</p>
        </div>
      )}
      {applicant.coachingChallenge && (
        <div className="mt-3">
          <SectionLabel>Coaching challenge</SectionLabel>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{applicant.coachingChallenge}</p>
        </div>
      )}
      {applicant.additionalNotes && (
        <div className="mt-3">
          <SectionLabel>Notes</SectionLabel>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{applicant.additionalNotes}</p>
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold text-navy-500 dark:text-white">{value}</div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</div>;
}

function GeoLegend({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      <span className="flex-1">{label}</span>
      <span className="font-semibold">{pct}%</span>
    </div>
  );
}

function TagList({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-navy-700 dark:text-slate-200">{t}</span>
        ))}
      </div>
    </div>
  );
}

function Paragraph({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value?: string; tone?: 'teal' }) {
  const v = value && value !== '0' ? value : '—';
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-sm ${tone === 'teal' ? 'font-semibold text-brand-teal' : 'text-navy-500 dark:text-white'}`}>{v}</div>
    </div>
  );
}

function Check({ label, value }: { label: string; value?: string }) {
  const ok = value === 'true' || value === 'TRUE' || value === 'Yes' || value === '1';
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-navy-700">
      <div className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-navy-700'}`} />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function TrackCard({ title, desc, active }: { title: string; desc: string; active: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${active ? 'border-brand-teal bg-brand-teal/5' : 'border-slate-200 bg-white dark:border-navy-700 dark:bg-navy-600'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-bold text-navy-500 dark:text-white">{title}</div>
        {active && <Badge tone="teal">Likely</Badge>}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{desc}</div>
    </div>
  );
}

// -------- Comments tab --------

function CommentsTab({
  comments,
  preDecisions,
  companyId,
  onPost,
}: {
  comments: CompanyComment[];
  preDecisions: PreDecisionRecommendation[];
  companyId: string;
  onPost: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const sorted = useMemo(
    () => comments.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    [comments],
  );
  if (!companyId) {
    return (
      <EmptyState
        icon={<MessageCircle className="h-6 w-6" />}
        title="No master row yet"
        description="Comments need a Companies Master record. Materialize the company first."
      />
    );
  }
  const handlePost = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await onPost(draft);
      setDraft('');
    } finally {
      setPosting(false);
    }
  };
  return (
    <div className="space-y-3">
      {/* Pre-decision recommendations (Israa CSV / Raouf docx / future seeds) */}
      {preDecisions.length > 0 && (
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader
            title={`Pre-decision recommendations (${preDecisions.length})`}
            subtitle={`From ${Array.from(new Set(preDecisions.map(p => displayName(p.author_email)))).join(', ')}`}
          />
          <ul className="space-y-1.5">
            {preDecisions.map(r => (
              <li key={r.recommendation_id} className="rounded-md border border-purple-200 bg-purple-50/50 p-2 text-xs dark:border-purple-900 dark:bg-purple-950/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-purple-800 dark:text-purple-200">
                    {r.pillar}{r.sub_intervention ? ` · ${r.sub_intervention}` : ''}
                    {r.fund_hint && <span className="ml-1 text-[10px] font-normal text-purple-600">[{r.fund_hint}]</span>}
                  </span>
                  <span className="text-[10px] text-purple-500">{displayName(r.author_email)}{r.source ? ` · ${r.source}` : ''}</span>
                </div>
                {r.note && <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{r.note}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Comments thread */}
      <Card>
        <CardHeader
          title={`Comments (${sorted.length})`}
          subtitle="Free-form team thread. Israa + Raouf imports show up here automatically."
        />
        {sorted.length === 0 ? (
          <p className="text-xs italic text-slate-500">No comments yet — be the first to post.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map(c => (
              <li key={c.comment_id} className="rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-navy-700 dark:bg-navy-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-navy-500 dark:text-slate-100">{displayName(c.author_email)}</span>
                  <span className="text-[10px] text-slate-500">{c.created_at}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{c.body}</div>
              </li>
            ))}
          </ul>
        )}
        {/* Composer */}
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-navy-700">
          <textarea
            value={draft}
            onChange={e => setDraft(e.currentTarget.value)}
            placeholder="Add a comment for the team…"
            rows={3}
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          />
          <div className="mt-2 flex justify-end">
            <Button onClick={handlePost} disabled={posting || !draft.trim()} size="sm">
              {posting ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// -------- Activity tab (grouped sections) --------

function ActivityTab({
  assignments,
  prs,
  payments,
  confs,
  docs,
  auditLog = [],
  companyId,
  onQuickAction,
  masterKey,
}: {
  assignments: Assignment[];
  prs: PR[];
  payments: Payment[];
  confs: ConferenceRow[];
  docs: Doc[];
  auditLog?: ActivityRow[];
  companyId?: string;
  onQuickAction: (kind: 'intervention' | 'pr' | 'payment' | 'agreement', prefill?: Record<string, string>) => void;
  masterKey: string;
}) {
  const auditForCompany = useMemo(
    () => (companyId ? auditLog.filter(r => r.company_id === companyId) : []),
    [auditLog, companyId],
  );
  const total = assignments.length + prs.length + payments.length + confs.length + docs.length;
  if (total === 0 && auditForCompany.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Interventions, PRs, payments, conference nominations, and agreements for this company will collect here."
        icon={<Activity className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PillarGrid assignments={assignments} onAssign={masterKey ? () => onQuickAction('intervention') : undefined} />

      <Section
        title="Interventions"
        count={assignments.length}
        icon={<LayoutDashboard className="h-4 w-4" />}
        empty="No interventions assigned."
        action={masterKey ? (
          <button
            onClick={() => onQuickAction('intervention')}
            className="text-xs font-semibold text-brand-teal hover:underline"
          >+ Assign</button>
        ) : undefined}
      >
        {assignments.length > 0 && (
          <InterventionsTable rows={assignments} onNewPR={assignment => onQuickAction('pr', {
            assignment_id: assignment.assignment_id || '',
            intervention_type: assignment.intervention_type || '',
            fund_code: assignment.fund_code || '',
            activity: assignment.sub_intervention || assignment.intervention_type || '',
          })} onLogPayment={assignment => onQuickAction('payment', {
            assignment_id: assignment.assignment_id || '',
            intervention_type: assignment.intervention_type || '',
            fund_code: assignment.fund_code || '',
          })} />
        )}
      </Section>

      <Section
        title="Procurement"
        count={prs.length}
        icon={<ClipboardList className="h-4 w-4" />}
        empty="No PRs filed."
        action={masterKey ? (
          <button
            onClick={() => onQuickAction('pr')}
            className="text-xs font-semibold text-brand-teal hover:underline"
          >+ New PR</button>
        ) : undefined}
      >
        {prs.length > 0 && (
          <ProcurementTable rows={prs} onLogPayment={pr => onQuickAction('payment', {
            pr_id: pr.pr_id || '',
            amount_usd: pr.total_cost_usd || '',
            intervention_type: pr.intervention_type || '',
            fund_code: pr.fund_code || '',
            payee_type: 'Vendor',
          })} />
        )}
      </Section>

      <Section
        title="Payments"
        count={payments.length}
        icon={<Wallet className="h-4 w-4" />}
        empty="No payments logged."
        action={masterKey ? (
          <button
            onClick={() => onQuickAction('payment')}
            className="text-xs font-semibold text-brand-teal hover:underline"
          >+ Log</button>
        ) : undefined}
      >
        {payments.length > 0 && <PaymentsTable rows={payments} />}
      </Section>

      <Section
        title="Conferences"
        count={confs.length}
        icon={<Plane className="h-4 w-4" />}
        empty="No conference involvement."
      >
        {confs.length > 0 && <ConferencesTable rows={confs} />}
      </Section>

      <Section
        title="Documents"
        count={docs.length}
        icon={<FileText className="h-4 w-4" />}
        empty="No agreements on file."
        action={masterKey ? (
          <button
            onClick={() => onQuickAction('agreement')}
            className="text-xs font-semibold text-brand-teal hover:underline"
          >+ New</button>
        ) : undefined}
      >
        {docs.length > 0 && <DocsTable rows={docs} />}
      </Section>

      {auditForCompany.length > 0 && (
        <Section
          title="Audit log"
          count={auditForCompany.length}
          icon={<Activity className="h-4 w-4" />}
          empty=""
        >
          <AuditLogTimeline rows={auditForCompany} companyId={companyId} limit={50} />
        </Section>
      )}
    </div>
  );
}

type ProgramEvent =
  | { kind: 'assignment'; at: string; row: Assignment }
  | { kind: 'pr'; at: string; row: PR }
  | { kind: 'payment'; at: string; row: Payment }
  | { kind: 'agreement'; at: string; row: Doc }
  | { kind: 'conference'; at: string; row: ConferenceRow };

type ProgramGroup = {
  key: string;
  intervention: string;
  subIntervention: string;
  assignment: Assignment | undefined;
  events: ProgramEvent[];
  budgetUsd: number;
  paidUsd: number;
};

function ProgramTab({
  assignments,
  prs,
  payments,
  confs,
  docs,
  onQuickAction,
  masterKey,
}: {
  assignments: Assignment[];
  prs: PR[];
  payments: Payment[];
  confs: ConferenceRow[];
  docs: Doc[];
  onQuickAction: (kind: 'intervention' | 'pr' | 'payment' | 'agreement', prefill?: Record<string, string>) => void;
  masterKey: string;
}) {
  const groups = useMemo<ProgramGroup[]>(() => {
    const byKey = new Map<string, ProgramGroup>();

    const ensure = (interventionType: string, sub: string, assignment?: Assignment): ProgramGroup => {
      const key = assignment?.assignment_id
        ? `A:${assignment.assignment_id}`
        : `I:${interventionType}|${sub}`.toLowerCase();
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          intervention: interventionType || '(unspecified)',
          subIntervention: sub,
          assignment,
          events: [],
          budgetUsd: parseFloat(assignment?.budget_usd || '0') || 0,
          paidUsd: 0,
        };
        byKey.set(key, g);
      }
      return g;
    };

    // Seed groups from assignments.
    assignments.forEach(a => {
      const g = ensure(a.intervention_type || '', a.sub_intervention || '', a);
      if (a.start_date || a.end_date) {
        g.events.push({ kind: 'assignment', at: a.start_date || a.end_date || '', row: a });
      }
    });

    // PRs: join via assignment_id when present, otherwise by intervention_type.
    prs.forEach(p => {
      const a = assignments.find(x => x.assignment_id && x.assignment_id === p.assignment_id);
      const g = a
        ? ensure(a.intervention_type || '', a.sub_intervention || '', a)
        : ensure(p.intervention_type || '(Unlinked)', '', undefined);
      g.events.push({ kind: 'pr', at: p.target_award_date || p.pr_submit_date || '', row: p });
    });

    // Payments: join by assignment_id, else pr_id -> assignment, else intervention_type.
    payments.forEach(pay => {
      let a = assignments.find(x => x.assignment_id && x.assignment_id === pay.assignment_id);
      if (!a && pay.pr_id) {
        const pr = prs.find(p => p.pr_id === pay.pr_id);
        if (pr?.assignment_id) {
          a = assignments.find(x => x.assignment_id === pr.assignment_id);
        }
      }
      const g = a
        ? ensure(a.intervention_type || '', a.sub_intervention || '', a)
        : ensure(pay.intervention_type || '(Unlinked)', '', undefined);
      g.paidUsd += parseFloat(pay.amount_usd || '0') || 0;
      g.events.push({ kind: 'payment', at: pay.payment_date || '', row: pay });
    });

    // Agreements: join by related_intervention.
    docs.forEach(d => {
      const related = d.related_intervention || '';
      const a = assignments.find(x => x.intervention_type === related);
      const g = a
        ? ensure(a.intervention_type || '', a.sub_intervention || '', a)
        : ensure(related || '(Unlinked)', '', undefined);
      g.events.push({ kind: 'agreement', at: d.signed_date || '', row: d });
    });

    // Conferences: treat as the Conferences pillar.
    confs.forEach(c => {
      const g = ensure('Conferences', c.conference_name || c.name || '', undefined);
      g.events.push({ kind: 'conference', at: c.travel_dates || c.start_date || '', row: c });
    });

    // Sort events newest first within each group.
    for (const g of byKey.values()) {
      g.events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    }

    const orderOf = (intervention: string) => {
      const p = pillarFor(intervention);
      const i = p ? CORE_PILLARS.indexOf(p) : -1;
      return i === -1 ? CORE_PILLARS.length : i;
    };
    return Array.from(byKey.values()).sort((a, b) => {
      const ap = orderOf(a.intervention);
      const bp = orderOf(b.intervention);
      if (ap !== bp) return ap - bp;
      return a.intervention.localeCompare(b.intervention);
    });
  }, [assignments, prs, payments, docs, confs]);

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No program activity yet"
        description="Assign an intervention to start building the joined program view."
        icon={<Activity className="h-6 w-6" />}
        action={masterKey ? (
          <Button onClick={() => onQuickAction('intervention')} variant="primary">Assign intervention</Button>
        ) : undefined}
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(g => (
        <ProgramGroupCard
          key={g.key}
          group={g}
          masterKey={masterKey}
          onQuickAction={onQuickAction}
        />
      ))}
    </div>
  );
}

function ProgramGroupCard({
  group,
  masterKey,
  onQuickAction,
}: {
  group: ProgramGroup;
  masterKey: string;
  onQuickAction: (kind: 'intervention' | 'pr' | 'payment' | 'agreement', prefill?: Record<string, string>) => void;
}) {
  const pillar = pillarFor(group.intervention);
  const pillarCode = pillar?.code ?? 'Other';
  const pillarLabel = pillar?.shortLabel ?? pillarCode;
  const pillarTone: Record<string, string> = {
    TTH: 'bg-brand-red/10 text-brand-red border-brand-red/20',
    Upskilling: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
    MKG: 'bg-brand-teal/10 text-brand-teal border-brand-teal/20',
    MA: 'bg-navy-500/10 text-navy-500 border-navy-500/20 dark:text-white',
    'C-Suite': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    Conferences: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  };
  const toneClass = pillarTone[pillarCode] || 'bg-slate-500/10 text-slate-500 border-slate-500/20';
  const progress = group.budgetUsd > 0
    ? Math.min(100, Math.round((group.paidUsd / group.budgetUsd) * 100))
    : null;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
            {pillarLabel}
          </span>
          <div>
            <div className="text-sm font-semibold text-navy-500 dark:text-white">
              {group.subIntervention || group.intervention}
            </div>
            <div className="text-xs text-slate-500">
              {group.assignment?.assignment_id ? group.assignment.assignment_id : 'Unlinked activity'}
              {group.assignment?.fund_code && ` · Fund ${group.assignment.fund_code}`}
              {group.assignment?.status && ` · ${group.assignment.status}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Budget</div>
            <div className="text-sm font-bold text-navy-500 dark:text-white">
              {group.budgetUsd ? fmtUsd(group.budgetUsd) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Paid</div>
            <div className="text-sm font-bold text-brand-teal">{fmtUsd(group.paidUsd)}</div>
          </div>
          {progress !== null && (
            <div className="w-24">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                <div
                  className="h-full rounded-full bg-brand-teal"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 text-right text-[10px] text-slate-500">{progress}%</div>
            </div>
          )}
        </div>
      </div>

      {masterKey && group.assignment?.assignment_id && (
        <div className="mb-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-navy-700">
          <button
            onClick={() => onQuickAction('pr', {
              assignment_id: group.assignment?.assignment_id || '',
              intervention_type: group.assignment?.intervention_type || '',
              fund_code: group.assignment?.fund_code || '',
              activity: group.assignment?.sub_intervention || group.assignment?.intervention_type || '',
            })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-navy-500 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            + PR
          </button>
          <button
            onClick={() => onQuickAction('payment', {
              assignment_id: group.assignment?.assignment_id || '',
              intervention_type: group.assignment?.intervention_type || '',
              fund_code: group.assignment?.fund_code || '',
            })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-navy-500 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            + Payment
          </button>
        </div>
      )}

      {group.events.length === 0 ? (
        <div className="py-4 text-xs text-slate-500">No events logged yet for this intervention.</div>
      ) : (
        <ol className="space-y-2">
          {group.events.map((e, i) => (
            <ProgramEventRow key={`${e.kind}-${i}`} event={e} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function ProgramEventRow({ event }: { event: ProgramEvent }) {
  const kindMeta: Record<ProgramEvent['kind'], { icon: React.ReactNode; label: string; tone: string }> = {
    assignment: { icon: <LayoutDashboard className="h-3.5 w-3.5" />, label: 'Assignment', tone: 'bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-200' },
    pr: { icon: <ClipboardList className="h-3.5 w-3.5" />, label: 'PR', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200' },
    payment: { icon: <Wallet className="h-3.5 w-3.5" />, label: 'Payment', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200' },
    agreement: { icon: <FileText className="h-3.5 w-3.5" />, label: 'Agreement', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200' },
    conference: { icon: <Plane className="h-3.5 w-3.5" />, label: 'Conference', tone: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200' },
  };
  const meta = kindMeta[event.kind];
  let title = '';
  let meta2 = '';
  if (event.kind === 'assignment') {
    const r = event.row;
    title = r.sub_intervention || r.intervention_type || 'Assignment';
    meta2 = [r.status, r.budget_usd ? fmtUsd(parseFloat(r.budget_usd) || 0) : ''].filter(Boolean).join(' · ');
  } else if (event.kind === 'pr') {
    const r = event.row;
    title = r.activity || r.item_description || r.pr_id || 'PR';
    meta2 = [r.pr_id, r.status, r.threshold_class, r.total_cost_usd ? fmtUsd(parseFloat(r.total_cost_usd) || 0) : ''].filter(Boolean).join(' · ');
  } else if (event.kind === 'payment') {
    const r = event.row;
    title = r.payee_name || 'Payment';
    meta2 = [r.payment_id, r.status, r.amount_usd ? fmtUsd(parseFloat(r.amount_usd) || 0) : ''].filter(Boolean).join(' · ');
  } else if (event.kind === 'agreement') {
    const r = event.row;
    title = r.agreement_type || 'Agreement';
    meta2 = [r.agreement_id, r.status, r.signatory_name].filter(Boolean).join(' · ');
  } else if (event.kind === 'conference') {
    const r = event.row;
    title = r.conference_name || r.name || 'Conference';
    meta2 = [r.decision, r.travel_dates].filter(Boolean).join(' · ');
  }

  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-600">
      <span className={`mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
        {meta.icon}
        {meta.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-navy-500 dark:text-white">{title}</div>
        {meta2 && <div className="truncate text-xs text-slate-500">{meta2}</div>}
      </div>
      {event.at && (
        <span className="shrink-0 text-xs tabular-nums text-slate-500">{dateOnly(event.at)}</span>
      )}
    </li>
  );
}

function Section({
  title,
  count,
  icon,
  empty,
  children,
  action,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  empty: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-500 dark:text-white">
        {icon}
        <span>{title}</span>
        <Badge tone="neutral">{count}</Badge>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500 dark:border-navy-700">
          <Calendar className="mr-1 inline h-3 w-3" /> {empty}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function PillarGrid({
  assignments,
  onAssign,
}: {
  assignments: Assignment[];
  onAssign?: () => void;
}) {
  const counts = useMemo(() => {
    const out: Record<string, { total: number; active: number }> = {};
    for (const p of CORE_PILLARS) out[p.code] = { total: 0, active: 0 };
    for (const a of assignments) {
      const pillar = pillarFor(a.intervention_type || '');
      if (!pillar) continue;
      const bucket = out[pillar.code] ?? (out[pillar.code] = { total: 0, active: 0 });
      bucket.total += 1;
      if (a.status === 'In Progress' || a.status === 'Planned') bucket.active += 1;
    }
    return out;
  }, [assignments]);

  const toneClass: Record<string, string> = {
    teal: 'border-brand-teal/40 bg-brand-teal/5',
    orange: 'border-brand-orange/40 bg-brand-orange/5',
    red: 'border-brand-red/40 bg-brand-red/5',
    navy: 'border-navy-500/40 bg-navy-500/5 dark:border-white/30 dark:bg-white/5',
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-500 dark:text-white">
        <Sparkles className="h-4 w-4" />
        <span>Program Pillars</span>
        {onAssign && (
          <button
            onClick={onAssign}
            className="ml-auto text-xs font-semibold text-brand-teal hover:underline"
          >+ Assign</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CORE_PILLARS.map(p => {
          const c = counts[p.code] || { total: 0, active: 0 };
          return (
            <div
              key={p.code}
              className={`rounded-xl border p-4 ${toneClass[p.color] || toneClass.navy}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {p.shortLabel}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-navy-500 dark:text-white">
                    {p.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-navy-500 dark:text-white">
                    {c.total}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {c.active} active
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{p.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InterventionsTable({
  rows,
  onNewPR,
  onLogPayment,
}: {
  rows: Assignment[];
  onNewPR?: (a: Assignment) => void;
  onLogPayment?: (a: Assignment) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-navy-700">
      <table className="w-full text-sm">
        <thead className="bg-navy-500 text-white">
          <tr>
            <Th>ID</Th><Th>Intervention</Th><Th>Sub</Th><Th>Fund</Th><Th>Owner</Th><Th>Status</Th><Th>Budget</Th><Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.assignment_id || i} className="border-b border-slate-100 last:border-0 dark:border-navy-700">
              <Td className="font-mono text-xs">{r.assignment_id}</Td>
              <Td><Badge tone="teal">{r.intervention_type || '—'}</Badge></Td>
              <Td>{r.sub_intervention || '—'}</Td>
              <Td>{r.fund_code || '—'}</Td>
              <Td>{r.owner_email || '—'}</Td>
              <Td><Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge></Td>
              <Td>{r.budget_usd ? fmtUsd(Number(r.budget_usd)) : '—'}</Td>
              <Td>
                <div className="flex gap-2 text-xs">
                  {onNewPR && <button onClick={() => onNewPR(r)} className="font-semibold text-brand-teal hover:underline">PR</button>}
                  {onLogPayment && <button onClick={() => onLogPayment(r)} className="font-semibold text-brand-orange hover:underline">Pay</button>}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcurementTable({
  rows,
  onLogPayment,
}: {
  rows: PR[];
  onLogPayment?: (pr: PR) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-navy-700">
      <table className="w-full text-sm">
        <thead className="bg-navy-500 text-white">
          <tr>
            <Th>PR ID</Th><Th>Activity</Th><Th>Threshold</Th><Th>Total</Th><Th>SLA</Th><Th>Status</Th>{onLogPayment && <Th>Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.pr_id || i} className="border-b border-slate-100 last:border-0 dark:border-navy-700">
              <Td className="font-mono text-xs">{r.pr_id}</Td>
              <Td>{r.activity || '—'}</Td>
              <Td><Badge tone={r.threshold_class === 'Micro' ? 'teal' : r.threshold_class === 'Small' ? 'green' : r.threshold_class === 'Standard' ? 'amber' : 'red'}>{r.threshold_class || '—'}</Badge></Td>
              <Td>{r.total_cost_usd ? fmtUsd(Number(r.total_cost_usd)) : '—'}</Td>
              <Td>{r.sla_working_days ? `${r.sla_working_days}d` : '—'}</Td>
              <Td><Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge></Td>
              {onLogPayment && (
                <Td>
                  <button onClick={() => onLogPayment(r)} className="text-xs font-semibold text-brand-orange hover:underline">Pay</button>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTable({ rows }: { rows: Payment[] }) {
  const total = rows.reduce((sum, r) => sum + (parseFloat(r.amount_usd || '0') || 0), 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-600">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total logged</span>
        <span className="text-xl font-extrabold text-navy-500 dark:text-white">{fmtUsd(total)}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-navy-700">
        <table className="w-full text-sm">
          <thead className="bg-navy-500 text-white">
            <tr><Th>ID</Th><Th>Payee</Th><Th>Type</Th><Th>Fund</Th><Th>Amount</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.payment_id || i} className="border-b border-slate-100 last:border-0 dark:border-navy-700">
                <Td className="font-mono text-xs">{r.payment_id}</Td>
                <Td>{r.payee_name || '—'}</Td>
                <Td>{r.payee_type || '—'}</Td>
                <Td>{r.fund_code || '—'}</Td>
                <Td>{r.amount_usd ? fmtUsd(Number(r.amount_usd)) : '—'}</Td>
                <Td><Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConferencesTable({ rows }: { rows: ConferenceRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-navy-700">
      <table className="w-full text-sm">
        <thead className="bg-navy-500 text-white">
          <tr><Th>Conference</Th><Th>Decision</Th><Th>Signatory</Th><Th>Fit</Th><Th>Flight</Th><Th>Visa</Th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tracker_id || i} className="border-b border-slate-100 last:border-0 dark:border-navy-700">
              <Td>{r.conference_name || r.conference_id}</Td>
              <Td><Badge tone={statusTone(r.decision)}>{r.decision || '—'}</Badge></Td>
              <Td>{r.signatory_name || '—'}</Td>
              <Td>{r.fit_score || '—'}</Td>
              <Td>{r.flight_booked || '—'}</Td>
              <Td>{r.visa_status || '—'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocsTable({ rows }: { rows: Doc[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-navy-700">
      <table className="w-full text-sm">
        <thead className="bg-navy-500 text-white">
          <tr><Th>ID</Th><Th>Type</Th><Th>Signed</Th><Th>Signatory</Th><Th>Status</Th><Th>Drive</Th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.agreement_id || i} className="border-b border-slate-100 last:border-0 dark:border-navy-700">
              <Td className="font-mono text-xs">{r.agreement_id}</Td>
              <Td>{r.agreement_type || '—'}</Td>
              <Td>{r.signed_date || '—'}</Td>
              <Td>{r.signatory_name || '—'}</Td>
              <Td><Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge></Td>
              <Td>
                {r.drive_url ? (
                  <a href={r.drive_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-teal">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : '—'}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------- Table + Form helpers --------

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 text-navy-500 dark:text-slate-100 ${className}`}>{children}</td>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

function QuickActionsBar({
  masterKey,
  onOpen,
}: {
  masterKey: string;
  onOpen: (kind: 'intervention' | 'pr' | 'payment' | 'agreement', prefill?: Record<string, string>) => void;
}) {
  const disabled = !masterKey;
  const items: { kind: 'intervention' | 'pr' | 'payment' | 'agreement'; label: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
    { kind: 'intervention', label: 'Assign Intervention', icon: LayoutDashboard, tone: 'bg-brand-teal/10 text-brand-teal hover:bg-brand-teal/20' },
    { kind: 'pr', label: 'New PR', icon: ClipboardList, tone: 'bg-brand-red/10 text-brand-red hover:bg-brand-red/20' },
    { kind: 'payment', label: 'Log Payment', icon: Wallet, tone: 'bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/20' },
    { kind: 'agreement', label: 'New Agreement', icon: FileText, tone: 'bg-slate-100 text-navy-500 hover:bg-slate-200 dark:bg-navy-700 dark:text-white' },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-600">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Quick actions</span>
        {items.map(it => {
          const Icon = it.icon;
          return (
            <button
              key={it.kind}
              onClick={() => !disabled && onOpen(it.kind)}
              disabled={disabled}
              title={disabled ? 'Save the company profile first to enable quick actions' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${disabled ? 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-navy-700 dark:text-slate-500' : it.tone}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {it.label}
            </button>
          );
        })}
        {disabled && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Save this applicant to Master first to unlock cross-module actions.
          </span>
        )}
      </div>
    </div>
  );
}

function pickQuarter(targetDate?: string): 'q1' | 'q2' | 'q3' | 'q4' {
  const d = targetDate ? new Date(targetDate) : new Date();
  const m = d.getMonth(); // 0-11
  if (m <= 2) return 'q1';
  if (m <= 5) return 'q2';
  if (m <= 8) return 'q3';
  return 'q4';
}

function AssignInterventionDrawer({
  open,
  onClose,
  companyId,
  companyName,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  onCreate: (row: Record<string, string>) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Record<string, string>>({
    company_id: companyId,
    intervention_type: '',
    sub_intervention: '',
    fund_code: '',
    owner_email: '',
    status: 'Planned',
    start_date: today,
    end_date: '',
    budget_usd: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(d => ({ ...d, company_id: companyId }));
  }, [companyId, open]);

  const pms = getProfileManagers();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Assign Intervention · ${companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!draft.intervention_type) return;
              setSaving(true);
              try { await onCreate(draft); } finally { setSaving(false); }
            }}
            disabled={saving || !draft.intervention_type}
          >
            {saving ? 'Assigning…' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Intervention Type">
          <select className={qaInputClass} value={draft.intervention_type} onChange={e => setDraft({ ...draft, intervention_type: e.target.value })}>
            <option value="">—</option>
            {INTERVENTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Sub-intervention">
          <input className={qaInputClass} value={draft.sub_intervention} onChange={e => setDraft({ ...draft, sub_intervention: e.target.value })} placeholder="e.g. Local Advisor, Upwork Track" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fund Code">
            <select className={qaInputClass} value={draft.fund_code} onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Budget USD">
            <input className={qaInputClass} value={draft.budget_usd} onChange={e => setDraft({ ...draft, budget_usd: e.target.value })} placeholder="1650" />
          </Field>
        </div>
        <Field label="Owner (Profile Manager)">
          <select className={qaInputClass} value={draft.owner_email} onChange={e => setDraft({ ...draft, owner_email: e.target.value })}>
            <option value="">—</option>
            {pms.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <input type="date" className={qaInputClass} value={draft.start_date} onChange={e => setDraft({ ...draft, start_date: e.target.value })} />
          </Field>
          <Field label="End Date">
            <input type="date" className={qaInputClass} value={draft.end_date} onChange={e => setDraft({ ...draft, end_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Status">
          <select className={qaInputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
            {ASSIGNMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <textarea rows={2} className={qaInputClass} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function QuickPRDrawer({
  open,
  onClose,
  companyId,
  companyName,
  prefill,
  requester,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  prefill: Record<string, string>;
  requester: string;
  onCreate: (quarter: 'q1' | 'q2' | 'q3' | 'q4', row: Record<string, string>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({
    pr_id: '',
    activity: '',
    intervention_type: '',
    company_id: companyId,
    fund_code: '',
    item_description: '',
    unit: '',
    qty: '1',
    unit_cost_usd: '',
    target_award_date: '',
    local_international: 'Local',
    requester_email: requester,
    status: 'Draft',
    procurement_contact: 'Donia Shadeed',
    notes: '',
    ...prefill,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(d => ({ ...d, company_id: companyId, requester_email: requester, ...prefill }));
  }, [open, companyId, requester, prefill]);

  const derived = useMemo(() => derivePRFields({
    qty: draft.qty, unit_cost_usd: draft.unit_cost_usd, target_award_date: draft.target_award_date,
  }), [draft.qty, draft.unit_cost_usd, draft.target_award_date]);

  const quarter = pickQuarter(draft.target_award_date);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`New PR · ${companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!draft.pr_id || !draft.activity) return;
              setSaving(true);
              try { await onCreate(quarter, { ...draft, ...derived }); } finally { setSaving(false); }
            }}
            disabled={saving || !draft.pr_id || !draft.activity}
          >
            {saving ? 'Creating…' : 'Create PR'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="PR ID">
          <input className={qaInputClass} value={draft.pr_id} onChange={e => setDraft({ ...draft, pr_id: e.target.value })} placeholder="PR-E3-001" />
        </Field>
        <Field label="Activity">
          <input className={qaInputClass} value={draft.activity} onChange={e => setDraft({ ...draft, activity: e.target.value })} />
        </Field>
        <Field label="Item Description">
          <textarea rows={2} className={qaInputClass} value={draft.item_description} onChange={e => setDraft({ ...draft, item_description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Intervention Type">
            <select className={qaInputClass} value={draft.intervention_type} onChange={e => setDraft({ ...draft, intervention_type: e.target.value })}>
              <option value="">—</option>
              {INTERVENTION_TYPES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Fund Code">
            <select className={qaInputClass} value={draft.fund_code} onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Qty">
            <input className={qaInputClass} value={draft.qty} onChange={e => setDraft({ ...draft, qty: e.target.value })} />
          </Field>
          <Field label="Unit Cost USD">
            <input className={qaInputClass} value={draft.unit_cost_usd} onChange={e => setDraft({ ...draft, unit_cost_usd: e.target.value })} />
          </Field>
          <Field label="Target Award">
            <input type="date" className={qaInputClass} value={draft.target_award_date} onChange={e => setDraft({ ...draft, target_award_date: e.target.value })} />
          </Field>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-navy-700 dark:bg-navy-700">
          <div className="mb-2 font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Auto-computed · Goes to <b>{quarter.toUpperCase()}</b>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>Total: <b>{derived.total_cost_usd ? `$${Number(derived.total_cost_usd).toLocaleString()}` : '—'}</b></div>
            <div>Threshold: <Badge tone={derived.threshold_class === 'Micro' ? 'teal' : derived.threshold_class === 'Small' ? 'green' : derived.threshold_class === 'Standard' ? 'amber' : 'red'}>{derived.threshold_class || '—'}</Badge></div>
            <div>SLA: <b>{derived.sla_working_days ? `${derived.sla_working_days} workdays` : '—'}</b></div>
            <div>Deadline: <b>{derived.pr_deadline || '—'}</b></div>
          </div>
        </div>
        <Field label="Status">
          <select className={qaInputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
            {PR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
    </Drawer>
  );
}

function LogPaymentDrawer({
  open,
  onClose,
  companyId,
  companyName,
  prefill,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  prefill: Record<string, string>;
  onCreate: (row: Record<string, string>) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Record<string, string>>({
    payment_id: '',
    pr_id: '',
    company_id: companyId,
    assignment_id: '',
    payee_type: 'Vendor',
    payee_name: '',
    intervention_type: '',
    fund_code: '',
    amount_usd: '',
    currency: 'USD',
    payment_date: today,
    status: 'Pending Approval',
    finance_contact: 'Khamis Eweis',
    invoice_url: '',
    receipt_url: '',
    notes: '',
    ...prefill,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(d => ({ ...d, company_id: companyId, ...prefill }));
  }, [open, companyId, prefill]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Log Payment · ${companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!draft.payment_id || !draft.payee_name || !draft.amount_usd) return;
              setSaving(true);
              try { await onCreate(draft); } finally { setSaving(false); }
            }}
            disabled={saving || !draft.payment_id || !draft.payee_name || !draft.amount_usd}
          >
            {saving ? 'Logging…' : 'Log Payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Payment ID">
          <input className={qaInputClass} value={draft.payment_id} onChange={e => setDraft({ ...draft, payment_id: e.target.value })} placeholder="PMT-E3-001" />
        </Field>
        <Field label="Payee Name">
          <input className={qaInputClass} value={draft.payee_name} onChange={e => setDraft({ ...draft, payee_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payee Type">
            <select className={qaInputClass} value={draft.payee_type} onChange={e => setDraft({ ...draft, payee_type: e.target.value })}>
              {PAYEE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Amount USD">
            <input className={qaInputClass} value={draft.amount_usd} onChange={e => setDraft({ ...draft, amount_usd: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PR ID (link)">
            <input className={qaInputClass} value={draft.pr_id} onChange={e => setDraft({ ...draft, pr_id: e.target.value })} />
          </Field>
          <Field label="Assignment ID (link)">
            <input className={qaInputClass} value={draft.assignment_id} onChange={e => setDraft({ ...draft, assignment_id: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Intervention">
            <select className={qaInputClass} value={draft.intervention_type} onChange={e => setDraft({ ...draft, intervention_type: e.target.value })}>
              <option value="">—</option>
              {INTERVENTION_TYPES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Fund Code">
            <select className={qaInputClass} value={draft.fund_code} onChange={e => setDraft({ ...draft, fund_code: e.target.value })}>
              <option value="">—</option>
              {FUND_CODES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment Date">
            <input type="date" className={qaInputClass} value={draft.payment_date} onChange={e => setDraft({ ...draft, payment_date: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className={qaInputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Invoice URL">
          <input className={qaInputClass} value={draft.invoice_url} onChange={e => setDraft({ ...draft, invoice_url: e.target.value })} placeholder="https://drive.google.com/…" />
        </Field>
        <Field label="Notes">
          <textarea rows={2} className={qaInputClass} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function NewAgreementDrawer({
  open,
  onClose,
  companyId,
  companyName,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  onCreate: (row: Record<string, string>) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<Record<string, string>>({
    agreement_id: '',
    company_id: companyId,
    agreement_type: 'MJPSA',
    signed_date: '',
    signatory_name: '',
    signatory_title: '',
    gsg_signatory: '',
    drive_url: '',
    status: 'Drafted',
    related_intervention: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(d => ({ ...d, company_id: companyId }));
  }, [companyId, open]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`New Agreement · ${companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!draft.agreement_id || !draft.agreement_type) return;
              setSaving(true);
              try { await onCreate(draft); } finally { setSaving(false); }
            }}
            disabled={saving || !draft.agreement_id || !draft.agreement_type}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Agreement ID">
          <input className={qaInputClass} value={draft.agreement_id} onChange={e => setDraft({ ...draft, agreement_id: e.target.value })} placeholder="AGR-E3-001" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agreement Type">
            <select className={qaInputClass} value={draft.agreement_type} onChange={e => setDraft({ ...draft, agreement_type: e.target.value })}>
              {AGREEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={qaInputClass} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
              {AGREEMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Signatory Name">
            <input className={qaInputClass} value={draft.signatory_name} onChange={e => setDraft({ ...draft, signatory_name: e.target.value })} />
          </Field>
          <Field label="Signatory Title">
            <input className={qaInputClass} value={draft.signatory_title} onChange={e => setDraft({ ...draft, signatory_title: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Signed Date">
            <input type="date" className={qaInputClass} value={draft.signed_date || today} onChange={e => setDraft({ ...draft, signed_date: e.target.value })} />
          </Field>
          <Field label="GSG Signatory">
            <input className={qaInputClass} value={draft.gsg_signatory} onChange={e => setDraft({ ...draft, gsg_signatory: e.target.value })} />
          </Field>
        </div>
        <Field label="Drive URL">
          <input className={qaInputClass} value={draft.drive_url} onChange={e => setDraft({ ...draft, drive_url: e.target.value })} placeholder="https://drive.google.com/…" />
        </Field>
        <Field label="Notes">
          <textarea rows={2} className={qaInputClass} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}
