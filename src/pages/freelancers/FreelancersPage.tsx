// /elevatebridge — native ElevateBridge module. Same philosophy as the
// Advisors module but built around a matching engine instead of an
// intake funnel: 203 pre-vetted freelancers waiting to be paired with
// Cohort 3 companies as their sales-funnel operators.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  Archive,
  Award,
  BarChart3,
  Calendar,
  CloudDownload,
  Download,
  Kanban as KanbanIcon,
  RefreshCw,
  Search,
  Sparkles,
  Table as TableIcon,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { getUserByEmail, isAdmin } from '../../config/team';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  PageHeader,
  Tabs,
  downloadCsv,
  timestampedFilename,
  useToast,
} from '../../lib/ui';
import type { Column, TabItem, Tone } from '../../lib/ui';
import type {
  Freelancer,
  FreelancerActivity,
  FreelancerComment,
  FreelancerFollowUp,
} from '../../types/freelancer';
import {
  appendFreelancerActivity,
  diffForActivity,
  enrichFreelancers,
  matchesFreelancerQuery,
  type CompanyLite,
  type EnrichedFreelancer,
  type FreelancerPipelineId,
  FL_PIPELINE_LABEL_BY_ID,
} from './utils';
import { FreelancerPipelineKanban } from './FreelancerPipelineKanban';
import { FreelancerFollowUpsTab } from './FreelancerFollowUpsTab';
import { FreelancerActivityTab } from './FreelancerActivityTab';
import { FreelancerDetailDrawer } from './FreelancerDetailDrawer';
import { FreelancerDashboard } from './FreelancerDashboard';
import { importNewFreelancerFormResponses } from './importFromFormResponses';
import { deduplicateFreelancers } from './deduplicateFreelancers';
import type { CompanyWithEbNeed } from './smartMatch';

export function FreelancersPage() {
  const { user } = useAuth();
  const userEmail = user?.email || '';
  const canEdit = isAdmin(userEmail) || /@gazaskygeeks\.com$/i.test(userEmail);
  const toast = useToast();

  const sheetId = getSheetId('freelancers');
  const tabFreelancers = getTab('freelancers', 'freelancers');
  const tabFollowups = 'FollowUps';
  const tabActivity = 'ActivityLog';
  const tabComments = 'Comments';
  const tabIncome = getTab('freelancers', 'income');

  const flHook = useSheetDoc<Freelancer>(sheetId || null, tabFreelancers, 'freelancer_id', { userEmail });
  const fuHook = useSheetDoc<FreelancerFollowUp>(sheetId || null, tabFollowups, 'followup_id', { userEmail });
  const actHook = useSheetDoc<FreelancerActivity>(sheetId || null, tabActivity, 'activity_id', { userEmail });
  const cmtHook = useSheetDoc<FreelancerComment>(sheetId || null, tabComments, 'comment_id', { userEmail });
  const { rows: incomeRows } = useSheetDoc<Record<string, string>>(sheetId || null, tabIncome, 'record_id');

  // Companies (for smart match + drawer dropdown).
  const companiesId = getSheetId('companies');
  const { rows: companyRows } = useSheetDoc<Record<string, string>>(
    companiesId || null,
    getTab('companies', 'companies'),
    'company_id'
  );
  const { rows: assignmentRows } = useSheetDoc<Record<string, string>>(
    companiesId || null,
    getTab('companies', 'assignments'),
    'assignment_id'
  );
  const companies = useMemo<CompanyLite[]>(
    () => companyRows.map(c => ({
      company_id: c.company_id,
      company_name: c.company_name,
      sector: c.sector,
      governorate: c.governorate,
      status: c.status,
    })),
    [companyRows]
  );
  // Companies that currently have an MA-ElevateBridge assignment in flight.
  const ebCandidateCompanies = useMemo<CompanyWithEbNeed[]>(() => {
    const needyIds = new Set<string>();
    for (const a of assignmentRows) {
      if ((a.intervention_type || '') !== 'MA-ElevateBridge') continue;
      const st = (a.status || '').toLowerCase();
      if (st === 'completed' || st === 'cancelled') continue;
      if (a.company_id) needyIds.add(a.company_id);
    }
    return companies
      .filter(c => needyIds.has(c.company_id))
      .map(c => ({ ...c, has_eb_assignment: true, employee_count: companyRows.find(r => r.company_id === c.company_id)?.employee_count }));
  }, [companies, assignmentRows, companyRows]);

  const [tab, setTab] = useState<string>('dashboard');
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterTrack, setFilterTrack] = useState<string>('');
  const [filterRole, setFilterRole] = useState<string>('');
  const [savedView, setSavedView] = useState<'' | 'mine' | 'stuck' | 'producing' | 'available_unassigned'>('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const enriched = useMemo(
    () => enrichFreelancers(flHook.rows, fuHook.rows, cmtHook.rows, actHook.rows, companies),
    [flHook.rows, fuHook.rows, cmtHook.rows, actHook.rows, companies]
  );

  const active = useMemo(
    () => showArchived ? enriched : enriched.filter(f => f.status !== 'Archived'),
    [enriched, showArchived]
  );
  const archivedCount = useMemo(() => enriched.filter(f => f.status === 'Archived').length, [enriched]);

  const savedViewPredicate = useCallback((f: EnrichedFreelancer): boolean => {
    switch (savedView) {
      case 'mine': return (f.assignee_email || '').toLowerCase() === userEmail.toLowerCase();
      case 'stuck': return f.is_stuck;
      case 'producing': return f.status === 'Producing';
      case 'available_unassigned': return f.status === 'Available' && !f.assignee_email;
      default: return true;
    }
  }, [savedView, userEmail]);

  const kanbanItems = useMemo(() => {
    return active.filter(f => {
      if (savedView && !savedViewPredicate(f)) return false;
      if (filterStatus && (f.status || 'Available') !== filterStatus) return false;
      if (filterTrack && (f.track || '') !== filterTrack) return false;
      if (filterRole && (f.role_profile || '') !== filterRole) return false;
      return matchesFreelancerQuery(f, query);
    });
  }, [active, query, filterStatus, filterTrack, filterRole, savedView, savedViewPredicate]);

  const filtered = useMemo(() => {
    if (!filterStatus) return kanbanItems;
    return kanbanItems.filter(f => (f.status || 'Available') === filterStatus);
  }, [kanbanItems, filterStatus]);

  const selected = useMemo(
    () => enriched.find(f => f.freelancer_id === selectedId) || null,
    [enriched, selectedId]
  );

  const handleMovePipeline = async (id: string, next: FreelancerPipelineId) => {
    const fl = enriched.find(f => f.freelancer_id === id);
    if (!fl) return;
    const nextLabel = FL_PIPELINE_LABEL_BY_ID[next];
    if (fl.status === nextLabel) return;
    try {
      await flHook.updateRow(id, { status: nextLabel } as Partial<Freelancer>);
      if (sheetId) {
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: id,
          action: 'status_change',
          field: 'status',
          old_value: fl.status,
          new_value: nextLabel,
        });
        await actHook.refresh();
      }
      toast.success(`${fl.full_name || id} → ${nextLabel}`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const handleTrackerSave = async (updates: Partial<EnrichedFreelancer>) => {
    if (!selected || !sheetId) return;
    const allowed: Partial<Freelancer> = {
      status: updates.status,
      assignee_email: updates.assignee_email,
      ack_sent: updates.ack_sent,
      assessment_date: updates.assessment_date,
      decision_date: updates.decision_date,
      tracker_notes: updates.tracker_notes,
      assigned_mentor: updates.assigned_mentor,
      company_id: updates.company_id,
    };
    const diff = diffForActivity(selected, allowed);
    try {
      await flHook.updateRow(selected.freelancer_id, allowed);
      for (const d of diff) {
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: selected.freelancer_id,
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

  const handleCreateFollowUp = async (fu: Partial<FreelancerFollowUp>) => {
    if (!fu.freelancer_id) return;
    const id = `FLU-${Date.now()}`;
    try {
      await fuHook.createRow({
        ...fu,
        followup_id: id,
        created_by: userEmail,
        created_at: new Date().toISOString(),
        completed_at: '',
        status: fu.status || 'Open',
      } as Partial<FreelancerFollowUp>);
      if (sheetId) {
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: fu.freelancer_id,
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
      } as Partial<FreelancerFollowUp>);
      if (sheetId) {
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: fu.freelancer_id,
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
    try {
      await fuHook.updateRow(followupId, { status: 'Snoozed' } as Partial<FreelancerFollowUp>);
      toast.success('Snoozed');
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  const handleAddComment = async (body: string) => {
    if (!selected) return;
    const id = `FCMT-${Date.now()}`;
    try {
      await cmtHook.createRow({
        comment_id: id,
        freelancer_id: selected.freelancer_id,
        author_email: userEmail,
        body,
        created_at: new Date().toISOString(),
      } as Partial<FreelancerComment>);
      if (sheetId) {
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: selected.freelancer_id,
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

  // Bulk actions on Roster
  const handleBulkMove = async (target: FreelancerPipelineId | 'Archived') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const targetLabel = target === 'Archived' ? 'Archived' : FL_PIPELINE_LABEL_BY_ID[target];
    if (!window.confirm(`Move ${ids.length} freelancer${ids.length === 1 ? '' : 's'} to ${targetLabel}?`)) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        const fl = enriched.find(f => f.freelancer_id === id);
        if (!fl || fl.status === targetLabel) continue;
        try {
          await flHook.updateRow(id, { status: targetLabel } as Partial<Freelancer>);
          if (sheetId) {
            await appendFreelancerActivity(sheetId, tabActivity, {
              user_email: userEmail,
              freelancer_id: id,
              action: 'status_change',
              field: 'status',
              old_value: fl.status,
              new_value: targetLabel,
              details: 'bulk_action',
            });
          }
          ok += 1;
        } catch (err) {
          console.warn('[freelancers] bulk move skipped', id, err);
        }
      }
      toast.success(`Bulk moved ${ok} of ${ids.length} to ${targetLabel}`);
      await actHook.refresh();
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const handleBulkAssign = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const assignee = window.prompt('Assignee email:');
    if (!assignee) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try {
          await flHook.updateRow(id, { assignee_email: assignee } as Partial<Freelancer>);
          ok += 1;
        } catch (err) {
          console.warn('[freelancers] bulk assign skipped', id, err);
        }
      }
      toast.success(`Assigned ${ok} of ${ids.length} to ${assignee}`);
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  // Auto-poll form responses every 5 minutes (silent unless new entries land).
  const importStateRef = useRef({ sheetId: sheetId || '', headers: flHook.headers, existing: flHook.rows, userEmail });
  importStateRef.current = { sheetId: sheetId || '', headers: flHook.headers, existing: flHook.rows, userEmail };

  const runFormImport = useCallback(async (silent: boolean) => {
    const s = importStateRef.current;
    if (!s.sheetId) return;
    const formSheetId = getSheetId('freelancersFormResponses');
    const formTab = getTab('freelancersFormResponses', 'responses');
    if (!formSheetId) {
      if (!silent) toast.error('Set VITE_SHEET_FREELANCERS_FORM_RESPONSES to enable form import.');
      return;
    }
    if (!silent) setImporting(true);
    try {
      const result = await importNewFreelancerFormResponses({
        formSheetId,
        formTabName: formTab,
        destSheetId: s.sheetId,
        destTabName: tabFreelancers,
        destHeaders: s.headers,
        existingFreelancers: s.existing,
        userEmail: s.userEmail,
      });
      if (result.errors.length > 0) {
        if (!silent) toast.error(`Import error: ${result.errors[0]}`);
        else console.warn('[freelancers] auto-import error:', result.errors[0]);
        return;
      }
      if (result.imported > 0) {
        toast.success(`${result.imported} new freelancer${result.imported === 1 ? '' : 's'} imported (joined the Available pool)`);
        await flHook.refresh();
        await appendFreelancerActivity(s.sheetId, tabActivity, {
          user_email: s.userEmail,
          freelancer_id: '',
          action: 'form_import',
          field: 'count',
          new_value: String(result.imported),
          details: `auto-poll · ${result.fetched} fetched, ${result.alreadyKnown} dupes`,
        });
        await actHook.refresh();
      } else if (!silent) {
        toast.success(`Form has ${result.fetched} entries · all ${result.alreadyKnown} already in pool`);
      }
    } catch (err) {
      if (!silent) toast.error(`Import failed: ${(err as Error).message}`);
      else console.warn('[freelancers] auto-import failed', err);
    } finally {
      if (!silent) setImporting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFreelancers, tabActivity]);

  useEffect(() => {
    if (!sheetId || !canEdit) return;
    if (!getSheetId('freelancersFormResponses')) return;
    const POLL_MS = 5 * 60 * 1000;
    const first = setTimeout(() => { void runFormImport(true); }, 3000);
    const interval = setInterval(() => { void runFormImport(true); }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [sheetId, canEdit, runFormImport]);

  const handleDeduplicate = async () => {
    if (!sheetId) return;
    if (!window.confirm(`Scan ${flHook.rows.length} rows for duplicate emails and remove all but the earliest of each? Permanent.`)) return;
    setDedupRunning(true);
    try {
      const result = await deduplicateFreelancers(sheetId, tabFreelancers, flHook.rows);
      if (result.rowsRemoved > 0) {
        toast.success(`Removed ${result.rowsRemoved} duplicate row${result.rowsRemoved === 1 ? '' : 's'} across ${result.duplicateGroups} email${result.duplicateGroups === 1 ? '' : 's'}`);
        await flHook.refresh();
        await appendFreelancerActivity(sheetId, tabActivity, {
          user_email: userEmail,
          freelancer_id: '',
          action: 'form_import',
          field: 'dedupe',
          new_value: String(result.rowsRemoved),
          details: `${result.duplicateGroups} duplicate-email groups`,
        });
        await actHook.refresh();
      } else {
        toast.success(`No duplicates found in ${result.scanned} rows`);
      }
      if (result.errors.length > 0) toast.error(`Some deletes failed: ${result.errors[0]}`);
    } catch (err) {
      toast.error(`Dedupe failed: ${(err as Error).message}`);
    } finally {
      setDedupRunning(false);
    }
  };

  if (!sheetId) {
    return (
      <Card>
        <CardHeader title="ElevateBridge" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_FREELANCERS</code> in your environment.
        </p>
      </Card>
    );
  }

  const error = flHook.error || fuHook.error || actHook.error || cmtHook.error;
  const loading = flHook.loading;

  const tabs: TabItem[] = [
    { value: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
    { value: 'pipeline', label: 'Pipeline', icon: <KanbanIcon className="h-4 w-4" />, count: active.length },
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
  ];

  const availableUnassigned = active.filter(f => f.status === 'Available' && !f.assignee_email).length;
  const stuckCount = active.filter(f => f.is_stuck).length;
  const ebNeedCount = ebCandidateCompanies.length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="ElevateBridge"
        badges={[
          { label: `${active.length} active`, tone: 'teal' },
          ...(archivedCount > 0 ? [{ label: `${archivedCount} archived`, tone: 'neutral' as Tone }] : []),
        ]}
        actions={
          <>
            {canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700 dark:text-slate-400" title="Form responses are pulled every 5 minutes">
                <CloudDownload className={`h-3 w-3 ${importing ? 'animate-pulse text-brand-teal' : ''}`} />
                Auto-sync
              </span>
            )}
            {canEdit && (
              <Button variant="ghost" onClick={handleDeduplicate} disabled={dedupRunning} title="Dedupe">
                <Trash2 className={`h-4 w-4 ${dedupRunning ? 'animate-pulse' : ''}`} />
              </Button>
            )}
            <Button variant="ghost" onClick={() => setShowArchived(v => !v)} title={showArchived ? 'Hide archived' : 'Show archived'}>
              <Archive className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={() => { flHook.refresh(); fuHook.refresh(); actHook.refresh(); cmtHook.refresh(); }} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              disabled={filtered.length === 0}
              onClick={() => downloadCsv(timestampedFilename('freelancers'), filtered.map(toCsvRow))}
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {ebNeedCount > 0 && availableUnassigned > 0 && (
        <Card accent="teal">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-brand-teal/15 p-2 text-brand-teal">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold text-navy-500 dark:text-white">
                  {ebNeedCount} compan{ebNeedCount === 1 ? 'y has' : 'ies have'} an open MA-ElevateBridge engagement,
                  and you have {availableUnassigned} unassigned freelancer{availableUnassigned === 1 ? '' : 's'} ready to match
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Open the Roster, filter to Available, and use the Smart match panel inside each freelancer's drawer.
                </div>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => { setTab('roster'); setSavedView('available_unassigned'); setQuery(''); setFilterStatus(''); setFilterTrack(''); setFilterRole(''); }}
            >
              <ArrowToRoster /> Match now
            </Button>
          </div>
        </Card>
      )}

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
              placeholder="Search by name, email, location, mentor, company id…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            />
          </div>
          <select
            value={filterTrack}
            onChange={e => setFilterTrack(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            <option value="">All tracks</option>
            <option value="Upwork">Upwork</option>
            <option value="Social Media">Social Media</option>
            <option value="Other">Other</option>
          </select>
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          >
            <option value="">All roles</option>
            <option value="Individual">Individual</option>
            <option value="Job Hunter">Job Hunter</option>
            <option value="Agency">Agency</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-500">Status:</span>
          <button onClick={() => setFilterStatus('')} className={`rounded-full px-3 py-1 text-xs font-semibold ${filterStatus === '' ? 'bg-navy-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}>All</button>
          {Object.values(FL_PIPELINE_LABEL_BY_ID).map(label => (
            <button key={label} onClick={() => setFilterStatus(label)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filterStatus === label ? 'bg-navy-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}>{label}</button>
          ))}
          {showArchived && (
            <button onClick={() => setFilterStatus('Archived')} className={`rounded-full px-3 py-1 text-xs font-semibold ${filterStatus === 'Archived' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}>Archived</button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Quick views:</span>
        {([
          { id: '', label: 'All' },
          { id: 'mine', label: 'My active' },
          { id: 'available_unassigned', label: `Available + unassigned (${availableUnassigned})` },
          { id: 'producing', label: `Producing (${active.filter(f => f.status === 'Producing').length})` },
          { id: 'stuck', label: `Stuck (${stuckCount})` },
        ] as const).map(v => (
          <button
            key={v.id}
            onClick={() => setSavedView(v.id as typeof savedView)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              savedView === v.id ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {loading && enriched.length === 0 && (
        <Card>
          <EmptyState
            icon={<RefreshCw className="h-6 w-6 animate-spin" />}
            title="Loading freelancers…"
            description="Fetching from Google Sheets."
          />
        </Card>
      )}

      {tab === 'pipeline' && (
        <FreelancerPipelineKanban
          freelancers={kanbanItems}
          readOnly={!canEdit}
          onMove={handleMovePipeline}
          onCardClick={fl => setSelectedId(fl.freelancer_id)}
        />
      )}

      {tab === 'roster' && (
        <RosterTable
          freelancers={filtered}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          canEdit={canEdit}
          bulkRunning={bulkRunning}
          onBulkMove={handleBulkMove}
          onBulkAssign={handleBulkAssign}
          onOpen={fl => setSelectedId(fl.freelancer_id)}
        />
      )}

      {tab === 'followups' && (
        <FreelancerFollowUpsTab
          followups={fuHook.rows}
          freelancers={enriched}
          userEmail={userEmail}
          canEdit={canEdit}
          onCreate={handleCreateFollowUp}
          onMarkDone={handleMarkFollowUpDone}
          onSnooze={handleSnoozeFollowUp}
          onOpenFreelancer={fl => setSelectedId(fl.freelancer_id)}
        />
      )}

      {tab === 'activity' && (
        <FreelancerActivityTab
          activity={actHook.rows}
          freelancers={enriched}
          onOpenFreelancer={fl => setSelectedId(fl.freelancer_id)}
        />
      )}

      {tab === 'dashboard' && (
        <FreelancerDashboard
          freelancers={enriched}
          activity={actHook.rows}
          monthlyIncome={incomeRows.map(r => ({ month: r.month, gross_income_usd: r.gross_income_usd }))}
        />
      )}

      <FreelancerDetailDrawer
        freelancer={selected}
        open={!!selected}
        canEdit={canEdit}
        userEmail={userEmail}
        userName={user?.name}
        userTitle={getUserByEmail(userEmail)?.title}
        companies={companies}
        ebCandidateCompanies={ebCandidateCompanies}
        onClose={() => setSelectedId(null)}
        onTrackerSave={handleTrackerSave}
        onCreateFollowUp={handleCreateFollowUp}
        onMarkFollowUpDone={handleMarkFollowUpDone}
        onAddComment={handleAddComment}
      />
    </div>
  );
}

// Trivial inline icon used to keep the banner button inline-importing-only.
function ArrowToRoster() {
  return <TableIcon className="h-4 w-4" />;
}

function RosterTable({
  freelancers,
  selectedIds,
  setSelectedIds,
  canEdit,
  bulkRunning,
  onBulkMove,
  onBulkAssign,
  onOpen,
}: {
  freelancers: EnrichedFreelancer[];
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  canEdit: boolean;
  bulkRunning: boolean;
  onBulkMove: (target: FreelancerPipelineId | 'Archived') => Promise<void>;
  onBulkAssign: () => Promise<void>;
  onOpen: (fl: EnrichedFreelancer) => void;
}) {
  const allChecked = freelancers.length > 0 && freelancers.every(f => selectedIds.has(f.freelancer_id));
  const someChecked = !allChecked && freelancers.some(f => selectedIds.has(f.freelancer_id));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allChecked) for (const f of freelancers) next.delete(f.freelancer_id);
    else for (const f of freelancers) next.add(f.freelancer_id);
    setSelectedIds(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const columns: Column<EnrichedFreelancer>[] = [
    ...(canEdit ? [{
      key: '_select',
      header: (
        <input
          type="checkbox"
          checked={allChecked}
          ref={el => { if (el) el.indeterminate = someChecked; }}
          onChange={toggleAll}
          aria-label="Select all"
        />
      ),
      width: '36px',
      render: (f: EnrichedFreelancer) => (
        <input
          type="checkbox"
          checked={selectedIds.has(f.freelancer_id)}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleOne(f.freelancer_id)}
          aria-label={`Select ${f.full_name}`}
        />
      ),
    }] satisfies Column<EnrichedFreelancer>[] : []),
    {
      key: 'full_name',
      header: 'Name',
      render: f => (
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{f.full_name || '(unnamed)'}</span>
          {f.is_stuck && <Badge tone="red">stuck {f.days_in_status}d</Badge>}
        </div>
      ),
    },
    { key: 'email', header: 'Email' },
    { key: 'track', header: 'Track', width: '110px' },
    { key: 'role_profile', header: 'Role', width: '110px' },
    {
      key: 'company_id',
      header: 'Match',
      render: f => f.matched_company_name ? <Badge tone="teal">{f.matched_company_name}</Badge> : <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: f => <Badge tone={pipelineTone(f.status)}>{f.status || 'Available'}</Badge>,
    },
    {
      key: 'days_in_status',
      header: 'Days',
      width: '70px',
      render: f => <span className={`font-mono text-xs ${f.is_stuck ? 'text-brand-red font-bold' : 'text-slate-500'}`}>{f.days_in_status >= 0 ? f.days_in_status : '—'}</span>,
    },
    {
      key: 'open_followups',
      header: 'FU',
      render: f => f.open_followups > 0 ? (
        <Badge tone={f.overdue_followups > 0 ? 'red' : 'orange'}>{f.open_followups}</Badge>
      ) : <span className="text-xs text-slate-400">—</span>,
    },
  ];

  if (freelancers.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Award className="h-6 w-6" />} title="No freelancers match the current filters" description="Loosen the filter or clear the search box." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && canEdit && (
        <Card accent="teal">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-navy-500 dark:text-white">{selectedIds.size} selected</span>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('matched')} disabled={bulkRunning}>Set Matched</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('active')} disabled={bulkRunning}>Set Active</Button>
            <Button size="sm" variant="ghost" onClick={onBulkAssign} disabled={bulkRunning}>Set assignee…</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('on_hold')} disabled={bulkRunning}>On Hold</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('Archived')} disabled={bulkRunning}>Archive</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkRunning}>Clear</Button>
          </div>
        </Card>
      )}
      <DataTable columns={columns} rows={freelancers} onRowClick={onOpen} />
    </div>
  );
}

function pipelineTone(s: string | undefined): Tone {
  switch ((s || 'Available')) {
    case 'Producing':
    case 'Active': return 'green';
    case 'Matched':
    case 'Released': return 'amber';
    case 'Dropped': return 'red';
    case 'On Hold':
    case 'Archived': return 'neutral';
    default: return 'neutral';
  }
}

function toCsvRow(f: EnrichedFreelancer): Record<string, string> {
  return {
    freelancer_id: f.freelancer_id,
    full_name: f.full_name,
    email: f.email,
    phone: f.phone,
    location: f.location,
    track: f.track,
    role_profile: f.role_profile,
    status: f.status,
    company_id: f.company_id,
    company_name: f.matched_company_name || '',
    assignee_email: f.assignee_email,
    assigned_mentor: f.assigned_mentor,
    days_in_status: String(f.days_in_status),
    open_followups: String(f.open_followups),
    overdue_followups: String(f.overdue_followups),
  };
}
