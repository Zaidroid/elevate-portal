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
import { useNavigate } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Lock,
  MessageCircle,
  RefreshCw,
  Trophy,
  Upload,
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
  EmptyState,
  PageHeader,
  Tabs,
  useToast,
} from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import { ACCOUNT_MANAGERS, displayName, getProfileManagers, isAdmin } from '../../config/team';
import { PILLARS, pillarFor } from '../../config/interventions';
import { INTERVIEWED_NAMES, isInterviewed } from '../companies/interviewedSource';
import { ReviewView } from './ReviewQueueTab';
import type { ReviewableCompany, SelectionContext } from './ReviewQueueTab';
import { FinalDecisionView } from './FinalCohortTab';
import type { FinalLockArgs } from './FinalCohortTab';
import { exportReviewToSheet } from './exportReview';
import { fuzzyResolve, importExternalSeed, loadSeed } from './importExternal';
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

type Stage = 'review' | 'finalize' | 'output' | 'insights' | 'imports' | 'activity';

// ─── main page ───────────────────────────────────────────────────────

export function SelectionPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const admin = user ? isAdmin(user.email) : false;

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

  const reviewableForView: ReviewableCompany[] = useMemo(() => {
    const out: ReviewableCompany[] = [];
    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const nKey = norm(name);
      if (!nKey || !interviewedSet.has(nKey) || removedSet.has(nKey)) continue;
      const m = masterByName.get(nKey);
      const company_id = m?.company_id || `E3-A${padId(a.id || '')}`;
      const selection: SelectionContext = {
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
      };
      out.push({
        route_id: company_id,
        applicant_id: a.id || '',
        company_id,
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
        selection,
      });
    }
    return out.sort((a, b) => a.company_name.localeCompare(b.company_name));
  }, [
    applicants.rows, interviewedSet, removedSet, masterByName,
    scoringIdx, docReviewIdx, needsIdx, interviewAssessIdx, interviewDiscIdx, interviewDiscAllIdx,
    committeeIdx, selectionVotesIdx, selectionVotesAllIdx,
    firstFiltrationIdx, additionalFiltrationIdx, shortlistsIdx, finalCohortIdx,
  ]);

  const pms = useMemo(() => getProfileManagers(), []);

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

  // ─── import handler ───
  const [importingExt, setImportingExt] = useState(false);
  const handleImportExternal = async () => {
    if (!masterSheetId) return;
    setImportingExt(true);
    try {
      const seed = await loadSeed();
      if (!seed) {
        toast.error('Seed missing', 'Run sheet-builders/tools/import_external_comments.py.');
        return;
      }
      const candidates = reviewableForView.map(r => ({ company_id: r.company_id, company_name: r.company_name }));
      const result = await importExternalSeed(seed, {
        resolve: name => fuzzyResolve(name, candidates),
        existingComments: commentsDoc.rows,
        existingRecs: preDecisionsDoc.rows,
        createComment: row => commentsDoc.createRow(row),
        createRecommendation: row => preDecisionsDoc.createRow(row),
      });
      const lines: string[] = [];
      lines.push(`${result.commentsAdded} comments + ${result.recsAdded} recs imported.`);
      if (result.commentsSkipped + result.recsSkipped > 0) lines.push(`${result.commentsSkipped + result.recsSkipped} already-present.`);
      if (result.commentsUnmatched.length + result.recsUnmatched.length > 0) {
        lines.push(`${result.commentsUnmatched.length + result.recsUnmatched.length} unmatched. Add aliases.`);
      }
      toast.success('Import complete', lines.join(' '));
      logActivity('import_external', undefined, { details: `${result.commentsAdded}c+${result.recsAdded}r` });
      await commentsDoc.refresh();
      await preDecisionsDoc.refresh();
    } catch (e) {
      toast.error('Import failed', (e as Error).message);
    } finally {
      setImportingExt(false);
    }
  };

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
    { value: 'imports', label: 'Imports & seeds', icon: <Upload className="h-4 w-4" /> },
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
          <ReviewView
            companies={reviewableForView}
            reviews={reviewsDoc.rows}
            comments={commentsDoc.rows}
            reviewerEmail={user?.email || ''}
            isAdmin={admin}
            profileManagers={pms}
            onSaveReview={onSaveReview}
            onAddComment={onAddComment}
            onAssignPM={onAssignPM}
            onFinalize={async ({ companyId, pmEmail, status, interventions }) => {
              // Convert the legacy onFinalize args to the new lock shape (no per-pillar fund picker in ReviewView; uses company's fund_code).
              const c = reviewableForView.find(x => x.company_id === companyId);
              if (!c) return;
              const repFund = c.fund_code || '';
              const allowed = ['Selected', 'Recommended', 'Reviewing', 'Hold', 'Rejected'] as const;
              type LockStatus = typeof allowed[number];
              const narrowedStatus: LockStatus = allowed.includes(status as LockStatus) ? (status as LockStatus) : 'Selected';
              await onLockDecision({
                companyId,
                companyName: c.company_name,
                status: narrowedStatus,
                pmEmail: pmEmail || '',
                interventions: interventions.map(i => ({ pillar: i.pillar, sub: i.sub, fund_code: repFund })),
              });
            }}
            onJumpToCompany={rid => navigate(`/companies/${encodeURIComponent(rid)}`)}
            onRemoveCompany={async () => { /* remove flow handled in CompaniesPage; not exposed here */ }}
          />
        )}

        {stage === 'finalize' && (
          <FinalDecisionView
            companies={reviewableForView}
            reviews={reviewsDoc.rows}
            reviewerEmail={user?.email || ''}
            existingAssignments={assignments.rows.map(a => ({
              company_id: a.company_id,
              intervention_type: a.intervention_type,
              sub_intervention: a.sub_intervention,
              fund_code: a.fund_code,
            }))}
            onExport={async () => {
              if (!masterSheetId) throw new Error('No companies workbook configured');
              const out = await exportReviewToSheet(masterSheetId, {
                companies: reviewableForView,
                reviews: reviewsDoc.rows,
                comments: commentsDoc.rows,
                assignments: assignments.rows as unknown as Record<string, string>[],
              }, user?.email || 'unknown');
              logActivity('export', undefined, { details: 'Cohort review exported' });
              return out;
            }}
            comments={commentsDoc.rows}
            preDecisions={preDecisionsDoc.rows}
            activity={activityDoc.rows}
            onImportExternal={admin ? handleImportExternal : undefined}
            importingExternal={importingExt}
            onLockDecision={onLockDecision}
          />
        )}

        {stage === 'output' && (
          <FinalCohortOutput
            companies={reviewableForView}
            assignments={assignments.rows}
            master={master.rows}
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

        {stage === 'imports' && (
          <ImportsSeedsView
            loading={importingExt}
            onImport={admin ? handleImportExternal : undefined}
            commentsCount={commentsDoc.rows.length}
            preDecisionsCount={preDecisionsDoc.rows.length}
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

// ─── InsightsDashboard ───────────────────────────────────────────────

function InsightsDashboard({
  companies,
  reviews,
  assignments,
  preDecisions,
}: {
  companies: ReviewableCompany[];
  reviews: Review[];
  assignments: Assignment[];
  preDecisions: PreDecisionRecommendation[];
}) {
  // Decision distribution
  const decisionCounts = useMemo(() => {
    let recommend = 0, hold = 0, reject = 0;
    for (const r of reviews) {
      if (r.decision === 'Recommend') recommend++;
      else if (r.decision === 'Hold') hold++;
      else if (r.decision === 'Reject') reject++;
    }
    return { recommend, hold, reject, total: reviews.length };
  }, [reviews]);

  // Per-company consensus distribution
  const consensusCounts = useMemo(() => {
    const out = { Recommend: 0, Hold: 0, Reject: 0, Mixed: 0, None: 0, divergent: 0 };
    const reviewsByCompany = new Map<string, Review[]>();
    for (const r of reviews) {
      const arr = reviewsByCompany.get(r.company_id) || [];
      arr.push(r);
      reviewsByCompany.set(r.company_id, arr);
    }
    for (const c of companies) {
      const rs = reviewsByCompany.get(c.company_id) || [];
      const s = summarizeReviews(rs);
      if (s.total === 0) out.None++;
      else if (s.consensus === 'Recommend') out.Recommend++;
      else if (s.consensus === 'Hold') out.Hold++;
      else if (s.consensus === 'Reject') out.Reject++;
      else out.Mixed++;
      if (s.divergence) out.divergent++;
    }
    return out;
  }, [companies, reviews]);

  // Pillar allocation count from reviews (every reviewer's proposed_pillars)
  const pillarFromReviews = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reviews) {
      const ps = (r.proposed_pillars || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const p of ps) m.set(p, (m.get(p) || 0) + 1);
    }
    return m;
  }, [reviews]);

  // Pillar allocation from locked assignments
  const pillarFromLocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) {
      const code = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (code) m.set(code, (m.get(code) || 0) + 1);
    }
    return m;
  }, [assignments]);

  // Sub-intervention allocation count from reviews
  const subFromReviews = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reviews) {
      const ss = (r.proposed_sub_interventions || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const s of ss) m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
  }, [reviews]);

  // Sub-intervention allocation from locked assignments
  const subFromLocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) {
      const s = (a.sub_intervention || '').trim();
      if (s) m.set(s, (m.get(s) || 0) + 1);
    }
    return m;
  }, [assignments]);

  // Per-AM locked counts
  const amCounts = useMemo(() => {
    const m = new Map<string, number>();
    const lockedByCompany = new Map<string, Set<string>>(); // companyId → set of pillars
    for (const a of assignments) {
      const set = lockedByCompany.get(a.company_id) || new Set();
      set.add(a.intervention_type);
      lockedByCompany.set(a.company_id, set);
    }
    for (const a of ACCOUNT_MANAGERS) m.set(a.email, 0);
    let unassigned = 0;
    for (const c of companies) {
      if (!lockedByCompany.has(c.company_id)) continue;
      const am = c.profile_manager_email || '';
      if (am && m.has(am)) m.set(am, (m.get(am) || 0) + 1);
      else if (am) m.set(am, (m.get(am) || 0) + 1);
      else unassigned++;
    }
    return { perAm: m, unassigned };
  }, [companies, assignments]);

  // Per-fund split (locked)
  const fundCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments) m.set(a.fund_code || 'unset', (m.get(a.fund_code || 'unset') || 0) + 1);
    return m;
  }, [assignments]);

  // Pre-decision agreement rate: of locked pillars, how many were ALSO in preDecisions for the same company?
  const preDecisionAgreement = useMemo(() => {
    if (preDecisions.length === 0 || assignments.length === 0) return null;
    const recsByCompany = new Map<string, Set<string>>();
    for (const r of preDecisions) {
      const set = recsByCompany.get(r.company_id) || new Set();
      const code = pillarFor(r.pillar)?.code || r.pillar;
      if (code) set.add(code);
      recsByCompany.set(r.company_id, set);
    }
    let matched = 0, total = 0;
    for (const a of assignments) {
      total++;
      const recs = recsByCompany.get(a.company_id);
      const code = pillarFor(a.intervention_type)?.code || a.intervention_type;
      if (recs && code && recs.has(code)) matched++;
    }
    return { matched, total, pct: total > 0 ? Math.round((matched / total) * 100) : 0 };
  }, [preDecisions, assignments]);

  return (
    <div className="space-y-3">
      {/* Top KPI strip */}
      <Card>
        <CardHeader title="Insights at a glance" subtitle="Live aggregates from today's reviews + locked decisions." />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <KPI label="In scope" value={companies.length} hint="reviewable" tone="navy" />
          <KPI label="Reviews captured" value={decisionCounts.total} hint={`${decisionCounts.recommend}R · ${decisionCounts.hold}H · ${decisionCounts.reject}X`} tone="teal" />
          <KPI label="Consensus Recommend" value={consensusCounts.Recommend} hint={`${consensusCounts.divergent} divergent`} tone="green" />
          <KPI label="Locked decisions" value={Array.from(new Set(assignments.map(a => a.company_id))).length} hint={`${assignments.length} interventions`} tone="amber" />
          <KPI label="Pre-decision agreement" value={preDecisionAgreement ? `${preDecisionAgreement.pct}%` : '—'} hint={preDecisionAgreement ? `${preDecisionAgreement.matched}/${preDecisionAgreement.total} match Israa+Raouf` : 'no data yet'} tone="orange" />
        </div>
      </Card>

      {/* Pillar allocation: reviews vs locks */}
      <Card>
        <CardHeader title="Pillar allocation" subtitle="How many times each pillar was proposed by team reviewers vs locked into Intervention Assignments." />
        <BarTable
          rows={PILLARS.map(p => ({
            label: p.label,
            sub: p.shortLabel,
            a: pillarFromReviews.get(p.code) || 0,
            aLabel: 'Reviews',
            b: pillarFromLocks.get(p.code) || 0,
            bLabel: 'Locked',
          }))}
        />
      </Card>

      {/* Sub-intervention allocation */}
      <Card>
        <CardHeader title="Sub-intervention allocation" subtitle="How many times each sub-intervention was proposed by reviewers vs locked." />
        {(() => {
          const allKeys = new Set([...subFromReviews.keys(), ...subFromLocks.keys()]);
          const rows = Array.from(allKeys)
            .map(s => ({
              label: s.replace(/^MA-/, 'MA · '),
              sub: '',
              a: subFromReviews.get(s) || 0,
              aLabel: 'Reviews',
              b: subFromLocks.get(s) || 0,
              bLabel: 'Locked',
            }))
            .sort((x, y) => (y.a + y.b) - (x.a + x.b));
          if (rows.length === 0) {
            return <p className="text-xs italic text-slate-500">No sub-intervention picks yet — show up once reviewers tag MA / Upskilling sub-tracks.</p>;
          }
          return <BarTable rows={rows} />;
        })()}
      </Card>

      {/* Decision distribution */}
      <Card>
        <CardHeader title="Per-company consensus" subtitle="How the team's reviews shake out per company." />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <KPI label="Recommend" value={consensusCounts.Recommend} tone="green" />
          <KPI label="Hold" value={consensusCounts.Hold} tone="amber" />
          <KPI label="Reject" value={consensusCounts.Reject} tone="navy" />
          <KPI label="Mixed" value={consensusCounts.Mixed} hint={`${consensusCounts.divergent} divergent`} tone="orange" />
          <KPI label="No reviews yet" value={consensusCounts.None} tone="navy" />
        </div>
      </Card>

      {/* AM workload + fund split */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader title="Per-AM locked companies" subtitle="Workload distribution across Mohammed / Doaa / Muna." />
          <ul className="space-y-1.5">
            {ACCOUNT_MANAGERS.map(am => {
              const n = amCounts.perAm.get(am.email) || 0;
              return (
                <li key={am.email} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900">
                  <span className="font-bold text-navy-500 dark:text-slate-100">{am.name}</span>
                  <span className="font-mono">{n}</span>
                </li>
              );
            })}
            {amCounts.unassigned > 0 && (
              <li className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs dark:border-amber-800 dark:bg-amber-950">
                <span className="font-bold text-amber-800 dark:text-amber-200">Unassigned</span>
                <span className="font-mono">{amCounts.unassigned}</span>
              </li>
            )}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Per-fund split" subtitle="How many intervention assignments each fund covers." />
          <ul className="space-y-1.5">
            {Array.from(fundCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => (
                <li key={code} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900">
                  <span className="font-bold text-navy-500 dark:text-slate-100">
                    {code === '97060' ? 'Dutch (97060)' : code === '91763' ? 'SIDA (91763)' : code === 'unset' ? 'Unset' : code}
                  </span>
                  <span className="font-mono">{n}</span>
                </li>
              ))}
            {fundCounts.size === 0 && <li className="text-xs italic text-slate-500">No fund codes set yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone: 'navy' | 'teal' | 'green' | 'amber' | 'orange' }) {
  const cls =
    tone === 'navy' ? 'bg-navy-50 text-navy-800 dark:bg-navy-900 dark:text-slate-100'
    : tone === 'teal' ? 'bg-teal-50 text-brand-teal dark:bg-teal-950'
    : tone === 'green' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : tone === 'amber' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
    : 'bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-200';
  return (
    <div className={`rounded-md border border-slate-200 px-3 py-2 dark:border-navy-700 ${cls}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {hint && <div className="text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}

function BarTable({ rows }: { rows: Array<{ label: string; sub: string; a: number; aLabel: string; b: number; bLabel: string }> }) {
  const max = Math.max(1, ...rows.map(r => Math.max(r.a, r.b)));
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
      <div className="grid grid-cols-[1fr_60px_1fr_60px] border-b border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700 dark:bg-navy-800">
        <span>Pillar / sub</span>
        <span className="text-right">{rows[0]?.aLabel || ''}</span>
        <span>Locked</span>
        <span className="text-right">{rows[0]?.bLabel || ''}</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_60px_1fr_60px] items-center gap-1 border-b border-slate-100 px-2 py-1.5 text-xs last:border-b-0 dark:border-navy-800">
            <span>
              <div className="font-bold text-navy-500 dark:text-slate-100">{r.label}</div>
              {r.sub && <div className="text-[10px] text-slate-500">{r.sub}</div>}
            </span>
            <span className="text-right font-mono text-slate-700 dark:text-slate-300">{r.a}</span>
            <div className="flex items-center gap-1">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-800">
                <div
                  className="h-full bg-brand-teal"
                  style={{ width: `${Math.round((r.b / max) * 100)}%` }}
                />
              </div>
            </div>
            <span className="text-right font-mono text-slate-700 dark:text-slate-300">{r.b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── FinalCohortOutput ───────────────────────────────────────────────

function FinalCohortOutput({
  companies,
  assignments,
  master,
}: {
  companies: ReviewableCompany[];
  assignments: Assignment[];
  master: Master[];
}) {
  // Group assignments by company. Only show companies that have at
  // least one locked assignment — that is the resulting cohort.
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

  const rows = useMemo(() => {
    const out: Array<{ company: ReviewableCompany; m: Master | undefined; assigns: Assignment[] }> = [];
    for (const c of companies) {
      const a = byCompany.get(c.company_id) || [];
      if (a.length === 0) continue;
      out.push({ company: c, m: masterById.get(c.company_id), assigns: a });
    }
    // Group by AM, then alphabetical.
    return out.sort((x, y) => {
      const ax = x.m?.profile_manager_email || 'zzz';
      const ay = y.m?.profile_manager_email || 'zzz';
      if (ax !== ay) return ax.localeCompare(ay);
      return x.company.company_name.localeCompare(y.company.company_name);
    });
  }, [companies, byCompany, masterById]);

  // Group assignments by pillar within each company for compact display.
  const summaryRows = rows.map(({ company, m, assigns }) => {
    const byPillar = new Map<string, { fund: string; subs: string[] }>();
    for (const a of assigns) {
      const code = pillarFor(a.intervention_type)?.code || a.intervention_type;
      const cur = byPillar.get(code) || { fund: a.fund_code || '', subs: [] };
      if (!cur.fund && a.fund_code) cur.fund = a.fund_code;
      if (a.sub_intervention) cur.subs.push(a.sub_intervention);
      byPillar.set(code, cur);
    }
    return { company, m, byPillar };
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Trophy className="h-6 w-6" />}
        title="No locked decisions yet"
        description="As Stage 2 finalizes companies, the resulting cohort will populate here. Each row shows the AM, status, fund, and pillars + sub-interventions locked for that company."
      />
    );
  }

  // Stats
  const totalCompanies = rows.length;
  const totalAssignments = assignments.length;
  const dutchCount = assignments.filter(a => a.fund_code === '97060').length;
  const sidaCount = assignments.filter(a => a.fund_code === '91763').length;
  const perAm = new Map<string, number>();
  for (const r of rows) {
    const k = r.m?.profile_manager_email || 'unassigned';
    perAm.set(k, (perAm.get(k) || 0) + 1);
  }

  // Group rendering by AM bucket
  const byAm = new Map<string, typeof summaryRows>();
  for (const r of summaryRows) {
    const k = r.m?.profile_manager_email || '';
    const arr = byAm.get(k) || [];
    arr.push(r);
    byAm.set(k, arr);
  }
  const amOrder = [
    ...ACCOUNT_MANAGERS.map(a => a.email),
    ...Array.from(byAm.keys()).filter(k => k && !ACCOUNT_MANAGERS.find(a => a.email === k)),
    '',
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title={`Final cohort · ${totalCompanies} compan${totalCompanies === 1 ? 'y' : 'ies'}`}
          subtitle={`${totalAssignments} intervention assignment${totalAssignments === 1 ? '' : 's'}; ${dutchCount} Dutch · ${sidaCount} SIDA. Grouped by AM.`}
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <KPI label="Companies" value={totalCompanies} tone="green" />
          <KPI label="Interventions" value={totalAssignments} tone="teal" />
          <KPI label="Dutch (97060)" value={dutchCount} tone="navy" />
          <KPI label="SIDA (91763)" value={sidaCount} tone="amber" />
          <KPI label="Avg per company" value={(totalAssignments / Math.max(1, totalCompanies)).toFixed(1)} tone="orange" />
        </div>
      </Card>

      {amOrder.map(amEmail => {
        const bucket = byAm.get(amEmail) || [];
        if (bucket.length === 0) return null;
        const amName = amEmail
          ? ACCOUNT_MANAGERS.find(a => a.email === amEmail)?.name || displayName(amEmail)
          : 'Unassigned AM';
        return (
          <Card key={amEmail || 'unassigned'}>
            <CardHeader
              title={`${amName} · ${bucket.length}`}
              subtitle={amEmail ? amEmail : 'These companies have locked interventions but no AM yet.'}
            />
            <ul className="space-y-2">
              {bucket.map(({ company, m, byPillar }) => (
                <li
                  key={company.company_id}
                  className="rounded-md border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-navy-500 dark:text-slate-100">{company.company_name}</div>
                      <div className="text-xs text-slate-500">
                        {[company.sector, company.city, company.governorate].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {m?.status && <Badge tone={m.status === 'Selected' ? 'green' : m.status === 'Hold' ? 'amber' : 'neutral'}>{m.status}</Badge>}
                      {company.fund_code && (
                        <Badge tone={company.fund_code === '97060' ? 'teal' : 'amber'}>
                          {company.fund_code === '97060' ? 'Dutch' : 'SIDA'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Array.from(byPillar.entries()).map(([code, { fund, subs }]) => (
                      <span
                        key={code}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] dark:border-navy-700 dark:bg-navy-800"
                      >
                        <span className="font-bold text-navy-500 dark:text-slate-100">{code}</span>
                        {fund && <span className="ml-1 text-[10px] text-slate-500">[{fund}]</span>}
                        {subs.length > 0 && (
                          <span className="ml-1 text-[10px] text-slate-500">· {subs.map(s => s.replace(/^MA-/, '')).join(', ')}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Imports & seeds ─────────────────────────────────────────────────

function ImportsSeedsView({
  loading,
  onImport,
  commentsCount,
  preDecisionsCount,
}: {
  loading: boolean;
  onImport?: () => void;
  commentsCount: number;
  preDecisionsCount: number;
}) {
  return (
    <Card>
      <CardHeader
        title="External imports — Israa CSV + Raouf docx"
        subtitle="Pulls Israa's voting CSV and Raouf's narrative notes into Company Comments + Pre-decision Recommendations. Idempotent — already-imported entries are skipped."
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KPI label="Comments in workbook" value={commentsCount} tone="navy" />
        <KPI label="Pre-decision recs" value={preDecisionsCount} tone="teal" />
        <KPI label="Israa source" value="Voting.csv" hint="52 × 9 pillars" tone="amber" />
        <KPI label="Raouf source" value="Notes.docx" hint="Phrase match" tone="orange" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onImport ? (
          <Button onClick={onImport} disabled={loading}>
            <Download className="h-4 w-4" /> {loading ? 'Importing…' : 'Run import'}
          </Button>
        ) : (
          <p className="text-xs italic text-slate-500">Admins only — Zaid / Israa / Raouf can run the import.</p>
        )}
        <p className="text-xs text-slate-500">
          Re-running adds nothing for entries already on the sheet. Edited Israa CSV / Raouf docx content WILL re-import.
        </p>
      </div>
    </Card>
  );
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
