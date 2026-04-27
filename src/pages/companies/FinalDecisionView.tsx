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
import { CheckCircle2, ChevronDown, ChevronRight, Download, Lock, Search } from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { displayName } from '../../config/team';
import { ACCOUNT_MANAGERS } from '../../config/team';
import { PILLARS, pillarFor } from '../../config/interventions';
import type { Review, ReviewDecision } from './reviewTypes';
import { summarizeReviews } from './reviewTypes';
import type { ReviewableCompany } from './ReviewView';

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
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  reviewerEmail: string;
  // Existing intervention assignments so the form can pre-fill picks
  // that have already been materialized for this company.
  existingAssignments: Array<{ company_id: string; intervention_type: string; sub_intervention: string; fund_code: string }>;
  onLockDecision: (args: FinalLockArgs) => Promise<void>;
  onExport?: () => Promise<{ tabName: string; rowsWritten: number; errors: string[] } | void>;
}) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Filter companies by search.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(c =>
      `${c.company_name} ${c.sector} ${c.governorate}`.toLowerCase().includes(q)
    );
  }, [companies, search]);

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
          subtitle="Lock each company's status, intervention pack (per-pillar fund), and Account Manager."
          action={
            <div className="flex items-center gap-2">
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
              {onExport && (
                <ExportButton onExport={onExport} />
              )}
            </div>
          }
        />
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <div className="grid grid-cols-[24px_1fr_140px_110px_100px_90px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300">
            <span />
            <span>Company</span>
            <span>Team consensus</span>
            <span>Status (master)</span>
            <span>Interventions</span>
            <span className="text-right">Reviewers</span>
          </div>
          <ul>
            {filtered.map(c => {
              const rs = reviewsByCompany.get(c.company_id) || [];
              const summary = summarizeReviews(rs);
              const isOpen = expanded.has(c.company_id);
              const existingForCompany = assignsByCompany.get(c.company_id) || [];
              return (
                <li key={c.company_id} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(c.company_id)}
                    className="grid w-full grid-cols-[24px_1fr_140px_110px_100px_90px] items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
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
                      {existingForCompany.length > 0 ? `${existingForCompany.length} locked` : <span className="text-slate-400 italic">none</span>}
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
}: {
  company: ReviewableCompany;
  reviews: Review[];
  reviewerEmail: string;
  existingAssigns: Array<{ company_id: string; intervention_type: string; sub_intervention: string; fund_code: string }>;
  onLock: (args: FinalLockArgs) => Promise<void>;
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
  const initialPillars = useMemo(() => {
    const set = new Set<string>();
    // 1) existing assignments
    for (const a of existingAssigns) {
      const p = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (p) set.add(p);
    }
    // 2) my own picks
    if (myReview) {
      for (const p of (myReview.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean)) set.add(p);
    }
    // 3) team union when nothing else surfaced
    if (set.size === 0) {
      for (const [p] of proposedPillars) set.add(p);
    }
    // 4) applicant's asked-for set as the last fallback (still empty)
    if (set.size === 0) {
      for (const [code, key] of Object.entries(WANTED_KEY)) {
        if (asBool(company.applicantRaw?.[key])) set.add(code);
      }
    }
    return set;
  }, [existingAssigns, myReview, proposedPillars, company.applicantRaw]);

  const initialSubs = useMemo(() => {
    const set = new Set<string>();
    for (const a of existingAssigns) {
      const s = (a.sub_intervention || '').trim();
      if (s) set.add(s);
    }
    if (myReview) {
      for (const s of (myReview.proposed_sub_interventions || '').split(',').map(t => t.trim()).filter(Boolean)) set.add(s);
    }
    if (set.size === 0) {
      for (const [s] of proposedSubs) set.add(s);
    }
    return set;
  }, [existingAssigns, myReview, proposedSubs]);

  const initialFunds: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of existingAssigns) {
      const p = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (p && a.fund_code) m[p] = a.fund_code;
    }
    return m;
  }, [existingAssigns]);

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

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-navy-800 dark:bg-navy-800/30">
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: status + AM */}
        <div className="space-y-3 lg:col-span-3">
          <div>
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Final status</h4>
            <div className="grid grid-cols-2 gap-1">
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
          </div>
          <div>
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Account Manager</h4>
            <div className="space-y-1">
              {ACCOUNT_MANAGERS.map(am => (
                <label key={am.email} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs hover:border-brand-teal dark:border-navy-700 dark:bg-navy-900">
                  <input
                    type="radio"
                    name={`am-${company.company_id}`}
                    checked={pmEmail === am.email}
                    onChange={() => setPmEmail(am.email)}
                  />
                  <span className="font-semibold text-navy-500 dark:text-slate-100">{am.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Center: per-pillar matrix */}
        <div className="lg:col-span-7">
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

        {/* Right: lock button */}
        <div className="lg:col-span-2">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Lock</h4>
          <Button onClick={handleLock} disabled={locking || !pmEmail} className="w-full">
            <Lock className="h-3.5 w-3.5" /> {locking ? 'Locking…' : 'Lock decision'}
          </Button>
          {lastLockedAt && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> Synced at {new Date(lastLockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Writes to <span className="font-bold">Companies Master</span> (status + AM) and
            <span className="font-bold"> Intervention Assignments</span> (one row per included pillar with its per-pillar fund_code).
            Idempotent — re-locking won't duplicate existing pairs.
          </p>
        </div>
      </div>
    </div>
  );
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
