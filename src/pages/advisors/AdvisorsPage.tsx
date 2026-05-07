// /advisors — native module replacing the standalone Advisors app.
//
// Tabs: Pipeline (kanban), Roster (table), Follow-ups, Activity, Dashboard.
// Bound to the E3 - Non-Technical Advisors workbook via four useSheetDoc
// instances (advisors, followups, activity, comments). Joining is done
// client-side in `enrichAdvisors`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  AlertCircle,
  Archive,
  Award,
  BarChart3,
  Calendar,
  CloudDownload,
  Download,
  ExternalLink,
  Kanban as KanbanIcon,
  RefreshCw,
  Search,
  Sparkles,
  Table as TableIcon,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { ACCOUNT_MANAGERS, getUserByEmail, isAdmin, isLeadership } from '../../config/team';
import { useModuleData } from '../../data/useModuleData';
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
import { CATEGORY_META } from '../../lib/advisor-scoring';
import type { AdvisorPipelineId } from '../../lib/advisor-scoring';
import { pillarFor as pillarForObj } from '../../config/interventions';
const pillarForCode = (code: string): string | undefined => pillarForObj(code)?.code;
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
  detectDuplicateAdvisors,
  type CompanyLite,
  type EnrichedAdvisor,
} from './utils';
import { AdvisorPipelineKanban } from './AdvisorPipelineKanban';
import { AdvisorFollowUpsTab } from './AdvisorFollowUpsTab';
import { AdvisorActivityTab } from './AdvisorActivityTab';
import { AdvisorDetailDrawer } from './AdvisorDetailDrawer';
import { AdvisorDashboard } from './AdvisorDashboard';
import { importNewFormResponses, type ImportResult } from './importFromFormResponses';
import { appendOutreachEntry, appendOutreachBatch, stampLastOutreach } from './outreachLog';
import { writeAdvisorPipelineSnapshot } from './snapshotWriter';
import { ALL_TEMPLATE_KEYS, renderTemplate, templateMailto, TEMPLATE_LABELS, type TemplateKey } from './emailTemplates';
import { deduplicateAdvisors } from './deduplicateAdvisors';

// Best-effort year extractor. Handles ISO ('2026-01-15...'), US-locale
// ('1/15/2026'), and 'Jan 15, 2026'-ish forms. Returns 0 when nothing
// useful comes back, which makes the call site tolerant to missing /
// malformed timestamps.
function parsedYear(s: string): number {
  if (!s) return 0;
  // Try ISO first.
  const isoMatch = s.match(/^(\d{4})-\d{2}-\d{2}/);
  if (isoMatch) return parseInt(isoMatch[1], 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.getFullYear();
  // Last-ditch: any 4-digit run that looks like a year.
  const m = s.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1], 10) : 0;
}

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
  // Coarse gate — any signed-in @gazaskygeeks user can interact with the
  // page (sync form, leave comments, view candidates). Per-action gates
  // for stage transitions live below.
  const canEdit = isAdmin(userEmail) || /@gazaskygeeks\.com$/i.test(userEmail);
  // Intake stages — admin / leadership only. Starts at "new"; admin
  // can move advisors to acknowledged → allocated, or hold / reject.
  const canDoIntake = isAdmin(userEmail) || isLeadership(userEmail);
  // The AM-side pipeline (intro → assessment → approved → matched).
  // An AM can only manage rows where they are the assignee.
  // Admins / leadership can manage any row (so they can unstick things).
  const canManagePipeline = (advisor: { assignee_email?: string }): boolean => {
    if (canDoIntake) return true;
    if (!canEdit) return false;
    return (advisor.assignee_email || '').toLowerCase() === userEmail.toLowerCase();
  };
  // Anyone with edit rights can park a row on hold or reject (escape hatches).
  const canEscape = canEdit;
  const toast = useToast();

  // sheetId + tab names are still needed for appendActivity / dedup / form-import
  // direct writes that bypass the provider.
  const sheetId = getSheetId('advisors');
  const tabAdvisors = getTab('advisors', 'advisors');
  const tabActivity = getTab('advisors', 'activity');

  const advHook = useModuleData<Advisor>('advisors', 'advisors');
  const fuHook  = useModuleData<FollowUp>('advisors', 'followups');
  const actHook = useModuleData<ActivityRow>('advisors', 'activity');
  const cmtHook = useModuleData<AdvisorComment>('advisors', 'comments');

  // Companies — needed for conflict-of-interest detection AND for
  // smart match against the cohort. Pulling Assignments too so each
  // CompanyLite carries the sub-intervention codes it's engaged in.
  const { rows: companyRows } = useModuleData<Record<string, string>>('companies', 'companies');
  const { rows: companyAssignmentRows } = useModuleData<Record<string, string>>('companies', 'assignments');
  const companies = useMemo<CompanyLite[]>(
    () => {
      // Pre-index assignments by company_id so the company lite can
      // surface the sub-interventions it actually has work on, not
      // just what reviewers proposed during selection.
      const subsByCompany = new Map<string, Set<string>>();
      const pillarsByCompany = new Map<string, Set<string>>();
      for (const a of companyAssignmentRows) {
        const cid = a.company_id;
        if (!cid) continue;
        const sub = (a.sub_intervention || '').trim();
        const it = (a.intervention_type || '').trim();
        if (sub) {
          if (!subsByCompany.has(cid)) subsByCompany.set(cid, new Set());
          subsByCompany.get(cid)!.add(sub);
        }
        // Resolve pillar via interventions.ts (handles legacy codes).
        const p = it ? pillarForCode(it) : undefined;
        if (p) {
          if (!pillarsByCompany.has(cid)) pillarsByCompany.set(cid, new Set());
          pillarsByCompany.get(cid)!.add(p);
        }
      }
      return companyRows.map(c => ({
        company_id: c.company_id,
        company_name: c.company_name,
        sector: c.sector,
        governorate: c.governorate,
        status: c.status,
        subs:    Array.from(subsByCompany.get(c.company_id)    ?? []),
        pillars: Array.from(pillarsByCompany.get(c.company_id) ?? []),
      }));
    },
    [companyRows, companyAssignmentRows]
  );

  const [tab, setTab] = useState<string>('dashboard');
  const [query, setQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterPipeline, setFilterPipeline] = useState<string>('');
  // Saved view: one-click preset that overrides individual filters with
  // a more expressive predicate (e.g. "stuck > SLA" or "matched this month")
  // that the basic chips cannot express.
  const [savedView, setSavedView] = useState<'' | 'mine' | 'stuck' | 's1_fails' | 'matched_month' | 'with_followup'>('');
  // Bulk selection on Roster — list of selected advisor_ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  // Admin opt-in: auto-acknowledge new entries that pass Stage 1 strongly.
  const [autoAck, setAutoAck] = useState<boolean>(() => {
    try {
      return localStorage.getItem('advisors:autoAck') === '1';
    } catch {
      return false;
    }
  });
  // Default view hides Archived (pre-Cohort 3 historicals + parked rows).
  // Admin toggles it on to inspect the archive.
  const [showArchived, setShowArchived] = useState(false);
  // `importing` is still tracked so a future manual refresh can show a
  // pulsing icon, but the visible "Pull from form" button has been replaced
  // with an auto-poll every 5 minutes.
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deep-link support: /advisors?focus=<advisor_id> auto-opens the
  // detail drawer for that advisor on mount. Used by company detail
  // pages to jump directly into the matched advisor's record.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus || !advHook.rows.length) return;
    if (advHook.rows.some(r => r.advisor_id === focus)) {
      setSelectedId(focus);
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, advHook.rows, setSearchParams]);
  // Last form-import outcome — surfaced in the page header AND a full
  // diagnostic card below the header so any schema drift / dedupe /
  // skip is visible without opening devtools.
  const [lastFormImport, setLastFormImport] = useState<ImportResult | null>(null);
  const [showImportDetails, setShowImportDetails] = useState(false);

  const enriched = useMemo(
    () => enrichAdvisors(advHook.rows, fuHook.rows, cmtHook.rows, actHook.rows, companies),
    [advHook.rows, fuHook.rows, cmtHook.rows, actHook.rows, companies]
  );

  // Duplicate / orphan detection. Surfaces a banner the team can act on.
  // The dedupe-at-render in enrichAdvisors keeps the kanban sane even
  // when the sheet has duplicates, but the underlying sheet is still
  // broken until someone runs the Deduplicate action — this surfaces
  // that.
  const duplicates = useMemo(() => detectDuplicateAdvisors(advHook.rows), [advHook.rows]);
  const dupRowCount = useMemo(() => {
    let n = 0;
    for (const g of duplicates) {
      if (g.reason === 'no_id') n += g.rows.length;
      else n += g.rows.length - 1;     // each group has 1 keeper, the rest are extras
    }
    return n;
  }, [duplicates]);

  // Active = post-2026 + not archived. Pre-2026 entries (legacy imports
  // that didn't get archived during migration) are hidden by default so
  // they don't pollute the kanban with random old names. Show archived
  // toggle brings the full set back.
  const active = useMemo(() => {
    if (showArchived) return enriched;
    return enriched.filter(a => {
      if (a.pipeline_status === 'Archived') return false;
      // The form-response timestamp is when this advisor applied. Reject
      // obvious pre-2026 entries (legacy imports that didn't get archived
      // during migration). Empty / unparseable timestamps pass through —
      // we'd rather show them than hide silently.
      const ts = (a.timestamp || '').trim();
      if (ts && parsedYear(ts) > 0 && parsedYear(ts) < 2026) return false;
      return true;
    });
  }, [enriched, showArchived]);

  const archivedCount = useMemo(
    () => enriched.filter(a => a.pipeline_status === 'Archived').length,
    [enriched]
  );

  const newEntries = useMemo(
    () => active.filter(a => (a.pipeline_status || 'New') === 'New'),
    [active]
  );

  // Saved-view predicate. When a saved view is set, it overrides individual
  // filter chips entirely — easier to reason about than mixing them.
  const savedViewPredicate = useCallback((a: EnrichedAdvisor): boolean => {
    const monthPrefix = new Date().toISOString().slice(0, 7);
    switch (savedView) {
      case 'mine':
        return (a.assignee_email || '').toLowerCase() === userEmail.toLowerCase();
      case 'stuck':
        return a.is_stuck;
      case 's1_fails':
        return !a.stage1.pass;
      case 'matched_month':
        return a.pipeline_status === 'Matched' && (a.decision_date || a.updated_at || '').startsWith(monthPrefix);
      case 'with_followup':
        return a.open_followups > 0;
      default:
        return true;
    }
  }, [savedView, userEmail]);

  // The kanban already buckets by pipeline_status into columns, so the
  // pipeline-filter chip would just hide other columns and — more
  // importantly — make a dragged card disappear the moment its status no
  // longer matches the filter. So we only apply pipeline filter to the
  // roster/follow-ups/activity views.
  const kanbanItems = useMemo(() => {
    return active.filter(a => {
      if (savedView && !savedViewPredicate(a)) return false;
      if (filterCountry && normalizeCountry(a.country) !== filterCountry) return false;
      if (filterCategory && a.stage2.primary !== filterCategory) return false;
      return matchesQuery(a, query);
    });
  }, [active, query, filterCountry, filterCategory, savedView, savedViewPredicate]);

  const filtered = useMemo(() => {
    if (!filterPipeline) return kanbanItems;
    return kanbanItems.filter(a => (a.pipeline_status || 'New') === filterPipeline);
  }, [kanbanItems, filterPipeline]);

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

    // ── Role gate ───────────────────────────────────────────────
    // Intake stages: admin / leadership only.
    // Pipeline stages: assignee AM only (admins always allowed).
    // on_hold + rejected: any signed-in editor (escape hatches).
    const isIntake = next === 'acknowledged' || next === 'allocated';
    const isPipeline = next === 'intro_sched' || next === 'intro_done' || next === 'assessment' || next === 'approved' || next === 'matched';
    const isEscape = next === 'on_hold' || next === 'rejected';
    if (isIntake && !canDoIntake) {
      toast.error('Only admins can move advisors through the intake stages.');
      return;
    }
    if (isPipeline && !canManagePipeline(adv)) {
      toast.error('Only the assigned AM (or admins) can manage this stage.');
      return;
    }
    if (isEscape && !canEscape) {
      toast.error('You don\'t have edit rights on this advisor.');
      return;
    }

    // ── Allocate handoff ────────────────────────────────────────
    // When admin moves an advisor to "Allocated", they must pick which
    // AM owns it. The picked email goes into assignee_email so the
    // advisor lands in that AM's pipeline (canManagePipeline above).
    let assigneeEmailUpdate: string | undefined;
    if (next === 'allocated') {
      const choices = ACCOUNT_MANAGERS.map((a, i) => `${i + 1}. ${a.name} (${a.email})`).join('\n');
      const picked = window.prompt(
        `Allocate ${adv.full_name || advisorId} to which AM?\n\n${choices}\n\nEnter 1–${ACCOUNT_MANAGERS.length} or paste an email:`,
        adv.assignee_email || '',
      );
      if (picked === null) return; // cancelled
      const trimmed = picked.trim();
      let resolved = '';
      const asIdx = parseInt(trimmed, 10);
      if (!Number.isNaN(asIdx) && asIdx >= 1 && asIdx <= ACCOUNT_MANAGERS.length) {
        resolved = ACCOUNT_MANAGERS[asIdx - 1].email;
      } else if (trimmed.includes('@')) {
        resolved = trimmed;
      }
      if (!resolved) {
        toast.error('Please pick 1-3 or paste a valid email.');
        return;
      }
      assigneeEmailUpdate = resolved;
    }

    // Stage gate: moving INTO Approved or Rejected requires a written
    // justification. The reason gets posted as a comment so the audit
    // trail captures *why*, not just what changed.
    let justification: string | null = null;
    if (nextLabel === 'Approved' || nextLabel === 'Rejected') {
      justification = window.prompt(
        `Moving ${adv.full_name || advisorId} to "${nextLabel}". Please write a short justification (this will be posted as a comment).`,
        ''
      );
      if (justification === null) return; // user cancelled
      if (justification.trim().length < 5) {
        toast.error('Justification must be at least 5 characters');
        return;
      }
    }

    try {
      // Re-stamp scores alongside the status change so the sheet's
      // Dashboard tab never goes stale on bulk moves / drag-drop.
      const scored = scoreFields({ ...adv, pipeline_status: nextLabel });
      const updates: Partial<Advisor> = { pipeline_status: nextLabel, ...scored };
      if (assigneeEmailUpdate) updates.assignee_email = assigneeEmailUpdate;
      await advHook.updateRow(advisorId, updates);
      if (sheetId) {
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: advisorId,
          action: 'status_change',
          field: 'pipeline_status',
          old_value: adv.pipeline_status,
          new_value: nextLabel,
          details: justification || '',
        });
        if (justification) {
          await cmtHook.createRow({
            comment_id: `CMT-${Date.now()}`,
            advisor_id: advisorId,
            author_email: userEmail,
            body: `[${nextLabel}] ${justification}`,
            created_at: new Date().toISOString(),
          } as Partial<AdvisorComment>);
        }
        await actHook.refresh();
      }
      toast.success(`${adv.full_name || advisorId} → ${nextLabel}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      // Surface a more actionable hint when the API returns a 403 — the
      // signed-in user almost always has only Viewer access on the
      // Advisors workbook in Drive.
      if (/permission|403|insufficient|read.only|cannot edit/i.test(msg)) {
        toast.error('No edit access on the Advisors sheet. Ask the workbook owner to share it with you as Editor in Drive.');
      } else {
        toast.error(`Move failed: ${msg}`);
      }
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

  // Refs so the auto-poll closure always sees the latest hook data without
  // re-creating the effect every time advHook.rows / .headers update (which
  // would tear down and rebuild the interval on every poll cycle).
  const importStateRef = useRef({
    sheetId: sheetId || '',
    headers: advHook.headers,
    existing: advHook.rows,
    userEmail,
  });
  importStateRef.current = {
    sheetId: sheetId || '',
    headers: advHook.headers,
    existing: advHook.rows,
    userEmail,
  };

  // Single import runner used by both the auto-poll and any future manual
  // trigger. `silent: true` suppresses the "0 new" notification.
  const runFormImport = useCallback(async (silent: boolean) => {
    const s = importStateRef.current;
    if (!s.sheetId) return;
    // Guard: skip if destination headers haven't loaded yet — otherwise
    // the appendRows call would push empty rows. The poll fires again
    // shortly so we'll catch up.
    if (!s.headers || s.headers.length === 0) {
      if (!silent) toast.info?.('Advisors data still loading — try again in a moment.');
      else console.info('[advisors] auto-poll skipped: headers not loaded yet');
      return;
    }
    const formSheetId = getSheetId('advisorsFormResponses');
    const formTab = getTab('advisorsFormResponses', 'responses');
    if (!formSheetId) {
      if (!silent) toast.error('Set VITE_SHEET_ADVISORS_FORM_RESPONSES in your environment to enable form import.');
      return;
    }
    if (!silent) setImporting(true);
    try {
      const result = await importNewFormResponses({
        formSheetId,
        formTabName: formTab,
        destSheetId: s.sheetId,
        destTabName: tabAdvisors,
        destHeaders: s.headers,
        existingAdvisors: s.existing,
        userEmail: s.userEmail,
      });
      // Always stash the FULL result + log a structured summary so silent
      // failures are visible in the UI (FormIntakeDiagnostics card).
      setLastFormImport(result);
      const summary = `[advisors] form-poll · fetched=${result.fetched} imported=${result.imported} dupes=${result.alreadyKnown} archived=${result.archived} skippedNoEmail=${result.skippedNoEmail} unmapped=[${result.unmappedHeaders.join(', ')}] errors=[${result.errors.join(' | ')}] at ${result.ranAt}`;
      if (result.errors.length > 0) {
        console.warn(summary);
        if (!silent) toast.error(`Import error: ${result.errors[0]}`);
        return;
      }
      console.info(summary);
      // ALWAYS refresh the data layer after a successful poll, even if
      // imported==0. The previous behavior only refreshed on imported>0,
      // which left stale data in the cache when an external sync (e.g.,
      // a teammate appending a row) happened between polls.
      await advHook.refresh();
      if (result.imported > 0) {
        toast.success(`${result.imported} new advisor entr${result.imported === 1 ? 'y' : 'ies'} imported${result.archived > 0 ? ` (${result.archived} pre-2026)` : ''}`);
        await appendActivity(s.sheetId, tabActivity, {
          user_email: s.userEmail,
          advisor_id: '',
          action: 'form_import',
          field: 'count',
          new_value: String(result.imported),
          details: `auto-poll · ${result.fetched} fetched, ${result.alreadyKnown} dupes`,
        });
        await actHook.refresh();
      } else if (!silent) {
        toast.success(`Form has ${result.fetched} entries · all ${result.alreadyKnown} already in tracker`);
      }
    } catch (err) {
      if (!silent) toast.error(`Import failed: ${(err as Error).message}`);
      else console.warn('[advisors] auto-import failed', err);
    } finally {
      if (!silent) setImporting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabAdvisors, tabActivity]);

  const [, setDedupRunning] = useState(false);
  // Track whether we've already auto-deduped this session, so the effect
  // doesn't loop on every poll cycle.
  const [autoDedupRan, setAutoDedupRan] = useState(false);
  const handleDeduplicate = async (silent = false) => {
    if (!sheetId) return;
    if (!silent) {
      if (!window.confirm(`Scan ${advHook.rows.length} rows for duplicate emails and remove all but the earliest copy of each? This is permanent.`)) return;
    }
    setDedupRunning(true);
    try {
      const result = await deduplicateAdvisors(sheetId, tabAdvisors, advHook.rows);
      if (result.rowsRemoved > 0) {
        if (silent) {
          toast.success(`Auto-removed ${result.rowsRemoved} duplicate row${result.rowsRemoved === 1 ? '' : 's'}`,
            `Across ${result.duplicateGroups} email group${result.duplicateGroups === 1 ? '' : 's'}.`);
        } else {
          toast.success(`Removed ${result.rowsRemoved} duplicate row${result.rowsRemoved === 1 ? '' : 's'} across ${result.duplicateGroups} email${result.duplicateGroups === 1 ? '' : 's'}`);
        }
        await advHook.refresh();
        await appendActivity(sheetId, tabActivity, {
          user_email: userEmail,
          advisor_id: '',
          action: 'dedupe',
          field: 'count',
          new_value: String(result.rowsRemoved),
          details: `${result.duplicateGroups} duplicate-email groups${silent ? ' · auto' : ''}`,
        });
        await actHook.refresh();
      } else if (!silent) {
        toast.success(`No duplicates found in ${result.scanned} rows`);
      }
      if (result.errors.length > 0) {
        toast.error(`Some deletes failed: ${result.errors[0]}`);
      }
    } catch (err) {
      if (!silent) toast.error(`Dedupe failed: ${(err as Error).message}`);
      else console.warn('[advisors] auto-dedupe failed', err);
    } finally {
      setDedupRunning(false);
    }
  };

  // Auto-dedupe — when the page loads and the underlying sheet has
  // duplicates, run the dedupe action silently. Admin-only so non-admins
  // never trigger destructive deletes. Runs at most once per page load
  // (autoDedupRan), and only after rows have actually loaded so we
  // don't no-op against an empty advHook.
  useEffect(() => {
    if (autoDedupRan) return;
    if (!canEdit) return;
    if (!sheetId) return;
    if (advHook.loading) return;
    if (advHook.rows.length === 0) return;
    if (dupRowCount === 0) {
      setAutoDedupRan(true);
      return;
    }
    setAutoDedupRan(true);
    void handleDeduplicate(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advHook.loading, advHook.rows.length, dupRowCount, canEdit, sheetId, autoDedupRan]);

  // Bulk actions on selected Roster rows.
  const handleBulkMove = async (target: AdvisorPipelineId | 'Archived') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Move ${ids.length} advisor${ids.length === 1 ? '' : 's'} to ${target === 'Archived' ? 'Archived' : PIPELINE_LABEL_BY_ID[target]}?`)) return;
    setBulkRunning(true);
    let ok = 0;
    const targetLabel = target === 'Archived' ? 'Archived' : PIPELINE_LABEL_BY_ID[target];
    try {
      for (const id of ids) {
        const adv = enriched.find(a => a.advisor_id === id);
        if (!adv || adv.pipeline_status === targetLabel) continue;
        try {
          const scored = scoreFields({ ...adv, pipeline_status: targetLabel });
          await advHook.updateRow(id, { pipeline_status: targetLabel, ...scored } as Partial<Advisor>);
          if (sheetId) {
            await appendActivity(sheetId, tabActivity, {
              user_email: userEmail,
              advisor_id: id,
              action: 'status_change',
              field: 'pipeline_status',
              old_value: adv.pipeline_status,
              new_value: targetLabel,
              details: 'bulk_action',
            });
          }
          ok += 1;
        } catch (err) {
          console.warn('[advisors] bulk move skipped', id, err);
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
    const assignee = window.prompt('Assignee email (e.g. doaa@gazaskygeeks.com):');
    if (!assignee) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try {
          await advHook.updateRow(id, { assignee_email: assignee } as Partial<Advisor>);
          if (sheetId) {
            await appendActivity(sheetId, tabActivity, {
              user_email: userEmail,
              advisor_id: id,
              action: 'tracker_edit',
              field: 'assignee_email',
              new_value: assignee,
              details: 'bulk_action',
            });
          }
          ok += 1;
        } catch (err) {
          console.warn('[advisors] bulk assign skipped', id, err);
        }
      }
      toast.success(`Assigned ${ok} of ${ids.length} to ${assignee}`);
      await actHook.refresh();
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  // Bulk send: opens N compose tabs for the selected advisors, then a
  // single confirm afterwards batches one Outreach Log write +
  // per-advisor last_outreach_at stamp.
  const handleBulkSendEmail = async (templateKey: TemplateKey) => {
    if (!sheetId) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const advisors = ids
      .map(id => advHook.rows.find(r => r.advisor_id === id))
      .filter((a): a is Advisor => !!a && !!a.email);
    if (advisors.length === 0) {
      toast.error('No selected advisors have an email address.');
      return;
    }
    const senderName = user?.name || userEmail.split('@')[0];
    const senderTitle = getUserByEmail(userEmail)?.title;
    let popupBlocked = 0;
    for (const a of advisors) {
      const rendered = renderTemplate(templateKey, {
        advisor: { full_name: a.full_name, email: a.email, position: a.position, employer: a.employer, country: a.country },
        sender: { name: senderName, email: userEmail, title: senderTitle },
      });
      const w = window.open(templateMailto(rendered), '_blank');
      if (!w) popupBlocked += 1;
    }
    if (popupBlocked > 0) {
      toast.error(`${popupBlocked} pop-ups blocked — allow pop-ups for this site, then click again.`);
      return;
    }
    const confirmed = window.confirm(`All ${advisors.length} emails sent?`);
    if (!confirmed) {
      toast.info?.('Skipped logging — open the drawer to log individual sends.');
      return;
    }
    const sentAt = new Date().toISOString();
    setBulkRunning(true);
    try {
      const label = TEMPLATE_LABELS[templateKey];
      await appendOutreachBatch(sheetId, advisors.map(a => ({
        advisor_id: a.advisor_id,
        advisor_name: a.full_name || '',
        email: a.email || '',
        template_key: templateKey,
        template_label: label,
        sender_email: userEmail,
        sent_at: sentAt,
      })));
      for (const a of advisors) {
        try {
          await stampLastOutreach(advHook.updateRow, a.advisor_id, templateKey, sentAt);
        } catch (err) {
          console.warn('[advisors] stamp failed for', a.advisor_id, err);
        }
      }
      await appendActivity(sheetId, tabActivity, {
        user_email: userEmail,
        advisor_id: '',
        action: 'outreach',
        field: 'bulk',
        new_value: templateKey,
        details: `bulk · ${advisors.length} sent`,
      });
      await actHook.refresh();
      toast.success(`Logged ${advisors.length} outreach entries`);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(`Bulk log failed: ${(err as Error).message}`);
    } finally {
      setBulkRunning(false);
    }
  };

  // Auto-acknowledge: scan for advisors with pipeline_status='New' that
  // pass a strong-fit threshold and auto-advance to 'Acknowledged'. Runs
  // each time the advisor list updates while autoAck is on. Records a
  // "auto_ack" activity row so the team can audit the automation.
  const autoAckRunning = useRef(false);
  useEffect(() => {
    if (!autoAck || !canEdit || !sheetId) return;
    if (autoAckRunning.current) return;
    autoAckRunning.current = true;
    (async () => {
      try {
        const candidates = enriched.filter(a =>
          a.pipeline_status === 'New' &&
          a.stage1.pass &&
          a.stage1.total >= 70 &&
          parseFloat(a.tech_rating || '0') >= 4
        );
        if (candidates.length === 0) return;
        for (const adv of candidates) {
          try {
            const scored = scoreFields({ ...adv, pipeline_status: 'Acknowledged' });
            await advHook.updateRow(adv.advisor_id, { pipeline_status: 'Acknowledged', ...scored } as Partial<Advisor>);
            await appendActivity(sheetId, tabActivity, {
              user_email: 'auto-ack',
              advisor_id: adv.advisor_id,
              action: 'status_change',
              field: 'pipeline_status',
              old_value: 'New',
              new_value: 'Acknowledged',
              details: `auto-ack: S1=${adv.stage1.total} tech=${adv.tech_rating}`,
            });
          } catch (err) {
            console.warn('[advisors] auto-ack skipped', adv.advisor_id, err);
          }
        }
        toast.success(`Auto-acknowledged ${candidates.length} strong Stage 1 fit${candidates.length === 1 ? '' : 's'}`);
        await actHook.refresh();
      } finally {
        autoAckRunning.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAck, advHook.rows.length]);

  const toggleAutoAck = () => {
    setAutoAck(v => {
      const next = !v;
      try { localStorage.setItem('advisors:autoAck', next ? '1' : '0'); } catch {}
      return next;
    });
  };

  // Auto-poll: pull from the linked Google Form responses sheet.
  // Fires twice on mount (1.5s + 8s, to catch first paint + post-load
  // cases where SheetDataProvider hadn't finished its initial fetch),
  // then every 90 seconds thereafter. The diagnostics card shows the
  // outcome of every run so the team can see if/why rows aren't
  // landing.
  useEffect(() => {
    if (!sheetId || !canEdit) return;
    if (!getSheetId('advisorsFormResponses')) return;
    const POLL_MS = 90 * 1000;
    const first = setTimeout(() => { void runFormImport(true); }, 1500);
    const second = setTimeout(() => { void runFormImport(true); }, 8000);
    const interval = setInterval(() => { void runFormImport(true); }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
      clearInterval(interval);
    };
  }, [sheetId, canEdit, runFormImport]);

  // Pipeline snapshot mirror tab: rewrite a polished, human-friendly
  // copy of advisor + follow-up state into the Advisors workbook every
  // time the data changes (debounced 3 s). The team can open the sheet
  // directly and use it as a parallel UI to the portal.
  const snapshotBusy = useRef(false);
  useEffect(() => {
    if (!canEdit || !sheetId) return;
    if (advHook.rows.length === 0) return;
    const handle = setTimeout(async () => {
      if (snapshotBusy.current) return;
      snapshotBusy.current = true;
      try {
        const companyNameById = new Map<string, string>();
        for (const c of companies) {
          if (c.company_id) companyNameById.set(c.company_id, c.company_name || c.company_id);
        }
        await writeAdvisorPipelineSnapshot({
          advisors: advHook.rows,
          followups: fuHook.rows,
          companyNameById,
          generatedBy: userEmail,
        });
      } catch (err) {
        console.warn('[advisors] snapshot write failed', err);
      } finally {
        snapshotBusy.current = false;
      }
    }, 3000);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advHook.rows, fuHook.rows, canEdit, sheetId, userEmail]);

  const handleLogOutreach = async (advisorId: string, templateKey: string, templateLabel: string) => {
    if (!sheetId) return;
    const adv = advHook.rows.find(r => r.advisor_id === advisorId);
    if (!adv) return;
    const sentAt = new Date().toISOString();
    try {
      await appendOutreachEntry(sheetId, {
        advisor_id: advisorId,
        advisor_name: adv.full_name || '',
        email: adv.email || '',
        template_key: templateKey,
        template_label: templateLabel,
        sender_email: userEmail,
        sent_at: sentAt,
      });
      await stampLastOutreach(advHook.updateRow, advisorId, templateKey, sentAt);
      await appendActivity(sheetId, tabActivity, {
        user_email: userEmail,
        advisor_id: advisorId,
        action: 'outreach',
        field: 'template',
        new_value: templateKey,
        details: `sent ${templateLabel}`,
      });
      await actHook.refresh();
      toast.success(`Outreach logged · ${templateLabel}`);
    } catch (err) {
      toast.error(`Couldn't log outreach: ${(err as Error).message}`);
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
    // Order: overview → daily work → reference → tasks → audit. Dashboard
    // first so opening the page lands on the summary; Pipeline next as the
    // primary triage surface; Roster as the searchable index; Follow-ups
    // as the side workload; Activity as the audit trail.
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Advisors"
        badges={[
          { label: `${active.length} active`, tone: 'teal' },
          ...(archivedCount > 0 ? [{ label: `${archivedCount} archived`, tone: 'neutral' as Tone }] : []),
        ]}
        actions={
          <>
            {canEdit && <FormSyncPill last={lastFormImport} importing={importing} onSyncNow={() => runFormImport(false)} />}
            <Button variant="ghost" onClick={() => setShowArchived(v => !v)} title={showArchived ? 'Hide archived' : 'Show archived'}>
              <Archive className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={() => { advHook.refresh(); fuHook.refresh(); actHook.refresh(); cmtHook.refresh(); }} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              disabled={filtered.length === 0}
              onClick={() => downloadCsv(timestampedFilename('advisors'), filtered.map(toCsvRow))}
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
          </>
        }
      />

      {canEdit && (
        <FormIntakeDiagnostics
          last={lastFormImport}
          importing={importing}
          showDetails={showImportDetails}
          onToggleDetails={() => setShowImportDetails(v => !v)}
          onSyncNow={() => runFormImport(false)}
        />
      )}

      {newEntries.length > 0 && (
        <Card accent="red">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-brand-red/15 p-2 text-brand-red">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold text-navy-500 dark:text-white">
                  {newEntries.length} new {newEntries.length === 1 ? 'entry' : 'entries'} waiting for triage
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  These came in via the application form and have not been acknowledged yet.
                  Open each card and run through Acknowledge → Allocate → Intro.
                </div>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                setTab('roster');
                setFilterPipeline('New');
                setQuery('');
                setFilterCountry('');
                setFilterCategory('');
              }}
            >
              <AlertCircle className="h-4 w-4" /> Triage now
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
          {showArchived && (
            <button
              onClick={() => setFilterPipeline('Archived')}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filterPipeline === 'Archived' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
            >
              Archived
            </button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Quick views:</span>
        {([
          { id: '', label: 'All' },
          { id: 'mine', label: 'My active' },
          { id: 'stuck', label: `Stuck (${active.filter(a => a.is_stuck).length})` },
          { id: 's1_fails', label: 'S1 fails' },
          { id: 'with_followup', label: 'With follow-ups' },
          { id: 'matched_month', label: 'Matched this month' },
        ] as const).map(v => (
          <button
            key={v.id}
            onClick={() => setSavedView(v.id as typeof savedView)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              savedView === v.id
                ? 'bg-brand-teal text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
        {canEdit && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={autoAck}
              onChange={toggleAutoAck}
              className="rounded"
            />
            Auto-acknowledge strong fits
          </label>
        )}
      </div>

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
          advisors={kanbanItems}
          readOnly={!canEdit}
          onMove={handleMovePipeline}
          onCardClick={a => setSelectedId(a.advisor_id)}
        />
      )}

      {tab === 'roster' && (
        <RosterTable
          advisors={filtered}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          canEdit={canEdit}
          bulkRunning={bulkRunning}
          onBulkMove={handleBulkMove}
          onBulkAssign={handleBulkAssign}
          onBulkSendEmail={handleBulkSendEmail}
          onOpen={a => setSelectedId(a.advisor_id)}
        />
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

      {tab === 'dashboard' && <AdvisorDashboard advisors={enriched} activity={actHook.rows} />}

      <AdvisorDetailDrawer
        advisor={selected}
        open={!!selected}
        canEdit={canEdit}
        userEmail={userEmail}
        userName={user?.name}
        userTitle={getUserByEmail(userEmail)?.title}
        companies={companies}
        onClose={() => setSelectedId(null)}
        onTrackerSave={handleTrackerSave}
        onCreateFollowUp={handleCreateFollowUp}
        onMarkFollowUpDone={handleMarkFollowUpDone}
        onAddComment={handleAddComment}
        onLogOutreach={handleLogOutreach}
      />
    </div>
  );
}

function RosterTable({
  advisors,
  selectedIds,
  setSelectedIds,
  canEdit,
  bulkRunning,
  onBulkMove,
  onBulkAssign,
  onBulkSendEmail,
  onOpen,
}: {
  advisors: EnrichedAdvisor[];
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  canEdit: boolean;
  bulkRunning: boolean;
  onBulkMove: (target: AdvisorPipelineId | 'Archived') => Promise<void>;
  onBulkAssign: () => Promise<void>;
  onBulkSendEmail: (templateKey: TemplateKey) => Promise<void>;
  onOpen: (a: EnrichedAdvisor) => void;
}) {
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [bulkEmailTemplate, setBulkEmailTemplate] = useState<TemplateKey>('intro_invite');
  const allChecked = advisors.length > 0 && advisors.every(a => selectedIds.has(a.advisor_id));
  const someChecked = !allChecked && advisors.some(a => selectedIds.has(a.advisor_id));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allChecked) {
      for (const a of advisors) next.delete(a.advisor_id);
    } else {
      for (const a of advisors) next.add(a.advisor_id);
    }
    setSelectedIds(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const columns: Column<EnrichedAdvisor>[] = [
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
      render: (a: EnrichedAdvisor) => (
        <input
          type="checkbox"
          checked={selectedIds.has(a.advisor_id)}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleOne(a.advisor_id)}
          aria-label={`Select ${a.full_name}`}
        />
      ),
    }] satisfies Column<EnrichedAdvisor>[] : []),
    {
      key: 'full_name',
      header: 'Name',
      render: a => (
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{a.full_name || '(unnamed)'}</span>
          {a.is_stuck && <Badge tone="red">stuck {a.days_in_status}d</Badge>}
          {a.conflict_company_id && <Badge tone="amber">COI</Badge>}
        </div>
      ),
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
      key: 'days_in_status',
      header: 'Days',
      width: '70px',
      render: a => <span className={`font-mono text-xs ${a.is_stuck ? 'text-brand-red font-bold' : 'text-slate-500'}`}>{a.days_in_status >= 0 ? a.days_in_status : '—'}</span>,
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

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && canEdit && (
        <Card accent="teal">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-navy-500 dark:text-white">
              {selectedIds.size} selected
            </span>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('acknowledged')} disabled={bulkRunning}>Acknowledge</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('allocated')} disabled={bulkRunning}>Allocate</Button>
            <Button size="sm" variant="ghost" onClick={onBulkAssign} disabled={bulkRunning}>Set assignee…</Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkEmailOpen(true)} disabled={bulkRunning}>Send template…</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('on_hold')} disabled={bulkRunning}>Move to On Hold</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkMove('Archived')} disabled={bulkRunning}>Archive</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkRunning}>Clear</Button>
          </div>
        </Card>
      )}
      {bulkEmailOpen && (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-2xs font-bold uppercase tracking-wider text-slate-500">Template</label>
              <select
                value={bulkEmailTemplate}
                onChange={e => setBulkEmailTemplate(e.target.value as TemplateKey)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-white"
              >
                {ALL_TEMPLATE_KEYS.map(k => (
                  <option key={k} value={k}>{TEMPLATE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <p className="flex-1 text-xs text-slate-500">
              Will open {selectedIds.size} compose tabs (one per advisor). Confirm afterwards to log to the Outreach tab. Pop-ups must be allowed.
            </p>
            <Button size="sm" variant="primary" onClick={async () => { await onBulkSendEmail(bulkEmailTemplate); setBulkEmailOpen(false); }} disabled={bulkRunning}>
              Compose {selectedIds.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBulkEmailOpen(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      <DataTable columns={columns} rows={advisors} onRowClick={onOpen} />
    </div>
  );
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

// ─── Form intake diagnostics card (loud, full visibility) ───────────
//
// The Form Sync Pill in the header is small. When a sync isn't behaving
// as expected, the team needs to see EVERYTHING about the last run:
// how many rows were fetched, how many were dupes, how many got skipped
// for missing email, which form columns are unmapped, AND a per-row
// list with each row's outcome. Click "Show details" to expand.

function FormIntakeDiagnostics({
  last,
  importing,
  showDetails,
  onToggleDetails,
  onSyncNow,
}: {
  last: ImportResult | null;
  importing: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
  onSyncNow: () => Promise<void> | void;
}) {
  const ago = last ? agoFor(last.ranAt) : 'never';
  const tone =
    !last ? 'neutral'
    : last.errors.length > 0 ? 'red'
    : last.unmappedHeaders.length > 0 ? 'amber'
    : last.imported > 0 ? 'teal'
    : 'neutral';

  const dotClass =
    tone === 'red'   ? 'bg-red-500'
    : tone === 'amber' ? 'bg-amber-500'
    : tone === 'teal'  ? 'bg-emerald-500'
    : 'bg-slate-400';

  return (
    <Card accent={tone === 'red' ? 'red' : tone === 'amber' ? 'orange' : 'teal'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full ${dotClass}`} />
          <div>
            <div className="text-sm font-bold text-navy-500 dark:text-white">
              Form sync · last ran {ago}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
              {last ? (
                <>
                  <span><strong className="font-mono text-navy-500 dark:text-white">{last.fetched}</strong> fetched</span>
                  <span className="text-emerald-700 dark:text-emerald-400"><strong className="font-mono">{last.imported}</strong> imported</span>
                  <span><strong className="font-mono">{last.alreadyKnown}</strong> dupes</span>
                  {last.archived > 0 && <span><strong className="font-mono">{last.archived}</strong> archived (pre-2026)</span>}
                  {last.skippedNoEmail > 0 && <span className="text-amber-700 dark:text-amber-400"><strong className="font-mono">{last.skippedNoEmail}</strong> skipped (no email)</span>}
                  {last.unmappedHeaders.length > 0 && <span className="text-amber-700 dark:text-amber-400"><strong className="font-mono">{last.unmappedHeaders.length}</strong> unmapped column{last.unmappedHeaders.length === 1 ? '' : 's'}</span>}
                  {last.errors.length > 0 && <span className="text-red-700 dark:text-red-400"><strong className="font-mono">{last.errors.length}</strong> error{last.errors.length === 1 ? '' : 's'}</span>}
                </>
              ) : (
                <span className="italic text-slate-500">No sync has run yet — click <strong>Sync now</strong>.</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => void onSyncNow()} disabled={importing}>
            <CloudDownload className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} />
            {importing ? 'Syncing…' : 'Sync now'}
          </Button>
          {last && (
            <Button variant="ghost" onClick={onToggleDetails}>
              {showDetails ? 'Hide details' : 'Show details'}
            </Button>
          )}
        </div>
      </div>

      {last && last.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          <div className="font-semibold">Errors</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {last.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {last && last.unmappedHeaders.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <div className="font-semibold">{last.unmappedHeaders.length} form column{last.unmappedHeaders.length === 1 ? '' : 's'} not mapped to any Advisor field</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {last.unmappedHeaders.map((h, i) => <li key={i}><span className="font-mono">{h}</span></li>)}
          </ul>
          <div className="mt-1 italic">Add a rule to <code>HEADER_RULES</code> in <code>importFromFormResponses.ts</code> for each of these (or ignore if intentional).</div>
        </div>
      )}

      {last && showDetails && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-navy-700 dark:bg-navy-700/50 dark:text-slate-200">
            <div className="font-semibold">Source / destination</div>
            <div className="mt-1 grid grid-cols-2 gap-1 font-mono">
              <div className="text-slate-500">Form sheet:</div>
              <div className="truncate"><a href={`https://docs.google.com/spreadsheets/d/${last.sourceSheetId}/edit#gid=0`} target="_blank" rel="noreferrer" className="text-brand-teal hover:underline">{last.sourceSheetId.slice(0, 12)}…</a> · <code>{last.sourceTabName}</code></div>
              <div className="text-slate-500">Advisors tab:</div>
              <div className="truncate"><a href={`https://docs.google.com/spreadsheets/d/${last.destSheetId}/edit#gid=0`} target="_blank" rel="noreferrer" className="text-brand-teal hover:underline">{last.destSheetId.slice(0, 12)}…</a> · <code>{last.destTabName}</code></div>
            </div>
          </div>

          {last.mappedHeaders.length > 0 && (
            <details className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-navy-700">
              <summary className="cursor-pointer font-semibold">{last.mappedHeaders.length} mapped form column{last.mappedHeaders.length === 1 ? '' : 's'}</summary>
              <table className="mt-2 w-full text-left">
                <thead className="text-2xs uppercase tracking-wider text-slate-500">
                  <tr><th className="py-1">Form column</th><th className="py-1">→ Advisor field</th></tr>
                </thead>
                <tbody className="font-mono text-2xs">
                  {last.mappedHeaders.map((m, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-navy-700">
                      <td className="py-1 pr-2">{m.source}</td>
                      <td className="py-1 text-brand-teal">{m.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {last.decisions.length > 0 && (
            <details className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-navy-700" open={last.imported === 0 && last.fetched > 0}>
              <summary className="cursor-pointer font-semibold">
                Per-row outcome ({last.decisions.length} rows)
              </summary>
              <div className="mt-2 max-h-80 overflow-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white text-2xs uppercase tracking-wider text-slate-500 dark:bg-navy-900">
                    <tr>
                      <th className="py-1 pr-2">Row</th>
                      <th className="py-1 pr-2">Email</th>
                      <th className="py-1 pr-2">Timestamp (raw → normalized)</th>
                      <th className="py-1 pr-2">Outcome</th>
                      <th className="py-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-2xs">
                    {last.decisions.map((d, i) => {
                      const tone =
                        d.outcome === 'imported' ? 'text-emerald-700 dark:text-emerald-400'
                        : d.outcome === 'duplicate' ? 'text-slate-500'
                        : d.outcome === 'archived-pre-2026' ? 'text-slate-500'
                        : 'text-amber-700 dark:text-amber-400';
                      return (
                        <tr key={i} className="border-t border-slate-100 dark:border-navy-700">
                          <td className="py-1 pr-2">{d.rowIndex}</td>
                          <td className="py-1 pr-2 truncate max-w-[160px]">{d.email || '—'}</td>
                          <td className="py-1 pr-2 truncate max-w-[260px]">{d.timestampRaw} → {d.timestampNormalized || '—'}</td>
                          <td className={`py-1 pr-2 font-bold uppercase tracking-wider ${tone}`}>{d.outcome}</td>
                          <td className="py-1 text-slate-500 truncate max-w-[200px]">{d.reason || ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Form sync status pill ──────────────────────────────────────────
//
// Surfaces the auto-poll's last run so silent failures (esp. schema
// drift in the Google Form column names) become visible to the team
// without needing devtools. Click the pill or *Sync now* to run a
// non-silent re-poll immediately.

function FormSyncPill({
  last,
  importing,
  onSyncNow,
}: {
  last: ImportResult | null;
  importing: boolean;
  onSyncNow: () => Promise<void> | void;
}) {
  const hasUnmapped = !!last && last.unmappedHeaders.length > 0;
  const hasErrors = !!last && last.errors.length > 0;
  const tone =
    !last ? 'neutral'
    : hasErrors ? 'red'
    : hasUnmapped ? 'amber'
    : 'teal';
  const ago = last ? agoFor(last.ranAt) : '—';
  const tooltip = last
    ? [
        `Last sync: ${ago}`,
        `Fetched ${last.fetched} · Imported ${last.imported} · Dupes ${last.alreadyKnown} · Archived ${last.archived}`,
        last.skippedNoEmail > 0 ? `Skipped (no email): ${last.skippedNoEmail}` : '',
        hasUnmapped ? `Unmapped form columns: ${last.unmappedHeaders.join(', ')}` : '',
        hasErrors ? `Errors: ${last.errors.join(' | ')}` : '',
      ].filter(Boolean).join('\n')
    : 'Waiting for first sync…';

  const dotClass =
    tone === 'red'   ? 'bg-red-500'
    : tone === 'amber' ? 'bg-amber-500'
    : tone === 'teal'  ? 'bg-emerald-500'
    : 'bg-slate-400';

  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-300"
      title={tooltip}
    >
      <CloudDownload className={`h-3.5 w-3.5 ${importing ? 'animate-pulse text-brand-teal' : 'text-slate-400'}`} />
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      <span>
        {last
          ? <>Form sync · <span className="font-mono">{last.imported}</span> in / <span className="font-mono">{last.alreadyKnown}</span> dup · {ago}</>
          : 'Form sync pending'}
      </span>
      {hasUnmapped && (
        <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {last!.unmappedHeaders.length} unmapped
        </span>
      )}
      <button
        type="button"
        onClick={() => void onSyncNow()}
        className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-teal hover:bg-teal-50 dark:hover:bg-teal-900/30"
        disabled={importing}
      >
        {importing ? '…' : 'Sync now'}
      </button>
    </span>
  );
}

function agoFor(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
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
