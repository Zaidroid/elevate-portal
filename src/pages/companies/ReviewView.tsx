// ReviewView — the team's step-through workflow.
// Layout: 2-pane. Left = tabbed evaluation timeline (At a glance / Application
// / Scoring & Needs / Doc Review / Interview / Committee / Team thread).
// Right = sticky decision form with PM picker, mini stats, Recommend / Hold /
// Reject, pillar picker (each pillar shows whether the company REQUESTED it
// in their application and whether the TEAM RECOMMENDED it during selection),
// notes, Save & Next, and an admin-only Finalize panel that locks status +
// materializes interventions into the Intervention Assignments tab.

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Building2, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardCheck, ExternalLink, FileText, Lock, MapPin, MessageCircle,
  PauseCircle, Save, SkipForward, ThumbsDown, ThumbsUp, UserCheck, Users, Vote, Zap,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { displayName } from '../../config/team';
import { PILLARS, pillarFor } from '../../config/interventions';
import type { Review, CompanyComment, ReviewDecision } from './reviewTypes';
import { REVIEW_DECISIONS, summarizeReviews } from './reviewTypes';
import { bucketize, humanizeKey, meaningfulEntries } from './selectionContext';
import type { RawRow } from './selectionContext';

export type SelectionContext = {
  scoring: RawRow | null;
  docReview: RawRow | null;
  needs: RawRow | null;
  interviewAssessment: RawRow | null;
  interviewDiscussion: RawRow | null;
  committeeVotes: RawRow | null;
  selectionVotes: RawRow | null;
};

export type ReviewableCompany = {
  route_id: string;
  applicant_id: string;
  company_id: string;
  company_name: string;
  sector: string;
  city: string;
  governorate: string;
  employee_count: string;
  readiness_score: string;
  fund_code: string;
  status: string;
  profile_manager_email: string;
  contact_email: string;
  applicantRaw: Record<string, string> | null;
  masterRaw: Record<string, string> | null;
  selection: SelectionContext;
};

export type FinalizeArgs = {
  companyId: string;
  pmEmail?: string;
  status: string;
  interventions: Array<{ pillar: string; sub: string }>;
};

const DECISION_TONE: Record<ReviewDecision, Tone> = {
  Recommend: 'green',
  Hold: 'amber',
  Reject: 'red',
};

const DECISION_ICON: Record<ReviewDecision, React.ReactNode> = {
  Recommend: <ThumbsUp className="h-3.5 w-3.5" />,
  Hold: <PauseCircle className="h-3.5 w-3.5" />,
  Reject: <ThumbsDown className="h-3.5 w-3.5" />,
};

const SCORING_BUCKETS = [
  { label: 'Score & Class', pattern: /score|class|rank|tier|grade|weight/i },
  { label: 'Notes', pattern: /note|comment|reason|justification/i },
];
const DOC_REVIEW_BUCKETS = [
  { label: 'Status', pattern: /status|complete|missing|pending/i },
  { label: 'Findings', pattern: /finding|red.flag|risk|concern|issue|gap/i },
  { label: 'Notes', pattern: /note|comment|summary|reason/i },
];
const INTERVIEW_BUCKETS = [
  { label: 'Rating / Score', pattern: /rating|score|grade|recommend/i },
  { label: 'Strengths', pattern: /strength|positive|asset|strong/i },
  { label: 'Concerns', pattern: /concern|weakness|risk|red.flag|negative/i },
  { label: 'Notes', pattern: /note|comment|summary|highlight|takeaway|observation|key/i },
];
const COMMITTEE_BUCKETS = [
  { label: 'Vote', pattern: /vote|decision|recommend|outcome|verdict/i },
  { label: 'Reasoning', pattern: /reason|justif|rationale|notes|why/i },
];
const NEEDS_BUCKETS = [
  { label: 'Recommended interventions', pattern: /intervention|pillar|need|require|recommend/i },
  { label: 'Priority', pattern: /priority|urgent|critical/i },
  { label: 'Notes', pattern: /note|comment|reason|summary/i },
];

const APPLICATION_KEY_FIELDS: Array<[string, string[]]> = [
  ['About', ['businessDescription', 'whatTheyDo', 'productOrService', 'description', 'about']],
  ['Why Elevate', ['whyElevate', 'goals', 'reasonForApplying', 'why']],
  ['Pain points', ['mainPainPoint', 'challenges', 'mainChallenge', 'problems', 'pain']],
  ['Hiring spec', ['rolesNeeded', 'hiring', 'trainToHireCount']],
  ['Founders / Team', ['founderName', 'founderEmail', 'leadership', 'foundingTeam', 'founders']],
  ['Markets', ['markets', 'targetMarkets', 'currentMarkets', 'currentMarket']],
  ['Revenue', ['annualRevenue', 'revenueBracket', 'revenue', 'arr']],
];

type EvalTab = 'glance' | 'application' | 'scoring' | 'docReview' | 'interview' | 'committee' | 'team';

// Maps application 'wantsXXX' fields → pillar codes. Drives the "Requested"
// badge on each pillar in the picker so the reviewer sees what the company
// asked for in their original application.
const WANTS_TO_PILLAR: Array<[string, string]> = [
  ['wantsTrainToHire', 'TTH'],
  ['wantsUpskilling', 'Upskilling'],
  ['wantsMarketingSupport', 'MKG'],
  ['wantsLegalSupport', 'MA'],
  ['wantsDomainCoaching', 'C-Suite'],
  ['wantsConferences', 'Conferences'],
  ['wantsElevateBridge', 'ElevateBridge'],
];

function asBool(v?: string): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function getRequestedPillars(app: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [key, code] of WANTS_TO_PILLAR) {
    if (asBool(app[key])) out.add(code);
  }
  return out;
}

// Recommended pillars derive from (a) the comma-separated assessedInterventions
// field on Interview Assessment and (b) the Company Needs flags (Domain
// Coaching = Yes, Elevate Bridge = Yes, etc.) that the selection-tool sets.
function getRecommendedPillars(sel: SelectionContext): Set<string> {
  const out = new Set<string>();
  const assessed = sel.interviewAssessment?.assessedInterventions || sel.interviewAssessment?.['Assessed Interventions'] || '';
  if (assessed) {
    for (const t of assessed.split(',')) {
      const code = t.trim();
      const p = pillarFor(code)?.code;
      if (p) out.add(p);
    }
  }
  const n = sel.needs;
  if (n) {
    if (asBool(n['Train To Hire']) || asBool(n['Train-to-Hire']) || asBool(n['TTH'])) out.add('TTH');
    if (asBool(n['Upskilling']) || (n['Upskilling'] && n['Upskilling'] !== 'No' && n['Upskilling'] !== '0')) out.add('Upskilling');
    if (n['Marketing Maturity'] || n['Marketing']) out.add('MKG');
    if (n['Legal Tier'] || n['Legal Urgency'] || n['Legal']) out.add('MA');
    if (asBool(n['Domain Coaching']) || n['Primary Domain']) out.add('C-Suite');
    if (asBool(n['Elevate Bridge']) || asBool(n['ElevateBridge'])) out.add('ElevateBridge');
    if (asBool(n['Conferences'])) out.add('Conferences');
  }
  return out;
}

export function ReviewView({
  companies,
  reviews,
  comments,
  reviewerEmail,
  isAdmin,
  profileManagers,
  onSaveReview,
  onAddComment,
  onAssignPM,
  onFinalize,
  onJumpToCompany,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  comments: CompanyComment[];
  reviewerEmail: string;
  isAdmin: boolean;
  profileManagers: Array<{ email: string; name: string }>;
  onSaveReview: (r: Review) => Promise<void>;
  onAddComment: (c: CompanyComment) => Promise<void>;
  onAssignPM: (companyId: string, pmEmail: string) => Promise<void>;
  onFinalize: (args: FinalizeArgs) => Promise<void>;
  onJumpToCompany?: (route_id: string) => void;
}) {
  const toast = useToast();
  const [cursor, setCursor] = useState(0);
  const [evalTab, setEvalTab] = useState<EvalTab>('glance');

  const summaryByCompany = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeReviews>>();
    for (const c of companies) {
      const own = reviews.filter(r => r.company_id === c.company_id);
      map.set(c.company_id, summarizeReviews(own));
    }
    return map;
  }, [companies, reviews]);

  const reviewedCount = useMemo(
    () => companies.filter(c => (summaryByCompany.get(c.company_id)?.total || 0) > 0).length,
    [companies, summaryByCompany]
  );
  const myReviewedCount = useMemo(() => {
    const lower = reviewerEmail.toLowerCase();
    let n = 0;
    for (const c of companies) {
      if (reviews.some(r => r.company_id === c.company_id && r.reviewer_email.toLowerCase() === lower && r.decision)) n += 1;
    }
    return n;
  }, [companies, reviews, reviewerEmail]);

  const company = companies[cursor];
  const myExistingReview = useMemo(() => {
    if (!company) return null;
    const lower = reviewerEmail.toLowerCase();
    return reviews.find(r => r.company_id === company.company_id && r.reviewer_email.toLowerCase() === lower) || null;
  }, [company, reviews, reviewerEmail]);

  const [decision, setDecision] = useState<ReviewDecision | ''>('');
  const [pillars, setPillars] = useState<Set<string>>(new Set());
  const [subInterventions, setSubInterventions] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [pmDraft, setPmDraft] = useState('');
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    if (myExistingReview) {
      setDecision((myExistingReview.decision || '') as ReviewDecision | '');
      setPillars(new Set(splitCsv(myExistingReview.proposed_pillars)));
      setSubInterventions(new Set(splitCsv(myExistingReview.proposed_sub_interventions)));
      setNotes(myExistingReview.notes || '');
    } else {
      setDecision('');
      setPillars(new Set());
      setSubInterventions(new Set());
      setNotes('');
    }
    setCommentDraft('');
    setEvalTab('glance');
    setPmDraft(company?.profile_manager_email || '');
    setShowFinalize(false);
  }, [myExistingReview, company?.company_id, company?.profile_manager_email]);

  // These hooks must be called unconditionally on every render — never move
  // them below an early return. The functions tolerate empty inputs.
  const requestedPillars = useMemo(
    () => getRequestedPillars(company?.applicantRaw || {}),
    [company?.applicantRaw]
  );
  const recommendedPillars = useMemo(
    () => getRecommendedPillars(company?.selection || {
      scoring: null, docReview: null, needs: null, interviewAssessment: null,
      interviewDiscussion: null, committeeVotes: null, selectionVotes: null,
    }),
    [company?.selection]
  );

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState icon={<MessageCircle className="h-8 w-8" />} title="No companies in scope to review" description="Adjust filters or flip 'Include pre-interview'." />
      </Card>
    );
  }
  if (!company) {
    return (
      <Card>
        <EmptyState icon={<MessageCircle className="h-8 w-8" />} title="End of the queue" description="You've stepped through every company in scope." />
      </Card>
    );
  }

  const togglePillar = (code: string) => {
    setPillars(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
        const dead = new Set(PILLARS.find(p => p.code === code)?.subInterventions || []);
        if (dead.size > 0) {
          setSubInterventions(prevSubs => {
            const ns = new Set(prevSubs);
            for (const s of dead) ns.delete(s);
            return ns;
          });
        }
      } else {
        next.add(code);
      }
      return next;
    });
  };
  const toggleSub = (code: string) => {
    setSubInterventions(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    const parent = pillarFor(code);
    if (parent) setPillars(prev => { const next = new Set(prev); next.add(parent.code); return next; });
  };

  const goPrev = () => setCursor(c => Math.max(0, c - 1));
  const goNext = () => setCursor(c => Math.min(companies.length - 1, c + 1));

  const handleSave = async (advance: boolean) => {
    if (!decision) {
      toast.error('Pick a decision', 'Recommend, Hold, or Reject before saving.');
      return;
    }
    setSavingReview(true);
    const now = new Date().toISOString();
    try {
      await onSaveReview({
        review_id: myExistingReview?.review_id || `rev-${company.company_id}-${reviewerEmail}-${now}`,
        company_id: company.company_id,
        reviewer_email: reviewerEmail,
        decision,
        proposed_pillars: Array.from(pillars).join(','),
        proposed_sub_interventions: Array.from(subInterventions).join(','),
        notes,
        created_at: myExistingReview?.created_at || now,
        updated_at: now,
      });
      toast.success(`Review saved`, `${decision} for ${company.company_name}.`);
      if (advance) goNext();
    } catch (e) {
      toast.error('Save failed', (e as Error).message);
    } finally {
      setSavingReview(false);
    }
  };

  const handlePostComment = async () => {
    const body = commentDraft.trim();
    if (!body) return;
    setPostingComment(true);
    const now = new Date().toISOString();
    try {
      await onAddComment({
        comment_id: `cmt-${company.company_id}-${reviewerEmail}-${now}`,
        company_id: company.company_id,
        author_email: reviewerEmail,
        body,
        created_at: now,
        updated_at: now,
      });
      setCommentDraft('');
    } catch (e) {
      toast.error('Comment failed', (e as Error).message);
    } finally {
      setPostingComment(false);
    }
  };

  const handleAssignPM = async () => {
    try {
      await onAssignPM(company.company_id, pmDraft);
      toast.success('PM assigned', pmDraft ? `${displayName(pmDraft)} now owns ${company.company_name}.` : 'Profile Manager cleared.');
    } catch (e) {
      toast.error('Assign failed', (e as Error).message);
    }
  };

  const handleFinalize = async (status: string) => {
    if (!isAdmin) return;
    setFinalizing(true);
    try {
      const interventions: Array<{ pillar: string; sub: string }> = [];
      // Use this reviewer's selections, or fall back to consensus.
      const pickedPillars = pillars.size > 0 ? Array.from(pillars) : computeConsensusPillars(companyReviews);
      const pickedSubs = subInterventions.size > 0 ? Array.from(subInterventions) : computeConsensusSubs(companyReviews);
      for (const p of pickedPillars) {
        const subsForP = pickedSubs.filter(s => pillarFor(s)?.code === p);
        if (subsForP.length === 0) interventions.push({ pillar: p, sub: '' });
        else for (const s of subsForP) interventions.push({ pillar: p, sub: s });
      }
      await onFinalize({
        companyId: company.company_id,
        pmEmail: pmDraft || undefined,
        status,
        interventions,
      });
      toast.success(`${status}`, `${company.company_name} locked in${interventions.length ? ` with ${interventions.length} intervention${interventions.length === 1 ? '' : 's'}` : ''}.`);
    } catch (e) {
      toast.error('Finalize failed', (e as Error).message);
    } finally {
      setFinalizing(false);
    }
  };

  const companyReviews = reviews.filter(r => r.company_id === company.company_id);
  const companyComments = comments
    .filter(c => c.company_id === company.company_id)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const summary = summaryByCompany.get(company.company_id);
  const progressPct = Math.round((reviewedCount / Math.max(1, companies.length)) * 100);

  const application = company.applicantRaw || {};
  const sel = company.selection;

  const has = {
    scoring: !!sel.scoring,
    docReview: !!sel.docReview,
    needs: !!sel.needs,
    interview: !!(sel.interviewAssessment || sel.interviewDiscussion),
    committee: !!(sel.committeeVotes || sel.selectionVotes),
  };

  const evalTabs: Array<{ id: EvalTab; label: string; icon: React.ReactNode; available: boolean; count?: number }> = [
    { id: 'glance', label: 'Glance', icon: <Zap className="h-3.5 w-3.5" />, available: true },
    { id: 'application', label: 'Application', icon: <FileText className="h-3.5 w-3.5" />, available: Object.keys(application).length > 0 },
    { id: 'scoring', label: 'Scoring & Needs', icon: <Activity className="h-3.5 w-3.5" />, available: has.scoring || has.needs },
    { id: 'docReview', label: 'Doc Review', icon: <ClipboardCheck className="h-3.5 w-3.5" />, available: has.docReview },
    { id: 'interview', label: 'Interview', icon: <BookOpen className="h-3.5 w-3.5" />, available: has.interview },
    { id: 'committee', label: 'Committee', icon: <Vote className="h-3.5 w-3.5" />, available: has.committee },
    { id: 'team', label: 'Team thread', icon: <Users className="h-3.5 w-3.5" />, available: true, count: companyReviews.length + companyComments.length },
  ];

  return (
    <div className="space-y-3">
      {/* Sticky progress + nav strip */}
      <div className="sticky top-0 z-30 -mx-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-navy-700 dark:bg-navy-900/95">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={cursor === 0}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <span className="rounded bg-brand-teal/10 px-2 py-1 text-xs font-bold text-brand-teal">
              {cursor + 1}/{companies.length}
            </span>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={cursor === companies.length - 1}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
              <span>{reviewedCount}/{companies.length} reviewed</span>
              <span className="text-slate-500">{progressPct}% · you: {myReviewedCount}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
              <div className="h-full bg-gradient-to-r from-brand-teal to-emerald-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <select
            value={cursor}
            onChange={e => setCursor(Number(e.currentTarget.value))}
            className="min-w-[180px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            {companies.map((c, i) => {
              const s = summaryByCompany.get(c.company_id);
              const tag = s && s.total > 0 ? ` · ${s.consensus}` : '';
              return <option key={c.company_id} value={i}>{i + 1}. {c.company_name}{tag}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Hero */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold leading-tight text-navy-500 dark:text-white">
                {company.company_name || 'Unnamed company'}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                {company.sector && <span>{company.sector}</span>}
                {(company.city || company.governorate) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {[company.city, company.governorate].filter(Boolean).join(', ')}
                  </span>
                )}
                {company.employee_count && <span>{company.employee_count} emp</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="teal">{company.status || 'Interviewed'}</Badge>
            {company.fund_code && (
              <Badge tone={company.fund_code === '97060' ? 'teal' : 'amber'}>
                {company.fund_code === '97060' ? 'Dutch' : 'SIDA'}
              </Badge>
            )}
            {summary && summary.total > 0 && (
              <Badge tone={summary.consensus === 'Mixed' ? 'amber' : DECISION_TONE[summary.consensus as ReviewDecision]}>
                {summary.total}× {summary.consensus}
              </Badge>
            )}
            {onJumpToCompany && (
              <Button variant="ghost" size="sm" onClick={() => onJumpToCompany(company.route_id)}>
                <ExternalLink className="h-3.5 w-3.5" /> Detail
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Two-pane */}
      <div className="grid gap-3 lg:grid-cols-12">
        {/* LEFT — Evaluation timeline */}
        <div className="space-y-3 lg:col-span-8">
          {/* Eval tab strip */}
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-navy-700 dark:bg-navy-900">
            {evalTabs.map(t => {
              const active = evalTab === t.id;
              const dim = !t.available && !active;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEvalTab(t.id)}
                  disabled={!t.available && !active}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${
                    active ? 'bg-brand-teal text-white' :
                    dim ? 'text-slate-400 dark:text-slate-500' :
                    'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700'
                  }`}
                >
                  {t.icon} {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-slate-200 dark:bg-navy-700'}`}>
                      {t.count}
                    </span>
                  )}
                  {!t.available && !active && <span className="text-[9px] opacity-60">(none)</span>}
                </button>
              );
            })}
          </div>

          {evalTab === 'glance' && (
            <GlanceTab
              company={company}
              application={application}
              sel={sel}
              summary={summary}
              requestedPillars={requestedPillars}
              recommendedPillars={recommendedPillars}
            />
          )}
          {evalTab === 'application' && <ApplicationTab application={application} />}
          {evalTab === 'scoring' && <ScoringTab sel={sel} />}
          {evalTab === 'docReview' && (
            <Card>
              {sel.docReview ? <BucketedFields entries={meaningfulEntries(sel.docReview)} buckets={DOC_REVIEW_BUCKETS} />
                : <EmptyHint icon={<ClipboardCheck className="h-5 w-5" />} text="No doc review on file." />}
            </Card>
          )}
          {evalTab === 'interview' && <InterviewTab sel={sel} />}
          {evalTab === 'committee' && <CommitteeTab sel={sel} />}
          {evalTab === 'team' && (
            <TeamThreadTab
              companyReviews={companyReviews}
              companyComments={companyComments}
              commentDraft={commentDraft}
              setCommentDraft={setCommentDraft}
              onPostComment={handlePostComment}
              postingComment={postingComment}
            />
          )}
        </div>

        {/* RIGHT — Sticky decision form */}
        <div className="lg:col-span-4">
          <div className="space-y-3 lg:sticky lg:top-[88px]">
            {/* PM picker */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-1 text-sm font-bold text-navy-500 dark:text-white">
                  <UserCheck className="h-3.5 w-3.5" /> Profile Manager
                </h3>
                {company.profile_manager_email && (
                  <span className="text-[11px] text-slate-500">current: {displayName(company.profile_manager_email)}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={pmDraft}
                  onChange={e => setPmDraft(e.currentTarget.value)}
                  className="flex-1 rounded-md border border-slate-200 bg-brand-editable/30 px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
                >
                  <option value="">Unassigned</option>
                  {profileManagers.map(pm => (
                    <option key={pm.email} value={pm.email}>{pm.name}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleAssignPM}
                  disabled={pmDraft === company.profile_manager_email}
                >
                  Assign
                </Button>
              </div>
            </div>

            {/* Mini stats */}
            <div className="grid grid-cols-3 gap-1.5">
              <MiniStat label="Score" value={pickValue(sel.scoring, /^(class|tier|grade)$/i) || pickValue(sel.scoring, /score|rating/i) || '—'} tone="teal" />
              <MiniStat label="Readiness" value={company.readiness_score || pickValue(sel.needs, /readiness/i) || '—'} tone="amber" />
              <MiniStat label="Reviews" value={summary && summary.total > 0 ? `${summary.total}` : '0'} tone={summary && summary.total > 0 ? (summary.consensus === 'Recommend' ? 'green' : summary.consensus === 'Reject' ? 'red' : 'amber') : 'neutral'} />
            </div>

            {/* Decision */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
              <h3 className="mb-2 text-sm font-bold text-navy-500 dark:text-white">Your decision</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {REVIEW_DECISIONS.map(d => {
                  const active = decision === d;
                  const tones = {
                    Recommend: { on: 'border-emerald-500 bg-emerald-500 text-white', off: 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:hover:bg-emerald-950' },
                    Hold: { on: 'border-amber-500 bg-amber-500 text-white', off: 'border-slate-200 hover:border-amber-400 hover:bg-amber-50 dark:border-navy-700 dark:hover:bg-amber-950' },
                    Reject: { on: 'border-red-500 bg-red-500 text-white', off: 'border-slate-200 hover:border-red-400 hover:bg-red-50 dark:border-navy-700 dark:hover:bg-red-950' },
                  };
                  const cls = active ? tones[d].on : `${tones[d].off} text-slate-700 dark:text-slate-200 bg-white dark:bg-navy-900`;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-2 py-2 text-xs font-bold transition-all ${cls}`}
                    >
                      {DECISION_ICON[d]} {d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pillars with Requested / Recommended badges */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-navy-500 dark:text-white">Interventions</h3>
                <div className="flex items-center gap-2 text-[10px] font-semibold">
                  <span className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Asked
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-purple-700 dark:text-purple-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500" /> Recommended
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                {PILLARS.map(p => {
                  const on = pillars.has(p.code);
                  const req = requestedPillars.has(p.code);
                  const rec = recommendedPillars.has(p.code);
                  return (
                    <div key={p.code} className={`rounded-lg border ${on ? 'border-brand-teal bg-brand-teal/5' : 'border-slate-200 dark:border-navy-700'}`}>
                      <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => togglePillar(p.code)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                        />
                        <span className="flex-1 text-xs font-bold text-navy-500 dark:text-slate-100">{p.label}</span>
                        <div className="flex items-center gap-1">
                          {req && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-200">ASKED</span>}
                          {rec && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-200">REC</span>}
                        </div>
                      </label>
                      {on && p.subInterventions.length > 0 && (
                        <div className="border-t border-brand-teal/20 px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {p.subInterventions.map(s => {
                              const subOn = subInterventions.has(s);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => toggleSub(s)}
                                  className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                                    subOn ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 hover:border-brand-teal hover:text-brand-teal dark:border-navy-700 dark:text-slate-300'
                                  }`}
                                >
                                  {s.replace(/^MA-/, '')}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
              <h3 className="mb-1.5 text-sm font-bold text-navy-500 dark:text-white">Your notes</h3>
              <textarea
                value={notes}
                onChange={e => setNotes(e.currentTarget.value)}
                rows={3}
                placeholder="Reasoning, concerns, why this pack…"
                className="w-full rounded-md border border-slate-200 bg-brand-editable/30 px-2 py-1.5 text-xs leading-relaxed focus:border-brand-teal focus:outline-none dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
              />
            </div>

            {/* Save bar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button onClick={() => handleSave(true)} disabled={savingReview || !decision}>
                <Save className="h-3.5 w-3.5" /> Save & Next
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleSave(false)} disabled={savingReview || !decision}>
                Save (stay)
              </Button>
              <Button variant="ghost" size="sm" onClick={goNext}>
                <SkipForward className="h-3.5 w-3.5" /> Skip
              </Button>
            </div>
            {myExistingReview && (
              <p className="text-[11px] text-slate-500">You reviewed this on {fmtDate(myExistingReview.updated_at)} — saving overwrites.</p>
            )}

            {/* Admin: Finalize */}
            {isAdmin && (
              <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                <button
                  type="button"
                  onClick={() => setShowFinalize(s => !s)}
                  className="flex w-full items-center justify-between"
                >
                  <h3 className="inline-flex items-center gap-1 text-sm font-bold text-amber-900 dark:text-amber-200">
                    <Lock className="h-3.5 w-3.5" /> Finalize (admin)
                  </h3>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{showFinalize ? '−' : '+'}</span>
                </button>
                {showFinalize && (
                  <div className="mt-2 space-y-2 text-xs text-amber-900 dark:text-amber-100">
                    <p className="leading-relaxed">
                      Locks the company status and creates Intervention Assignment rows from the picks below
                      (or from the team consensus if you haven't picked your own yet).
                    </p>
                    {summary && summary.total > 0 ? (
                      <div className="rounded bg-white p-2 dark:bg-navy-900">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Team consensus</span>
                        <div className="mt-0.5 text-sm font-bold text-navy-500 dark:text-white">
                          {summary.consensus} ({summary.recommend}/{summary.hold}/{summary.reject})
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] italic">No team reviews yet — finalize will use your current picks.</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => handleFinalize('Selected')} disabled={finalizing}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> → Selected
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleFinalize('Recommended')} disabled={finalizing}>
                        → Recommended
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleFinalize('Reviewing')} disabled={finalizing}>
                        → Reviewing
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────── Sub-tabs ────────

function GlanceTab({
  company,
  application,
  sel,
  summary,
  requestedPillars,
  recommendedPillars,
}: {
  company: ReviewableCompany;
  application: Record<string, string>;
  sel: SelectionContext;
  summary?: ReturnType<typeof summarizeReviews>;
  requestedPillars: Set<string>;
  recommendedPillars: Set<string>;
}) {
  const presentInApp = (keys: string[]) => keys.find(k => application[k] && application[k].trim());
  const aboutKey = presentInApp(APPLICATION_KEY_FIELDS[0][1]);
  const whyKey = presentInApp(APPLICATION_KEY_FIELDS[1][1]);
  const painKey = presentInApp(APPLICATION_KEY_FIELDS[2][1]);

  return (
    <div className="space-y-3">
      {/* Snapshot tiles — fall back to application data so something always shows */}
      <Card>
        <SectionHeader title="Snapshot" subtitle="Pulled from selection-tool + application" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <BigStat label="Score" value={pickValue(sel.scoring, /^(class|tier|grade)$/i) || '—'} hint={pickValue(sel.scoring, /total.*score|^score$|weighted/i)} tone="teal" />
          <BigStat label="Readiness" value={company.readiness_score || pickValue(sel.needs, /readiness/i) || '—'} hint={pickValue(sel.needs, /total.*intervention|count/i)} tone="amber" />
          <BigStat label="Interview" value={pickValue(sel.interviewAssessment, /rating|score|grade|recommend/i) || '—'} hint={pickValue(sel.interviewAssessment, /interviewer|by/i)} tone="teal" />
          <BigStat label="Committee" value={pickValue(sel.committeeVotes, /vote|decision|recommend|outcome/i) || '—'} hint={pickValue(sel.committeeVotes, /reason|note/i)} tone="orange" />
          <BigStat label="Reviews" value={summary && summary.total > 0 ? `${summary.total}` : '0'} hint={summary && summary.total > 0 ? `${summary.recommend} rec · ${summary.hold} hold · ${summary.reject} rej` : 'No team reviews yet'} tone={summary && summary.consensus === 'Recommend' ? 'green' : summary && summary.consensus === 'Reject' ? 'red' : 'amber'} />
          <BigStat label="Sector" value={company.sector || '—'} hint={[company.city, company.governorate].filter(Boolean).join(', ')} tone="navy" />
          <BigStat label="Employees" value={company.employee_count || '—'} hint={pickValue(application, /^(annualRevenue|revenue|revenueBracket|arr)$/i)} tone="navy" />
          <BigStat label="PM" value={company.profile_manager_email ? displayName(company.profile_manager_email).split(' ')[0] : '—'} hint={company.profile_manager_email || 'Unassigned'} tone="navy" />
        </div>
      </Card>

      {/* Requested vs Recommended interventions */}
      <Card>
        <SectionHeader title="Interventions: requested vs recommended" subtitle="What they asked for in the application vs what the team recommended during selection" />
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-navy-800">
              <tr>
                <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Pillar</th>
                <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">Asked for</th>
                <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">Team recommended</th>
              </tr>
            </thead>
            <tbody>
              {PILLARS.map(p => {
                const req = requestedPillars.has(p.code);
                const rec = recommendedPillars.has(p.code);
                return (
                  <tr key={p.code} className="border-t border-slate-100 dark:border-navy-800">
                    <td className="px-2 py-1.5 font-bold text-navy-500 dark:text-slate-100">{p.label}</td>
                    <td className="px-2 py-1.5 text-center">{req ? <CheckCircle2 className="inline h-3.5 w-3.5 text-blue-600" /> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5 text-center">{rec ? <CheckCircle2 className="inline h-3.5 w-3.5 text-purple-600" /> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(aboutKey || whyKey || painKey) && (
        <Card>
          <SectionHeader title="In their own words" subtitle="From their application" />
          <div className="space-y-3">
            {aboutKey && <NarrativeBlock title="About" body={application[aboutKey]} icon={<Building2 className="h-3.5 w-3.5" />} />}
            {whyKey && <NarrativeBlock title="Why Elevate" body={application[whyKey]} icon={<Zap className="h-3.5 w-3.5" />} />}
            {painKey && <NarrativeBlock title="Pain points" body={application[painKey]} icon={<AlertTriangle className="h-3.5 w-3.5" />} />}
          </div>
        </Card>
      )}

      {(sel.interviewAssessment || sel.interviewDiscussion) && (
        <Card>
          <SectionHeader title="From the interview" subtitle="See 'Interview' tab for full breakdown" />
          {sel.interviewAssessment && (
            <div className="mb-2">
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Assessment</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {pickValue(sel.interviewAssessment, /note|comment|summary|highlight|takeaway|observation/i) || pickValue(sel.interviewAssessment, /assessed|recommend/i) || '—'}
              </p>
            </div>
          )}
          {sel.interviewDiscussion && (
            <div>
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Team discussion</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {pickValue(sel.interviewDiscussion, /discussion|note|summary|comment/i) || '—'}
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ApplicationTab({ application }: { application: Record<string, string> }) {
  const presentInApp = (keys: string[]) => keys.find(k => application[k] && application[k].trim());
  return (
    <div className="space-y-3">
      <Card>
        <SectionHeader title="Highlights" subtitle="Curated from Source Data" />
        <div className="space-y-3">
          {APPLICATION_KEY_FIELDS.map(([title, keys]) => {
            const k = presentInApp(keys);
            if (!k) return null;
            return (
              <div key={title}>
                <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">{application[k]}</p>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <SectionHeader title="Full application" subtitle="Every field they submitted" />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(application)
            .filter(([k, v]) => v && v.trim() && !['id', 'name', 'companyName', 'company_name'].includes(k))
            .map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-100 bg-slate-50/60 p-2 dark:border-navy-800 dark:bg-navy-800/40">
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{humanizeKey(k)}</div>
                <div className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">{v}</div>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

function ScoringTab({ sel }: { sel: SelectionContext }) {
  return (
    <div className="space-y-3">
      <Card>
        <SectionHeader title="Scoring matrix" subtitle="Output of the team's scoring stage" />
        {sel.scoring ? <BucketedFields entries={meaningfulEntries(sel.scoring)} buckets={SCORING_BUCKETS} />
          : <EmptyHint icon={<Activity className="h-5 w-5" />} text="No scoring on file." />}
      </Card>
      <Card>
        <SectionHeader title="Identified needs" subtitle="What interventions the team thought were a fit" />
        {sel.needs ? <BucketedFields entries={meaningfulEntries(sel.needs)} buckets={NEEDS_BUCKETS} />
          : <EmptyHint icon={<Activity className="h-5 w-5" />} text="No needs row on file." />}
      </Card>
    </div>
  );
}

function InterviewTab({ sel }: { sel: SelectionContext }) {
  return (
    <div className="space-y-3">
      <Card>
        <SectionHeader title="Interview assessment" subtitle="Captured by the interviewer" />
        {sel.interviewAssessment ? <BucketedFields entries={meaningfulEntries(sel.interviewAssessment)} buckets={INTERVIEW_BUCKETS} />
          : <EmptyHint icon={<BookOpen className="h-5 w-5" />} text="No assessment on file." />}
      </Card>
      <Card>
        <SectionHeader title="Team interview discussion" subtitle="What we said about them post-interview" />
        {sel.interviewDiscussion ? <BucketedFields entries={meaningfulEntries(sel.interviewDiscussion)} buckets={INTERVIEW_BUCKETS} />
          : <EmptyHint icon={<MessageCircle className="h-5 w-5" />} text="No discussion captured." />}
      </Card>
    </div>
  );
}

function CommitteeTab({ sel }: { sel: SelectionContext }) {
  return (
    <div className="space-y-3">
      <Card>
        <SectionHeader title="Committee votes" subtitle="Decisions captured before review" />
        {sel.committeeVotes ? <BucketedFields entries={meaningfulEntries(sel.committeeVotes)} buckets={COMMITTEE_BUCKETS} />
          : <EmptyHint icon={<Vote className="h-5 w-5" />} text="No committee vote on file." />}
      </Card>
      <Card>
        <SectionHeader title="Selection votes" subtitle="Per-person votes from selection" />
        {sel.selectionVotes ? <BucketedFields entries={meaningfulEntries(sel.selectionVotes)} buckets={COMMITTEE_BUCKETS} />
          : <EmptyHint icon={<Vote className="h-5 w-5" />} text="No selection vote on file." />}
      </Card>
    </div>
  );
}

function TeamThreadTab({
  companyReviews,
  companyComments,
  commentDraft,
  setCommentDraft,
  onPostComment,
  postingComment,
}: {
  companyReviews: Review[];
  companyComments: CompanyComment[];
  commentDraft: string;
  setCommentDraft: (s: string) => void;
  onPostComment: () => void;
  postingComment: boolean;
}) {
  return (
    <div className="space-y-3">
      <Card>
        <SectionHeader title="Reviews" subtitle="Every team member's call" />
        {companyReviews.length === 0 ? (
          <EmptyHint icon={<Users className="h-5 w-5" />} text="No reviews yet." />
        ) : (
          <ul className="space-y-2">
            {companyReviews.sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || '')).map(r => (
              <li key={r.review_id} className="rounded-md border border-slate-200 p-2 dark:border-navy-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-navy-500 dark:text-slate-100">{displayName(r.reviewer_email)}</span>
                  {r.decision && <Badge tone={DECISION_TONE[r.decision as ReviewDecision]}>{r.decision}</Badge>}
                </div>
                {(r.proposed_pillars || r.proposed_sub_interventions) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {splitCsv(r.proposed_pillars).map(p => (
                      <span key={p} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold dark:border-navy-700 dark:bg-navy-800">{p}</span>
                    ))}
                    {splitCsv(r.proposed_sub_interventions).map(s => (
                      <span key={s} className="rounded border border-brand-teal/40 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-teal dark:bg-teal-950">{s.replace(/^MA-/, '')}</span>
                    ))}
                  </div>
                )}
                {r.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">{r.notes}</p>}
                <div className="mt-1 text-[10px] text-slate-400">{fmtDate(r.updated_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionHeader title="Discussion" subtitle="Open thread" />
        {companyComments.length === 0 ? (
          <EmptyHint icon={<MessageCircle className="h-5 w-5" />} text="No comments yet." />
        ) : (
          <ul className="space-y-2">
            {companyComments.map(c => (
              <li key={c.comment_id} className="rounded-md border border-slate-200 bg-slate-50/50 p-2 dark:border-navy-700 dark:bg-navy-800/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-navy-500 dark:text-slate-100">{displayName(c.author_email)}</span>
                  <span className="text-[10px] text-slate-400">{fmtDate(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 space-y-1.5">
          <textarea
            value={commentDraft}
            onChange={e => setCommentDraft(e.currentTarget.value)}
            rows={2}
            placeholder="Write a comment for the team…"
            className="w-full rounded-md border border-slate-200 bg-brand-editable/30 px-2 py-1.5 text-xs leading-relaxed focus:border-brand-teal focus:outline-none dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
          />
          <Button size="sm" onClick={onPostComment} disabled={postingComment || !commentDraft.trim()}>
            <MessageCircle className="h-3.5 w-3.5" /> Post
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ──────── Primitives ────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-bold text-navy-500 dark:text-white">{title}</h3>
      {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}

type StatTone = Tone | 'navy';

function MiniStat({ label, value, tone }: { label: string; value: string; tone: StatTone }) {
  const toneCls: Record<string, string> = {
    teal: 'bg-brand-teal/10 text-brand-teal',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    orange: 'bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
    navy: 'bg-slate-100 text-slate-700 dark:bg-navy-800 dark:text-slate-200',
    neutral: 'bg-slate-100 text-slate-700 dark:bg-navy-800 dark:text-slate-300',
  };
  return (
    <div className={`rounded-lg p-1.5 text-center ${toneCls[tone] || toneCls.neutral}`}>
      <div className="truncate text-base font-extrabold leading-tight">{value}</div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider opacity-80">{label}</div>
    </div>
  );
}

function BigStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: StatTone }) {
  const toneCls: Record<string, string> = {
    teal: 'border-brand-teal/40 bg-brand-teal/5 text-brand-teal',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    orange: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100',
    navy: 'border-slate-200 bg-white text-navy-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-100',
    neutral: 'border-slate-200 bg-white text-slate-700 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200',
  };
  return (
    <div className={`rounded-lg border p-2 ${toneCls[tone] || toneCls.neutral}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 truncate text-base font-extrabold">{value || '—'}</div>
      {hint && <div className="mt-0.5 truncate text-[10px] font-medium opacity-70">{hint}</div>}
    </div>
  );
}

function NarrativeBlock({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {icon} {title}
      </h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">{body}</p>
    </div>
  );
}

function BucketedFields({ entries, buckets }: { entries: Array<[string, string]>; buckets: Array<{ label: string; pattern: RegExp }> }) {
  if (entries.length === 0) return null;
  const grouped = bucketize(entries, buckets);
  if (grouped.length === 0) return null;
  return (
    <div className="space-y-3">
      {grouped.map(g => (
        <div key={g.label}>
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.label}</h4>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {g.entries.map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-100 bg-slate-50/60 p-2 dark:border-navy-800 dark:bg-navy-800/40">
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{humanizeKey(k)}</div>
                <div className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">{v}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-navy-700 dark:text-slate-400">
      <span className="text-slate-400">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ──────── Helpers ────────

function pickValue(row: RawRow | null | undefined, pattern: RegExp): string {
  if (!row) return '';
  for (const [k, v] of Object.entries(row)) {
    if (!v || !v.trim()) continue;
    if (pattern.test(k)) return v.trim();
  }
  return '';
}

function splitCsv(s: string): string[] {
  return (s || '').split(',').map(x => x.trim()).filter(Boolean);
}

function fmtDate(s?: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

// Compute the team consensus pillars as the union of every Recommend
// review's proposed_pillars. Used by the admin Finalize fall-back when the
// admin hasn't picked their own pillars.
function computeConsensusPillars(reviews: Review[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    if (r.decision !== 'Recommend') continue;
    for (const p of splitCsv(r.proposed_pillars)) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const total = reviews.filter(r => r.decision === 'Recommend').length || 1;
  return Array.from(counts.entries())
    .filter(([, n]) => n / total >= 0.5)
    .map(([p]) => p);
}

function computeConsensusSubs(reviews: Review[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    if (r.decision !== 'Recommend') continue;
    for (const s of splitCsv(r.proposed_sub_interventions)) counts.set(s, (counts.get(s) || 0) + 1);
  }
  const total = reviews.filter(r => r.decision === 'Recommend').length || 1;
  return Array.from(counts.entries())
    .filter(([, n]) => n / total >= 0.5)
    .map(([s]) => s);
}
