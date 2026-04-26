// ReviewView — the team's step-through workflow for going through every
// post-interview company, deciding inclusion, and proposing interventions.
//
// Layout (desktop, 12-col grid):
//   [progress bar + nav]
//   [ Selection snapshot (5)  | Decision form (4)  | Team thread (3) ]
//   [ Save / Skip / Prev ]
//
// All writes land in the Companies workbook (Reviews / Company Comments
// tabs auto-created via ensureSchema). Reviews are upserted by
// (reviewer_email, company_id) so a reviewer's edit updates rather than
// duplicates the row.

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Save, SkipForward, ThumbsDown, ThumbsUp, PauseCircle, ExternalLink, Mail, Phone, Building2, MapPin } from 'lucide-react';
import { Badge, Button, Card, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { displayName } from '../../config/team';
import { PILLARS, pillarFor } from '../../config/interventions';
import type { Review, CompanyComment, ReviewDecision } from './reviewTypes';
import { REVIEW_DECISIONS, summarizeReviews } from './reviewTypes';

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
};

const DECISION_TONE: Record<ReviewDecision, Tone> = {
  Recommend: 'green',
  Hold: 'amber',
  Reject: 'red',
};

const DECISION_ICON: Record<ReviewDecision, React.ReactNode> = {
  Recommend: <ThumbsUp className="h-5 w-5" />,
  Hold: <PauseCircle className="h-5 w-5" />,
  Reject: <ThumbsDown className="h-5 w-5" />,
};

// Source Data fields the review panel surfaces in a structured "About"
// block — the rest land in a collapsible "Full application" panel below.
// Keeping the surface tight: what a reviewer needs to make a call quickly.
const KEY_APPLICATION_FIELDS: Array<[string, string[]]> = [
  ['About the company', ['businessDescription', 'whatTheyDo', 'productOrService', 'description']],
  ['Why Elevate', ['whyElevate', 'goals', 'reasonForApplying']],
  ['Pain points', ['mainPainPoint', 'challenges', 'mainChallenge', 'problems']],
  ['Hiring spec', ['wantsTrainToHire', 'trainToHireCount', 'rolesNeeded']],
  ['Founders / Team', ['founderName', 'founderEmail', 'leadership', 'foundingTeam']],
  ['Markets', ['markets', 'targetMarkets', 'currentMarkets']],
];

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
  const [showFullApp, setShowFullApp] = useState(false);

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
    setShowFullApp(false);
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
  const presentInApp = (keys: string[]) => keys.find(k => application[k] && application[k].trim());

  return (
    <div className="space-y-5">
      {/* ───────── Sticky progress + nav strip ───────── */}
      <Card className="sticky top-0 z-20 border-b-2 border-brand-teal/20 bg-white/95 backdrop-blur dark:bg-navy-900/95">
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

      {/* ───────── Hero header for the company being reviewed ───────── */}
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
                  <span className="inline-flex items-center gap-1">
                    {company.employee_count} {company.employee_count === '1' ? 'employee' : 'employees'}
                  </span>
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
            {onJumpToCompany && (
              <Button variant="ghost" onClick={() => onJumpToCompany(company.route_id)}>
                <ExternalLink className="h-4 w-4" /> Open detail
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ───────── Three-column working surface ───────── */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* ════════ Left: Selection snapshot ════════ */}
        <div className="space-y-5 lg:col-span-5">
          <Card>
            <SectionHeader title="At a glance" subtitle="What we already know about them" />
            <dl className="divide-y divide-slate-100 dark:divide-navy-800">
              <KV label="Profile Manager" value={
                company.profile_manager_email
                  ? <span className="font-semibold text-navy-500 dark:text-slate-100">{displayName(company.profile_manager_email)}</span>
                  : <span className="text-slate-400 italic">unassigned</span>
              } />
              <KV label="Readiness score" value={company.readiness_score || '—'} />
              <KV label="Contact" value={
                company.contact_email
                  ? <a href={`mailto:${company.contact_email}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-teal hover:underline">
                      <Mail className="h-3.5 w-3.5" /> {company.contact_email}
                    </a>
                  : <span className="text-slate-400 italic">no email on file</span>
              } />
              {application['phone'] && (
                <KV label="Phone" value={
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                    <Phone className="h-3.5 w-3.5" /> {application['phone']}
                  </span>
                } />
              )}
            </dl>
          </Card>

          {/* Curated key-fields blocks (About / Why / Pain / Hiring / Founders) */}
          {KEY_APPLICATION_FIELDS.some(([, keys]) => presentInApp(keys)) && (
            <Card>
              <SectionHeader title="From their application" subtitle="Source Data — the highlights" />
              <div className="space-y-4">
                {KEY_APPLICATION_FIELDS.map(([title, keys]) => {
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
          )}

          {/* Full application dump (collapsible) */}
          {Object.keys(application).length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setShowFullApp(s => !s)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <SectionHeader
                  title="Full application"
                  subtitle={showFullApp ? 'Click to hide' : 'Every field they submitted'}
                  inline
                />
                <span className="text-sm font-semibold text-brand-teal">{showFullApp ? '−' : '+'}</span>
              </button>
              {showFullApp && (
                <div className="mt-3 max-h-[460px] space-y-2 overflow-y-auto pr-2">
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
              )}
            </Card>
          )}
        </div>

        {/* ════════ Center: Decision form ════════ */}
        <div className="space-y-5 lg:col-span-4">
          {/* Decision tile */}
          <Card>
            <SectionHeader title="Your decision" subtitle="Pick one. Updates the team consensus on the right." />
            <div className="grid grid-cols-3 gap-3">
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
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-4 py-4 text-base font-bold transition-all ${cls}`}
                  >
                    {DECISION_ICON[d]}
                    <span>{d}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Interventions picker */}
          <Card>
            <SectionHeader title="Proposed interventions" subtitle="Pillars + (where applicable) sub-interventions" />
            <div className="space-y-2.5">
              {PILLARS.map(p => {
                const on = pillars.has(p.code);
                return (
                  <div
                    key={p.code}
                    className={`rounded-xl border-2 transition-colors ${
                      on
                        ? 'border-brand-teal bg-brand-teal/5'
                        : 'border-slate-200 bg-white hover:border-brand-teal/40 dark:border-navy-700 dark:bg-navy-900'
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => togglePillar(p.code)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                      />
                      <div className="flex-1">
                        <div className="text-base font-bold text-navy-500 dark:text-slate-100">{p.label}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{p.description}</div>
                      </div>
                      <Badge tone={on ? 'teal' : 'neutral'}>{p.shortLabel}</Badge>
                    </label>
                    {on && p.subInterventions.length > 0 && (
                      <div className="border-t border-brand-teal/20 px-4 py-2.5">
                        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Sub-interventions
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {p.subInterventions.map(s => {
                            const subOn = subInterventions.has(s);
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => toggleSub(s)}
                                className={`rounded-full border-2 px-2.5 py-1 text-xs font-semibold transition-colors ${
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
            <SectionHeader title="Your notes" subtitle="Reasoning, concerns, special considerations" />
            <textarea
              value={notes}
              onChange={e => setNotes(e.currentTarget.value)}
              rows={5}
              placeholder="What stood out, what concerns you, why this intervention pack…"
              className="w-full rounded-lg border-2 border-slate-200 bg-brand-editable/30 px-3 py-2.5 text-sm leading-relaxed focus:border-brand-teal focus:outline-none dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
            />
          </Card>

          {/* Save bar */}
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

        {/* ════════ Right: Team thread ════════ */}
        <div className="space-y-5 lg:col-span-3">
          {/* Consensus tile */}
          <Card>
            <SectionHeader title="Team consensus" subtitle={
              summary && summary.total > 0
                ? `${summary.total} review${summary.total === 1 ? '' : 's'}`
                : 'No reviews yet'
            } />
            {summary && summary.total > 0 ? (
              <div className="space-y-3">
                {summary.consensus && (
                  <div className="flex items-center gap-2">
                    <Badge tone={summary.consensus === 'Mixed' ? 'amber' : DECISION_TONE[summary.consensus as ReviewDecision]}>
                      {summary.consensus}
                    </Badge>
                    {summary.divergence && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">divergent</span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950/40">
                    <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">{summary.recommend}</div>
                    <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Rec</div>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/40">
                    <div className="text-2xl font-extrabold text-amber-700 dark:text-amber-300">{summary.hold}</div>
                    <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Hold</div>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2.5 dark:bg-red-950/40">
                    <div className="text-2xl font-extrabold text-red-700 dark:text-red-300">{summary.reject}</div>
                    <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">Rej</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">Be the first to weigh in.</p>
            )}
          </Card>

          {/* Per-reviewer breakdown */}
          <Card>
            <SectionHeader title="Reviews" subtitle="Each team member's call" />
            {companyReviews.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No reviews yet.</p>
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

          {/* Comments thread */}
          <Card>
            <SectionHeader title="Discussion" subtitle="Open thread" />
            {companyComments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No comments yet.</p>
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
              <Button size="sm" onClick={handlePostComment} disabled={postingComment || !commentDraft.trim()}>
                <MessageCircle className="h-4 w-4" /> Post comment
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, inline = false }: { title: string; subtitle?: string; inline?: boolean }) {
  return (
    <div className={inline ? '' : 'mb-3'}>
      <h3 className="text-base font-extrabold text-navy-500 dark:text-white">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
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

function humanizeKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\s*\w/, c => c.toUpperCase());
}
