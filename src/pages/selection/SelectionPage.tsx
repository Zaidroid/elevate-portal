// SelectionPage — the team's dedicated multi-user space for the
// review → final decision → cohort output flow. Standalone page; owns
// its own data hooks. CompaniesPage is the AM workspace and stays
// purely operational.
//
// Flow stages (visualized at the top via <StageIndicator />):
//   Stage 1 · Today's review queue   — per-reviewer triage, propose pillars, post comments
//   Stage 2 · Final cohort decisions — lock status + AM + per-pillar funds for each company
//   Stage 3 · Final cohort output    — the resulting cohort + intervention list, exportable
//
// Plus two adjacent tabs:
//   Insights — counts per pillar / sub-intervention, decision distribution, AM split, fund split, divergence rate, agreement rate with pre-decision recs
//   Imports & seeds — Israa CSV + Raouf docx import runner
//   Activity — selection-flow audit log
//
// Multi-user safety: presence heartbeat fires while the page is open
// so the team can see who's on the same company. SheetConflictError
// (already in useSheetDoc) surfaces a banner via the form's catch.

import { useEffect, useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  Lock,
  MessageCircle,
  RefreshCw,
  Search,
  Trophy,
  Users,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { ensureSchema } from '../../lib/sheets/client';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Drawer,
  EmptyState,
  PageHeader,
  Tabs,
  downloadCsv,
  timestampedFilename,
  useToast,
} from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';
import { PILLARS, pillarFor, resolveIntervention } from '../../config/interventions';
import { INTERVIEWED_NAMES, isInterviewed } from '../companies/interviewedSource';
import type { ReviewableCompany, SelectionContext } from './ReviewQueueTab';
import type { FinalLockArgs } from './FinalCohortTab';
import {
  ACTIVITY_HEADERS,
  ALIAS_HEADERS,
  COMMENTS_HEADERS,
  PRE_DECISION_HEADERS,
  REMOVED_HEADERS,
  REVIEWS_HEADERS,
  summarizeReviews,
} from '../companies/reviewTypes';
import type {
  ActivityRow,
  CompanyComment,
  InterviewAlias,
  PreDecisionRecommendation,
  RemovedCompany,
  Review,
} from '../companies/reviewTypes';
import {
  indexAllByCompanyName,
  indexByCompanyName,
  lookupAllByName,
  lookupByName,
} from '../companies/selectionContext';
import { appendActivity } from '../companies/activityLog';
import type { ActivityAction } from '../companies/activityLog';
import { ActivityTimeline } from '../companies/ActivityTimeline';
import { startPresenceHeartbeat } from './presence';

// ─── shared types (matches CompaniesPage shapes) ─────────────────────

type Master = {
  company_id: string;
  company_name: string;
  legal_name: string;
  city: string;
  governorate: string;
  sector: string;
  employee_count: string;
  revenue_bracket: string;
  fund_code: string;
  cohort: string;
  status: string;
  stage: string;
  profile_manager_email: string;
  selection_date: string;
  onboarding_date: string;
  drive_folder_url: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

type Applicant = Record<string, string>;

type Assignment = {
  assignment_id: string;
  company_id: string;
  intervention_type: string;
  sub_intervention: string;
  fund_code: string;
  start_date: string;
  end_date: string;
  owner_email: string;
  status: string;
  budget_usd: string;
  notes: string;
};

const norm = (s?: string) => (s || '').trim().toLowerCase();
function padId(n: string): string {
  const num = parseInt(n || '0', 10);
  return Number.isFinite(num) && num > 0 ? `A-${num.toString().padStart(4, '0')}` : '';
}

type Stage = 'review' | 'finalize' | 'output' | 'insights' | 'activity';

// ─── main page ───────────────────────────────────────────────────────

export function SelectionPage() {
  const { user } = useAuth();

  const masterSheetId = getSheetId('companies');
  const selectionSheetId = getSheetId('selection');

  const [stage, setStage] = useState<Stage>('review');

  // Lazy-mount the selection-tool tabs only when stages 1/2 need them
  // (insights/output/imports/activity don't). Polls every 5min.
  const reviewActive = stage === 'review' || stage === 'finalize';
  const SLOW_POLL = 5 * 60_000;
  const selSheetId = reviewActive ? selectionSheetId || null : null;
  const selOpts = useMemo(() => ({ userEmail: user?.email, intervalMs: SLOW_POLL }), [user?.email]);

  // ─── data hooks ───
  const master = useSheetDoc<Master>(masterSheetId || null, getTab('companies', 'companies'), 'company_id', { userEmail: user?.email });
  const applicants = useSheetDoc<Applicant>(selectionSheetId || null, getTab('selection', 'sourceData'), 'id', { userEmail: user?.email });
  const assignments = useSheetDoc<Assignment>(masterSheetId || null, getTab('companies', 'assignments'), 'assignment_id', { userEmail: user?.email });

  const scoring = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'scoringMatrix'), 'id', selOpts);
  const docReviews = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'docReviews'), 'id', selOpts);
  const companyNeeds = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'companyNeeds'), 'id', selOpts);
  const interviewAssessments = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'interviewAssessments'), 'id', selOpts);
  const interviewDiscussion = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'interviewDiscussion'), 'id', selOpts);
  const committeeVotes = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'committeeVotes'), 'id', selOpts);
  const selectionVotes = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'selectionVotes'), 'id', selOpts);
  const firstFiltration = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'firstFiltration'), 'id', selOpts);
  const additionalFiltration = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'additionalFiltration'), 'id', selOpts);
  const shortlists = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'shortlists'), 'id', selOpts);
  const finalCohortRows = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'finalCohort'), 'id', selOpts);

  // Logframe targets — used by the Stage 2 live insights panel to
  // surface "X of Y target" bars per pillar / per donor. Lazy-mounted
  // on Stage 2; SLOW_POLL since targets barely change mid-session.
  const logframesId = getSheetId('logframes');
  const logSheetId = stage === 'finalize' ? logframesId || null : null;
  const dutchLog = useSheetDoc<Record<string, string>>(logSheetId, getTab('logframes', 'dutch'), 'ID', selOpts);
  const sidaLog = useSheetDoc<Record<string, string>>(logSheetId, getTab('logframes', 'sida'), 'ID', selOpts);

  // Auto-create the portal-managed tabs if the workbook is missing them.
  const [schemaReady, setSchemaReady] = useState(false);
  useEffect(() => {
    if (!masterSheetId) return;
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          ensureSchema(masterSheetId, getTab('companies', 'reviews'), REVIEWS_HEADERS),
          ensureSchema(masterSheetId, getTab('companies', 'comments'), COMMENTS_HEADERS),
          ensureSchema(masterSheetId, getTab('companies', 'activity'), ACTIVITY_HEADERS),
          ensureSchema(masterSheetId, getTab('companies', 'interviewAliases'), ALIAS_HEADERS),
          ensureSchema(masterSheetId, getTab('companies', 'removedCompanies'), REMOVED_HEADERS),
          ensureSchema(masterSheetId, getTab('companies', 'preDecisions'), PRE_DECISION_HEADERS),
        ]);
      } catch (err) {
        console.warn('[selection] ensureSchema failed', err);
      }
      if (!cancelled) setSchemaReady(true);
    })();
    return () => { cancelled = true; };
  }, [masterSheetId]);

  const reviewsDoc = useSheetDoc<Review>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'reviews'), 'review_id', { userEmail: user?.email });
  const commentsDoc = useSheetDoc<CompanyComment>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'comments'), 'comment_id', { userEmail: user?.email });
  const activityDoc = useSheetDoc<ActivityRow>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'activity'), 'activity_id', { userEmail: user?.email });
  const aliasesDoc = useSheetDoc<InterviewAlias>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'interviewAliases'), 'alias_id', { userEmail: user?.email });
  const removedDoc = useSheetDoc<RemovedCompany>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'removedCompanies'), 'removed_id', { userEmail: user?.email });
  const preDecisionsDoc = useSheetDoc<PreDecisionRecommendation>(schemaReady && masterSheetId ? masterSheetId : null, getTab('companies', 'preDecisions'), 'recommendation_id', { userEmail: user?.email });

  // Per-user heartbeat so the room knows who is currently active.
  useEffect(() => {
    if (!user?.email) return;
    return startPresenceHeartbeat(user.email);
  }, [user?.email]);

  // ─── derived state ───

  const aliases = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of aliasesDoc.rows) if (r.schedule_name && r.applicant_company_name) m[r.schedule_name] = r.applicant_company_name;
    return m;
  }, [aliasesDoc.rows]);

  const removedSet = useMemo(() => new Set(removedDoc.rows.map(r => norm(r.company_name)).filter(Boolean)), [removedDoc.rows]);

  const interviewedSet = useMemo(() => {
    const set = new Set<string>();
    for (const n of INTERVIEWED_NAMES) {
      const target = aliases[n] || n;
      const t = norm(target);
      if (t && !removedSet.has(t)) set.add(t);
    }
    return set;
  }, [aliases, removedSet]);

  // Build the joined "reviewable companies" list. Source = applicants
  // that are interviewed, joined with master if present, joined with
  // every selection-tool tab via fuzzy company name lookup.
  const masterByName = useMemo(() => {
    const m = new Map<string, Master>();
    for (const r of master.rows) {
      const k = norm(r.company_name || '');
      if (k) m.set(k, r);
    }
    return m;
  }, [master.rows]);

  const applicantByName = useMemo(() => {
    const m = new Map<string, Applicant>();
    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const k = norm(name);
      if (k) m.set(k, a);
    }
    return m;
  }, [applicants.rows]);

  const scoringIdx = useMemo(() => indexByCompanyName(scoring.rows), [scoring.rows]);
  const docReviewIdx = useMemo(() => indexByCompanyName(docReviews.rows), [docReviews.rows]);
  const needsIdx = useMemo(() => indexByCompanyName(companyNeeds.rows), [companyNeeds.rows]);
  const interviewAssessIdx = useMemo(() => indexByCompanyName(interviewAssessments.rows), [interviewAssessments.rows]);
  const interviewDiscIdx = useMemo(() => indexByCompanyName(interviewDiscussion.rows), [interviewDiscussion.rows]);
  const interviewDiscAllIdx = useMemo(() => indexAllByCompanyName(interviewDiscussion.rows), [interviewDiscussion.rows]);
  const committeeIdx = useMemo(() => indexByCompanyName(committeeVotes.rows), [committeeVotes.rows]);
  const selectionVotesIdx = useMemo(() => indexByCompanyName(selectionVotes.rows), [selectionVotes.rows]);
  const selectionVotesAllIdx = useMemo(() => indexAllByCompanyName(selectionVotes.rows), [selectionVotes.rows]);
  const firstFiltrationIdx = useMemo(() => indexByCompanyName(firstFiltration.rows), [firstFiltration.rows]);
  const additionalFiltrationIdx = useMemo(() => indexByCompanyName(additionalFiltration.rows), [additionalFiltration.rows]);
  const shortlistsIdx = useMemo(() => indexByCompanyName(shortlists.rows), [shortlists.rows]);
  const finalCohortIdx = useMemo(() => indexByCompanyName(finalCohortRows.rows), [finalCohortRows.rows]);

  // Build the joined "reviewable companies" list. Mirrors the legacy
  // CompaniesPage logic so existing reviews keyed by company_id still
  // match:
  //   - Master rows with post-interview status come in unconditionally
  //     (their canonical `company_id` like E3-0042 is preserved).
  //   - Applicants matching interviewedSet are added on top, only if
  //     not already covered by a master row of the same name.
  //   - For applicant-only entries we synth `padId(a.id)` (e.g. A-0042),
  //     matching the historical save format so legacy Reviews rows
  //     still resolve.
  const POST_INTERVIEW = new Set(['Interviewed', 'Reviewing', 'Recommended', 'Selected', 'Onboarded', 'Active', 'Graduated']);
  const reviewableForView: ReviewableCompany[] = useMemo(() => {
    const seenName = new Set<string>();
    const out: ReviewableCompany[] = [];
    const buildSelection = (name: string): SelectionContext => ({
      scoring: lookupByName(scoringIdx, name),
      docReview: lookupByName(docReviewIdx, name),
      needs: lookupByName(needsIdx, name),
      interviewAssessment: lookupByName(interviewAssessIdx, name),
      interviewDiscussion: lookupByName(interviewDiscIdx, name),
      interviewDiscussionAll: lookupAllByName(interviewDiscAllIdx, name),
      committeeVotes: lookupByName(committeeIdx, name),
      selectionVotes: lookupByName(selectionVotesIdx, name),
      selectionVotesAll: lookupAllByName(selectionVotesAllIdx, name),
      firstFiltration: lookupByName(firstFiltrationIdx, name),
      additionalFiltration: lookupByName(additionalFiltrationIdx, name),
      shortlists: lookupByName(shortlistsIdx, name),
      finalCohort: lookupByName(finalCohortIdx, name),
    });

    // 1) Master rows with post-interview status. These come from the
    // Companies workbook regardless of whether the static interviewed
    // list mentions them — being in master at this status IS the
    // signal that they are part of the cohort.
    for (const m of master.rows) {
      if (!POST_INTERVIEW.has(m.status || '')) continue;
      const name = m.company_name || '';
      const nKey = norm(name);
      if (!nKey || removedSet.has(nKey) || seenName.has(nKey)) continue;
      seenName.add(nKey);
      // Pull applicant detail by name so the dossier still has app fields.
      const a = applicantByName.get(nKey);
      out.push({
        route_id: m.company_id,
        applicant_id: a?.id || '',
        company_id: m.company_id,
        company_name: name,
        sector: m.sector || a?.businessType || a?.sector || '',
        city: m.city || a?.city || '',
        governorate: m.governorate || a?.governorate || '',
        employee_count: m.employee_count || a?.numEmployees || a?.employee_count || '',
        readiness_score: a?.readinessScore || a?.readiness_score || '',
        fund_code: m.fund_code || '',
        status: m.status || 'Interviewed',
        profile_manager_email: m.profile_manager_email || '',
        contact_email: a?.email || a?.email_address || a?.contact_email || '',
        applicantRaw: (a as unknown as Record<string, string>) || null,
        masterRaw: m as unknown as Record<string, string>,
        selection: buildSelection(name),
      });
    }

    // 2) Applicants flagged as interviewed, but only if not already
    // covered by a master row above. Applicant-only IDs use the
    // legacy `A-0042` shape (padId) so older Reviews rows keep
    // matching by company_id.
    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const nKey = norm(name);
      if (!nKey || !interviewedSet.has(nKey) || removedSet.has(nKey) || seenName.has(nKey)) continue;
      seenName.add(nKey);
      const m = masterByName.get(nKey);
      const company_id = m?.company_id || padId(a.id || '');
      out.push({
        route_id: company_id || nKey,
        applicant_id: a.id || '',
        company_id: company_id || nKey,
        company_name: name,
        sector: a.businessType || a.sector || m?.sector || '',
        city: a.city || m?.city || '',
        governorate: a.governorate || m?.governorate || '',
        employee_count: a.numEmployees || a.employee_count || m?.employee_count || '',
        readiness_score: a.readinessScore || a.readiness_score || '',
        fund_code: m?.fund_code || '',
        status: m?.status || 'Interviewed',
        profile_manager_email: m?.profile_manager_email || '',
        contact_email: a.email || a.email_address || a.contact_email || '',
        applicantRaw: a as unknown as Record<string, string>,
        masterRaw: (m as unknown as Record<string, string>) || null,
        selection: buildSelection(name),
      });
    }

    return out.sort((a, b) => a.company_name.localeCompare(b.company_name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applicants.rows, master.rows, applicantByName, interviewedSet, removedSet, masterByName,
    scoringIdx, docReviewIdx, needsIdx, interviewAssessIdx, interviewDiscIdx, interviewDiscAllIdx,
    committeeIdx, selectionVotesIdx, selectionVotesAllIdx,
    firstFiltrationIdx, additionalFiltrationIdx, shortlistsIdx, finalCohortIdx,
  ]);

  // ─── activity log helper ───
  const logActivity = (action: ActivityAction, company_id?: string, extra?: { field?: string; old_value?: string; new_value?: string; details?: string }) => {
    if (!masterSheetId) return;
    void appendActivity({ sheetId: masterSheetId, tabName: getTab('companies', 'activity'), user_email: user?.email, company_id, action, ...extra });
  };

  // ─── handlers ───
  const onSaveReview = async (r: Review) => {
    const lower = r.reviewer_email.toLowerCase();
    const existing = reviewsDoc.rows.find(x => x.company_id === r.company_id && x.reviewer_email.toLowerCase() === lower);
    if (existing) await reviewsDoc.updateRow(existing.review_id, r);
    else await reviewsDoc.createRow(r);
    logActivity('review_saved', r.company_id, { new_value: r.decision || '', details: r.proposed_pillars ? `pillars: ${r.proposed_pillars}` : '' });
  };
  const onAddComment = async (c: CompanyComment) => {
    await commentsDoc.createRow(c);
    logActivity('comment_added', c.company_id, { details: c.body.slice(0, 200) });
  };
  const onAssignPM = async (companyId: string, pmEmail: string) => {
    const existing = master.rows.find(m => m.company_id === companyId);
    if (existing) {
      await master.updateRow(companyId, { profile_manager_email: pmEmail });
    } else {
      const c = reviewableForView.find(c => c.company_id === companyId);
      if (!c) throw new Error('Company not found');
      await master.createRow({
        company_id: companyId,
        company_name: c.company_name,
        cohort: 'E3',
        status: c.status || 'Interviewed',
        profile_manager_email: pmEmail,
        sector: c.sector || '',
        city: c.city || '',
        governorate: c.governorate || '',
      } as Master);
    }
    logActivity('pm_assigned', companyId, { field: 'profile_manager_email', new_value: pmEmail });
  };

  const onLockDecision = async (args: FinalLockArgs) => {
    const c = reviewableForView.find(x => x.company_id === args.companyId);
    if (!c) throw new Error('Company not found');
    const existing = master.rows.find(m => m.company_id === args.companyId);
    const repFund = args.interventions.find(i => i.fund_code)?.fund_code || c.fund_code || '';
    if (existing) {
      await master.updateRow(args.companyId, {
        status: args.status,
        profile_manager_email: args.pmEmail,
        ...(repFund ? { fund_code: repFund } : {}),
      });
    } else {
      await master.createRow({
        company_id: args.companyId,
        company_name: args.companyName,
        cohort: 'E3',
        status: args.status,
        stage: args.status,
        sector: c.sector || '',
        city: c.city || '',
        governorate: c.governorate || '',
        employee_count: c.employee_count || '',
        fund_code: repFund,
        profile_manager_email: args.pmEmail,
      } as Master);
    }
    const now = new Date().toISOString();
    const existingPairs = new Set(
      assignments.rows
        .filter(a => a.company_id === args.companyId)
        .map(a => `${a.intervention_type}::${a.sub_intervention || ''}`),
    );
    for (const i of args.interventions) {
      const key = `${i.pillar}::${i.sub || ''}`;
      if (existingPairs.has(key)) continue;
      await assignments.createRow({
        assignment_id: `asn-${args.companyId}-${i.pillar}-${i.sub || 'all'}-${now}`,
        company_id: args.companyId,
        intervention_type: i.pillar,
        sub_intervention: i.sub || '',
        fund_code: i.fund_code,
        status: 'Planned',
        start_date: '',
        end_date: '',
        owner_email: args.pmEmail,
        budget_usd: '',
        notes: '',
      } as Assignment);
    }
    logActivity('finalize_locked', args.companyId, {
      field: 'status',
      new_value: args.status,
      details: `${args.interventions.length} intervention(s) [${args.interventions.map(i => `${i.pillar}/${i.fund_code}`).join(', ')}]; PM=${args.pmEmail || '—'}`,
    });
    await master.refresh();
    await assignments.refresh();
  };

  // External comment imports (Israa CSV / Raouf docx) are handled by
  // the Python tool offline + a one-time admin push. They land in the
  // regular Company Comments + Pre-decision Recommendations tabs and
  // surface in the UI alongside everyone else's comments — no separate
  // import button or special call-out.

  // ─── tab + flow stage counts ───
  const reviewedAnyone = useMemo(() => {
    const ids = new Set(reviewsDoc.rows.map(r => r.company_id));
    return reviewableForView.filter(c => ids.has(c.company_id)).length;
  }, [reviewableForView, reviewsDoc.rows]);
  const finalReady = reviewableForView.length > 0 && reviewedAnyone === reviewableForView.length;
  const lockedCompanyIds = useMemo(() => new Set(assignments.rows.map(a => a.company_id)), [assignments.rows]);
  const lockedCount = useMemo(
    () => reviewableForView.filter(c => lockedCompanyIds.has(c.company_id)).length,
    [reviewableForView, lockedCompanyIds],
  );

  const tabs: TabItem[] = [
    { value: 'review', label: `Stage 1 · Review queue · ${reviewedAnyone}/${reviewableForView.length}`, icon: <ClipboardCheck className="h-4 w-4" /> },
    {
      value: 'finalize',
      label: finalReady ? `Stage 2 · Final decisions · ready` : `Stage 2 · Final decisions · ${reviewableForView.length - reviewedAnyone} left`,
      icon: <Lock className="h-4 w-4" />,
      disabled: !finalReady,
    },
    { value: 'output', label: `Stage 3 · Final cohort · ${lockedCount}`, icon: <Trophy className="h-4 w-4" /> },
    { value: 'insights', label: 'Insights', icon: <BarChart3 className="h-4 w-4" /> },
    { value: 'activity', label: 'Activity', icon: <ActivityIcon className="h-4 w-4" /> },
  ];

  if (!masterSheetId || !selectionSheetId) {
    return (
      <Card>
        <CardHeader title="Selection" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_SELECTION</code> and{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SHEET_COMPANIES</code> in your environment.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Selection · Cohort 3"
        badges={[
          { label: `${reviewableForView.length} reviewable`, tone: 'teal' },
          { label: `${reviewedAnyone}/${reviewableForView.length} reviewed`, tone: 'amber' as Tone },
          { label: `${lockedCount} locked`, tone: 'green' as Tone },
        ]}
        actions={
          <Button variant="ghost" onClick={() => { master.refresh(); applicants.refresh(); reviewsDoc.refresh(); assignments.refresh(); }} title="Reload">
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      <StageIndicator
        current={stage}
        reviewedAnyone={reviewedAnyone}
        totalReviewable={reviewableForView.length}
        lockedCount={lockedCount}
        onJump={s => setStage(s)}
      />

      <Tabs items={tabs} value={stage} onChange={v => setStage(v as Stage)} />

      <div className="min-h-[280px]">
        {stage === 'review' && (
          <ReviewQueueBoard
            companies={reviewableForView}
            reviews={reviewsDoc.rows}
            comments={commentsDoc.rows}
            preDecisions={preDecisionsDoc.rows}
            reviewerEmail={user?.email || ''}
            onSaveReview={onSaveReview}
            onAddComment={onAddComment}
          />
        )}

        {stage === 'finalize' && (
          <FinalCohortBoard
            companies={reviewableForView}
            reviews={reviewsDoc.rows}
            comments={commentsDoc.rows}
            preDecisions={preDecisionsDoc.rows}
            assignments={assignments.rows}
            dutchLogframe={dutchLog.rows}
            sidaLogframe={sidaLog.rows}
            reviewerEmail={user?.email || ''}
            onLockDecision={onLockDecision}
            onAssignPM={onAssignPM}
          />
        )}

        {stage === 'output' && (
          <FinalCohortOutput
            companies={reviewableForView}
            assignments={assignments.rows}
            master={master.rows}
            masterSheetId={masterSheetId}
          />
        )}

        {stage === 'insights' && (
          <InsightsDashboard
            companies={reviewableForView}
            reviews={reviewsDoc.rows}
            assignments={assignments.rows}
            preDecisions={preDecisionsDoc.rows}
          />
        )}

        {stage === 'activity' && (
          <SelectionActivityView rows={activityDoc.rows} />
        )}
      </div>

      {/* Suppress unused variable warnings — interviewedSet drives reviewable scope; isInterviewed is referenced for parity with CompaniesPage. */}
      <span className="hidden">{INTERVIEWED_NAMES.size}{isInterviewed('') ? '' : ''}</span>
    </div>
  );
}

// ─── StageIndicator ──────────────────────────────────────────────────

function StageIndicator({
  current,
  reviewedAnyone,
  totalReviewable,
  lockedCount,
  onJump,
}: {
  current: Stage;
  reviewedAnyone: number;
  totalReviewable: number;
  lockedCount: number;
  onJump: (s: Stage) => void;
}) {
  const steps: Array<{ id: Stage; label: string; sub: string; done: boolean; active: boolean }> = [
    {
      id: 'review',
      label: 'Stage 1 · Review',
      sub: `${reviewedAnyone}/${totalReviewable} reviewed`,
      done: totalReviewable > 0 && reviewedAnyone === totalReviewable,
      active: current === 'review',
    },
    {
      id: 'finalize',
      label: 'Stage 2 · Final decisions',
      sub: `${lockedCount}/${totalReviewable} locked`,
      done: totalReviewable > 0 && lockedCount === totalReviewable,
      active: current === 'finalize',
    },
    {
      id: 'output',
      label: 'Stage 3 · Final cohort',
      sub: lockedCount > 0 ? `${lockedCount} companies` : 'Pending locks',
      done: lockedCount > 0,
      active: current === 'output',
    },
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
      <div className="flex flex-wrap items-stretch gap-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-stretch gap-2 min-w-[200px]">
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={`flex flex-1 items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition ${
                s.active
                  ? 'border-brand-teal bg-teal-50 dark:bg-teal-950'
                  : s.done
                  ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-navy-700 dark:bg-navy-900'
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${
                  s.active
                    ? 'bg-brand-teal text-white'
                    : s.done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 text-slate-600 dark:bg-navy-700 dark:text-slate-300'
                }`}
              >
                {s.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </span>
              <div>
                <div className={`text-xs font-bold uppercase tracking-wider ${s.active ? 'text-brand-teal' : 'text-navy-500 dark:text-slate-100'}`}>{s.label}</div>
                <div className="text-[11px] text-slate-500">{s.sub}</div>
              </div>
            </button>
            {i < steps.length - 1 && (
              <div className="flex items-center text-slate-300">→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── FinalCohortOutput ───────────────────────────────────────────────

function FinalCohortOutput({
  companies,
  assignments,
  master,
  masterSheetId,
}: {
  companies: ReviewableCompany[];
  assignments: Assignment[];
  master: Master[];
  masterSheetId: string;
}) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<'am' | 'pillar' | 'fund'>('am');
  const [exporting, setExporting] = useState(false);

  // Group assignments by company. Only show companies that have at
  // least one locked assignment — the resulting cohort.
  const byCompany = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.company_id) || [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return m;
  }, [assignments]);

  const masterById = useMemo(() => {
    const m = new Map<string, Master>();
    for (const r of master) if (r.company_id) m.set(r.company_id, r);
    return m;
  }, [master]);

  // Per-company aggregate row + pillar breakdown.
  const cohortRows = useMemo(() => {
    const out: Array<{
      company: ReviewableCompany;
      m: Master | undefined;
      assigns: Assignment[];
      byPillar: Map<string, { fund: string; subs: Array<{ name: string; fund: string }> }>;
      pillarCodes: string[];
      funds: Set<string>;
    }> = [];
    for (const c of companies) {
      const a = byCompany.get(c.company_id) || [];
      if (a.length === 0) continue;
      const byPillar = new Map<string, { fund: string; subs: Array<{ name: string; fund: string }> }>();
      const funds = new Set<string>();
      for (const x of a) {
        const code = pillarFor(x.intervention_type)?.code || x.intervention_type;
        const cur = byPillar.get(code) || { fund: x.fund_code || '', subs: [] };
        if (!cur.fund && x.fund_code) cur.fund = x.fund_code;
        if (x.sub_intervention) cur.subs.push({ name: x.sub_intervention, fund: x.fund_code || '' });
        byPillar.set(code, cur);
        if (x.fund_code) funds.add(x.fund_code);
      }
      out.push({
        company: c,
        m: masterById.get(c.company_id),
        assigns: a,
        byPillar,
        pillarCodes: Array.from(byPillar.keys()),
        funds,
      });
    }
    return out;
  }, [companies, byCompany, masterById]);

  // Apply search filter.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cohortRows;
    return cohortRows.filter(r =>
      `${r.company.company_name} ${r.company.sector} ${r.company.city} ${r.company.governorate}`.toLowerCase().includes(q),
    );
  }, [cohortRows, search]);

  if (cohortRows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Trophy className="h-8 w-8" />}
          title="No locked decisions yet"
          description="Once Stage 2 starts locking decisions, the final cohort populates here with AMs, donors, pillars and sub-interventions per company. Includes one-click Sheet/CSV export."
        />
      </Card>
    );
  }

  // Stats
  const totalCompanies = cohortRows.length;
  const totalAssignments = assignments.length;
  const dutchCount = assignments.filter(a => a.fund_code === '97060').length;
  const sidaCount = assignments.filter(a => a.fund_code === '91763').length;
  const noFundCount = assignments.filter(a => !a.fund_code).length;
  const dualFundCompanies = cohortRows.filter(r => r.funds.has('97060') && r.funds.has('91763')).length;

  // Per-pillar coverage: distinct companies served per pillar
  const pillarCompanySets = new Map<string, Set<string>>();
  for (const r of cohortRows) {
    for (const p of r.pillarCodes) {
      const set = pillarCompanySets.get(p) || new Set();
      set.add(r.company.company_id);
      pillarCompanySets.set(p, set);
    }
  }

  // Per-sub-intervention counts
  const subCounts = new Map<string, number>();
  for (const a of assignments) {
    if (a.sub_intervention) subCounts.set(a.sub_intervention, (subCounts.get(a.sub_intervention) || 0) + 1);
  }

  // Per-AM
  const amBuckets = new Map<string, typeof cohortRows>();
  for (const r of cohortRows) {
    const key = r.m?.profile_manager_email || '';
    const arr = amBuckets.get(key) || [];
    arr.push(r);
    amBuckets.set(key, arr);
  }

  // ─── Export handlers ─────────────────────────────────────────────
  const buildExportRows = () => {
    return cohortRows.map(r => {
      const pillarStrings: string[] = [];
      for (const [code, { fund, subs }] of r.byPillar) {
        if (subs.length === 0) pillarStrings.push(`${code}${fund ? ` [${fund}]` : ''}`);
        else for (const s of subs) pillarStrings.push(`${code}/${s.name}${s.fund ? ` [${s.fund}]` : (fund ? ` [${fund}]` : '')}`);
      }
      const dutchSubs: string[] = [];
      const sidaSubs: string[] = [];
      for (const [code, { fund, subs }] of r.byPillar) {
        for (const s of subs) {
          const eff = s.fund || fund;
          const tag = `${code}/${s.name}`;
          if (eff === '97060') dutchSubs.push(tag);
          else if (eff === '91763') sidaSubs.push(tag);
        }
      }
      return {
        company_id: r.company.company_id,
        company_name: r.company.company_name,
        sector: r.company.sector,
        city: r.company.city,
        governorate: r.company.governorate,
        status: r.m?.status || r.company.status,
        account_manager: r.m?.profile_manager_email || r.company.profile_manager_email || '',
        pillars: r.pillarCodes.join(', '),
        interventions: pillarStrings.join(' | '),
        dutch_interventions: dutchSubs.join(' | '),
        sida_interventions: sidaSubs.join(' | '),
        fund_codes: Array.from(r.funds).join(','),
        intervention_count: r.assigns.length,
      };
    });
  };

  const handleCsvExport = () => {
    const rows = buildExportRows();
    downloadCsv(timestampedFilename('final-cohort'), rows as unknown as Record<string, unknown>[]);
    toast.success('CSV downloaded', `${rows.length} compan${rows.length === 1 ? 'y' : 'ies'} exported.`);
  };

  const handleSheetExport = async () => {
    if (!masterSheetId) {
      toast.error('No workbook configured', 'VITE_SHEET_COMPANIES is not set.');
      return;
    }
    setExporting(true);
    try {
      const rows = buildExportRows();
      const result = await exportFinalCohortToSheet(masterSheetId, rows);
      toast.success('Pushed to sheet', `${result.rowsWritten} rows written to "${result.tabName}".`);
    } catch (e) {
      toast.error('Export failed', (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Hero header ── */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 dark:border-navy-700 dark:from-emerald-950 dark:to-teal-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
              <h2 className="text-xl font-extrabold text-emerald-900 dark:text-emerald-100">
                Cohort 3 · Final selection
              </h2>
            </div>
            <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/80">
              {totalCompanies} compan{totalCompanies === 1 ? 'y' : 'ies'} · {totalAssignments} intervention{totalAssignments === 1 ? '' : 's'} · {dutchCount} Dutch + {sidaCount} SIDA
              {dualFundCompanies > 0 && ` · ${dualFundCompanies} on both donors`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handleCsvExport}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={handleSheetExport} disabled={exporting}>
              <ExternalLink className="h-4 w-4" /> {exporting ? 'Pushing…' : 'Push to Sheet'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <KPI label="Companies" value={totalCompanies} tone="green" />
        <KPI label="Interventions" value={totalAssignments} tone="teal" />
        <KPI label="Dutch" value={dutchCount} hint="97060" tone="navy" />
        <KPI label="SIDA" value={sidaCount} hint="91763" tone="amber" />
        <KPI label="Avg / company" value={(totalAssignments / Math.max(1, totalCompanies)).toFixed(1)} tone="orange" />
        {noFundCount > 0
          ? <KPI label="No donor" value={noFundCount} hint="needs fix" tone="red" />
          : <KPI label="Dual-donor cos" value={dualFundCompanies} tone="orange" />}
      </div>

      {/* ── Per-pillar + per-fund visualization ── */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader title="Pillar coverage" subtitle="Distinct companies per pillar." />
          <ul className="space-y-2">
            {PILLARS.map(p => {
              const count = pillarCompanySets.get(p.code)?.size || 0;
              const pct = totalCompanies === 0 ? 0 : Math.round((count / totalCompanies) * 100);
              return (
                <li key={p.code}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-navy-500 dark:text-slate-100">{p.label}</span>
                    <span className="font-mono">{count} <span className="text-[10px] text-slate-500">({pct}%)</span></span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                    <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Sub-interventions allocated" subtitle="Count of intervention-rows per sub." />
          {subCounts.size === 0 ? (
            <p className="text-xs italic text-slate-500">No sub-interventions tagged yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {Array.from(subCounts.entries()).sort((a, b) => b[1] - a[1]).map(([sub, n]) => {
                const max = Math.max(1, ...Array.from(subCounts.values()));
                const pct = Math.round((n / max) * 100);
                return (
                  <li key={sub}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-navy-500 dark:text-slate-100">{sub}</span>
                      <span className="font-mono">{n}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                      <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Search + Group toggle ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-navy-700 dark:bg-navy-900">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            placeholder="Search company, sector, city…"
            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5 dark:border-navy-700 dark:bg-navy-900">
          <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Group by:</span>
          {(['am', 'pillar', 'fund'] as const).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                groupBy === g
                  ? 'bg-brand-teal text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800'
              }`}
            >
              {g === 'am' ? 'Account Manager' : g === 'pillar' ? 'Pillar' : 'Donor'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-slate-500">
          Showing <span className="font-bold text-navy-500 dark:text-slate-100">{visibleRows.length}</span> of {cohortRows.length}
        </span>
      </div>

      {/* ── Grouped sections ── */}
      {groupBy === 'am' && <CohortByAm rows={visibleRows} amBuckets={amBuckets} />}
      {groupBy === 'pillar' && <CohortByPillar rows={visibleRows} />}
      {groupBy === 'fund' && <CohortByFund rows={visibleRows} />}
    </div>
  );
}

type CohortRow = {
  company: ReviewableCompany;
  m: Master | undefined;
  assigns: Assignment[];
  byPillar: Map<string, { fund: string; subs: Array<{ name: string; fund: string }> }>;
  pillarCodes: string[];
  funds: Set<string>;
};

function CompanyCard({ row }: { row: CohortRow }) {
  const { company, m, byPillar } = row;
  return (
    <li className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-navy-500 dark:text-slate-100">{company.company_name}</div>
          <div className="text-[11px] text-slate-500">
            {[company.sector, company.city, company.governorate].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {m?.profile_manager_email && (
            <Badge tone="teal">{displayName(m.profile_manager_email).split(' ')[0]}</Badge>
          )}
          {m?.status && <Badge tone={m.status === 'Selected' ? 'green' : m.status === 'Hold' ? 'amber' : 'orange'}>{m.status}</Badge>}
          {row.funds.size > 1 && <Badge tone="orange">Dutch + SIDA</Badge>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {Array.from(byPillar.entries()).map(([code, { fund, subs }]) => (
          <span
            key={code}
            className="inline-flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-navy-700 dark:bg-navy-800"
          >
            <span className="font-bold text-navy-500 dark:text-slate-100">{code}</span>
            {fund && (
              <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${fund === '97060' ? 'bg-teal-100 text-brand-teal' : 'bg-amber-100 text-amber-800'}`}>
                {fund === '97060' ? 'Dutch' : 'SIDA'}
              </span>
            )}
            {subs.length > 0 && (
              <span className="text-[10px] text-slate-600 dark:text-slate-300">
                · {subs.map(s => `${s.name}${s.fund && s.fund !== fund ? ` (${s.fund === '97060' ? 'D' : 'S'})` : ''}`).join(', ')}
              </span>
            )}
          </span>
        ))}
      </div>
    </li>
  );
}

function CohortByAm({ rows, amBuckets }: { rows: CohortRow[]; amBuckets: Map<string, CohortRow[]> }) {
  const visibleByAm = new Map<string, CohortRow[]>();
  for (const r of rows) {
    const k = r.m?.profile_manager_email || '';
    const arr = visibleByAm.get(k) || [];
    arr.push(r);
    visibleByAm.set(k, arr);
  }
  const order = [
    ...ACCOUNT_MANAGERS.map(a => a.email),
    ...Array.from(amBuckets.keys()).filter(k => k && !ACCOUNT_MANAGERS.find(a => a.email === k)),
    '',
  ];
  return (
    <div className="space-y-3">
      {order.map(amEmail => {
        const bucket = visibleByAm.get(amEmail) || [];
        if (bucket.length === 0) return null;
        const am = ACCOUNT_MANAGERS.find(a => a.email === amEmail);
        const amName = am?.name || (amEmail ? displayName(amEmail) : 'Unassigned AM');
        const tone = amEmail ? 'teal' : 'amber';
        return (
          <Card key={amEmail || 'unassigned'} className={`border-l-4 ${tone === 'teal' ? 'border-l-brand-teal' : 'border-l-amber-500'}`}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {amName} · {bucket.length}
                </span>
              }
              subtitle={amEmail || 'Companies with locks but no AM yet'}
            />
            <ul className="space-y-2">
              {bucket.map(r => <CompanyCard key={r.company.company_id} row={r} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function CohortByPillar({ rows }: { rows: CohortRow[] }) {
  const byPillarBucket = new Map<string, CohortRow[]>();
  for (const r of rows) {
    for (const p of r.pillarCodes) {
      const arr = byPillarBucket.get(p) || [];
      arr.push(r);
      byPillarBucket.set(p, arr);
    }
  }
  return (
    <div className="space-y-3">
      {PILLARS.map(p => {
        const bucket = byPillarBucket.get(p.code) || [];
        if (bucket.length === 0) return null;
        return (
          <Card key={p.code} className="border-l-4 border-l-brand-teal">
            <CardHeader title={`${p.label} · ${bucket.length}`} subtitle={p.description} />
            <ul className="space-y-2">
              {bucket.map(r => <CompanyCard key={r.company.company_id + p.code} row={r} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function CohortByFund({ rows }: { rows: CohortRow[] }) {
  const dutch = rows.filter(r => r.funds.has('97060'));
  const sida = rows.filter(r => r.funds.has('91763'));
  const noFund = rows.filter(r => r.funds.size === 0);
  return (
    <div className="space-y-3">
      {dutch.length > 0 && (
        <Card className="border-l-4 border-l-brand-teal">
          <CardHeader title={`Dutch · 97060 · ${dutch.length}`} subtitle="Companies carrying at least one Dutch-funded intervention." />
          <ul className="space-y-2">{dutch.map(r => <CompanyCard key={'d' + r.company.company_id} row={r} />)}</ul>
        </Card>
      )}
      {sida.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader title={`SIDA · 91763 · ${sida.length}`} subtitle="Companies carrying at least one SIDA-funded intervention." />
          <ul className="space-y-2">{sida.map(r => <CompanyCard key={'s' + r.company.company_id} row={r} />)}</ul>
        </Card>
      )}
      {noFund.length > 0 && (
        <Card className="border-l-4 border-l-red-500">
          <CardHeader title={`No donor set · ${noFund.length}`} subtitle="These need a fund_code before exporting." />
          <ul className="space-y-2">{noFund.map(r => <CompanyCard key={'n' + r.company.company_id} row={r} />)}</ul>
        </Card>
      )}
    </div>
  );
}

// ─── Push final cohort to a Sheet tab ───────────────────────────────

async function exportFinalCohortToSheet(
  sheetId: string,
  rows: Array<Record<string, string | number>>,
): Promise<{ tabName: string; rowsWritten: number }> {
  const tabName = 'Final Cohort Export';
  const headers = [
    'company_id', 'company_name', 'sector', 'city', 'governorate',
    'status', 'account_manager', 'pillars', 'interventions',
    'dutch_interventions', 'sida_interventions', 'fund_codes', 'intervention_count',
  ];
  await ensureSchema(sheetId, tabName, headers);
  // Clear existing rows below header by overwriting a wide range.
  const data = rows.map(r => headers.map(h => String(r[h] ?? '')));
  // Write under the header (row 2 onwards) using appendRows so we don't clobber a manually-edited header.
  const { appendRows } = await import('../../lib/sheets/client');
  // Simple strategy: append always — re-runs add a new "wave" of rows below the previous one.
  // For idempotency the team can clear the tab manually before re-export, or we'd need to wipe first.
  // For now this is simpler and the team understands "this is a snapshot".
  // First add a separator marker row so re-runs are visually distinct.
  const ts = new Date().toISOString();
  const marker = [`--- snapshot ${ts} ---`, ...new Array(headers.length - 1).fill('')];
  await appendRows(sheetId, `${tabName}!A1`, [marker, ...data]);
  return { tabName, rowsWritten: data.length };
}


// ─── Activity ────────────────────────────────────────────────────────

function SelectionActivityView({ rows }: { rows: ActivityRow[] }) {
  const filtered = useMemo(() => {
    const include = new Set(['review_saved', 'comment_added', 'pm_assigned', 'finalize_locked', 'import_external', 'pre_decision_added']);
    return rows.filter(r => include.has(r.action));
  }, [rows]);
  return (
    <Card>
      <CardHeader title="Selection activity" subtitle="Reviews saved · comments · PM assignments · decisions locked · imports." />
      {filtered.length === 0 ? (
        <EmptyState icon={<MessageCircle className="h-5 w-5" />} title="No selection activity yet" />
      ) : (
        <ActivityTimeline rows={filtered} limit={200} />
      )}
    </Card>
  );
}

// ─── KPI tile (shared) ───────────────────────────────────────────────

function KPI({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone: 'navy' | 'teal' | 'green' | 'amber' | 'orange' | 'red' }) {
  const cls =
    tone === 'navy' ? 'bg-navy-50 text-navy-800 dark:bg-navy-900 dark:text-slate-100'
    : tone === 'teal' ? 'bg-teal-50 text-brand-teal dark:bg-teal-950'
    : tone === 'green' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : tone === 'amber' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
    : tone === 'red' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
    : 'bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-200';
  return (
    <div className={`rounded-md border border-slate-200 px-3 py-2 dark:border-navy-700 ${cls}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}

// ─── ReviewQueueBoard (Stage 1) ──────────────────────────────────────
// Kanban-style by my-review status. Columns: To review (mine) /
// Recommend / Hold / Reject. Each column shows compact cards with
// company name + sector + Israa/Raouf signal + team consensus from
// other reviewers. Click any card to open the focus drawer with the
// full dossier and decision form.

function ReviewQueueBoard({
  companies,
  reviews,
  comments,
  preDecisions,
  reviewerEmail,
  onSaveReview,
  onAddComment,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  comments: CompanyComment[];
  preDecisions: PreDecisionRecommendation[];
  reviewerEmail: string;
  onSaveReview: (r: Review) => Promise<void>;
  onAddComment: (c: CompanyComment) => Promise<void>;
}) {
  const [focused, setFocused] = useState<ReviewableCompany | null>(null);

  const myReviewByCompany = useMemo(() => {
    const m = new Map<string, Review>();
    for (const r of reviews) {
      if (r.reviewer_email?.toLowerCase() === reviewerEmail.toLowerCase()) {
        m.set(r.company_id, r);
      }
    }
    return m;
  }, [reviews, reviewerEmail]);

  const teamSummaryByCompany = useMemo(() => {
    const byCompany = new Map<string, Review[]>();
    for (const r of reviews) {
      const arr = byCompany.get(r.company_id) || [];
      arr.push(r);
      byCompany.set(r.company_id, arr);
    }
    const m = new Map<string, ReturnType<typeof summarizeReviews>>();
    for (const [cid, rs] of byCompany) m.set(cid, summarizeReviews(rs));
    return m;
  }, [reviews]);

  const preDecsByCompany = useMemo(() => {
    const m = new Map<string, PreDecisionRecommendation[]>();
    for (const r of preDecisions) {
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [preDecisions]);

  const commentsByCompany = useMemo(() => {
    const m = new Map<string, CompanyComment[]>();
    for (const c of comments) {
      const arr = m.get(c.company_id) || [];
      arr.push(c);
      m.set(c.company_id, arr);
    }
    return m;
  }, [comments]);

  type Bucket = 'unreviewed' | 'Recommend' | 'Hold' | 'Waitlist';

  // Stage 1 polish: search + filter chips for fast navigation.
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'divergent' | 'topScore' | 'noConsensus'>('all');

  // Apply search + filter to the source companies BEFORE bucketing.
  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter(c => {
      if (q && !`${c.company_name} ${c.sector} ${c.city} ${c.governorate}`.toLowerCase().includes(q)) return false;
      if (filter === 'divergent') {
        const s = teamSummaryByCompany.get(c.company_id);
        if (!s || !s.divergence) return false;
      } else if (filter === 'topScore') {
        const cls = (firstField(c.selection?.scoring, ['class', 'tier', 'grade']) || '').toLowerCase();
        if (!/^a|class.?a|tier.?1|excellent/.test(cls)) return false;
      } else if (filter === 'noConsensus') {
        const s = teamSummaryByCompany.get(c.company_id);
        if (!s || s.total === 0) return false;
        if (s.consensus !== 'Mixed' && !s.divergence) return false;
      }
      return true;
    });
  }, [companies, search, filter, teamSummaryByCompany]);

  // Bucket companies by MY review state — using the filtered set.
  const buckets: Record<Bucket, ReviewableCompany[]> = { unreviewed: [], Recommend: [], Hold: [], Waitlist: [] };
  for (const c of filteredCompanies) {
    const my = myReviewByCompany.get(c.company_id);
    if (!my || !my.decision) buckets.unreviewed.push(c);
    else if (my.decision === 'Recommend') buckets.Recommend.push(c);
    else if (my.decision === 'Hold') buckets.Hold.push(c);
    else if (my.decision === 'Waitlist' || my.decision === 'Reject') buckets.Waitlist.push(c);
    else buckets.unreviewed.push(c);
  }

  const COLUMNS: Array<{ id: Bucket; label: string; tone: string; bg: string }> = [
    { id: 'unreviewed', label: 'To review (you)', tone: 'text-slate-700', bg: 'bg-slate-50 dark:bg-navy-800/50' },
    { id: 'Recommend', label: 'Recommend', tone: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { id: 'Hold', label: 'Hold', tone: 'text-amber-700', bg: 'bg-amber-50 dark:bg-amber-950/30' },
    { id: 'Waitlist', label: 'Waitlist', tone: 'text-orange-700', bg: 'bg-orange-50 dark:bg-orange-950/30' },
  ];

  // Drag state — track which card is currently being dragged + the
  // hovered drop target so we can show a highlight ring on the column.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Bucket | null>(null);

  // Jump to next unreviewed-by-me company.
  const jumpToNextUnreviewed = () => {
    const next = filteredCompanies.find(c => {
      const my = myReviewByCompany.get(c.company_id);
      return !my || !my.decision;
    });
    if (next) setFocused(next);
  };

  const handleDrop = async (target: Bucket, companyId: string) => {
    setDragId(null); setDragOver(null);
    if (!companyId) return;
    const my = myReviewByCompany.get(companyId);
    const now = new Date().toISOString();
    const id = my?.review_id || `rev-${companyId}-${reviewerEmail.split('@')[0]}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
    const newDecision = target === 'unreviewed' ? '' : (target as 'Recommend' | 'Hold' | 'Waitlist');
    await onSaveReview({
      review_id: id,
      company_id: companyId,
      reviewer_email: reviewerEmail,
      decision: newDecision,
      proposed_pillars: my?.proposed_pillars || '',
      proposed_sub_interventions: my?.proposed_sub_interventions || '',
      notes: my?.notes || '',
      created_at: my?.created_at || now,
      updated_at: now,
    });
  };

  return (
    <div className="space-y-3">
      {/* Toolbar: search · filter chips · next unreviewed jump */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-navy-700 dark:bg-navy-900">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            placeholder="Search company, sector, city…"
            className="w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          />
        </div>
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5 dark:border-navy-700 dark:bg-navy-900">
          {(['all', 'divergent', 'topScore', 'noConsensus'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                filter === f
                  ? 'bg-brand-teal text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800'
              }`}
            >
              {f === 'all' ? 'All' : f === 'divergent' ? 'Divergent' : f === 'topScore' ? 'Top class' : 'Mixed consensus'}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={jumpToNextUnreviewed} disabled={buckets.unreviewed.length === 0}>
          Next unreviewed →
        </Button>
        <span className="ml-auto text-[11px] text-slate-500">
          Showing <span className="font-bold text-navy-500 dark:text-slate-100">{filteredCompanies.length}</span> of {companies.length}
        </span>
      </div>
      <div className="text-[11px] text-slate-500">
        <strong>Drag</strong> between columns to change your decision · <strong>click</strong> a card for the full dossier + pillar picker.
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {COLUMNS.map(col => {
          const isDropTarget = dragOver === col.id;
          return (
            <div
              key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id); }}
              onDragLeave={() => setDragOver(prev => (prev === col.id ? null : prev))}
              onDrop={e => {
                e.preventDefault();
                const cid = e.dataTransfer.getData('text/plain');
                void handleDrop(col.id, cid);
              }}
              className={`rounded-xl border-2 p-2 transition ${
                isDropTarget
                  ? 'border-brand-teal bg-teal-50/80 dark:bg-teal-950/40'
                  : `border-slate-200 dark:border-navy-700 ${col.bg}`
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className={`text-xs font-bold uppercase tracking-wider ${col.tone}`}>{col.label}</div>
                <Badge tone="neutral">{buckets[col.id].length}</Badge>
              </div>
              <ul className="space-y-1.5">
                {buckets[col.id].length === 0 && (
                  <li className="rounded-md border border-dashed border-slate-200 px-2 py-3 text-center text-[10px] italic text-slate-400 dark:border-navy-700">
                    {isDropTarget ? 'Drop here' : 'Empty'}
                  </li>
                )}
                {buckets[col.id].map(c => {
                  const teamSummary = teamSummaryByCompany.get(c.company_id);
                  const cmtCount = (commentsByCompany.get(c.company_id) || []).length;
                  const my = myReviewByCompany.get(c.company_id);
                  const isDragging = dragId === c.company_id;
                  return (
                    <li key={c.company_id}>
                      <div
                        draggable
                        onDragStart={e => {
                          setDragId(c.company_id);
                          e.dataTransfer.setData('text/plain', c.company_id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setFocused(c)}
                        className={`block w-full cursor-grab rounded-md border bg-white px-2 py-1.5 text-left transition hover:border-brand-teal hover:shadow-sm dark:bg-navy-900 dark:hover:border-brand-teal ${
                          isDragging ? 'border-brand-teal opacity-60' : 'border-slate-200 dark:border-navy-700'
                        }`}
                      >
                        <div className="truncate text-xs font-bold text-navy-500 dark:text-slate-100">{c.company_name}</div>
                        {c.sector && <div className="truncate text-[10px] text-slate-500">{c.sector}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                          {teamSummary && teamSummary.total > 0 && (
                            <span className={`rounded px-1 py-0.5 font-bold ${teamSummary.consensus === 'Recommend' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : teamSummary.consensus === 'Hold' ? 'bg-amber-100 text-amber-800' : teamSummary.consensus === 'Waitlist' ? 'bg-orange-100 text-orange-800' : 'bg-slate-200'}`}>
                              {teamSummary.total}× {teamSummary.consensus}
                              {teamSummary.divergence ? ' · div' : ''}
                            </span>
                          )}
                          {cmtCount > 0 && (
                            <span className="rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-700 dark:bg-navy-800 dark:text-slate-300" title={`${cmtCount} comment(s)`}>
                              {cmtCount}c
                            </span>
                          )}
                          {my?.proposed_pillars && (
                            <span className="text-[9px] text-slate-500" title={my.proposed_pillars}>
                              {my.proposed_pillars.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <CompanyFocusDrawer
        company={focused}
        onClose={() => setFocused(null)}
        comments={focused ? (commentsByCompany.get(focused.company_id) || []) : []}
        preDecs={focused ? (preDecsByCompany.get(focused.company_id) || []) : []}
        reviewsForCompany={focused ? reviews.filter(r => r.company_id === focused.company_id) : []}
        myReview={focused ? myReviewByCompany.get(focused.company_id) : undefined}
        reviewerEmail={reviewerEmail}
        mode="review"
        onSaveReview={onSaveReview}
        onAddComment={onAddComment}
      />
    </div>
  );
}

// ─── FinalCohortBoard (Stage 2) ──────────────────────────────────────
// Three AM lanes (Mohammed / Doaa / Muna) + an Unassigned lane. Each
// card shows status, fund, locked pillars. Click → open focus drawer
// with the lock-decision form. Drag-and-drop is intentionally not
// added now (small surface, the click-to-open flow is fast enough).

function FinalCohortBoard({
  companies,
  reviews,
  comments,
  preDecisions,
  assignments,
  dutchLogframe,
  sidaLogframe,
  onLockDecision,
  onAssignPM,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  comments: CompanyComment[];
  preDecisions: PreDecisionRecommendation[];
  assignments: Assignment[];
  dutchLogframe: Record<string, string>[];
  sidaLogframe: Record<string, string>[];
  reviewerEmail: string;
  onLockDecision: (args: FinalLockArgs) => Promise<void>;
  onAssignPM: (companyId: string, pmEmail: string) => Promise<void>;
}) {
  const [focused, setFocused] = useState<ReviewableCompany | null>(null);
  // Stage 2 scope filter: 'selected' (default — only Recommend / Selected
  // companies need lock work), 'all' (every reviewable), 'pending' (only
  // those without locks yet).
  const [scope, setScope] = useState<'selected' | 'all' | 'pending'>('selected');

  const assignsByCompany = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.company_id) || [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return m;
  }, [assignments]);

  const preDecsByCompany = useMemo(() => {
    const m = new Map<string, PreDecisionRecommendation[]>();
    for (const r of preDecisions) {
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [preDecisions]);

  const commentsByCompany = useMemo(() => {
    const m = new Map<string, CompanyComment[]>();
    for (const c of comments) {
      const arr = m.get(c.company_id) || [];
      arr.push(c);
      m.set(c.company_id, arr);
    }
    return m;
  }, [comments]);

  // Per-company team consensus — used to scope to "selected" (Recommend
  // by team OR already locked OR master.status === Selected/Recommended).
  const reviewsByCompany = useMemo(() => {
    const m = new Map<string, Review[]>();
    for (const r of reviews) {
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [reviews]);

  // "Selected" scope = a company has crossed the team threshold for
  // moving forward: at least 3 reviewer Recommend votes, OR it's
  // already locked (assigned), OR master flags it Selected/Recommended
  // (admin override).
  const RECOMMEND_THRESHOLD = 3;
  const isSelected = (c: ReviewableCompany): boolean => {
    if (assignsByCompany.has(c.company_id)) return true;
    if (c.status === 'Selected' || c.status === 'Recommended') return true;
    const rs = reviewsByCompany.get(c.company_id) || [];
    const recommendCount = rs.filter(r => r.decision === 'Recommend').length;
    return recommendCount >= RECOMMEND_THRESHOLD;
  };

  const visibleCompanies = useMemo(() => {
    if (scope === 'all') return companies;
    if (scope === 'pending') return companies.filter(c => !assignsByCompany.has(c.company_id) && isSelected(c));
    return companies.filter(c => isSelected(c));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, scope, assignsByCompany, reviewsByCompany]);

  // Lanes. ACCOUNT_MANAGERS first, then unassigned at the end.
  const lanes: Array<{ amEmail: string; label: string; companies: ReviewableCompany[] }> = [];
  for (const am of ACCOUNT_MANAGERS) {
    lanes.push({ amEmail: am.email, label: am.name.split(' ')[0], companies: [] });
  }
  lanes.push({ amEmail: '', label: 'Unassigned', companies: [] });

  for (const c of visibleCompanies) {
    const lane = lanes.find(l => l.amEmail === c.profile_manager_email) || lanes[lanes.length - 1];
    lane.companies.push(c);
  }

  // Drag state for the AM lane board.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const handleAmDrop = async (targetAmEmail: string, companyId: string) => {
    setDragId(null); setDragOver(null);
    if (!companyId) return;
    const c = companies.find(x => x.company_id === companyId);
    if (!c) return;
    if (c.profile_manager_email === targetAmEmail) return;
    await onAssignPM(companyId, targetAmEmail);
  };

  // ── Counts for the live insights panel ──────────────────────────
  const totalSelected = companies.filter(isSelected).length;
  const lockedTotal = Array.from(assignsByCompany.keys()).length;
  const dutchTargets = parseLogframeTargets(dutchLogframe);
  const sidaTargets = parseLogframeTargets(sidaLogframe);

  // Per-pillar locked counts (companies, not assignment rows — counting
  // distinct companies served by each pillar is what targets measure).
  const pillarCompanyCounts = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of assignments) {
      const code = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (!code) continue;
      const set = m.get(code) || new Set();
      set.add(a.company_id);
      m.set(code, set);
    }
    return m;
  }, [assignments]);

  const subCompanyCounts = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of assignments) {
      const r = resolveIntervention(a.intervention_type);
      const sub = r?.sub || a.sub_intervention;
      if (!sub) continue;
      const set = m.get(sub) || new Set();
      set.add(a.company_id);
      m.set(sub, set);
    }
    return m;
  }, [assignments]);

  const dutchAssignsCount = assignments.filter(a => a.fund_code === '97060').length;
  const sidaAssignsCount = assignments.filter(a => a.fund_code === '91763').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span><strong>Drag</strong> between AM lanes to reassign, or <strong>click</strong> to open the lock form (status · AM · per-pillar fund · sub-interventions).</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5 dark:border-navy-700 dark:bg-navy-900">
          <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Show:</span>
          {(['selected', 'pending', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                scope === s
                  ? 'bg-brand-teal text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800'
              }`}
            >
              {s === 'selected' ? `Selected (${totalSelected})` : s === 'pending' ? `Pending lock` : `All (${companies.length})`}
            </button>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {lanes.map(lane => {
          const colTone = lane.amEmail
            ? 'bg-teal-50/60 dark:bg-teal-950/20'
            : 'bg-amber-50/60 dark:bg-amber-950/20';
          const lockedInLane = lane.companies.filter(c => assignsByCompany.has(c.company_id)).length;
          const isDropTarget = dragOver === (lane.amEmail || 'UNASSIGNED');
          const laneKey = lane.amEmail || 'UNASSIGNED';
          return (
            <div
              key={laneKey}
              onDragOver={e => { e.preventDefault(); setDragOver(laneKey); }}
              onDragLeave={() => setDragOver(prev => (prev === laneKey ? null : prev))}
              onDrop={e => {
                e.preventDefault();
                const cid = e.dataTransfer.getData('text/plain');
                void handleAmDrop(lane.amEmail, cid);
              }}
              className={`rounded-xl border-2 p-2 transition ${
                isDropTarget
                  ? 'border-brand-teal bg-teal-50/80 dark:bg-teal-950/40'
                  : `border-slate-200 dark:border-navy-700 ${colTone}`
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="text-xs font-bold uppercase tracking-wider text-navy-500 dark:text-slate-100">{lane.label}</div>
                <Badge tone={lane.amEmail ? 'teal' : 'amber'}>
                  {lockedInLane}/{lane.companies.length}
                </Badge>
              </div>
              <ul className="space-y-1.5">
                {lane.companies.length === 0 && (
                  <li className="rounded-md border border-dashed border-slate-200 px-2 py-3 text-center text-[10px] italic text-slate-400 dark:border-navy-700">
                    {isDropTarget ? 'Drop here' : 'Empty'}
                  </li>
                )}
                {lane.companies.map(c => {
                  const assigns = assignsByCompany.get(c.company_id) || [];
                  const locked = assigns.length > 0;
                  const pillars = Array.from(new Set(assigns.map(a => pillarFor(a.intervention_type)?.code || a.intervention_type)));
                  const recs = preDecsByCompany.get(c.company_id) || [];
                  const isDragging = dragId === c.company_id;
                  return (
                    <li key={c.company_id}>
                      <div
                        draggable
                        onDragStart={e => {
                          setDragId(c.company_id);
                          e.dataTransfer.setData('text/plain', c.company_id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setFocused(c)}
                        className={`block w-full cursor-grab rounded-md border bg-white px-2 py-1.5 text-left transition hover:shadow-sm dark:bg-navy-900 ${
                          isDragging
                            ? 'border-brand-teal opacity-60'
                            : locked
                            ? 'border-emerald-300 dark:border-emerald-800'
                            : 'border-slate-200 hover:border-brand-teal dark:border-navy-700 dark:hover:border-brand-teal'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-navy-500 dark:text-slate-100">{c.company_name}</div>
                            {c.sector && <div className="truncate text-[10px] text-slate-500">{c.sector}</div>}
                          </div>
                          {locked && <span className="rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold text-white">LOCKED</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                          {c.status && c.status !== 'Interviewed' && (
                            <span className={`rounded px-1 py-0.5 font-bold ${c.status === 'Selected' ? 'bg-emerald-100 text-emerald-800' : c.status === 'Hold' ? 'bg-amber-100 text-amber-800' : c.status === 'Waitlist' ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-700'}`}>
                              {c.status}
                            </span>
                          )}
                          {c.fund_code && (
                            <span className={`rounded px-1 py-0.5 font-bold ${c.fund_code === '97060' ? 'bg-teal-100 text-brand-teal' : 'bg-amber-100 text-amber-800'}`}>
                              {c.fund_code === '97060' ? 'Dutch' : 'SIDA'}
                            </span>
                          )}
                          {pillars.slice(0, 4).map(p => (
                            <span key={p} className="rounded bg-slate-100 px-1 py-0.5 font-semibold text-slate-700 dark:bg-navy-800 dark:text-slate-200">{p}</span>
                          ))}
                          {recs.length > 0 && (
                            <span className="rounded bg-purple-100 px-1 py-0.5 font-bold text-purple-800 dark:bg-purple-950 dark:text-purple-200" title={`${recs.length} pre-decision rec(s)`}>
                              {recs.length}rec
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        </div>

        {/* Live insights side rail — always visible, updates as locks happen. */}
        <LiveInsightsPanel
          totalSelected={totalSelected}
          totalCohort={companies.length}
          lockedTotal={lockedTotal}
          pillarCompanyCounts={pillarCompanyCounts}
          subCompanyCounts={subCompanyCounts}
          dutchAssignsCount={dutchAssignsCount}
          sidaAssignsCount={sidaAssignsCount}
          dutchTargets={dutchTargets}
          sidaTargets={sidaTargets}
        />
      </div>

      <CompanyFocusDrawer
        company={focused}
        onClose={() => setFocused(null)}
        comments={focused ? (commentsByCompany.get(focused.company_id) || []) : []}
        preDecs={focused ? (preDecsByCompany.get(focused.company_id) || []) : []}
        reviewsForCompany={focused ? reviews.filter(r => r.company_id === focused.company_id) : []}
        existingAssigns={focused ? (assignsByCompany.get(focused.company_id) || []) : []}
        reviewerEmail=""
        mode="lock"
        onLockDecision={onLockDecision}
        onAssignPM={onAssignPM}
      />
    </div>
  );
}


// ─── Shared focus drawer ─────────────────────────────────────────────
// Right-side drawer used by both Stage 1 and Stage 2. Shows the company
// dossier on top, then a mode-specific form: review form for Stage 1,
// lock-decision form for Stage 2.

function CompanyFocusDrawer({
  company,
  onClose,
  comments,
  preDecs,
  reviewsForCompany,
  existingAssigns,
  myReview,
  reviewerEmail,
  mode,
  onSaveReview,
  onAddComment,
  onLockDecision,
  onAssignPM,
}: {
  company: ReviewableCompany | null;
  onClose: () => void;
  comments: CompanyComment[];
  preDecs: PreDecisionRecommendation[];
  reviewsForCompany: Review[];
  existingAssigns?: Assignment[];
  myReview?: Review | undefined;
  reviewerEmail: string;
  mode: 'review' | 'lock';
  onSaveReview?: (r: Review) => Promise<void>;
  onAddComment?: (c: CompanyComment) => Promise<void>;
  onLockDecision?: (args: FinalLockArgs) => Promise<void>;
  onAssignPM?: (companyId: string, pmEmail: string) => Promise<void>;
}) {
  // Local form state
  const [decision, setDecision] = useState<'Recommend' | 'Hold' | 'Waitlist' | ''>('');
  const [proposedPillars, setProposedPillars] = useState<Set<string>>(new Set());
  const [proposedSubs, setProposedSubs] = useState<Set<string>>(new Set());
  const [reviewNotes, setReviewNotes] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  // Lock form state
  const [lockStatus, setLockStatus] = useState<'Selected' | 'Hold' | 'Waitlist'>('Selected');
  const [lockPm, setLockPm] = useState('');
  const [lockPillars, setLockPillars] = useState<Set<string>>(new Set());
  const [lockSubs, setLockSubs] = useState<Set<string>>(new Set());
  const [lockFund, setLockFund] = useState<Record<string, string>>({});
  const [perSubFund, setPerSubFund] = useState<Record<string, string>>({});
  const [locking, setLocking] = useState(false);

  // Reset state when the focused company changes.
  // Both branches run every saved code through `resolveIntervention()`
  // so legacy taxonomy values (TTH, Upskilling, C-Suite, Conferences,
  // ElevateBridge, MA-Legal, MA-MKG Agency, ...) get migrated to the
  // current 3-pillar structure. Without this, existing reviews and
  // assignments would render as cleared because the old codes don't
  // match any new pillar checkbox.
  useEffect(() => {
    if (!company) return;
    if (mode === 'review') {
      setDecision((myReview?.decision as 'Recommend' | 'Hold' | 'Waitlist' | '') || '');
      const pSet = new Set<string>();
      const sSet = new Set<string>();
      // proposed_pillars CSV may contain old top-level codes; resolveIntervention
      // returns {pillar, sub} so we can put them in the right buckets.
      for (const code of (myReview?.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const r = resolveIntervention(code);
        if (r) {
          pSet.add(r.pillar);
          if (r.sub) sSet.add(r.sub);
        } else {
          pSet.add(code);
        }
      }
      // proposed_sub_interventions CSV — resolve and ensure parent pillar
      // is also marked.
      for (const code of (myReview?.proposed_sub_interventions || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const r = resolveIntervention(code);
        if (r) {
          pSet.add(r.pillar);
          if (r.sub) sSet.add(r.sub);
        } else {
          sSet.add(code);
        }
      }
      setProposedPillars(pSet);
      setProposedSubs(sSet);
      setReviewNotes(myReview?.notes || '');
      setCommentDraft('');
    } else {
      setLockStatus(((company.status === 'Hold' || company.status === 'Waitlist' || company.status === 'Rejected') ? (company.status === 'Rejected' ? 'Waitlist' : (company.status as 'Hold' | 'Waitlist')) : 'Selected'));
      setLockPm(company.profile_manager_email || '');
      const pSet = new Set<string>();
      const sSet = new Set<string>();
      const funds: Record<string, string> = {};
      const subFunds: Record<string, string> = {};
      for (const a of existingAssigns || []) {
        // intervention_type might be old (e.g., 'TTH') or new ('CB'); resolve.
        const r = resolveIntervention(a.intervention_type);
        const pillarCode = r?.pillar || pillarFor(a.intervention_type)?.code || a.intervention_type;
        if (pillarCode) {
          pSet.add(pillarCode);
          if (a.fund_code) funds[pillarCode] = a.fund_code;
        }
        // The sub from resolve OR the explicit sub_intervention.
        const sub = r?.sub || a.sub_intervention;
        if (sub) {
          sSet.add(sub);
          if (a.fund_code) subFunds[sub] = a.fund_code;
        }
      }
      // Pre-decision pillars pre-fill when nothing was locked yet.
      if (pSet.size === 0) {
        for (const r of preDecs) {
          const resolved = resolveIntervention(r.pillar);
          const pillarCode = resolved?.pillar || pillarFor(r.pillar)?.code || r.pillar;
          if (pillarCode) {
            pSet.add(pillarCode);
            if (r.fund_hint && !funds[pillarCode]) funds[pillarCode] = r.fund_hint;
          }
          const sub = resolved?.sub || r.sub_intervention;
          if (sub) sSet.add(sub);
        }
      }
      setLockPillars(pSet);
      setLockSubs(sSet);
      setLockFund({ ...Object.fromEntries(PILLARS.map(p => [p.code, '97060'])), ...funds });
      setPerSubFund(subFunds);
    }
  }, [company, myReview, mode, existingAssigns, preDecs]);

  if (!company) return null;

  const togglePillar = (code: string, set: Set<string>, setSet: (s: Set<string>) => void, subs: Set<string>, setSubsFn: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(code)) {
      next.delete(code);
      const dead = new Set(PILLARS.find(p => p.code === code)?.subInterventions || []);
      if (dead.size > 0) {
        const ns = new Set(subs);
        for (const s of dead) ns.delete(s);
        setSubsFn(ns);
      }
    } else next.add(code);
    setSet(next);
  };

  const handleSaveReview = async () => {
    if (!onSaveReview || !decision) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const id = `rev-${company.company_id}-${reviewerEmail.split('@')[0]}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
      await onSaveReview({
        review_id: myReview?.review_id || id,
        company_id: company.company_id,
        reviewer_email: reviewerEmail,
        decision,
        proposed_pillars: Array.from(proposedPillars).join(','),
        proposed_sub_interventions: Array.from(proposedSubs).join(','),
        notes: reviewNotes,
        created_at: myReview?.created_at || now,
        updated_at: now,
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePostComment = async () => {
    if (!onAddComment || !commentDraft.trim()) return;
    setPosting(true);
    try {
      const now = new Date().toISOString();
      const id = `cmt-${company.company_id}-${reviewerEmail.split('@')[0]}-${now}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
      await onAddComment({
        comment_id: id,
        company_id: company.company_id,
        author_email: reviewerEmail,
        body: commentDraft.trim(),
        created_at: now,
        updated_at: now,
      });
      setCommentDraft('');
    } finally {
      setPosting(false);
    }
  };

  const handleLock = async () => {
    if (!onLockDecision || !lockPm) return;
    setLocking(true);
    try {
      const interventions: FinalLockArgs['interventions'] = [];
      for (const p of lockPillars) {
        const subsForP = Array.from(lockSubs).filter(s => pillarFor(s)?.code === p);
        const pillarFund = lockFund[p] || '';
        if (subsForP.length === 0) {
          interventions.push({ pillar: p, sub: '', fund_code: pillarFund });
        } else {
          for (const s of subsForP) {
            interventions.push({ pillar: p, sub: s, fund_code: perSubFund[s] || pillarFund });
          }
        }
      }
      await onLockDecision({
        companyId: company.company_id,
        companyName: company.company_name,
        status: lockStatus,
        pmEmail: lockPm,
        interventions,
      });
      onClose();
    } finally {
      setLocking(false);
    }
  };

  const teamSummary = summarizeReviews(reviewsForCompany);

  return (
    <Drawer
      open={!!company}
      onClose={onClose}
      width="max-w-3xl"
      title={company.company_name}
      subtitle={[company.sector, company.city, company.governorate].filter(Boolean).join(' · ')}
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {/* LEFT: dossier */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <KPI
              label="Score"
              value={firstField(company.selection?.scoring, ['class', 'tier', 'grade']) || '—'}
              hint={firstField(company.selection?.scoring, ['total_score', 'total score', 'score', 'weighted'])}
              tone="teal"
            />
            <KPI
              label="Interview"
              value={firstField(company.selection?.interviewAssessment, ['rating', 'score', 'grade', 'recommend']) || '—'}
              tone="navy"
            />
            <KPI
              label="Team consensus"
              value={teamSummary.total > 0 ? `${teamSummary.total}× ${teamSummary.consensus}` : 'no reviews'}
              hint={teamSummary.divergence ? 'divergent' : undefined}
              tone={teamSummary.consensus === 'Recommend' ? 'green' : teamSummary.consensus === 'Waitlist' ? 'red' : 'amber'}
            />
            <KPI
              label="Comments"
              value={comments.length}
              hint={comments.length > 0 ? `${Array.from(new Set(comments.map(c => displayName(c.author_email).split(' ')[0]))).slice(0, 3).join(', ')}${comments.length > 3 ? '…' : ''}` : 'none'}
              tone="orange"
            />
          </div>

          {/* Requested vs Recommended pillar matrix — compact */}
          <Card>
            <CardHeader title="Requested vs Recommended" subtitle="ASKED = applicant wantsXXX. REC = team reviewers + interview/needs assessment." />
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 dark:bg-navy-800">
                <tr>
                  <th className="px-1.5 py-1 text-left">Pillar</th>
                  <th className="px-1.5 py-1 text-center">Asked</th>
                  <th className="px-1.5 py-1 text-center">Rec</th>
                </tr>
              </thead>
              <tbody>
                {PILLARS.map(p => {
                  const asked = wantsBoolFor(company.applicantRaw, p.code);
                  // Team-recommended: any reviewer's proposed_pillars OR a pre-decision rec maps here.
                  const teamRec =
                    reviewsForCompany.some(r => (r.proposed_pillars || '').split(',').map(s => s.trim()).includes(p.code)) ||
                    preDecs.some(r => (pillarFor(r.pillar)?.code || r.pillar) === p.code);
                  return (
                    <tr key={p.code} className="border-t border-slate-100 dark:border-navy-800">
                      <td className="px-1.5 py-1 font-bold text-navy-500 dark:text-slate-100">{p.shortLabel}</td>
                      <td className="px-1.5 py-1 text-center">{asked ? '✓' : '—'}</td>
                      <td className="px-1.5 py-1 text-center">{teamRec ? '✓' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Pre-decision recs detail */}
          {/* Comments thread (includes Israa + Raouf alongside the rest of the team) */}
          {comments.length > 0 && (
            <Card>
              <CardHeader title={`Comments · ${comments.length}`} />
              <ul className="space-y-1">
                {comments.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).map(c => (
                  <li key={c.comment_id} className="rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{displayName(c.author_email)}</span>
                      <span className="text-[9px] text-slate-500">{c.created_at}</span>
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap">{c.body}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Other reviewers */}
          {reviewsForCompany.length > 0 && (
            <Card>
              <CardHeader title={`Team reviews · ${reviewsForCompany.length}`} />
              <ul className="space-y-1">
                {reviewsForCompany.map(r => (
                  <li key={r.review_id} className="rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">{displayName(r.reviewer_email)}</span>
                      {r.decision && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.decision === 'Recommend' ? 'bg-emerald-100 text-emerald-800' : r.decision === 'Hold' ? 'bg-amber-100 text-amber-800' : 'bg-orange-100 text-orange-800'}`}>{r.decision}</span>}
                    </div>
                    {r.proposed_pillars && (
                      <div className="mt-0.5 text-slate-600 dark:text-slate-400">{r.proposed_pillars}</div>
                    )}
                    {r.notes && <div className="mt-0.5 whitespace-pre-wrap">{r.notes}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Selection-tool: Interview Discussion (multi-row team thread) */}
          {(company.selection?.interviewDiscussionAll && company.selection.interviewDiscussionAll.length > 0) && (
            <Card>
              <CardHeader title={`Interview discussion (selection-tool) · ${company.selection.interviewDiscussionAll.length}`} subtitle="Team thread captured in the Selection workbook" />
              <ul className="space-y-1">
                {company.selection.interviewDiscussionAll.map((row, i) => (
                  <li key={i} className="rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                    <SelectionRowDump row={row} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Selection-tool: Selection Votes (per voter) */}
          {(company.selection?.selectionVotesAll && company.selection.selectionVotesAll.length > 0) && (
            <Card>
              <CardHeader title={`Selection votes (selection-tool) · ${company.selection.selectionVotesAll.length}`} subtitle="Per-voter tally before the live session" />
              <ul className="space-y-1">
                {company.selection.selectionVotesAll.map((row, i) => (
                  <li key={i} className="rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                    <SelectionRowDump row={row} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Selection-tool: Committee votes + Doc reviews */}
          {(company.selection?.committeeVotes || company.selection?.docReview) && (
            <Card>
              <CardHeader title="Committee + doc review (selection-tool)" subtitle="Earlier-stage decisions and document audit" />
              {company.selection.committeeVotes && (
                <div className="rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">Committee votes</div>
                  <SelectionRowDump row={company.selection.committeeVotes} />
                </div>
              )}
              {company.selection.docReview && (
                <div className="mt-2 rounded border border-slate-200 p-1.5 text-[11px] dark:border-navy-700">
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">Doc review</div>
                  <SelectionRowDump row={company.selection.docReview} />
                </div>
              )}
            </Card>
          )}
        </div>

        {/* RIGHT: form */}
        <div className="space-y-3">
          {mode === 'review' ? (
            <>
              <Card>
                <CardHeader title="Your decision" />
                <div className="grid grid-cols-3 gap-1">
                  {(['Recommend', 'Hold', 'Waitlist'] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      className={`rounded-md border-2 px-2 py-2 text-xs font-bold ${
                        decision === d
                          ? d === 'Recommend' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : d === 'Hold' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-orange-500 bg-orange-50 text-orange-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Pillars" subtitle="Pick what this company should get." />
                <div className="space-y-1.5">
                  {PILLARS.map(p => (
                    <div key={p.code}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:border-brand-teal dark:border-navy-700">
                        <input
                          type="checkbox"
                          checked={proposedPillars.has(p.code)}
                          onChange={() => togglePillar(p.code, proposedPillars, setProposedPillars, proposedSubs, setProposedSubs)}
                        />
                        <span className="font-bold">{p.label}</span>
                        <span className="text-[10px] text-slate-500">{p.shortLabel}</span>
                      </label>
                      {proposedPillars.has(p.code) && p.subInterventions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1 px-2">
                          {p.subInterventions.map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                const next = new Set(proposedSubs);
                                if (next.has(s)) next.delete(s); else next.add(s);
                                setProposedSubs(next);
                              }}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                proposedSubs.has(s)
                                  ? 'border-brand-teal bg-brand-teal text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand-teal dark:border-navy-700 dark:bg-navy-900 dark:text-slate-300'
                              }`}
                            >
                              {s.replace(/^MA-/, '')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Notes" />
                <textarea
                  rows={4}
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.currentTarget.value)}
                  placeholder="Reasoning, context, concerns…"
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                />
              </Card>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSaveReview} disabled={saving || !decision}>
                  {saving ? 'Saving…' : myReview ? 'Update review' : 'Save review'}
                </Button>
              </div>

              <Card>
                <CardHeader title="Add a comment" subtitle="Visible to the whole team." />
                <textarea
                  rows={2}
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.currentTarget.value)}
                  placeholder="Quick comment…"
                  className="w-full rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" onClick={handlePostComment} disabled={posting || !commentDraft.trim()}>
                    {posting ? 'Posting…' : 'Post'}
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardHeader title="Final status" />
                <div className="grid grid-cols-3 gap-1">
                  {(['Selected', 'Hold', 'Waitlist'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setLockStatus(s)}
                      className={`rounded-md border-2 px-2 py-2 text-xs font-bold ${
                        lockStatus === s
                          ? s === 'Selected' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : s === 'Hold' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-orange-500 bg-orange-50 text-orange-800'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Account Manager" />
                <div className="grid grid-cols-3 gap-1">
                  {ACCOUNT_MANAGERS.map(am => (
                    <button
                      key={am.email}
                      type="button"
                      onClick={() => setLockPm(am.email)}
                      className={`rounded-md border-2 px-2 py-2 text-xs font-bold ${
                        lockPm === am.email ? 'border-brand-teal bg-teal-50 text-brand-teal dark:bg-teal-950' : 'border-slate-200 bg-white text-slate-700 dark:border-navy-700 dark:bg-navy-900'
                      }`}
                    >
                      {am.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
                {!company.profile_manager_email && lockPm && onAssignPM && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => onAssignPM(company.company_id, lockPm)}
                  >
                    Assign without locking
                  </Button>
                )}
              </Card>

              <Card>
                <CardHeader title="Interventions + donor" subtitle="Pick a pillar, then sub + donor for each. Sub-level donor wins over pillar-level." />
                <div className="space-y-2">
                  {PILLARS.map(p => {
                    const isOn = lockPillars.has(p.code);
                    const pillarFund = lockFund[p.code] || '';
                    return (
                      <div key={p.code} className="rounded-md border border-slate-200 dark:border-navy-700">
                        <div className="flex items-center justify-between gap-2 bg-slate-50 px-2 py-1 dark:bg-navy-800/50">
                          <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => togglePillar(p.code, lockPillars, setLockPillars, lockSubs, setLockSubs)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="font-bold text-navy-500 dark:text-slate-100">{p.label}</span>
                          </label>
                          {isOn && (
                            <select
                              value={pillarFund}
                              onChange={e => setLockFund({ ...lockFund, [p.code]: e.currentTarget.value })}
                              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                            >
                              <option value="">Donor?</option>
                              <option value="97060">Dutch (97060)</option>
                              <option value="91763">SIDA (91763)</option>
                            </select>
                          )}
                        </div>
                        {isOn && p.subInterventions.length > 0 && (
                          <ul className="space-y-0.5 px-2 py-1">
                            {p.subInterventions.map(s => {
                              const subOn = lockSubs.has(s);
                              const subFund = perSubFund[s] || '';
                              return (
                                <li key={s} className="flex items-center justify-between gap-2 text-[11px]">
                                  <label className="flex flex-1 cursor-pointer items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={subOn}
                                      onChange={() => {
                                        const next = new Set(lockSubs);
                                        if (next.has(s)) next.delete(s); else next.add(s);
                                        setLockSubs(next);
                                        setLockPillars(prev => { const np = new Set(prev); np.add(p.code); return np; });
                                      }}
                                      className="h-3 w-3"
                                    />
                                    <span className={subOn ? 'font-semibold text-navy-500 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}>{s}</span>
                                  </label>
                                  {subOn && (
                                    <select
                                      value={subFund}
                                      onChange={e => setPerSubFund({ ...perSubFund, [s]: e.currentTarget.value })}
                                      className="rounded border border-slate-200 bg-white px-1 py-0 text-[9px] dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
                                      title="Override pillar-level donor for this sub"
                                    >
                                      <option value="">use pillar</option>
                                      <option value="97060">Dutch</option>
                                      <option value="91763">SIDA</option>
                                    </select>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={handleLock} disabled={locking || !lockPm || lockPillars.size === 0}>
                  {locking ? 'Locking…' : 'Lock decision'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// Compact key-value dump of a selection-tool row. Skips empty / id /
// timestamp columns. Renders the speaker/reviewer + timestamp on top
// when those are present so multi-row threads identify who said what.
function SelectionRowDump({ row }: { row: Record<string, string> }) {
  const meta = {
    who: row['reviewer_email'] || row['reviewer'] || row['author'] || row['author_email'] || row['voter_email'] || row['email'] || '',
    when: row['updated_at'] || row['created_at'] || row['timestamp'] || row['date'] || '',
  };
  const skip = /^id$|_id$|^index$|^row[_ ]?number$|^updated[_ ]?at$|^created[_ ]?at$|^updated[_ ]?by$|^created[_ ]?by$|^reviewer_?email$|^author_?email$|^voter_?email$|^company.?name$/i;
  const entries = Object.entries(row).filter(([k, v]) => v && v.trim() && !skip.test(k));
  return (
    <div>
      {(meta.who || meta.when) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500">
          <span>{meta.who ? displayName(meta.who) : ''}</span>
          <span>{meta.when}</span>
        </div>
      )}
      {entries.length === 0 ? (
        <span className="italic text-slate-400">No data.</span>
      ) : (
        <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
          {entries.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{k.replace(/_/g, ' ')}</dt>
              <dd className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function firstField(row: Record<string, string> | null | undefined, keys: string[]): string {
  if (!row) return '';
  for (const k of keys) {
    const lower = k.toLowerCase();
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase() === lower && rv) return rv;
    }
  }
  for (const k of keys) {
    const lower = k.toLowerCase();
    for (const [rk, rv] of Object.entries(row)) {
      if (rk.toLowerCase().includes(lower) && rv) return rv;
    }
  }
  return '';
}

// Map a pillar code (new taxonomy) to the applicant wantsXXX flags
// that signal the applicant requested that pillar.
function wantsBoolFor(applicant: Record<string, string> | null | undefined, pillarCode: string): boolean {
  if (!applicant) return false;
  const map: Record<string, string[]> = {
    // Capacity Building = wantsTrainToHire OR wantsUpskilling
    CB: ['wantsTrainToHire', 'wantsUpskilling'],
    // Marketing & Branding = wantsMarketingSupport
    MKG: ['wantsMarketingSupport'],
    // Market Access = legal / coaching / conferences / EB any of these
    MA: ['wantsLegalSupport', 'wantsDomainCoaching', 'wantsConferences', 'wantsElevateBridge'],
  };
  const keys = map[pillarCode] || [];
  for (const k of keys) {
    const v = (applicant[k] || '').trim().toLowerCase();
    if (v === 'true' || v === 'yes' || v === '1' || v === 'y') return true;
  }
  return false;
}

// ─── InsightsDashboard (action-oriented) ─────────────────────────────
// Real signals, not just counts. Surfaces things the team actually
// needs to react to in the live session.

function InsightsDashboard({
  companies,
  reviews,
  assignments,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  assignments: Assignment[];
  preDecisions: PreDecisionRecommendation[];
}) {
  const reviewsByCompany = useMemo(() => {
    const m = new Map<string, Review[]>();
    for (const r of reviews) {
      const arr = m.get(r.company_id) || [];
      arr.push(r);
      m.set(r.company_id, arr);
    }
    return m;
  }, [reviews]);

  const lockedSet = useMemo(() => new Set(assignments.map(a => a.company_id)), [assignments]);

  // ── Action items ─────────────────────────────────────────
  const noReviewYet = companies.filter(c => (reviewsByCompany.get(c.company_id)?.length || 0) === 0);
  const divergent = companies.filter(c => summarizeReviews(reviewsByCompany.get(c.company_id) || []).divergence);
  const lockedNoPm = companies.filter(c => lockedSet.has(c.company_id) && !c.profile_manager_email);
  const recommendNotLocked = companies.filter(c => {
    const s = summarizeReviews(reviewsByCompany.get(c.company_id) || []);
    return s.consensus === 'Recommend' && !lockedSet.has(c.company_id);
  });

  // ── Pillar capacity health ───────────────────────────────
  const pillarStats = useMemo(() => {
    const fromReviews = new Map<string, number>();
    for (const r of reviews) {
      for (const p of (r.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean)) {
        fromReviews.set(p, (fromReviews.get(p) || 0) + 1);
      }
    }
    const fromLocks = new Map<string, number>();
    for (const a of assignments) {
      const code = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (code) fromLocks.set(code, (fromLocks.get(code) || 0) + 1);
    }
    return PILLARS.map(p => {
      const proposed = fromReviews.get(p.code) || 0;
      const locked = fromLocks.get(p.code) || 0;
      const dropRate = proposed === 0 ? 0 : Math.round(((proposed - locked) / proposed) * 100);
      return { p, proposed, locked, dropRate };
    });
  }, [reviews, assignments]);

  // ── Sub-intervention demand (top 10) ─────────────────────
  const subStats = useMemo(() => {
    const fromReviews = new Map<string, number>();
    for (const r of reviews) {
      for (const s of (r.proposed_sub_interventions || '').split(',').map(s => s.trim()).filter(Boolean)) {
        fromReviews.set(s, (fromReviews.get(s) || 0) + 1);
      }
    }
    const fromLocks = new Map<string, number>();
    for (const a of assignments) {
      const s = (a.sub_intervention || '').trim();
      if (s) fromLocks.set(s, (fromLocks.get(s) || 0) + 1);
    }
    const all = new Set([...fromReviews.keys(), ...fromLocks.keys()]);
    return Array.from(all)
      .map(s => ({ name: s, proposed: fromReviews.get(s) || 0, locked: fromLocks.get(s) || 0 }))
      .sort((a, b) => (b.proposed + b.locked) - (a.proposed + a.locked))
      .slice(0, 10);
  }, [reviews, assignments]);

  // ── AM workload ──────────────────────────────────────────
  const amStats = useMemo(() => {
    const m = new Map<string, { locked: number; selected: number }>();
    for (const am of ACCOUNT_MANAGERS) m.set(am.email, { locked: 0, selected: 0 });
    let unassigned = 0;
    for (const c of companies) {
      const isLocked = lockedSet.has(c.company_id);
      const am = c.profile_manager_email || '';
      const cur = m.get(am);
      if (cur) {
        if (isLocked) cur.locked++;
        if (c.status === 'Selected') cur.selected++;
      } else if (am === '' && isLocked) unassigned++;
    }
    return { perAm: m, unassigned };
  }, [companies, lockedSet]);

  // ── Fund capacity ────────────────────────────────────────
  const fundStats = useMemo(() => {
    const dutchLocks = assignments.filter(a => a.fund_code === '97060').length;
    const sidaLocks = assignments.filter(a => a.fund_code === '91763').length;
    const noFund = assignments.filter(a => !a.fund_code).length;
    return { dutchLocks, sidaLocks, noFund, total: assignments.length };
  }, [assignments]);

  return (
    <div className="space-y-4">
      {/* ── Action items at the very top ── */}
      <Card>
        <CardHeader title="Action items" subtitle="Things that need attention before tomorrow's session — click any number to drill in." />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <ActionTile
            label="No review yet"
            count={noReviewYet.length}
            tone="red"
            hint={noReviewYet.length > 0 ? 'Blocks Stage 2' : 'All reviewed ✓'}
            companies={noReviewYet}
          />
          <ActionTile
            label="Divergent reviews"
            count={divergent.length}
            tone="amber"
            hint="Reviewers disagree — discuss live"
            companies={divergent}
          />
          <ActionTile
            label="Recommend but not locked yet"
            count={recommendNotLocked.length}
            tone="orange"
            hint="Ready for Stage 2"
            companies={recommendNotLocked}
          />
          <ActionTile
            label="Locked but no AM"
            count={lockedNoPm.length}
            tone="red"
            hint="Assign Mohammed/Doaa/Muna"
            companies={lockedNoPm}
          />
        </div>
      </Card>

      {/* ── Pillar capacity health ── */}
      <Card>
        <CardHeader
          title="Pillar capacity health"
          subtitle="Reviewer demand vs locked supply per pillar. High drop rate = team proposed but didn't lock — clarify scope or capacity."
        />
        <ul className="space-y-1.5">
          {pillarStats.map(({ p, proposed, locked, dropRate }) => (
            <li key={p.code} className="grid grid-cols-[1fr_60px_60px_120px_60px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900">
              <div>
                <div className="font-bold text-navy-500 dark:text-slate-100">{p.label}</div>
                <div className="text-[10px] text-slate-500">{p.shortLabel}</div>
              </div>
              <span className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-slate-500">Proposed</div>
                <div className="font-mono font-bold">{proposed}</div>
              </span>
              <span className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-slate-500">Locked</div>
                <div className="font-mono font-bold">{locked}</div>
              </span>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                  <div className="h-full bg-brand-teal" style={{ width: `${proposed === 0 ? 0 : Math.min(100, Math.round((locked / proposed) * 100))}%` }} />
                </div>
              </div>
              <span className={`text-right text-xs font-bold ${dropRate > 50 ? 'text-red-700' : dropRate > 20 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {proposed === 0 ? '—' : `${dropRate}% drop`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── Sub-intervention demand ── */}
      <Card>
        <CardHeader
          title="Top sub-interventions by demand"
          subtitle="Which sub-interventions are most-requested. High proposed-vs-locked gap = capacity bottleneck."
        />
        {subStats.length === 0 ? (
          <p className="text-xs italic text-slate-500">No sub-intervention picks yet — appears once reviewers tag MA / Upskilling sub-tracks.</p>
        ) : (
          <ul className="space-y-1.5">
            {subStats.map(s => {
              const max = Math.max(1, subStats[0]?.proposed || 0, subStats[0]?.locked || 0);
              return (
                <li key={s.name} className="grid grid-cols-[1fr_50px_50px_140px] items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900">
                  <div className="font-bold text-navy-500 dark:text-slate-100">{s.name.replace(/^MA-/, 'MA · ')}</div>
                  <span className="text-right font-mono">{s.proposed}</span>
                  <span className="text-right font-mono">{s.locked}</span>
                  <div className="flex items-center gap-1">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                      <div className="h-full bg-amber-500" style={{ width: `${Math.round((s.proposed / max) * 100)}%` }} />
                    </div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                      <div className="h-full bg-brand-teal" style={{ width: `${Math.round((s.locked / max) * 100)}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── AM workload + Fund split ── */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader title="AM workload" subtitle="Locked companies per Account Manager. Avg ≈ N/3 — bigger gap = rebalance opportunity." />
          {(() => {
            const lockedTotal = Array.from(amStats.perAm.values()).reduce((s, v) => s + v.locked, 0) + amStats.unassigned;
            const avg = Math.max(1, lockedTotal / 3);
            return (
              <ul className="space-y-1.5">
                {ACCOUNT_MANAGERS.map(am => {
                  const cur = amStats.perAm.get(am.email)!;
                  const dev = cur.locked - avg;
                  const tone = Math.abs(dev) <= 1 ? 'text-slate-500' : dev > 0 ? 'text-amber-700' : 'text-emerald-700';
                  return (
                    <li key={am.email} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{am.name}</span>
                        <span className="font-mono">{cur.locked} <span className={`text-[10px] ${tone}`}>({dev >= 0 ? '+' : ''}{dev.toFixed(1)} vs avg)</span></span>
                      </div>
                    </li>
                  );
                })}
                {amStats.unassigned > 0 && (
                  <li className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-950">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-amber-800 dark:text-amber-200">Unassigned</span>
                      <span className="font-mono">{amStats.unassigned}</span>
                    </div>
                  </li>
                )}
              </ul>
            );
          })()}
        </Card>
        <Card>
          <CardHeader title="Fund commitment" subtitle="How locked interventions split across Dutch (97060) and SIDA (91763)." />
          <div className="space-y-1.5">
            <FundBar label="Dutch (97060)" value={fundStats.dutchLocks} total={fundStats.total} tone="teal" />
            <FundBar label="SIDA (91763)" value={fundStats.sidaLocks} total={fundStats.total} tone="amber" />
            {fundStats.noFund > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <span className="font-bold">{fundStats.noFund}</span> intervention(s) locked without a fund_code — fix before exporting.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ActionTile({ label, count, tone, hint, companies }: { label: string; count: number; tone: 'red' | 'amber' | 'orange' | 'green'; hint?: string; companies: ReviewableCompany[] }) {
  const [open, setOpen] = useState(false);
  const cls =
    tone === 'red' ? 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800'
    : tone === 'amber' ? 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800'
    : tone === 'orange' ? 'bg-orange-50 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800'
    : 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800';
  if (count === 0) {
    return (
      <div className={`rounded-md border px-3 py-2 ${cls.replace('border-red-300', 'border-emerald-300').replace('text-red-800', 'text-emerald-800').replace('bg-red-50', 'bg-emerald-50').replace('border-amber-300', 'border-emerald-300').replace('text-amber-900', 'text-emerald-800').replace('bg-amber-50', 'bg-emerald-50')}`}>
        <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">{label}</div>
        <div className="text-xl font-bold">0</div>
        {hint && <div className="text-[10px] opacity-70">{hint}</div>}
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full rounded-md border px-3 py-2 text-left ${cls}`}
      >
        <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">{label}</div>
        <div className="text-xl font-bold">{count}</div>
        {hint && <div className="text-[10px] opacity-70">{hint}</div>}
      </button>
      {open && companies.length > 0 && (
        <ul className={`mt-1 max-h-44 overflow-auto rounded-md border px-2 py-1 text-[11px] ${cls}`}>
          {companies.map(c => (
            <li key={c.company_id} className="border-b border-current/20 py-0.5 last:border-b-0">
              {c.company_name}
              {c.sector && <span className="ml-1 opacity-60">· {c.sector}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FundBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'teal' | 'amber' }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold">{label}</span>
        <span className="font-mono">{value} ({pct}%)</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
        <div className={`h-full ${tone === 'teal' ? 'bg-brand-teal' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Logframe target parser ──────────────────────────────────────────
// The logframe Dutch + SIDA tabs each have one row per indicator with
// year-target columns. We pull the 2026 target for each row + match
// the indicator text to a pillar/sub via keyword. Returns a map keyed
// by '<pillar>' or '<pillar>/<sub>' with { target, indicator } values.

type LogframeTargets = {
  perKey: Map<string, { target: number; indicator: string }>;
  cohortTarget: number; // companies-supported target for 2026 if found
};

function parseLogframeTargets(rows: Record<string, string>[]): LogframeTargets {
  const perKey = new Map<string, { target: number; indicator: string }>();
  let cohortTarget = 0;

  // Match an indicator name to a pillar/sub. Keyword precedence matters:
  // sub-intervention names beat pillar names so the bar lands on the
  // most-specific bucket.
  const matchKey = (text: string): string | null => {
    const t = text.toLowerCase();
    // Sub matches first
    if (/train.to.hire|tth\b/.test(t)) return 'CB/Train To Hire';
    if (/upskill/.test(t)) return 'CB/Upskilling';
    if (/marketing agency|m&b agency/.test(t)) return 'MKG/Marketing Agency';
    if (/marketing resource|m&b resource/.test(t)) return 'MKG/Marketing Resources';
    if (/legal (support|registration|setup)|registration in|legal&compliance/.test(t)) return 'MA/Legal Support';
    if (/conference|biban|exhibition/.test(t)) return 'MA/Conferences';
    if (/c-suite|domain coaching|coaching/.test(t)) return 'MA/C-Suite';
    if (/elevate ?bridge|bridge\b/.test(t)) return 'MA/ElevateBridge';
    // Pillar fallback
    if (/capacity building|cap.building/.test(t)) return 'CB';
    if (/marketing(?: ?& ?branding)?|m&b\b|brand/.test(t)) return 'MKG';
    if (/market access|ma\b/.test(t)) return 'MA';
    return null;
  };

  for (const r of rows) {
    const indicator = (r['Output Indicators'] || r['Indicators'] || '').trim();
    if (!indicator) continue;
    const target2026Raw = r['2026 Target'] || r['Y1 Target'] || r['2026 Target (June - July)'] || '';
    const t = parseInt((target2026Raw || '').replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(t) || t <= 0) continue;

    // Whole-cohort indicator (e.g. "Number of supported companies")
    if (/total (number of )?(supported )?companies|cohort size|companies in the cohort/i.test(indicator)) {
      cohortTarget = Math.max(cohortTarget, t);
      continue;
    }

    const key = matchKey(indicator);
    if (!key) continue;
    const existing = perKey.get(key);
    if (!existing || existing.target < t) {
      perKey.set(key, { target: t, indicator });
    }
  }
  return { perKey, cohortTarget };
}

// ─── LiveInsightsPanel ───────────────────────────────────────────────

function LiveInsightsPanel({
  totalSelected,
  totalCohort,
  lockedTotal,
  pillarCompanyCounts,
  subCompanyCounts,
  dutchAssignsCount,
  sidaAssignsCount,
  dutchTargets,
  sidaTargets,
}: {
  totalSelected: number;
  totalCohort: number;
  lockedTotal: number;
  pillarCompanyCounts: Map<string, Set<string>>;
  subCompanyCounts: Map<string, Set<string>>;
  dutchAssignsCount: number;
  sidaAssignsCount: number;
  dutchTargets: LogframeTargets;
  sidaTargets: LogframeTargets;
}) {
  // Combined target (Dutch + SIDA) per key — we don't separate the two
  // for the per-pillar bars since one company can carry both funds.
  const combinedTargets = new Map<string, { target: number; indicator: string; dutch: number; sida: number }>();
  for (const [k, v] of dutchTargets.perKey) {
    combinedTargets.set(k, { target: v.target, indicator: v.indicator, dutch: v.target, sida: 0 });
  }
  for (const [k, v] of sidaTargets.perKey) {
    const cur = combinedTargets.get(k);
    if (cur) {
      combinedTargets.set(k, { ...cur, target: cur.target + v.target, sida: v.target });
    } else {
      combinedTargets.set(k, { target: v.target, indicator: v.indicator, dutch: 0, sida: v.target });
    }
  }
  const cohortTarget = Math.max(dutchTargets.cohortTarget, sidaTargets.cohortTarget) || totalCohort;

  return (
    <div className="space-y-3 lg:sticky lg:top-3">
      <Card>
        <CardHeader title="Cohort progress" subtitle="Live as locks happen." />
        <div className="space-y-2">
          <ProgressBar label="Selected" value={totalSelected} total={cohortTarget} hint={`of ${cohortTarget} target`} tone="teal" />
          <ProgressBar label="Locked" value={lockedTotal} total={totalSelected || cohortTarget} hint={`of ${totalSelected || cohortTarget} selected`} tone="green" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Per donor" subtitle="Intervention-rows allocated to each fund." />
        <div className="space-y-2">
          <FundBar label="Dutch (97060)" value={dutchAssignsCount} total={dutchAssignsCount + sidaAssignsCount} tone="teal" />
          <FundBar label="SIDA (91763)" value={sidaAssignsCount} total={dutchAssignsCount + sidaAssignsCount} tone="amber" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Per pillar" subtitle="Distinct companies per pillar vs logframe target." />
        <ul className="space-y-2">
          {PILLARS.map(p => {
            const t = combinedTargets.get(p.code);
            const count = pillarCompanyCounts.get(p.code)?.size || 0;
            return (
              <li key={p.code}>
                <ProgressBar
                  label={p.shortLabel}
                  value={count}
                  total={t?.target || 0}
                  hint={t ? `of ${t.target} target (D ${t.dutch} · S ${t.sida})` : 'no target found'}
                  tone="navy"
                />
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Per sub-intervention" subtitle="Where each sub-target stands." />
        <ul className="space-y-2">
          {PILLARS.flatMap(p => p.subInterventions.map(s => ({ pillar: p.code, sub: s }))).map(({ pillar, sub }) => {
            const key = `${pillar}/${sub}`;
            const t = combinedTargets.get(key);
            const count = subCompanyCounts.get(sub)?.size || 0;
            // Only render rows that have either a count or a target — skip empty noise.
            if (!t && count === 0) return null;
            return (
              <li key={key}>
                <ProgressBar
                  label={sub}
                  value={count}
                  total={t?.target || count}
                  hint={t ? `of ${t.target} target` : 'no target found'}
                  tone="orange"
                />
              </li>
            );
          })}
        </ul>
      </Card>

      {(dutchTargets.perKey.size === 0 && sidaTargets.perKey.size === 0) && (
        <Card>
          <p className="text-[11px] italic text-slate-500">
            Logframe targets not loaded yet. Check that the Logframes workbook is shared and that 2026 Target / Y1 Target columns are populated for the indicators you care about.
          </p>
        </Card>
      )}
    </div>
  );
}

function ProgressBar({ label, value, total, hint, tone }: { label: string; value: number; total: number; hint?: string; tone: 'teal' | 'amber' | 'navy' | 'orange' | 'green' }) {
  const pct = total <= 0 ? 0 : Math.round((value / total) * 100);
  const cls =
    tone === 'teal' ? 'bg-brand-teal'
    : tone === 'amber' ? 'bg-amber-500'
    : tone === 'green' ? 'bg-emerald-500'
    : tone === 'orange' ? 'bg-orange-500'
    : 'bg-navy-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-navy-500 dark:text-slate-100">{label}</span>
        <span className="font-mono">{value}{total > 0 ? ` / ${total}` : ''} <span className="text-[10px] text-slate-500">{total > 0 ? `(${pct}%)` : ''}</span></span>
      </div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
        <div className={`h-full ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
