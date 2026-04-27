// FinalDecisionView — table of every reviewable company with the team
// consensus + per-pillar pickers and an account-manager assignment, so an
// admin can lock in the final cohort + interventions in one place.
//
// Activates once every company has at least one review (when the team's
// step-through is done). Each row expands to:
//   - Final status: Selected / Hold / Reject
//   - Per-pillar matrix (Asked / Recommended / My pick / Include? / Fund)
//   - Sub-interventions per pillar
//   - Account Manager: Mohammed Ayesh / Doaa Younis / Muna Mahroum
//   - Lock decision → writes master.status + master.profile_manager_email +
//     one Intervention Assignment row per included pillar (with per-pillar
//     fund_code so a company can carry both 97060 and 91763 across
//     different pillars).

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Download, Lock, Search, Upload } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { displayName } from '../../config/team';
import { ACCOUNT_MANAGERS } from '../../config/team';
import { PILLARS, pillarFor } from '../../config/interventions';
import type { ActivityRow, CompanyComment, PreDecisionRecommendation, Review, ReviewDecision } from './reviewTypes';
import { summarizeReviews } from './reviewTypes';
import type { ReviewableCompany } from './ReviewView';
import { ActivityTimeline } from './ActivityTimeline';
import { meaningfulEntries } from './selectionContext';

const FINAL_STATUSES = ['Selected', 'Recommended', 'Reviewing', 'Hold', 'Rejected'] as const;
type FinalStatus = (typeof FINAL_STATUSES)[number];

const FINAL_TONE: Record<FinalStatus, Tone> = {
  Selected: 'green',
  Recommended: 'orange',
  Reviewing: 'amber',
  Hold: 'amber',
  Rejected: 'red',
};

const DECISION_TONE: Record<ReviewDecision, Tone> = {
  Recommend: 'green',
  Hold: 'amber',
  Reject: 'red',
};

const FUND_OPTIONS: { value: string; label: string }[] = [
  { value: '97060', label: 'Dutch (97060)' },
  { value: '91763', label: 'SIDA (91763)' },
];

export type FinalLockArgs = {
  companyId: string;
  companyName: string;
  status: FinalStatus;
  pmEmail: string;
  // One entry per intervention to materialize. fund_code is per-pillar
  // so a single company can carry multiple funds.
  interventions: Array<{ pillar: string; sub: string; fund_code: string }>;
};

export function FinalDecisionView({
  companies,
  reviews,
  reviewerEmail,
  existingAssignments,
  onLockDecision,
  onExport,
  comments = [],
  preDecisions = [],
  activity = [],
  onImportExternal,
  importingExternal = false,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  reviewerEmail: string;
  // Existing intervention assignments so the form can pre-fill picks
  // that have already been materialized for this company.
  existingAssignments: Array<{ company_id: string; intervention_type: string; sub_intervention: string; fund_code: string }>;
  onLockDecision: (args: FinalLockArgs) => Promise<void>;
  onExport?: () => Promise<{ tabName: string; rowsWritten: number; errors: string[] } | void>;
  // New: per-company comments thread (selection-tool + portal merged)
  // and pre-decision recommendations (Israa CSV / Raouf docx / future
  // seeds). Used in the row drill-down dossier and the smart pre-fill.
  comments?: CompanyComment[];
  preDecisions?: PreDecisionRecommendation[];
  // Activity log feed — surfaced inline per row drill-down.
  activity?: ActivityRow[];
  onImportExternal?: () => Promise<void>;
  importingExternal?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Phase 6 filters — status, AM, divergent flag, pillar.
  const [statusFilter, setStatusFilter] = useState<'all' | 'Selected' | 'Hold' | 'Rejected' | 'unset'>('all');
  const [amFilter, setAmFilter] = useState<string>('all');
  const [pillarFilter, setPillarFilter] = useState<string>('all');
  const [divergentOnly, setDivergentOnly] = useState(false);
  const [decidedOnly, setDecidedOnly] = useState<'all' | 'locked' | 'unlocked'>('all');

  // Indexes
  const reviewsByCompany = useMemo(() => {
    const m = new Map<string, Review[]>();
    for (const r of reviews) {
      if (!r.company_id) continue;
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [reviews]);

  const commentsByCompany = useMemo(() => {
    const m = new Map<string, CompanyComment[]>();
    for (const c of comments) {
      if (!c.company_id) continue;
      (m.get(c.company_id) || m.set(c.company_id, []).get(c.company_id)!).push(c);
    }
    return m;
  }, [comments]);

  const preDecisionsByCompany = useMemo(() => {
    const m = new Map<string, PreDecisionRecommendation[]>();
    for (const r of preDecisions) {
      if (!r.company_id) continue;
      (m.get(r.company_id) || m.set(r.company_id, []).get(r.company_id)!).push(r);
    }
    return m;
  }, [preDecisions]);

  const assignsByCompany = useMemo(() => {
    const m = new Map<string, typeof existingAssignments>();
    for (const a of existingAssignments) {
      if (!a.company_id) continue;
      const arr = m.get(a.company_id) || [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return m;
  }, [existingAssignments]);

  // Filter companies by search + status + AM + pillar + divergent + decided.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter(c => {
      if (q && !`${c.company_name} ${c.sector} ${c.governorate}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'unset' && c.status) return false;
        if (statusFilter !== 'unset' && c.status !== statusFilter) return false;
      }
      if (amFilter !== 'all') {
        const am = c.profile_manager_email || '';
        if (amFilter === 'unassigned' && am) return false;
        if (amFilter !== 'unassigned' && am !== amFilter) return false;
      }
      if (pillarFilter !== 'all') {
        const assigns = assignsByCompany.get(c.company_id) || [];
        const proposed = (reviewsByCompany.get(c.company_id) || []).flatMap(r =>
          (r.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean),
        );
        const all = new Set([...assigns.map(a => a.intervention_type), ...proposed]);
        if (!all.has(pillarFilter)) return false;
      }
      if (decidedOnly !== 'all') {
        const locked = (assignsByCompany.get(c.company_id) || []).length > 0;
        if (decidedOnly === 'locked' && !locked) return false;
        if (decidedOnly === 'unlocked' && locked) return false;
      }
      if (divergentOnly) {
        const s = summarizeReviews(reviewsByCompany.get(c.company_id) || []);
        if (!s.divergence) return false;
      }
      return true;
    });
  }, [companies, search, statusFilter, amFilter, pillarFilter, decidedOnly, divergentOnly, assignsByCompany, reviewsByCompany]);

  // Top-of-table summary.
  const summary = useMemo(() => {
    let recommend = 0, hold = 0, reject = 0, mixed = 0, none = 0;
    for (const c of companies) {
      const own = reviewsByCompany.get(c.company_id) || [];
      const s = summarizeReviews(own);
      if (s.total === 0) { none += 1; continue; }
      if (s.consensus === 'Recommend') recommend += 1;
      else if (s.consensus === 'Hold') hold += 1;
      else if (s.consensus === 'Reject') reject += 1;
      else mixed += 1;
    }
    return { recommend, hold, reject, mixed, none };
  }, [companies, reviewsByCompany]);

  if (companies.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Lock className="h-8 w-8" />} title="No companies in scope" />
      </Card>
    );
  }

  // Final Decision is open to the whole team. Drive sharing on the
  // Companies workbook controls who can actually write — so a
  // non-editor will get a clear "no edit access" error from the API
  // when they try to Lock, instead of being walled off here.
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-3">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label="Recommend (consensus)" value={summary.recommend} tone="green" />
        <Tile label="Hold" value={summary.hold} tone="amber" />
        <Tile label="Reject" value={summary.reject} tone="red" />
        <Tile label="Mixed" value={summary.mixed} tone="amber" />
        <Tile label="No reviews" value={summary.none} tone="navy" />
      </div>

      <Card>
        <CardHeader
          title="Final cohort decisions"
          subtitle={`${filtered.length}/${companies.length} companies — lock status, per-pillar fund, AM. Click a row for the full dossier.`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter companies"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-56 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpanded(prev => (prev.size === filtered.length ? new Set() : new Set(filtered.map(c => c.company_id))))
                }
                title="Expand or collapse all visible rows"
              >
                {expanded.size === filtered.length && filtered.length > 0 ? 'Collapse all' : 'Expand all'}
              </Button>
              {onImportExternal && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={importingExternal}
                  onClick={onImportExternal}
                  title="Pull Israa's voting CSV + Raouf's notes into Company Comments + Pre-decision Recommendations. Idempotent."
                >
                  <Upload className="h-3.5 w-3.5" /> {importingExternal ? 'Importing…' : 'Import Israa + Raouf'}
                </Button>
              )}
              {onExport && (
                <ExportButton onExport={onExport} />
              )}
            </div>
          }
        />
        {/* Filter bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] dark:border-navy-700 dark:bg-navy-800/50">
          <span className="font-bold uppercase tracking-wider text-slate-500">Filter:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="all">Status: any</option>
            <option value="Selected">Selected</option>
            <option value="Hold">Hold</option>
            <option value="Rejected">Rejected</option>
            <option value="unset">Unset</option>
          </select>
          <select
            value={amFilter}
            onChange={e => setAmFilter(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="all">AM: any</option>
            <option value="unassigned">Unassigned</option>
            {ACCOUNT_MANAGERS.map(am => (
              <option key={am.email} value={am.email}>{am.name}</option>
            ))}
          </select>
          <select
            value={pillarFilter}
            onChange={e => setPillarFilter(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="all">Pillar: any</option>
            {PILLARS.map(p => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
          <select
            value={decidedOnly}
            onChange={e => setDecidedOnly(e.target.value as typeof decidedOnly)}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          >
            <option value="all">All</option>
            <option value="locked">Locked only</option>
            <option value="unlocked">Unlocked only</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={divergentOnly}
              onChange={e => setDivergentOnly(e.currentTarget.checked)}
            />
            Divergent reviews only
          </label>
          {(statusFilter !== 'all' || amFilter !== 'all' || pillarFilter !== 'all' || decidedOnly !== 'all' || divergentOnly || search) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all'); setAmFilter('all'); setPillarFilter('all');
                setDecidedOnly('all'); setDivergentOnly(false); setSearch('');
              }}
              className="ml-auto rounded bg-white px-2 py-0.5 font-bold text-brand-teal hover:underline dark:bg-navy-900"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <div className="grid grid-cols-[24px_1fr_140px_110px_120px_90px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
            <span />
            <span>Company</span>
            <span>Team consensus</span>
            <span>Status (master)</span>
            <span>Locks · Cmts · Recs</span>
            <span className="text-right">Reviewers</span>
          </div>
          <ul>
            {filtered.map(c => {
              const rs = reviewsByCompany.get(c.company_id) || [];
              const summary = summarizeReviews(rs);
              const isOpen = expanded.has(c.company_id);
              const existingForCompany = assignsByCompany.get(c.company_id) || [];
              const cmtsForCompany = commentsByCompany.get(c.company_id) || [];
              const preDecsForCompany = preDecisionsByCompany.get(c.company_id) || [];
              return (
                <li key={c.company_id} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(c.company_id)}
                    className="grid w-full grid-cols-[24px_1fr_140px_110px_120px_90px] items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
                  >
                    <span className="text-slate-400">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    <span className="truncate">
                      <span className="font-bold text-navy-500 dark:text-slate-100">{c.company_name}</span>
                      {c.sector && <span className="ml-1.5 text-slate-500">· {c.sector}</span>}
                    </span>
                    <span>
                      {summary.total > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Badge tone={summary.consensus === 'Mixed' ? 'amber' : DECISION_TONE[summary.consensus as ReviewDecision] || 'neutral'}>
                            {summary.total}× {summary.consensus}
                          </Badge>
                          {summary.divergence && <span className="text-[9px] font-bold text-amber-700">div</span>}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">no reviews</span>
                      )}
                    </span>
                    <span>
                      {c.status ? <Badge tone={FINAL_TONE[(c.status as FinalStatus)] || 'neutral'}>{c.status}</Badge> : <span className="text-slate-400 italic">—</span>}
                    </span>
                    <span className="font-mono text-slate-600 dark:text-slate-300">
                      <div>{existingForCompany.length > 0 ? `${existingForCompany.length} locked` : <span className="text-slate-400 italic">none</span>}</div>
                      {(cmtsForCompany.length > 0 || preDecsForCompany.length > 0) && (
                        <div className="text-[10px] text-slate-400">
                          {cmtsForCompany.length > 0 && `${cmtsForCompany.length}c`}
                          {cmtsForCompany.length > 0 && preDecsForCompany.length > 0 && ' · '}
                          {preDecsForCompany.length > 0 && `${preDecsForCompany.length}r`}
                        </div>
                      )}
                    </span>
                    <span className="text-right font-mono text-slate-500">{summary.reviewerEmails.length}</span>
                  </button>
                  {isOpen && (
                    <FinalDecisionRow
                      company={c}
                      reviews={rs}
                      reviewerEmail={reviewerEmail}
                      existingAssigns={existingForCompany}
                      onLock={onLockDecision}
                      comments={cmtsForCompany}
                      preDecs={preDecsForCompany}
                      activity={activity}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </div>
  );
}

// ─── Per-row decision form ─────────────────────────────────────────

function FinalDecisionRow({
  company,
  reviews,
  reviewerEmail,
  existingAssigns,
  onLock,
  comments = [],
  preDecs = [],
  activity = [],
}: {
  company: ReviewableCompany;
  reviews: Review[];
  reviewerEmail: string;
  existingAssigns: Array<{ company_id: string; intervention_type: string; sub_intervention: string; fund_code: string }>;
  onLock: (args: FinalLockArgs) => Promise<void>;
  comments?: CompanyComment[];
  preDecs?: PreDecisionRecommendation[];
  activity?: ActivityRow[];
}) {
  const toast = useToast();

  // Aggregate every reviewer's pillar + sub picks regardless of their
  // decision verdict (Recommend / Hold / Reject). A reviewer who voted
  // Hold but still listed pillars they think the company needs counts
  // here — the lock decision is about WHICH interventions to assign,
  // separately from whether to include the company at all.
  // Each map value carries the count + a list of contributing reviewer
  // emails so the UI can show 'Mohammad, Doaa' on hover.
  const proposedPillars = useMemo(() => {
    const c = new Map<string, { count: number; reviewers: string[] }>();
    for (const r of reviews) {
      for (const p of (r.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const e = c.get(p) || { count: 0, reviewers: [] };
        e.count += 1;
        if (r.reviewer_email && !e.reviewers.includes(r.reviewer_email)) e.reviewers.push(r.reviewer_email);
        c.set(p, e);
      }
    }
    return c;
  }, [reviews]);

  const proposedSubs = useMemo(() => {
    const c = new Map<string, { count: number; reviewers: string[] }>();
    for (const r of reviews) {
      for (const s of (r.proposed_sub_interventions || '').split(',').map(t => t.trim()).filter(Boolean)) {
        const e = c.get(s) || { count: 0, reviewers: [] };
        e.count += 1;
        if (r.reviewer_email && !e.reviewers.includes(r.reviewer_email)) e.reviewers.push(r.reviewer_email);
        c.set(s, e);
      }
    }
    return c;
  }, [reviews]);

  // My own picks (if I reviewed this company) take priority over the
  // team aggregate — the admin closing out the cohort might want their
  // own picks pre-loaded.
  const myReview = useMemo(() => {
    const lower = (reviewerEmail || '').toLowerCase();
    return reviews.find(r => r.reviewer_email?.toLowerCase() === lower) || null;
  }, [reviews, reviewerEmail]);

  // Pre-fill order:
  //   1. Existing locked Intervention Assignments  (don't undo prior locks)
  //   2. My own review picks                       (preserve admin intent)
  //   3. Union of every reviewer's picks           (team consensus)
  //   4. The applicant's wantsXXX flags            (last-resort fallback)
  // Smart pre-fill priority (plan Phase 6):
  //   1) Existing locked assignment for this pillar (don't undo a lock).
  //   2) Pre-decision recommendations from Israa CSV / Raouf docx — the
  //      "before tomorrow" team consensus that was imported.
  //   3) Majority of team Recommend reviews from the per-reviewer step.
  //   4) Interview Assessment's assessedInterventions.
  //   5) Applicant's wantsXXX flags as a last resort.
  const initialPillars = useMemo(() => {
    const set = new Set<string>();
    // (1) existing assignments
    for (const a of existingAssigns) {
      const p = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (p) set.add(p);
    }
    // (2) pre-decision recommendations
    for (const r of preDecs) {
      const p = pillarFor(r.pillar)?.code || r.pillar;
      if (p) set.add(p);
    }
    // (3) majority team Recommend
    if (set.size === 0) {
      for (const [p] of proposedPillars) set.add(p);
    }
    // (3b) my own picks fall back here too
    if (set.size === 0 && myReview) {
      for (const p of (myReview.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean)) set.add(p);
    }
    // (4 / 5) applicant's asked-for set as the last fallback
    if (set.size === 0) {
      for (const [code, key] of Object.entries(WANTED_KEY)) {
        if (asBool(company.applicantRaw?.[key])) set.add(code);
      }
    }
    return set;
  }, [existingAssigns, preDecs, myReview, proposedPillars, company.applicantRaw]);

  const initialSubs = useMemo(() => {
    const set = new Set<string>();
    for (const a of existingAssigns) {
      const s = (a.sub_intervention || '').trim();
      if (s) set.add(s);
    }
    for (const r of preDecs) {
      const s = (r.sub_intervention || '').trim();
      if (s) set.add(s);
    }
    if (myReview) {
      for (const s of (myReview.proposed_sub_interventions || '').split(',').map(t => t.trim()).filter(Boolean)) set.add(s);
    }
    if (set.size === 0) {
      for (const [s] of proposedSubs) set.add(s);
    }
    return set;
  }, [existingAssigns, preDecs, myReview, proposedSubs]);

  const initialFunds: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    // (1) existing locked fund_code wins.
    for (const a of existingAssigns) {
      const p = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (p && a.fund_code) m[p] = a.fund_code;
    }
    // (2) pre-decision fund_hint fills the rest.
    for (const r of preDecs) {
      const p = pillarFor(r.pillar)?.code || r.pillar;
      if (p && !m[p] && r.fund_hint) m[p] = r.fund_hint;
    }
    return m;
  }, [existingAssigns, preDecs]);

  const [status, setStatus] = useState<FinalStatus>(
    (company.status === 'Selected' || company.status === 'Hold' || company.status === 'Rejected'
      ? company.status
      : 'Selected') as FinalStatus
  );
  const [pillars, setPillars] = useState<Set<string>>(initialPillars);
  const [subs, setSubs] = useState<Set<string>>(initialSubs);
  const [fundsByPillar, setFundsByPillar] = useState<Record<string, string>>(() => ({
    // Default per-pillar fund: use existing if present, else company's fund_code, else 97060.
    ...Object.fromEntries(PILLARS.map(p => [p.code, company.fund_code || '97060'])),
    ...initialFunds,
  }));
  const [pmEmail, setPmEmail] = useState<string>(company.profile_manager_email || '');
  const [locking, setLocking] = useState(false);
  const [lastLockedAt, setLastLockedAt] = useState<string | null>(null);

  // Reset picks when the team's reviews change AND the admin hasn't
  // started editing yet. Once the admin makes a single change
  // (touched), we stop overriding their state.
  const touchedRef = useRef(false);
  const lastReviewSig = useRef('');
  useEffect(() => {
    const sig = reviews.map(r => `${r.reviewer_email}:${r.proposed_pillars}:${r.proposed_sub_interventions}`).join('|');
    if (sig === lastReviewSig.current) return;
    lastReviewSig.current = sig;
    if (touchedRef.current) return;
    setPillars(new Set(initialPillars));
    setSubs(new Set(initialSubs));
  }, [reviews, initialPillars, initialSubs]);

  const togglePillar = (code: string) => {
    touchedRef.current = true;
    setPillars(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
        const dead = new Set(PILLARS.find(p => p.code === code)?.subInterventions || []);
        if (dead.size > 0) {
          setSubs(prevS => {
            const ns = new Set(prevS);
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
    touchedRef.current = true;
    setSubs(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    const parent = pillarFor(code);
    if (parent) setPillars(prev => { const next = new Set(prev); next.add(parent.code); return next; });
  };

  const handleLock = async () => {
    if (!pmEmail) {
      toast.error('Pick an Account Manager', 'Mohammad / Doaa / Muna.');
      return;
    }
    setLocking(true);
    try {
      const interventions: FinalLockArgs['interventions'] = [];
      for (const p of pillars) {
        const subsForP = Array.from(subs).filter(s => pillarFor(s)?.code === p);
        const fund = fundsByPillar[p] || '';
        if (subsForP.length === 0) {
          interventions.push({ pillar: p, sub: '', fund_code: fund });
        } else {
          for (const s of subsForP) {
            interventions.push({ pillar: p, sub: s, fund_code: fund });
          }
        }
      }
      await onLock({
        companyId: company.company_id,
        companyName: company.company_name,
        status,
        pmEmail,
        interventions,
      });
      setLastLockedAt(new Date().toISOString());
      touchedRef.current = false; // re-enable auto-pickup of further team review changes
      toast.success('Locked & synced',
        `${company.company_name} → ${status} · ${interventions.length} intervention${interventions.length === 1 ? '' : 's'} · AM ${displayName(pmEmail)}. Master + Intervention Assignments sheets updated.`);
    } catch (e) {
      toast.error('Lock failed', (e as Error).message);
    } finally {
      setLocking(false);
    }
  };

  // Agreement strip — quick visual: which pillars team proposed vs which
  // selection-tool / pre-decision recs picked, and where they diverge.
  const teamProposedSet = new Set(proposedPillars.keys());
  const selectionRecSet = new Set<string>();
  for (const r of preDecs) {
    const code = pillarFor(r.pillar)?.code || r.pillar;
    if (code) selectionRecSet.add(code);
  }
  // Also surface Interview Assessment's assessedInterventions if present.
  const interviewRecRaw = company.selection?.interviewAssessment?.['assessedInterventions'] || '';
  for (const piece of interviewRecRaw.split(/[,;|]/).map(s => s.trim()).filter(Boolean)) {
    const code = pillarFor(piece)?.code;
    if (code) selectionRecSet.add(code);
  }
  const agreementUnion = new Set([...teamProposedSet, ...selectionRecSet]);
  const agreementBoth = new Set([...teamProposedSet].filter(p => selectionRecSet.has(p)));
  const teamOnly = new Set([...teamProposedSet].filter(p => !selectionRecSet.has(p)));
  const selectionOnly = new Set([...selectionRecSet].filter(p => !teamProposedSet.has(p)));

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-navy-800 dark:bg-navy-800/30">
      {/* Agreement strip — quick visual of team vs selection-tool agreement */}
      {agreementUnion.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-navy-700 dark:bg-navy-900">
          <span className="font-bold uppercase tracking-wider text-slate-500">Agreement:</span>
          {agreementBoth.size > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-emerald-700 dark:text-emerald-300">Both:</span>
              {[...agreementBoth].map(p => (
                <span key={p} className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{p}</span>
              ))}
            </span>
          )}
          {teamOnly.size > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-blue-700 dark:text-blue-300">Team only:</span>
              {[...teamOnly].map(p => (
                <span key={p} className="rounded bg-blue-100 px-1.5 py-0.5 font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{p}</span>
              ))}
            </span>
          )}
          {selectionOnly.size > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="font-bold text-purple-700 dark:text-purple-300">Selection only:</span>
              {[...selectionOnly].map(p => (
                <span key={p} className="rounded bg-purple-100 px-1.5 py-0.5 font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-200">{p}</span>
              ))}
            </span>
          )}
          {teamOnly.size === 0 && selectionOnly.size === 0 && agreementBoth.size > 0 && (
            <span className="ml-auto text-[10px] font-bold text-emerald-700">Full agreement</span>
          )}
          {(teamOnly.size > 0 || selectionOnly.size > 0) && (
            <span className="ml-auto text-[10px] font-bold text-amber-700">Divergence — review dossier</span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* LEFT col-span-7: full dossier — applicant snapshot, selection-tool data, comments, recs, activity */}
        <div className="space-y-3 lg:col-span-7">
          <DossierColumn
            company={company}
            comments={comments}
            preDecs={preDecs}
            activity={activity}
            reviews={reviews}
          />
        </div>

        {/* RIGHT col-span-5 (sticky): status + AM + per-pillar matrix + Lock */}
        <div className="lg:col-span-5">
          <div className="space-y-3 lg:sticky lg:top-3">
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Final status</h4>
            <div className="grid grid-cols-3 gap-1">
              {FINAL_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-md border-2 px-2 py-1.5 text-xs font-bold transition ${
                    status === s
                      ? `border-${FINAL_TONE[s]}-500 bg-${FINAL_TONE[s]}-50 text-${FINAL_TONE[s]}-800 dark:bg-${FINAL_TONE[s]}-950`
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200'
                  }`}
                  style={status === s ? statusStyle(s) : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
            <h4 className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Account Manager</h4>
            <div className="grid grid-cols-3 gap-1">
              {ACCOUNT_MANAGERS.map(am => (
                <label
                  key={am.email}
                  className={`flex cursor-pointer items-center justify-center rounded-md border-2 px-2 py-1.5 text-[11px] font-bold ${
                    pmEmail === am.email
                      ? 'border-brand-teal bg-teal-50 text-brand-teal dark:bg-teal-950'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name={`am-${company.company_id}`}
                    checked={pmEmail === am.email}
                    onChange={() => setPmEmail(am.email)}
                    className="sr-only"
                  />
                  {am.name.split(' ')[0]}
                </label>
              ))}
            </div>
          </div>

          {/* Per-pillar matrix */}
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Per-pillar decisions</h4>
          <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
            <div className="grid grid-cols-[1.8fr_50px_50px_50px_120px] border-b border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-400">
              <span>Pillar</span>
              <span className="text-center text-blue-700">Asked</span>
              <span className="text-center text-purple-700">Rec</span>
              <span className="text-center">Include</span>
              <span>Fund</span>
            </div>
            <ul>
              {PILLARS.map(p => {
                const on = pillars.has(p.code);
                const rec = proposedPillars.get(p.code);
                const recCount = rec?.count || 0;
                const totalRecs = Math.max(1, ...Array.from(proposedPillars.values()).map(v => v.count));
                const fund = fundsByPillar[p.code] || '';
                return (
                  <li key={p.code} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                    <div className="grid grid-cols-[1.8fr_50px_50px_50px_120px] items-center gap-1 px-2 py-1.5 text-xs">
                      <span>
                        <div className="font-bold text-navy-500 dark:text-slate-100">{p.label}</div>
                        <div className="text-[10px] text-slate-500">{p.shortLabel}</div>
                      </span>
                      <span className="text-center">
                        {/* Asked = company-requested via wantsXXX. Look up from applicantRaw. */}
                        {wantedBy(company.applicantRaw, p.code) ? <CheckCircle2 className="inline h-3.5 w-3.5 text-blue-600" /> : <span className="text-slate-300">—</span>}
                      </span>
                      <span className="text-center">
                        {recCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-purple-700 dark:text-purple-300"
                            title={`${recCount} of ${totalRecs} reviewer${recCount === 1 ? '' : 's'}: ${(rec?.reviewers || []).map(displayName).join(', ')}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="text-[9px] font-bold">{recCount}</span>
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </span>
                      <span className="text-center">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => togglePillar(p.code)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                        />
                      </span>
                      <span>
                        {on ? (
                          <select
                            value={fund}
                            onChange={e => setFundsByPillar({ ...fundsByPillar, [p.code]: e.currentTarget.value })}
                            className="w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                          >
                            <option value="">—</option>
                            {FUND_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                          </select>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </span>
                    </div>
                    {on && p.subInterventions.length > 0 && (
                      <div className="border-t border-slate-100 bg-white px-3 py-1.5 dark:border-navy-800 dark:bg-navy-900/40">
                        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Sub-interventions</div>
                        <div className="flex flex-wrap gap-1">
                          {p.subInterventions.map(s => {
                            const subOn = subs.has(s);
                            const subRec = proposedSubs.get(s);
                            const subRecCount = subRec?.count || 0;
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => toggleSub(s)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  subOn
                                    ? 'border-brand-teal bg-brand-teal text-white'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-brand-teal hover:text-brand-teal dark:border-navy-700 dark:bg-navy-900 dark:text-slate-300'
                                }`}
                                title={subRecCount > 0 ? `${subRecCount} reviewer${subRecCount === 1 ? '' : 's'}: ${(subRec?.reviewers || []).map(displayName).join(', ')}` : undefined}
                              >
                                {s.replace(/^MA-/, '')}
                                {subRecCount > 0 && <span className="ml-1 opacity-70">·{subRecCount}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

          {/* Lock card — sticky bottom of the right column */}
          <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
            <Button onClick={handleLock} disabled={locking || !pmEmail} className="w-full">
              <Lock className="h-3.5 w-3.5" /> {locking ? 'Locking…' : 'Lock decision'}
            </Button>
            {lastLockedAt && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Synced at {new Date(lastLockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {(existingAssigns.length > 0 || preDecs.length > 0 || proposedPillars.size > 0) && (
              <div className="mt-2 space-y-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 dark:border-navy-700 dark:bg-navy-800/50">
                <div className="font-bold uppercase tracking-wider text-slate-400">Pre-filled from</div>
                {existingAssigns.length > 0 && <div>· {existingAssigns.length} locked assignment(s)</div>}
                {preDecs.length > 0 && <div>· {preDecs.length} pre-decision rec(s) [{Array.from(new Set(preDecs.map(p => p.author_email.split('@')[0]))).join(', ')}]</div>}
                {proposedPillars.size > 0 && <div>· {proposedPillars.size} team-proposed pillar(s)</div>}
              </div>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Writes Companies Master (status + AM) + Intervention Assignments (one row per pillar). Idempotent.
            </p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DossierColumn — full per-company context, left side of drilldown ──

function DossierColumn({
  company,
  comments,
  preDecs,
  activity,
  reviews,
}: {
  company: ReviewableCompany;
  comments: CompanyComment[];
  preDecs: PreDecisionRecommendation[];
  activity: ActivityRow[];
  reviews: Review[];
}) {
  const sel = company.selection;
  const scoreClass = pickFirst(sel?.scoring, ['class', 'tier', 'grade', 'score class']);
  const totalScore = pickFirst(sel?.scoring, ['total_score', 'total score', 'score', 'weighted']);
  const rank = pickFirst(sel?.scoring, ['rank', 'position']);
  const interviewRating = pickFirst(sel?.interviewAssessment, ['rating', 'score', 'grade', 'recommend']);
  const sortedComments = useMemo(
    () => comments.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    [comments],
  );

  return (
    <>
      {/* Snapshot */}
      <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
        <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Snapshot</h4>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <SnapTile label="Score class" value={scoreClass || '—'} hint={[totalScore && `Total ${totalScore}`, rank && `Rank ${rank}`].filter(Boolean).join(' · ') || undefined} />
          <SnapTile label="Interview" value={interviewRating || '—'} />
          <SnapTile label="Sector" value={company.sector || '—'} hint={[company.city, company.governorate].filter(Boolean).join(', ')} />
          <SnapTile label="Employees" value={company.employee_count || '—'} hint={company.fund_code ? `Fund ${company.fund_code}` : undefined} />
        </div>
      </div>

      {/* Selection-tool sections — collapsed by default per section so the dossier stays scannable */}
      {sel?.docReview && (
        <DossierBlock title="Doc review" row={sel.docReview} />
      )}
      {(sel?.firstFiltration || sel?.additionalFiltration) && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtration</h4>
          {sel.firstFiltration && <DossierKV row={sel.firstFiltration} />}
          {sel.additionalFiltration && (
            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-navy-800">
              <div className="mb-1 text-[10px] font-bold text-slate-500">Additional factors</div>
              <DossierKV row={sel.additionalFiltration} />
            </div>
          )}
        </div>
      )}
      {sel?.interviewAssessment && (
        <DossierBlock title="Interview assessment" row={sel.interviewAssessment} />
      )}
      {(sel?.interviewDiscussionAll && sel.interviewDiscussionAll.length > 0) && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Interview discussion ({sel.interviewDiscussionAll.length})
          </h4>
          <div className="space-y-2">
            {sel.interviewDiscussionAll.map((row, i) => (
              <div key={i} className="rounded border border-slate-100 p-2 dark:border-navy-800">
                <DossierKV row={row} />
              </div>
            ))}
          </div>
        </div>
      )}
      {(sel?.selectionVotesAll && sel.selectionVotesAll.length > 0) && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Selection votes ({sel.selectionVotesAll.length} voters)
          </h4>
          <div className="space-y-2">
            {sel.selectionVotesAll.map((row, i) => (
              <div key={i} className="rounded border border-slate-100 p-2 dark:border-navy-800">
                <DossierKV row={row} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team reviews — what the team wrote during step-through */}
      {reviews.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Team reviews ({reviews.length})
          </h4>
          <ul className="space-y-1.5">
            {reviews.slice().sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || '')).map(r => (
              <li key={r.review_id} className="rounded border border-slate-100 p-2 text-xs dark:border-navy-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-navy-500 dark:text-slate-100">{displayName(r.reviewer_email)}</span>
                  {r.decision && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.decision === 'Recommend' ? 'bg-emerald-100 text-emerald-800' : r.decision === 'Hold' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{r.decision}</span>}
                </div>
                {r.proposed_pillars && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.proposed_pillars.split(',').map(s => s.trim()).filter(Boolean).map(p => (
                      <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-navy-800">{p}</span>
                    ))}
                  </div>
                )}
                {r.notes && <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{r.notes}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pre-decision recommendations (Israa CSV / Raouf docx) */}
      {preDecs.length > 0 && (
        <div className="rounded-md border border-purple-200 bg-purple-50 p-3 dark:border-purple-900 dark:bg-purple-950/30">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-800 dark:text-purple-200">
            Pre-decision recs ({preDecs.length}) · {Array.from(new Set(preDecs.map(p => displayName(p.author_email)))).join(', ')}
          </h4>
          <ul className="space-y-1">
            {preDecs.map(r => (
              <li key={r.recommendation_id} className="rounded border border-purple-100 bg-white p-2 text-xs dark:border-purple-900 dark:bg-navy-900">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-purple-800 dark:text-purple-200">
                    {r.pillar}{r.sub_intervention ? ` · ${r.sub_intervention}` : ''}
                    {r.fund_hint && <span className="ml-1 text-[10px] font-normal text-purple-600">[{r.fund_hint}]</span>}
                  </span>
                  <span className="text-[10px] text-purple-500">{displayName(r.author_email)}</span>
                </div>
                {r.note && <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{r.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Comments thread */}
      {sortedComments.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Comments ({sortedComments.length})</h4>
          <ul className="space-y-1">
            {sortedComments.map(c => (
              <li key={c.comment_id} className="rounded border border-slate-100 p-2 text-xs dark:border-navy-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-navy-500 dark:text-slate-100">{displayName(c.author_email)}</span>
                  <span className="text-[10px] text-slate-500">{c.created_at}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{c.body}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Activity timeline */}
      {activity.some(a => a.company_id === company.company_id) && (
        <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Activity</h4>
          <ActivityTimeline rows={activity} companyId={company.company_id} limit={15} />
        </div>
      )}
    </>
  );
}

function SnapTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 dark:border-navy-800 dark:bg-navy-800/50">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-bold text-navy-500 dark:text-slate-100">{value}</div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function DossierBlock({ title, row }: { title: string; row: Record<string, string> }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
      <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      <DossierKV row={row} />
    </div>
  );
}

function DossierKV({ row }: { row: Record<string, string> }) {
  const entries = meaningfulEntries(row).slice(0, 12);
  if (entries.length === 0) return <p className="text-[11px] italic text-slate-400">No data.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{k.replace(/_/g, ' ')}</dt>
          <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function pickFirst(row: Record<string, string> | null | undefined, keys: string[]): string {
  if (!row) return '';
  for (const k of keys) {
    const lower = k.toLowerCase();
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase() === lower && rv) return rv;
    }
  }
  // try contains
  for (const k of keys) {
    const lower = k.toLowerCase();
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase().includes(lower) && rv) return rv;
    }
  }
  return '';
}

// ─── helpers ────────────────────────────────────────────────────────

function asBool(v?: string): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

const WANTED_KEY: Record<string, string> = {
  TTH: 'wantsTrainToHire',
  Upskilling: 'wantsUpskilling',
  MKG: 'wantsMarketingSupport',
  MA: 'wantsLegalSupport',
  'C-Suite': 'wantsDomainCoaching',
  Conferences: 'wantsConferences',
  ElevateBridge: 'wantsElevateBridge',
};

function wantedBy(applicantRaw: Record<string, string> | null, pillarCode: string): boolean {
  if (!applicantRaw) return false;
  const key = WANTED_KEY[pillarCode];
  if (!key) return false;
  return asBool(applicantRaw[key]);
}

function statusStyle(s: FinalStatus): React.CSSProperties {
  // Tailwind doesn't pick up dynamic class names like
  // `border-${tone}-500`, so for the active-button state we just
  // render a static border via inline style. Cheaper than enumerating
  // every variant.
  const map: Record<FinalStatus, { border: string; bg: string; color: string }> = {
    Selected: { border: '#10b981', bg: '#ecfdf5', color: '#065f46' },
    Recommended: { border: '#f97316', bg: '#fff7ed', color: '#9a3412' },
    Reviewing: { border: '#f59e0b', bg: '#fffbeb', color: '#92400e' },
    Hold: { border: '#f59e0b', bg: '#fffbeb', color: '#92400e' },
    Rejected: { border: '#ef4444', bg: '#fef2f2', color: '#991b1b' },
  };
  const v = map[s];
  return { borderColor: v.border, backgroundColor: v.bg, color: v.color };
}

function ExportButton({
  onExport,
}: {
  onExport: () => Promise<{ tabName: string; rowsWritten: number; errors: string[] } | void>;
}) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={running}
      onClick={async () => {
        setRunning(true);
        try {
          const r = await onExport();
          if (r) {
            if (r.errors.length === 0) {
              toast.success('Exported',
                `${r.rowsWritten} rows written to the "${r.tabName}" tab in the Companies workbook.`);
            } else {
              toast.error('Export had warnings', r.errors[0]);
            }
          } else {
            toast.success('Exported');
          }
        } catch (e) {
          toast.error('Export failed', (e as Error).message);
        } finally {
          setRunning(false);
        }
      }}
      title="Write a Cohort Review Export tab to the Companies workbook"
    >
      <Download className="h-3.5 w-3.5" /> {running ? 'Exporting…' : 'Export to sheet'}
    </Button>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'green' | 'amber' | 'red' | 'navy' }) {
  const cls: Record<string, string> = {
    green: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-300 bg-amber-50 text-amber-800',
    red: 'border-red-300 bg-red-50 text-red-800',
    navy: 'border-slate-200 bg-white text-navy-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-100',
  };
  return (
    <div className={`rounded-lg border p-2 ${cls[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold">{value}</div>
    </div>
  );
}
