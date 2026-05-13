// ElevateBridge Programme HQ — replaces the previous FreelancersPage at
// /elevatebridge. Surfaces the full October 2025 – April 2026 selection
// pipeline (203 → 115 → 88 → 32), scoring frameworks, top performers,
// capacity-building tracks, and the post-admission matching engine that
// pairs freelancers with Cohort 3 companies.
//
// Tabs:
//   Overview  — funnel cards, track + region distribution, mentor cards
//   Applicants — full 203 with drawer showing per-applicant lineage
//   Scoring    — rubric-driven editable score grids (admin only)
//   Top Performers — final 32, CSV export
//   Capacity   — mentors, sessions, attendance, budget tracker
//   Matching   — existing kanban + drawer, admitted-only scope toggle
//   Activity   — unified audit trail

import { useState } from 'react';
import {
  Activity as ActivityIcon,
  Award,
  BarChart3,
  ClipboardCheck,
  GraduationCap,
  Handshake,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { getSheetId } from '../../config/sheets';
import { useModuleData } from '../../data/useModuleData';
import {
  Button,
  Card,
  CardHeader,
  PageHeader,
  Tabs,
  useToast,
} from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import type {
  EbApplicant,
  EbAttendance,
  EbDecisionRow,
  EbInterview,
  EbMentor,
  EbRubric,
  EbSession,
  EbStage1,
  EbStage2,
  EbStage3Response,
  EbStage3Ssi,
  EbTopPerformer,
  EbActivity,
} from '../../types/elevateBridge';
import type { FreelancerActivity } from '../../types/freelancer';
import { computeFunnel, enrichApplicants } from './utils';
import { OverviewTab } from './OverviewTab';
import { ApplicantsTab } from './ApplicantsTab';
import { ScoringTab } from './ScoringTab';
import { TopPerformersTab } from './TopPerformersTab';
import { CapacityTab } from './CapacityTab';
import { MatchingTab } from './MatchingTab';
import { ActivityTab } from './ActivityTab';

type EbTab =
  | 'overview'
  | 'applicants'
  | 'scoring'
  | 'top'
  | 'capacity'
  | 'matching'
  | 'activity';

export function ElevateBridgePage() {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const canEditAdmin = isAdmin(userEmail);
  const canEditStaff = canEditAdmin || /@gazaskygeeks\.com$/i.test(userEmail);
  const toast = useToast();

  const sheetId = getSheetId('elevateBridge');

  const [tab, setTab] = useState<EbTab>('overview');

  // All hooks register against SheetDataProvider; the provider batches
  // reads per workbook so all 14 elevateBridge tabs cost one batchGet
  // call per 120s poll. Tab-conditional rendering keeps the heavy tables
  // off the DOM when not viewing.
  const applicantsHook = useModuleData<EbApplicant>('elevateBridge', 'applicants');
  const decisionsHook  = useModuleData<EbDecisionRow>('elevateBridge', 'decisions');
  const stage1Hook     = useModuleData<EbStage1>('elevateBridge', 'stage1');
  const stage2Hook     = useModuleData<EbStage2>('elevateBridge', 'stage2');
  const ssiHook        = useModuleData<EbStage3Ssi>('elevateBridge', 'stage3Ssi');
  const responsesHook  = useModuleData<EbStage3Response>('elevateBridge', 'stage3Resp');
  const interviewsHook = useModuleData<EbInterview>('elevateBridge', 'interviews');
  const rubricsHook    = useModuleData<EbRubric>('elevateBridge', 'rubrics');
  const mentorsHook    = useModuleData<EbMentor>('elevateBridge', 'mentors');
  const sessionsHook   = useModuleData<EbSession>('elevateBridge', 'sessions');
  const attendanceHook = useModuleData<EbAttendance>('elevateBridge', 'attendance');
  const topPerfHook    = useModuleData<EbTopPerformer>('elevateBridge', 'topPerformers');
  const activityHook   = useModuleData<EbActivity>('elevateBridge', 'activity');
  // Pull the freelancers (matching) activity log too so the Activity tab
  // is a unified trail across both workbooks.
  const flActivityHook = useModuleData<FreelancerActivity>('freelancers', 'activity');

  if (!sheetId) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader title="ElevateBridge — Workbook not configured" />
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Set <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">VITE_SHEET_ELEVATE_BRIDGE</code> in
            your environment to point at the Elevate Bridge programme workbook in Drive, then refresh.
          </p>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            The workbook should contain these tabs: Applicants, Form Responses, S1 Killing Factor, S2 Tracks
            Sorting, S3 SSI, S3 Response Scoring, Interview Scoring, Final Decisions, Scoring Rubrics,
            Mentors, Training Sessions, Session Attendance, Top Performers, ActivityLog.
          </p>
        </Card>
      </div>
    );
  }

  const enriched = enrichApplicants(
    applicantsHook.rows,
    stage1Hook.rows,
    stage2Hook.rows,
    ssiHook.rows,
    decisionsHook.rows,
  );

  const funnel = computeFunnel(applicantsHook.rows);
  const admittedCount = funnel.admitted;
  const netCount = funnel.netCapacity;

  const firstError =
    applicantsHook.error ||
    decisionsHook.error ||
    stage1Hook.error ||
    stage2Hook.error ||
    ssiHook.error ||
    responsesHook.error ||
    interviewsHook.error ||
    rubricsHook.error ||
    mentorsHook.error ||
    sessionsHook.error ||
    attendanceHook.error ||
    topPerfHook.error ||
    activityHook.error;

  const loading = applicantsHook.loading && applicantsHook.rows.length === 0;

  const refreshAll = () => {
    applicantsHook.refresh();
    decisionsHook.refresh();
    stage1Hook.refresh();
    stage2Hook.refresh();
    ssiHook.refresh();
    responsesHook.refresh();
    interviewsHook.refresh();
    rubricsHook.refresh();
    mentorsHook.refresh();
    sessionsHook.refresh();
    attendanceHook.refresh();
    topPerfHook.refresh();
    activityHook.refresh();
    toast.info('Refreshing all ElevateBridge data…');
  };

  const tabs: TabItem[] = [
    { value: 'overview',   label: 'Overview',       icon: <BarChart3 className="h-4 w-4" /> },
    { value: 'applicants', label: 'Applicants',     icon: <Users className="h-4 w-4" />,        count: applicantsHook.rows.length },
    { value: 'scoring',    label: 'Scoring',        icon: <ClipboardCheck className="h-4 w-4" />, count: responsesHook.rows.length + interviewsHook.rows.length },
    { value: 'top',        label: 'Top Performers', icon: <Award className="h-4 w-4" />,        count: topPerfHook.rows.length },
    { value: 'capacity',   label: 'Capacity',       icon: <GraduationCap className="h-4 w-4" />, count: sessionsHook.rows.length },
    { value: 'matching',   label: 'Matching',       icon: <Handshake className="h-4 w-4" /> },
    { value: 'activity',   label: 'Activity',       icon: <ActivityIcon className="h-4 w-4" />, count: activityHook.rows.length },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="ElevateBridge"
        subtitle="Selection · Upskilling · Matching"
        badges={[
          { label: `${applicantsHook.rows.length} applicants`, tone: 'neutral' as Tone },
          { label: `${admittedCount} admitted`, tone: 'teal' as Tone },
          ...(netCount !== admittedCount
            ? [{ label: `${netCount} active`, tone: 'orange' as Tone }]
            : []),
        ]}
        actions={
          <Button variant="ghost" onClick={refreshAll} title="Reload all tabs">
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      {!canEditStaff && (
        <Card accent="orange">
          <p className="text-sm text-navy-500 dark:text-white">
            You are viewing the ElevateBridge Programme in <strong>read-only</strong> mode.
            Score edits, decisions, and session updates require admin access.
          </p>
        </Card>
      )}

      {firstError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">
            Failed to load: {firstError.message}
          </p>
        </Card>
      )}

      <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as EbTab)} />

      {loading && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading ElevateBridge data…
          </div>
        </Card>
      )}

      {tab === 'overview' && (
        <OverviewTab
          applicants={applicantsHook.rows}
          decisions={decisionsHook.rows}
          mentors={mentorsHook.rows}
          sessions={sessionsHook.rows}
          topPerformers={topPerfHook.rows}
        />
      )}

      {tab === 'applicants' && (
        <ApplicantsTab
          enriched={enriched}
          responses={responsesHook.rows}
          interviews={interviewsHook.rows}
          rubrics={rubricsHook.rows}
          canEdit={canEditAdmin}
          userEmail={userEmail}
          sheetId={sheetId}
          updateApplicant={applicantsHook.updateRow}
          updateDecision={decisionsHook.updateRow}
          createDecision={decisionsHook.createRow}
        />
      )}

      {tab === 'scoring' && (
        <ScoringTab
          applicants={applicantsHook.rows}
          rubrics={rubricsHook.rows}
          responseScores={responsesHook.rows}
          interviewScores={interviewsHook.rows}
          canEdit={canEditAdmin}
          userEmail={userEmail}
          sheetId={sheetId}
          updateResponse={responsesHook.updateRow}
          createResponse={responsesHook.createRow}
          updateInterview={interviewsHook.updateRow}
          createInterview={interviewsHook.createRow}
        />
      )}

      {tab === 'top' && (
        <TopPerformersTab rows={topPerfHook.rows} />
      )}

      {tab === 'capacity' && (
        <CapacityTab
          mentors={mentorsHook.rows}
          sessions={sessionsHook.rows}
          attendance={attendanceHook.rows}
          canEdit={canEditAdmin}
          userEmail={userEmail}
          sheetId={sheetId}
          updateMentor={mentorsHook.updateRow}
          updateSession={sessionsHook.updateRow}
          createSession={sessionsHook.createRow}
          updateAttendance={attendanceHook.updateRow}
          createAttendance={attendanceHook.createRow}
        />
      )}

      {tab === 'matching' && (
        <MatchingTab
          sheetId={sheetId}
          userEmail={userEmail}
          canEdit={canEditStaff}
        />
      )}

      {tab === 'activity' && (
        <ActivityTab
          rows={activityHook.rows}
          freelancerRows={flActivityHook.rows}
        />
      )}
    </div>
  );
}
