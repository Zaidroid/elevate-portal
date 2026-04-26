// ReviewView — the team's step-through workflow for going through every
// post-interview company, deciding inclusion, and proposing interventions.
//
// New layout (drastically rethought to surface every prior team
// evaluation artifact alongside the decision form):
//
//   ┌─────────────────────────────────────────────────────────────────┐
//   │ Sticky progress strip + jump-to-company dropdown                │
//   ├─────────────────────────────────────────────────────────────────┤
//   │ Hero (company icon + name + status / fund / consensus chips)    │
//   ├──────────────────────────────────────┬──────────────────────────┤
//   │ Evaluation timeline (left, 8/12)     │ Decision form (right,    │
//   │  ┌ At a glance — KPI strip          │ 4/12, sticky)             │
//   │  ├ Application — Source Data         │  Decision: Rec/Hold/Rej  │
//   │  ├ Scoring — score class + matrix    │  Pillars + sub-int       │
//   │  ├ Doc Review — readiness notes      │  Notes                   │
//   │  ├ Interview — assess + discussion   │  Save & Next             │
//   │  ├ Committee — votes from before     │                          │
//   │  └ Team thread — reviews + comments  │                          │
//   └──────────────────────────────────────┴──────────────────────────┘
//
// The right pane stays put while the reviewer scrolls through evaluation
// history; their decision form is always one glance away.

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Building2, ChevronLeft, ChevronRight,
  ClipboardCheck, ExternalLink, FileText, MapPin, MessageCircle,
  PauseCircle, Save, SkipForward, ThumbsDown, ThumbsUp, Users, Vote, Zap,
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

const DECISION_TONE: Record<ReviewDecision, Tone> = {
  Recommend: 'green',
  Hold: 'amber',
  Reject: 'red',
};

const DECISION_ICON: Record<ReviewDecision, React.ReactNode> = {
  Recommend: <ThumbsUp className="h-4 w-4" />,
  Hold: <PauseCircle className="h-4 w-4" />,
  Reject: <ThumbsDown className="h-4 w-4" />,
};

// Header buckets used to group raw key/value pairs from each Selection tab
// into readable sections without hardcoding tab schemas.
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
  ['About the company', ['businessDescription', 'whatTheyDo', 'productOrService', 'description', 'about']],
  ['Why Elevate', ['whyElevate', 'goals', 'reasonForApplying', 'why']],
  ['Pain points', ['mainPainPoint', 'challenges', 'mainChallenge', 'problems', 'pain']],
  ['Hiring spec', ['wantsTrainToHire', 'trainToHireCount', 'rolesNeeded', 'hiring']],
  ['Founders / Team', ['founderName', 'founderEmail', 'leadership', 'foundingTeam', 'founders']],
  ['Markets', ['markets', 'targetMarkets', 'currentMarkets', 'currentMarket']],
  ['Revenue', ['revenue', 'annualRevenue', 'revenueBracket', 'arr']],
];

type EvalTab = 'glance' | 'application' | 'scoring' | 'docReview' | 'interview' | 'committee' | 'team';

export function ReviewView({
  companies,
  reviews,
  comments,
  reviewerEmail,
  onSaveReview,
  onAddComment,
  onJumpToCompany,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  comments: CompanyComment[];
  reviewerEmail: string;
  onSaveReview: (r: Review) => Promise<void>;
  onAddComment: (c: CompanyComment) => Promise<void>;
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
  }, [myExistingReview, company?.company_id]);

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<MessageCircle className="h-10 w-10" />}
          title="No companies in scope to review"
          description="Adjust the filters above (or flip 'Include pre-interview') to populate the review queue."
        />
      </Card>
    );
  }

  if (!company) {
    return (
      <Card>
        <EmptyState
          icon={<MessageCircle className="h-10 w-10" />}
          title="End of the queue"
          description="You've stepped through every company in the current scope."
        />
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
    if (parent) setPillars(prev => {
      const next = new Set(prev); next.add(parent.code); return next;
    });
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

  const companyReviews = reviews.filter(r => r.company_id === company.company_id);
  const companyComments = comments
    .filter(c => c.company_id === company.company_id)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const summary = summaryByCompany.get(company.company_id);
  const progressPct = Math.round((reviewedCount / Math.max(1, companies.length)) * 100);

  const application = company.applicantRaw || {};
  const presentInApp = (keys: string[]) =>
    keys.find(k => application[k] && application[k].trim());

  const sel = company.selection;
  // Per-tab signal availability for the eval-tab strip.
  const has = {
    scoring: !!sel.scoring,
    docReview: !!sel.docReview,
    needs: !!sel.needs,
    interview: !!(sel.interviewAssessment || sel.interviewDiscussion),
    committee: !!(sel.committeeVotes || sel.selectionVotes),
  };

  const evalTabs: Array<{ id: EvalTab; label: string; icon: React.ReactNode; available: boolean; count?: number }> = [
    { id: 'glance', label: 'At a glance', icon: <Zap className="h-4 w-4" />, available: true },
    { id: 'application', label: 'Application', icon: <FileText className="h-4 w-4" />, available: Object.keys(application).length > 0 },
    { id: 'scoring', label: 'Scoring & Needs', icon: <Activity className="h-4 w-4" />, available: has.scoring || has.needs },
    { id: 'docReview', label: 'Doc Review', icon: <ClipboardCheck className="h-4 w-4" />, available: has.docReview },
    { id: 'interview', label: 'Interview', icon: <BookOpen className="h-4 w-4" />, available: has.interview },
    { id: 'committee', label: 'Committee', icon: <Vote className="h-4 w-4" />, available: has.committee },
    { id: 'team', label: 'Team thread', icon: <Users className="h-4 w-4" />, available: true, count: companyReviews.length + companyComments.length },
  ];

  return (
    <div className="space-y-5">
      {/* ───────── Sticky progress + nav strip ───────── */}
      <Card className="sticky top-0 z-30 border-b-2 border-brand-teal/20 bg-white/95 backdrop-blur dark:bg-navy-900/95">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={goPrev} disabled={cursor === 0}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="rounded-md bg-brand-teal/10 px-2 py-1 text-sm font-bold text-brand-teal">
              {cursor + 1} / {companies.length}
            </span>
            <Button variant="ghost" onClick={goNext} disabled={cursor === companies.length - 1}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
              <span>{reviewedCount} of {companies.length} reviewed</span>
              <span className="text-slate-500 dark:text-slate-400">{progressPct}% · you've done {myReviewedCount}</span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
              <div
                className="h-full bg-gradient-to-r from-brand-teal to-emerald-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <select
            value={cursor}
            onChange={e => setCursor(Number(e.currentTarget.value))}
            className="min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            title="Jump to a company"
          >
            {companies.map((c, i) => {
              const s = summaryByCompany.get(c.company_id);
              const tag = s && s.total > 0 ? ` · ${s.consensus}` : '';
              return (
                <option key={c.company_id} value={i}>
                  {i + 1}. {c.company_name || c.company_id}{tag}
                </option>
              );
            })}
          </select>
        </div>
      </Card>

      {/* ───────── Hero ───────── */}
      <Card className="border-l-4 border-l-brand-teal">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
              <Building2 className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-navy-500 dark:text-white">
                {company.company_name || 'Unnamed company'}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                {company.sector && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" /> {company.sector}
                  </span>
                )}
                {(company.city || company.governorate) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {[company.city, company.governorate].filter(Boolean).join(', ')}
                  </span>
                )}
                {company.employee_count && (
                  <span>{company.employee_count} {company.employee_count === '1' ? 'employee' : 'employees'}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">{company.status || 'Interviewed'}</Badge>
            {company.fund_code && (
              <Badge tone={company.fund_code === '97060' ? 'teal' : 'amber'}>
                {company.fund_code === '97060' ? 'Dutch (97060)' : 'SIDA (91763)'}
              </Badge>
            )}
            {summary && summary.total > 0 && (
              <Badge tone={summary.consensus === 'Mixed' ? 'amber' : DECISION_TONE[summary.consensus as ReviewDecision]}>
                {summary.total}× {summary.consensus}
              </Badge>
            )}
            {onJumpToCompany && (
              <Button variant="ghost" onClick={() => onJumpToCompany(company.route_id)}>
                <ExternalLink className="h-4 w-4" /> Open detail
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ───────── Two-pane: timeline + sticky decision form ───────── */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* ════════ LEFT — Evaluation timeline ════════ */}
        <div className="space-y-4 lg:col-span-8">
          {/* Eval tab strip */}
          <Card>
            <div className="flex flex-wrap gap-1.5">
              {evalTabs.map(t => {
                const active = evalTab === t.id;
                const dim = !t.available && !active;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEvalTab(t.id)}
                    disabled={!t.available && !active}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                      active
                        ? 'bg-brand-teal text-white shadow'
                        : dim
                        ? 'bg-slate-100 text-slate-400 dark:bg-navy-800 dark:text-slate-500'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-navy-800 dark:text-slate-200 dark:hover:bg-navy-700'
                    }`}
                  >
                    {t.icon} {t.label}
                    {t.count !== undefined && t.count > 0 && (
                      <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-slate-300 text-slate-700 dark:bg-navy-600 dark:text-slate-200'}`}>
                        {t.count}
                      </span>
                    )}
                    {!t.available && <span className="text-[10px] font-medium opacity-60">none</span>}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ── At a glance ── */}
          {evalTab === 'glance' && (
            <GlanceTab company={company} application={application} sel={sel} summary={summary} />
          )}

          {/* ── Application ── */}
          {evalTab === 'application' && (
            <ApplicationTab application={application} presentInApp={presentInApp} />
          )}

          {/* ── Scoring & Needs ── */}
          {evalTab === 'scoring' && (
            <ScoringTab sel={sel} />
          )}

          {/* ── Doc Review ── */}
          {evalTab === 'docReview' && (
            <RawTabContent
              row={sel.docReview}
              buckets={DOC_REVIEW_BUCKETS}
              empty="No doc review on file."
              icon={<ClipboardCheck className="h-6 w-6" />}
            />
          )}

          {/* ── Interview ── */}
          {evalTab === 'interview' && (
            <InterviewTab sel={sel} />
          )}

          {/* ── Committee ── */}
          {evalTab === 'committee' && (
            <CommitteeTab sel={sel} />
          )}

          {/* ── Team thread ── */}
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

        {/* ════════ RIGHT — Sticky decision form ════════ */}
        <div className="lg:col-span-4">
          <div className="space-y-4 lg:sticky lg:top-[140px]">
            {/* Quick stats — score + readiness + interventions hint */}
            <Card>
              <SectionHeader title="Quick read" subtitle="What we already have on this company" />
              <div className="grid grid-cols-3 gap-2">
                <MiniStat
                  label="Score"
                  value={pickValue(sel.scoring, /^(class|tier|grade)$/i) || pickValue(sel.scoring, /score|rating/i) || '—'}
                  tone="teal"
                />
                <MiniStat
                  label="Readiness"
                  value={company.readiness_score || pickValue(sel.needs, /readiness|score/i) || '—'}
                  tone="amber"
                />
                <MiniStat
                  label="Reviews"
                  value={summary && summary.total > 0 ? `${summary.total}` : '0'}
                  tone={summary && summary.total > 0 ? (summary.consensus === 'Recommend' ? 'green' : summary.consensus === 'Reject' ? 'red' : 'amber') : 'neutral'}
                />
              </div>
            </Card>

            {/* Decision tile */}
            <Card>
              <SectionHeader title="Your decision" subtitle="Pick one" />
              <div className="grid grid-cols-3 gap-2">
                {REVIEW_DECISIONS.map(d => {
                  const active = decision === d;
                  const tones = {
                    Recommend: {
                      on: 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/30',
                      off: 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-emerald-950',
                    },
                    Hold: {
                      on: 'border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-500/30',
                      off: 'border-slate-200 bg-white text-slate-700 hover:border-amber-400 hover:bg-amber-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-amber-950',
                    },
                    Reject: {
                      on: 'border-red-500 bg-red-500 text-white shadow-md shadow-red-500/30',
                      off: 'border-slate-200 bg-white text-slate-700 hover:border-red-400 hover:bg-red-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-red-950',
                    },
                  };
                  const cls = active ? tones[d].on : tones[d].off;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-3 text-sm font-bold transition-all ${cls}`}
                    >
                      {DECISION_ICON[d]} {d}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Interventions */}
            <Card>
              <SectionHeader title="Proposed interventions" />
              <div className="space-y-1.5">
                {PILLARS.map(p => {
                  const on = pillars.has(p.code);
                  return (
                    <div
                      key={p.code}
                      className={`rounded-lg border-2 transition-colors ${
                        on
                          ? 'border-brand-teal bg-brand-teal/5'
                          : 'border-slate-200 bg-white hover:border-brand-teal/40 dark:border-navy-700 dark:bg-navy-900'
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => togglePillar(p.code)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                        />
                        <span className="flex-1 text-sm font-bold text-navy-500 dark:text-slate-100">{p.label}</span>
                        <Badge tone={on ? 'teal' : 'neutral'}>{p.shortLabel}</Badge>
                      </label>
                      {on && p.subInterventions.length > 0 && (
                        <div className="border-t border-brand-teal/20 px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {p.subInterventions.map(s => {
                              const subOn = subInterventions.has(s);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => toggleSub(s)}
                                  className={`rounded-full border-2 px-2 py-0.5 text-xs font-semibold transition-colors ${
                                    subOn
                                      ? 'border-brand-teal bg-brand-teal text-white'
                                      : 'border-slate-300 bg-white text-slate-700 hover:border-brand-teal hover:text-brand-teal dark:border-navy-700 dark:bg-navy-900 dark:text-slate-300'
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
            </Card>

            {/* Notes */}
            <Card>
              <SectionHeader title="Your notes" />
              <textarea
                value={notes}
                onChange={e => setNotes(e.currentTarget.value)}
                rows={4}
                placeholder="Reasoning, concerns, why this intervention pack…"
                className="w-full rounded-lg border-2 border-slate-200 bg-brand-editable/30 px-3 py-2 text-sm leading-relaxed focus:border-brand-teal focus:outline-none dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
              />
            </Card>

            {/* Save bar */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => handleSave(true)} disabled={savingReview || !decision} className="px-5 py-2.5 text-base">
                  <Save className="h-4 w-4" /> Save & Next
                </Button>
                <Button variant="ghost" onClick={() => handleSave(false)} disabled={savingReview || !decision}>
                  Save (stay)
                </Button>
                <Button variant="ghost" onClick={goNext}>
                  <SkipForward className="h-4 w-4" /> Skip
                </Button>
              </div>
              {myExistingReview && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  You reviewed this on <span className="font-semibold">{fmtDate(myExistingReview.updated_at)}</span> — saving will overwrite.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────── Sub-components ─────────────────────────────

function GlanceTab({
  company,
  application,
  sel,
  summary,
}: {
  company: ReviewableCompany;
  application: Record<string, string>;
  sel: SelectionContext;
  summary?: ReturnType<typeof summarizeReviews>;
}) {
  // Collect every signal we have into a single dense KPI strip + two
  // narrative blocks (About / Why) so a reviewer can decide on this tab
  // alone if they trust the prior team work.
  const presentInApp = (keys: string[]) => keys.find(k => application[k] && application[k].trim());
  const aboutKey = presentInApp(APPLICATION_KEY_FIELDS[0][1]);
  const whyKey = presentInApp(APPLICATION_KEY_FIELDS[1][1]);
  const painKey = presentInApp(APPLICATION_KEY_FIELDS[2][1]);

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Snapshot" subtitle="Everything the team has on this company so far" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <BigStat
            label="Score class"
            value={pickValue(sel.scoring, /^(class|tier|grade)$/i) || '—'}
            hint={pickValue(sel.scoring, /total.*score|^score$|weighted/i)}
            tone="teal"
          />
          <BigStat
            label="Readiness"
            value={company.readiness_score || pickValue(sel.needs, /readiness/i) || '—'}
            hint={pickValue(sel.needs, /total.*intervention|count/i)}
            tone="amber"
          />
          <BigStat
            label="Interview rating"
            value={pickValue(sel.interviewAssessment, /rating|score|grade|recommend/i) || '—'}
            hint={pickValue(sel.interviewAssessment, /interviewer|by/i)}
            tone="teal"
          />
          <BigStat
            label="Committee"
            value={pickValue(sel.committeeVotes, /vote|decision|recommend|outcome/i) || '—'}
            hint={pickValue(sel.committeeVotes, /reason|note/i)}
            tone="orange"
          />
          <BigStat
            label="Team reviews"
            value={summary && summary.total > 0 ? `${summary.total}` : '0'}
            hint={summary && summary.total > 0 ? `${summary.recommend} rec · ${summary.hold} hold · ${summary.reject} rej` : 'No team reviews yet'}
            tone={summary && summary.consensus === 'Recommend' ? 'green' : summary && summary.consensus === 'Reject' ? 'red' : 'amber'}
          />
          <BigStat
            label="PM"
            value={company.profile_manager_email ? displayName(company.profile_manager_email).split(' ')[0] : '—'}
            hint={company.profile_manager_email || 'Unassigned'}
            tone="navy"
          />
          <BigStat
            label="Sector"
            value={company.sector || '—'}
            hint={company.governorate || company.city || ''}
            tone="navy"
          />
          <BigStat
            label="Employees"
            value={company.employee_count || '—'}
            hint={pickValue(application, /^(annualRevenue|revenue|revenueBracket)$/i) || ''}
            tone="navy"
          />
        </div>
      </Card>

      {(aboutKey || whyKey || painKey) && (
        <Card>
          <SectionHeader title="In their own words" subtitle="From their application" />
          <div className="space-y-4">
            {aboutKey && (
              <NarrativeBlock title="About the company" body={application[aboutKey]} icon={<Building2 className="h-4 w-4" />} />
            )}
            {whyKey && (
              <NarrativeBlock title="Why Elevate" body={application[whyKey]} icon={<Zap className="h-4 w-4" />} />
            )}
            {painKey && (
              <NarrativeBlock title="Pain points" body={application[painKey]} icon={<AlertTriangle className="h-4 w-4" />} />
            )}
          </div>
        </Card>
      )}

      {sel.needs && (
        <Card>
          <SectionHeader title="Identified needs" subtitle="What the team flagged during selection" />
          {meaningfulEntries(sel.needs).filter(([k]) => !/company|name/i.test(k)).slice(0, 8).map(([k, v]) => (
            <KV key={k} label={humanizeKey(k)} value={<span className="whitespace-pre-wrap">{v}</span>} />
          ))}
        </Card>
      )}

      {(sel.interviewAssessment || sel.interviewDiscussion) && (
        <Card>
          <SectionHeader title="From the interview" subtitle="Tap 'Interview' tab for the full breakdown" />
          {sel.interviewAssessment && (
            <div className="mb-3">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Assessment notes</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {pickValue(sel.interviewAssessment, /note|comment|summary|highlight|takeaway|observation/i) || '—'}
              </p>
            </div>
          )}
          {sel.interviewDiscussion && (
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Team discussion</h4>
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

function ApplicationTab({
  application,
  presentInApp,
}: {
  application: Record<string, string>;
  presentInApp: (keys: string[]) => string | undefined;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="From their application" subtitle="Source Data — the highlights" />
        <div className="space-y-4">
          {APPLICATION_KEY_FIELDS.map(([title, keys]) => {
            const k = presentInApp(keys);
            if (!k) return null;
            return (
              <div key={title}>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {title}
                </h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {application[k]}
                </p>
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
              <div key={k} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 dark:border-navy-800 dark:bg-navy-800/40">
                <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {humanizeKey(k)}
                </div>
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
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Scoring matrix" subtitle="Output of the team's scoring stage" />
        {sel.scoring ? (
          <BucketedFields entries={meaningfulEntries(sel.scoring)} buckets={SCORING_BUCKETS} />
        ) : (
          <EmptyHint icon={<Activity className="h-6 w-6" />} text="No scoring row found for this company." />
        )}
      </Card>
      <Card>
        <SectionHeader title="Identified needs" subtitle="What interventions the team thought were a fit" />
        {sel.needs ? (
          <BucketedFields entries={meaningfulEntries(sel.needs)} buckets={NEEDS_BUCKETS} />
        ) : (
          <EmptyHint icon={<Activity className="h-6 w-6" />} text="No needs row found for this company." />
        )}
      </Card>
    </div>
  );
}

function InterviewTab({ sel }: { sel: SelectionContext }) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Interview assessment" subtitle="What the interviewer captured" />
        {sel.interviewAssessment ? (
          <BucketedFields entries={meaningfulEntries(sel.interviewAssessment)} buckets={INTERVIEW_BUCKETS} />
        ) : (
          <EmptyHint icon={<BookOpen className="h-6 w-6" />} text="No interview assessment on file." />
        )}
      </Card>
      <Card>
        <SectionHeader title="Team interview discussion" subtitle="What we said about them post-interview" />
        {sel.interviewDiscussion ? (
          <BucketedFields entries={meaningfulEntries(sel.interviewDiscussion)} buckets={INTERVIEW_BUCKETS} />
        ) : (
          <EmptyHint icon={<MessageCircle className="h-6 w-6" />} text="No team discussion captured for this company." />
        )}
      </Card>
    </div>
  );
}

function CommitteeTab({ sel }: { sel: SelectionContext }) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Committee votes" subtitle="Decisions the committee logged before review" />
        {sel.committeeVotes ? (
          <BucketedFields entries={meaningfulEntries(sel.committeeVotes)} buckets={COMMITTEE_BUCKETS} />
        ) : (
          <EmptyHint icon={<Vote className="h-6 w-6" />} text="No committee vote on file." />
        )}
      </Card>
      <Card>
        <SectionHeader title="Selection votes" subtitle="Per-person votes captured in selection" />
        {sel.selectionVotes ? (
          <BucketedFields entries={meaningfulEntries(sel.selectionVotes)} buckets={COMMITTEE_BUCKETS} />
        ) : (
          <EmptyHint icon={<Vote className="h-6 w-6" />} text="No selection vote on file." />
        )}
      </Card>
    </div>
  );
}

function RawTabContent({
  row,
  buckets,
  empty,
  icon,
}: {
  row: RawRow | null;
  buckets: Array<{ label: string; pattern: RegExp }>;
  empty: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      {row ? (
        <BucketedFields entries={meaningfulEntries(row)} buckets={buckets} />
      ) : (
        <EmptyHint icon={icon} text={empty} />
      )}
    </Card>
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
    <div className="space-y-4">
      <Card>
        <SectionHeader title="Reviews" subtitle="Every team member's call on this company" />
        {companyReviews.length === 0 ? (
          <EmptyHint icon={<Users className="h-6 w-6" />} text="No reviews yet — be the first to weigh in." />
        ) : (
          <ul className="space-y-3">
            {companyReviews
              .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
              .map(r => (
                <li key={r.review_id} className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-navy-500 dark:text-slate-100">
                      {displayName(r.reviewer_email)}
                    </span>
                    {r.decision && (
                      <Badge tone={DECISION_TONE[r.decision as ReviewDecision]}>{r.decision}</Badge>
                    )}
                  </div>
                  {(r.proposed_pillars || r.proposed_sub_interventions) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {splitCsv(r.proposed_pillars).map(p => (
                        <span key={p} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold dark:border-navy-700 dark:bg-navy-800">
                          {p}
                        </span>
                      ))}
                      {splitCsv(r.proposed_sub_interventions).map(s => (
                        <span key={s} className="rounded-md border border-brand-teal/40 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-brand-teal dark:bg-teal-950">
                          {s.replace(/^MA-/, '')}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.notes && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {r.notes}
                    </p>
                  )}
                  <div className="mt-2 text-xs text-slate-400">{fmtDate(r.updated_at)}</div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader title="Discussion" subtitle="Open thread for this company" />
        {companyComments.length === 0 ? (
          <EmptyHint icon={<MessageCircle className="h-6 w-6" />} text="No comments yet." />
        ) : (
          <ul className="space-y-2.5">
            {companyComments.map(c => (
              <li key={c.comment_id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-navy-700 dark:bg-navy-800/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-navy-500 dark:text-slate-100">
                    {displayName(c.author_email)}
                  </span>
                  <span className="text-xs text-slate-400">{fmtDate(c.created_at)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 space-y-2">
          <textarea
            value={commentDraft}
            onChange={e => setCommentDraft(e.currentTarget.value)}
            rows={3}
            placeholder="Write a comment for the team…"
            className="w-full rounded-lg border-2 border-slate-200 bg-brand-editable/30 px-3 py-2 text-sm leading-relaxed focus:border-brand-teal focus:outline-none dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
          />
          <Button size="sm" onClick={onPostComment} disabled={postingComment || !commentDraft.trim()}>
            <MessageCircle className="h-4 w-4" /> Post comment
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ──────────────────────────── Primitives ────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-extrabold text-navy-500 dark:text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0 dark:border-navy-800">
      <span className="shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-800 dark:text-slate-100">{value}</span>
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
    <div className={`rounded-lg p-2.5 text-center ${toneCls[tone] || toneCls.neutral}`}>
      <div className="text-xl font-extrabold leading-tight">{value}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
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
    <div className={`rounded-xl border-2 p-3 ${toneCls[tone] || toneCls.neutral}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-1 truncate text-xl font-extrabold">{value || '—'}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] font-medium opacity-70">{hint}</div>}
    </div>
  );
}

function NarrativeBlock({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
    <div className="space-y-4">
      {grouped.map(g => (
        <div key={g.label}>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.label}</h4>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {g.entries.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 dark:border-navy-800 dark:bg-navy-800/40">
                <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {humanizeKey(k)}
                </div>
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
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-navy-700 dark:text-slate-400">
      <span className="text-slate-400">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ──────────────────────────── helpers ────────────────────────────────

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
