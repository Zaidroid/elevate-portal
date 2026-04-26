// /advisors — native module replacing the standalone Advisors app.
//
// Tabs: Pipeline (kanban), Roster (table), Follow-ups, Activity, Dashboard.
// Bound to the E3 - Non-Technical Advisors workbook via four useSheetDoc
// instances (advisors, followups, activity, comments). Joining is done
// client-side in `enrichAdvisors`.

import { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  Award,
  BarChart3,
  Calendar,
  Download,
  ExternalLink,
  Kanban as KanbanIcon,
  RefreshCw,
  Search,
  Table as TableIcon,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Tabs,
  downloadCsv,
  timestampedFilename,
  useToast,
} from '../../lib/ui';
import type { Column, TabItem, Tone } from '../../lib/ui';
import { CATEGORY_META } from '../../lib/advisor-scoring';
import type { AdvisorPipelineId } from '../../lib/advisor-scoring';
import type {
  ActivityRow,
  Advisor,
  AdvisorComment,
  FollowUp,
} from '../../types/advisor';
import {
  appendActivity,
  diffForActivity,
  enrichAdvisors,
  matchesQuery,
  normalizeCountry,
  scoreFields,
  type EnrichedAdvisor,
} from './utils';
import { AdvisorPipelineKanban } from './AdvisorPipelineKanban';
import { AdvisorFollowUpsTab } from './AdvisorFollowUpsTab';
import { AdvisorActivityTab } from './AdvisorActivityTab';
import { AdvisorDetailDrawer } from './AdvisorDetailDrawer';
import { AdvisorDashboard } from './AdvisorDashboard';

const PIPELINE_LABEL_BY_ID: Record<AdvisorPipelineId, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  allocated: 'Allocated',
  intro_sched: 'Intro Scheduled',
  intro_done: 'Intro Done',
  assessment: 'Assessment',
  approved: 'Approved',
  matched: 'Matched',
  on_hold: 'On Hold',
  rejected: 'Rejected',
};

export function AdvisorsPage() {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const canEdit = isAdmin(userEmail) || /@gazaskygeeks\.com$/i.test(userEmail);
  const toast = useToast();

  const sheetId = getSheetId('advisors');
  const tabAdvisors = getTab('advisors', 'advisors');
  const tabFollowups = getTab('advisors', 'followups');
  const tabActivity = getTab('advisors', 'activity');
  const tabComments = getTab('advisors', 'comments');

  const advHook = useSheetDoc<Advisor>(sheetId || null, tabAdvisors, 'advisor_id', { userEmail });
  const fuHook = useSheetDoc<FollowUp>(sheetId || null, tabFollowups, 'followup_id', { userEmail });
  const actHook = useSheetDoc<ActivityRow>(sheetId || null, tabActivity, 'activity_id', { userEmail });
  const cmtHook = useSheetDoc<AdvisorComment>(sheetId || null, tabComments, 'comment_id', { userEmail });

  const [tab, setTab] = useState<string>('pipeline');
  const [query, setQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterPipeline, setFilterPipeline] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const enriched = useMemo(
    () => enrichAdvisors(advHook.rows, fuHook.rows, cmtHook.rows, actHook.rows),
    [advHook.rows, fuHook.rows, cmtHook.rows, actHook.rows]
  );

  const filtered = useMemo(() => {
    return enriched.filter(a => {
      if (filterCountry && normalizeCountry(a.country) !== filterCountry) return false;
      if (filterCategory && a.stage2.primary !== filterCategory) return false;
      if (filterPipeline && a.pipeline_status !== filterPipeline) return false;
      return matchesQuery(a, query);
    });
  }, [enriched, query, filterCountry, filterCategory, filterPipeline]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const a of enriched) {
      const c = normalizeCountry(a.country);
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [enriched]);

  const selected = useMemo(
    () => enriched.find(a => a.advisor_id === selectedId) || null,
    [enriched, selectedId]
  );

  const handleMovePipeline = async (advisorId: string, next: AdvisorPipelineId) => {
    const adv = enriched.find(a => a.advisor_id === advisorId);
    if (!adv) return;
    const nextLabel = PIPELINE_LABEL_BY_ID[next];
    if (adv.pipeline_status === nextLabel) return;
    try {
      await advHook.updateRow(advisorId, { pipeline_status: nextLabel } as Partial<Advisor>);
      if (sheetId) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: advisorId,
          action: 'status_change',
          field: 'pipeline_status',
          old_value: adv.pipeline_status,
          new_value: nextLabel,
        });
        await actHook.refresh();
      }
      toast.success(`${adv.full_name || advisorId} → ${nextLabel}`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const handleTrackerSave = async (updates: Partial<EnrichedAdvisor>) => {
    if (!selected || !sheetId) return;
    const allowed: Partial<Advisor> = {
      pipeline_status: updates.pipeline_status,
      assignee_email: updates.assignee_email,
      received_ack: updates.received_ack,
      intro_scheduled_date: updates.intro_scheduled_date,
      intro_done_date: updates.intro_done_date,
      assessment_date: updates.assessment_date,
      decision_date: updates.decision_date,
      tracker_notes: updates.tracker_notes,
      assignment_company_id: updates.assignment_company_id,
      assignment_intervention_type: updates.assignment_intervention_type,
      assignment_status: updates.assignment_status,
      assignment_notes: updates.assignment_notes,
    };
    const scored = scoreFields({ ...selected, ...allowed });
    const merged: Partial<Advisor> = { ...allowed, ...scored };
    const diff = diffForActivity(selected, merged);
    try {
      await advHook.updateRow(selected.advisor_id, merged);
      for (const d of diff) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: selected.advisor_id,
          action: 'tracker_edit',
          field: d.field,
          old_value: d.old,
          new_value: d.next,
        });
      }
      await actHook.refresh();
      toast.success('Tracker saved');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  const handleCreateFollowUp = async (fu: Partial<FollowUp>) => {
    if (!fu.advisor_id) return;
    const id = `FU-${Date.now()}`;
    try {
      await fuHook.createRow({
        ...fu,
        followup_id: id,
        created_by: userEmail,
        created_at: new Date().toISOString(),
        completed_at: '',
        status: fu.status || 'Open',
      } as Partial<FollowUp>);
      if (sheetId) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: fu.advisor_id,
          action: 'followup',
          field: 'create',
          new_value: `${fu.type || 'Follow-up'} due ${fu.due_date || ''}`,
        });
        await actHook.refresh();
      }
      toast.success('Follow-up created');
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  const handleMarkFollowUpDone = async (followupId: string) => {
    const fu = fuHook.rows.find(f => f.followup_id === followupId);
    if (!fu) return;
    try {
      await fuHook.updateRow(followupId, {
        status: 'Done',
        completed_at: new Date().toISOString(),
      } as Partial<FollowUp>);
      if (sheetId) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: fu.advisor_id,
          action: 'followup',
          field: 'status',
          old_value: fu.status,
          new_value: 'Done',
        });
        await actHook.refresh();
      }
      toast.success('Follow-up marked done');
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  const handleSnoozeFollowUp = async (followupId: string) => {
    const fu = fuHook.rows.find(f => f.followup_id === followupId);
    if (!fu) return;
    try {
      await fuHook.updateRow(followupId, { status: 'Snoozed' } as Partial<FollowUp>);
      toast.success('Snoozed');
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  const handleAddComment = async (body: string) => {
    if (!selected) return;
    const id = `CMT-${Date.now()}`;
    try {
      await cmtHook.createRow({
        comment_id: id,
        advisor_id: selected.advisor_id,
        author_email: userEmail,
        body,
        created_at: new Date().toISOString(),
      } as Partial<AdvisorComment>);
      if (sheetId) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: selected.advisor_id,
          action: 'comment',
          field: 'body',
          new_value: body.slice(0, 80),
        });
        await actHook.refresh();
      }
      toast.success('Comment posted');
    } catch (err) {
      toast.error(`Post failed: ${(err as Error).message}`);
    }
  };

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="Advisors" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_ADVISORS</code> in your environment.
        </p>
      </Card>
    );
  }

  const error = advHook.error || fuHook.error || actHook.error || cmtHook.error;
  const loading = advHook.loading;

  const tabs: TabItem[] = [
    { value: 'pipeline', label: 'Pipeline', icon: <KanbanIcon className="h-4 w-4" />, count: enriched.length },
    { value: 'roster', label: 'Roster', icon: <TableIcon className="h-4 w-4" />, count: filtered.length },
    {
      value: 'followups',
      label: 'Follow-ups',
      icon: <Calendar className="h-4 w-4" />,
      count: fuHook.rows.filter(f => f.status === 'Open').length,
    },
    {
      value: 'activity',
      label: 'Activity',
      icon: <ActivityIcon className="h-4 w-4" />,
      count: actHook.rows.length,
    },
    { value: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Advisors</h1>
            <Badge tone="teal">{enriched.length}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Triage non-technical advisors. Stage 1 + Stage 2 scoring, kanban, follow-ups, audit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => { advHook.refresh(); fuHook.refresh(); actHook.refresh(); cmtHook.refresh(); }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="ghost"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(timestampedFilename('advisors'), filtered.map(toCsvRow))}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, email, country, position, employer, company id…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            />
          </div>
          <select
            value={filterCountry}
            onChange={e => setFilterCountry(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            <option value="">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            <option value="">All categories</option>
            {Object.keys(CATEGORY_META).map(c => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-500">Pipeline:</span>
          <button
            onClick={() => setFilterPipeline('')}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filterPipeline === '' ? 'bg-navy-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-navy-700 dark:text-slate-200'}`}
          >
            All
          </button>
          {Object.values(PIPELINE_LABEL_BY_ID).map(label => (
            <button
              key={label}
              onClick={() => setFilterPipeline(label)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filterPipeline === label ? 'bg-navy-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {loading && enriched.length === 0 && (
        <Card>
          <EmptyState
            icon={<RefreshCw className="h-6 w-6 animate-spin" />}
            title="Loading advisors…"
            description="Fetching from Google Sheets."
          />
        </Card>
      )}

      {tab === 'pipeline' && (
        <AdvisorPipelineKanban
          advisors={filtered}
          readOnly={!canEdit}
          onMove={handleMovePipeline}
          onCardClick={a => setSelectedId(a.advisor_id)}
        />
      )}

      {tab === 'roster' && (
        <RosterTable advisors={filtered} onOpen={a => setSelectedId(a.advisor_id)} />
      )}

      {tab === 'followups' && (
        <AdvisorFollowUpsTab
          followups={fuHook.rows}
          advisors={enriched}
          userEmail={userEmail}
          canEdit={canEdit}
          onCreate={handleCreateFollowUp}
          onMarkDone={handleMarkFollowUpDone}
          onSnooze={handleSnoozeFollowUp}
          onOpenAdvisor={a => setSelectedId(a.advisor_id)}
        />
      )}

      {tab === 'activity' && (
        <AdvisorActivityTab
          activity={actHook.rows}
          advisors={enriched}
          onOpenAdvisor={a => setSelectedId(a.advisor_id)}
        />
      )}

      {tab === 'dashboard' && <AdvisorDashboard advisors={enriched} />}

      <AdvisorDetailDrawer
        advisor={selected}
        open={!!selected}
        canEdit={canEdit}
        userEmail={userEmail}
        onClose={() => setSelectedId(null)}
        onTrackerSave={handleTrackerSave}
        onCreateFollowUp={handleCreateFollowUp}
        onMarkFollowUpDone={handleMarkFollowUpDone}
        onAddComment={handleAddComment}
      />
    </div>
  );
}

function RosterTable({
  advisors,
  onOpen,
}: {
  advisors: EnrichedAdvisor[];
  onOpen: (a: EnrichedAdvisor) => void;
}) {
  const columns: Column<EnrichedAdvisor>[] = [
    {
      key: 'full_name',
      header: 'Name',
      render: a => <span className="font-semibold">{a.full_name || '(unnamed)'}</span>,
    },
    { key: 'country', header: 'Country' },
    {
      key: 'position',
      header: 'Position',
      render: a => <span className="text-xs text-slate-500">{[a.position, a.employer].filter(Boolean).join(' @ ')}</span>,
    },
    {
      key: 'stage1_score',
      header: 'S1',
      render: a => <Badge tone={a.stage1.pass ? 'green' : 'red'}>{a.stage1.total}</Badge>,
    },
    {
      key: 'stage2_category',
      header: 'Category',
      render: a => {
        const meta = CATEGORY_META[a.stage2.primary] || CATEGORY_META.Unqualified;
        return <Badge tone={catTone(meta.tone)}>{meta.label}</Badge>;
      },
    },
    {
      key: 'pipeline_status',
      header: 'Pipeline',
      render: a => <Badge tone={pipelineTone(a.pipeline_status)}>{a.pipeline_status || 'New'}</Badge>,
    },
    {
      key: 'open_followups',
      header: 'Follow-ups',
      render: a =>
        a.open_followups > 0 ? (
          <Badge tone={a.overdue_followups > 0 ? 'red' : 'orange'}>
            {a.open_followups} open{a.overdue_followups > 0 ? ` · ${a.overdue_followups} overdue` : ''}
          </Badge>
        ) : <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: 'linkedin',
      header: 'LinkedIn',
      width: '60px',
      render: a => a.linkedin ? (
        <a
          href={a.linkedin.startsWith('http') ? a.linkedin : `https://${a.linkedin}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-brand-teal hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null,
    },
  ];

  if (advisors.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No advisors match the current filters"
          description="Loosen the filter or clear the search box."
        />
      </Card>
    );
  }

  return <DataTable columns={columns} rows={advisors} onRowClick={onOpen} />;
}

const TONE_MAP: Record<string, Tone> = {
  slate: 'neutral',
  navy: 'neutral',
  red: 'red',
  teal: 'teal',
  orange: 'orange',
  amber: 'amber',
  green: 'green',
};

function catTone(tone: string): Tone {
  return TONE_MAP[tone] || 'neutral';
}

function pipelineTone(s: string | undefined): Tone {
  switch ((s || 'New')) {
    case 'Approved':
    case 'Matched': return 'green';
    case 'Acknowledged':
    case 'Allocated':
    case 'Intro Scheduled':
    case 'Intro Done':
    case 'Assessment': return 'amber';
    case 'Rejected': return 'red';
    case 'On Hold': return 'neutral';
    default: return 'neutral';
  }
}

function toCsvRow(a: EnrichedAdvisor): Record<string, string> {
  return {
    advisor_id: a.advisor_id,
    full_name: a.full_name,
    email: a.email,
    country: a.country,
    position: a.position,
    employer: a.employer,
    pipeline_status: a.pipeline_status,
    stage1_score: String(a.stage1.total),
    stage1_pass: a.stage1.pass ? 'TRUE' : 'FALSE',
    stage2_category: a.stage2.primary,
    stage2_score: a.stage2.primary === 'Unqualified' ? '0' : String(
      a.stage2[a.stage2.primary.toLowerCase() as 'ceo' | 'cto' | 'coo' | 'marketing' | 'ai']
    ),
    assignee_email: a.assignee_email,
    assignment_company_id: a.assignment_company_id,
    assignment_intervention_type: a.assignment_intervention_type,
    assignment_status: a.assignment_status,
    open_followups: String(a.open_followups),
    overdue_followups: String(a.overdue_followups),
  };
}
