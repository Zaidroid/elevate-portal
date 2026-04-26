// ReviewView — the team's step-through workflow for going through every
// post-interview company, deciding inclusion, and proposing interventions.
//
// Layout (desktop):
//   [progress bar + nav]
//   [ Selection snapshot         | Decision form        | Team thread     ]
//   [   Source Data application  |  Recommend/Hold/Rej  |  Existing       ]
//   [   Master enrichment        |  Pillars + subs      |  team reviews   ]
//   [   Interview-tracker info   |  Notes               |  + comments     ]
//   [ Save & Next | Skip | Prev ]
//
// All writes land in the Companies workbook (Reviews / Company Comments
// / Activity Log tabs auto-created via ensureSchema). Reviews are keyed
// by review_id but uniqueness on (reviewer_email + company_id) is enforced
// at save time so a reviewer's edit updates rather than duplicates.

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Save, SkipForward, ThumbsDown, ThumbsUp, PauseCircle } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '../../lib/ui';
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
  // Raw applicant snapshot from Source Data — every key/value pair captured
  // at application time. Rendered as a structured table so the reviewer
  // sees everything the company shared.
  applicantRaw: Record<string, string> | null;
  // Master row enrichment — the operational fields the team has already
  // filled (PM, fund, sector, etc.).
  masterRaw: Record<string, string> | null;
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

  // Per-company review aggregation (drives the progress bar + the "X of Y"
  // strip + the kanban / roster badges).
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

  // Local form state — primed from the existing review (if any) when the
  // user navigates between companies. Reset cleanly on every cursor change.
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
  }, [myExistingReview, company?.company_id]);

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<MessageCircle className="h-8 w-8" />}
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
          icon={<MessageCircle className="h-8 w-8" />}
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
        // Clear sub-interventions tied to this pillar when the pillar is dropped.
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
    // Auto-select the parent pillar when a sub is checked.
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

  return (
    <div className="space-y-4">
      {/* Progress strip + nav */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={cursor === 0}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="text-sm font-bold text-navy-500 dark:text-white">
              {cursor + 1} / {companies.length}
            </span>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={cursor === companies.length - 1}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
              <div
                className="h-full bg-brand-teal transition-all"
                style={{ width: `${Math.round((reviewedCount / Math.max(1, companies.length)) * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {reviewedCount} / {companies.length} reviewed by anyone · {myReviewedCount} by you
            </div>
          </div>
          <select
            value={cursor}
            onChange={e => setCursor(Number(e.currentTarget.value))}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            title="Jump to a company"
          >
            {companies.map((c, i) => {
              const s = summaryByCompany.get(c.company_id);
              const tag = s && s.total > 0 ? ` · ${s.consensus}` : '';
              return (
                <option key={c.company_id} value={i}>
                  {c.company_name || c.company_id}{tag}
                </option>
              );
            })}
          </select>
        </div>
      </Card>

      {/* The 3-column working surface */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left — selection snapshot */}
        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader
              title={company.company_name || 'Unnamed company'}
              subtitle={[company.sector, [company.city, company.governorate].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined}
              action={
                onJumpToCompany ? (
                  <Button variant="ghost" size="sm" onClick={() => onJumpToCompany(company.route_id)}>
                    Open detail →
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-1 text-sm">
              <KV label="Status" value={<Badge tone="teal">{company.status || 'Interviewed'}</Badge>} />
              <KV label="Fund" value={company.fund_code ? <Badge tone={company.fund_code === '97060' ? 'teal' : 'amber'}>{company.fund_code === '97060' ? 'Dutch (97060)' : 'SIDA (91763)'}</Badge> : <span className="text-slate-400">unset</span>} />
              <KV label="Profile Manager" value={company.profile_manager_email ? displayName(company.profile_manager_email) : <span className="text-slate-400">unassigned</span>} />
              <KV label="Employees" value={company.employee_count || '—'} />
              <KV label="Readiness score" value={company.readiness_score || '—'} />
              <KV label="Contact" value={company.contact_email || '—'} />
            </div>
          </Card>

          {company.applicantRaw && Object.keys(company.applicantRaw).length > 0 && (
            <Card>
              <CardHeader title="Application snapshot" subtitle="What the company submitted in Source Data" />
              <div className="max-h-[480px] space-y-1 overflow-y-auto pr-2 text-xs">
                {Object.entries(company.applicantRaw)
                  .filter(([k, v]) => v && v.trim() && !['id', 'name', 'companyName', 'company_name'].includes(k))
                  .map(([k, v]) => (
                    <KV key={k} label={humanizeKey(k)} value={<span className="whitespace-pre-wrap break-words">{v}</span>} compact />
                  ))}
              </div>
            </Card>
          )}
        </div>

        {/* Center — decision form */}
        <div className="space-y-4 lg:col-span-4">
          <Card accent="teal">
            <CardHeader title="Your decision" subtitle="Pick one. The team aggregate is shown on the right." />
            <div className="grid grid-cols-3 gap-2">
              {REVIEW_DECISIONS.map(d => {
                const active = decision === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDecision(d)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-bold transition-colors ${
                      active
                        ? d === 'Recommend'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-200'
                          : d === 'Hold'
                          ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100'
                          : 'border-red-500 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950 dark:text-red-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200'
                    }`}
                  >
                    {DECISION_ICON[d]} {d}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Proposed interventions" subtitle="Pillars + sub-interventions you'd recommend" />
            <div className="space-y-2">
              {PILLARS.map(p => {
                const on = pillars.has(p.code);
                return (
                  <div key={p.code} className={`rounded-lg border ${on ? 'border-brand-teal bg-teal-50/40 dark:bg-teal-950/30' : 'border-slate-200 dark:border-navy-700'} p-2`}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-navy-500 dark:text-slate-100">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => togglePillar(p.code)}
                      />
                      <span>{p.label}</span>
                      <span className="text-[11px] font-normal text-slate-500">{p.shortLabel}</span>
                    </label>
                    {on && p.subInterventions.length > 0 && (
                      <div className="ml-6 mt-1 flex flex-wrap gap-1.5">
                        {p.subInterventions.map(s => {
                          const subOn = subInterventions.has(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleSub(s)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                subOn
                                  ? 'border-brand-teal bg-brand-teal text-white'
                                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-300'
                              }`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Notes" subtitle="Your reasoning, scoped to this company" />
            <textarea
              value={notes}
              onChange={e => setNotes(e.currentTarget.value)}
              rows={5}
              placeholder="What stood out, what concerns you, why this intervention pack…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
            />
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => handleSave(true)} disabled={savingReview || !decision}>
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
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              You already reviewed this company on {fmtDate(myExistingReview.updated_at)} — saving will overwrite.
            </div>
          )}
        </div>

        {/* Right — team thread */}
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader
              title="Team consensus"
              subtitle={summary && summary.total > 0
                ? `${summary.total} reviewer${summary.total === 1 ? '' : 's'}`
                : 'No reviews yet'
              }
            />
            {summary && summary.total > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {summary.consensus && (
                    <Badge tone={summary.consensus === 'Mixed' ? 'amber' : DECISION_TONE[summary.consensus as ReviewDecision]}>
                      {summary.consensus}
                    </Badge>
                  )}
                  {summary.divergence && <span className="text-[11px] text-amber-700 dark:text-amber-300">Divergent</span>}
                </div>
                <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div className="rounded bg-emerald-50 p-1.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    <div className="text-base font-bold">{summary.recommend}</div>Rec
                  </div>
                  <div className="rounded bg-amber-50 p-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    <div className="text-base font-bold">{summary.hold}</div>Hold
                  </div>
                  <div className="rounded bg-red-50 p-1.5 text-red-800 dark:bg-red-950 dark:text-red-200">
                    <div className="text-base font-bold">{summary.reject}</div>Rej
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Be the first to weigh in.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Reviews" subtitle="Each team member's decision + proposed interventions" />
            {companyReviews.length === 0 ? (
              <p className="text-xs text-slate-500">No reviews yet.</p>
            ) : (
              <ul className="space-y-2">
                {companyReviews
                  .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
                  .map(r => (
                    <li key={r.review_id} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-navy-700">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-navy-500 dark:text-slate-100">{displayName(r.reviewer_email)}</span>
                        {r.decision && <Badge tone={DECISION_TONE[r.decision as ReviewDecision]}>{r.decision}</Badge>}
                      </div>
                      {(r.proposed_pillars || r.proposed_sub_interventions) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {splitCsv(r.proposed_pillars).map(p => (
                            <span key={p} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] dark:border-navy-700 dark:bg-navy-800">{p}</span>
                          ))}
                          {splitCsv(r.proposed_sub_interventions).map(s => (
                            <span key={s} className="rounded border border-brand-teal/40 bg-teal-50 px-1.5 py-0.5 text-[10px] text-brand-teal dark:bg-teal-950">{s}</span>
                          ))}
                        </div>
                      )}
                      {r.notes && <p className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{r.notes}</p>}
                      <div className="mt-1 text-[10px] text-slate-400">{fmtDate(r.updated_at)}</div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Comments" subtitle="Open thread per company" />
            {companyComments.length === 0 ? (
              <p className="text-xs text-slate-500">No comments yet.</p>
            ) : (
              <ul className="space-y-2">
                {companyComments.map(c => (
                  <li key={c.comment_id} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-navy-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-navy-500 dark:text-slate-100">{displayName(c.author_email)}</span>
                      <span className="text-[10px] text-slate-400">{fmtDate(c.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{c.body}</p>
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
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
              />
              <Button size="sm" onClick={handlePostComment} disabled={postingComment || !commentDraft.trim()}>
                <MessageCircle className="h-3.5 w-3.5" /> Post
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value, compact = false }: { label: string; value: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${compact ? '' : 'border-b border-slate-100 py-1 last:border-b-0 dark:border-navy-800'}`}>
      <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-xs text-slate-700 dark:text-slate-200">{value}</span>
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
