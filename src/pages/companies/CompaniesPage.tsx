import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Download,
  Kanban as KanbanIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Table as TableIcon,
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
  DataTable,
  Drawer,
  EmptyState,
  FilterDrawer,
  FilterToggleButton,
  Kanban,
  PageHeader,
  Tabs,
  statusTone,
  useToast,
  downloadCsv,
  timestampedFilename,
} from '../../lib/ui';
import type { Column, FilterDrawerValues, FilterFieldDef, KanbanColumn, KanbanItem, TabItem, Tone } from '../../lib/ui';
import { displayName, getProfileManagers, isAdmin } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import { INTERVIEWED_NAMES, INTERVIEWED_RAW, isInterviewed } from './interviewedSource';
import { ReviewView } from './ReviewView';
import type { ReviewableCompany, SelectionContext } from './ReviewView';
import { FinalDecisionView } from './FinalDecisionView';
import type { FinalLockArgs } from './FinalDecisionView';
import { exportReviewToSheet } from './exportReview';
import { indexByCompanyName, lookupByName } from './selectionContext';
import { ExpandableCompanyCard } from './ExpandableCompanyCard';
import type { CardCompany } from './ExpandableCompanyCard';
import {
  ACTIVITY_HEADERS,
  ALIAS_HEADERS,
  COMMENTS_HEADERS,
  PRE_DECISION_HEADERS,
  REMOVED_HEADERS,
  REVIEWS_HEADERS,
  aliasIdFor,
  removedIdFor,
  summarizeReviews,
} from './reviewTypes';
import { repairDashboard } from './repairDashboard';
import { fuzzyResolve, importExternalSeed, loadSeed } from './importExternalComments';
import type { CompanyComment, InterviewAlias, PreDecisionRecommendation, RemovedCompany, Review, ReviewSummary } from './reviewTypes';

// Source Data row from the Selection workbook. Headers come from selection-tool's
// Company schema so keys are camelCase.
type Applicant = Record<string, string>;

// Companies Master row (operational enrichment).
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

// Joined row shown in the table.
type Row = {
  route_id: string;              // route param used for /companies/:id
  applicant_id: string;          // numeric id from Source Data, blank if Master-only
  company_id: string;            // Master's E3-XXXX if joined, else synthesized
  company_name: string;
  sector: string;
  city: string;
  governorate: string;
  employee_count: string;
  readiness_score: string;
  fund_code: string;
  stage: string;
  status: string;
  profile_manager_email: string;
  contact_email: string;
  source: 'applicant' | 'master' | 'both';
  intervention_count: number;
  intervention_pillars: string[];   // unique pillar codes assigned to this company
};

const STATUSES = ['Applicant', 'Shortlisted', 'Interviewed', 'Reviewing', 'Recommended', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Withdrawn'];
const STAGES = ['Applied', '1st Filtration', 'Doc Review', 'Needs Assessed', 'Scored', 'Interviewed', 'Final Assessment', 'Selected', 'Onboarded', 'Active', 'Graduated', 'Rejected', 'Withdrew'];
const FUND_CODES = ['97060', '91763'];

// The post-interview triage flow: every status from Interviewed onwards
// belongs to the working portfolio that this page is built around.
const POST_INTERVIEW_STATUSES = new Set(['Interviewed', 'Reviewing', 'Recommended', 'Selected', 'Onboarded', 'Active', 'Graduated']);

const norm = (s?: string) => (s || '').trim().toLowerCase();

function padId(n: string): string {
  const num = parseInt(n || '0', 10);
  return Number.isFinite(num) && num > 0 ? `A-${num.toString().padStart(4, '0')}` : '';
}

// Order in which statuses live within the pipeline. Used to compute "the
// higher of (master.status, override)" so we never demote a company by
// applying the Interviewed override on top of an Onboarded record. Reviewing
// and Recommended sit between Interviewed and Selected — that's where the
// committee debate happens before the final cohort is locked.
const STATUS_ORDER: Record<string, number> = {
  Applicant: 0,
  Shortlisted: 1,
  Interviewed: 2,
  Reviewing: 3,
  Recommended: 4,
  Selected: 5,
  Onboarded: 6,
  Active: 7,
  Graduated: 8,
  Withdrawn: -1,
};
function maxStatus(a: string, b: string): string {
  const ra = STATUS_ORDER[a] ?? 0;
  const rb = STATUS_ORDER[b] ?? 0;
  return ra >= rb ? a : b;
}

export function CompaniesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const admin = user ? isAdmin(user.email) : false;

  const masterSheetId = getSheetId('companies');
  const selectionSheetId = getSheetId('selection');
  const masterTab = getTab('companies', 'companies');
  const sourceTab = getTab('selection', 'sourceData');

  // Hoisted up front so the Selection-workbook hooks below can lazy-mount
  // when the Review view isn't open. Cuts polling load substantially.
  const [view, setView] = useState<'review' | 'finalize' | 'dashboard' | 'pipeline' | 'roster'>('review');
  const reviewActive = view === 'review' || view === 'finalize';
  // Read-only context tabs barely change; poll them every 5 minutes
  // instead of the default 30 seconds. The user still sees fresh data
  // because every visibility-change fires an immediate refresh.
  const SLOW_POLL = 5 * 60_000;

  const master = useSheetDoc<Master>(
    masterSheetId || null,
    masterTab,
    'company_id',
    { userEmail: user?.email }
  );

  const applicants = useSheetDoc<Applicant>(
    selectionSheetId || null,
    sourceTab,
    'id',
    { userEmail: user?.email }
  );

  // Prior team evaluation context — every relevant tab from the Selection
  // workbook surfaces inline in the Review view so the reviewer sees what
  // the team has already concluded (scoring, doc review notes, interview
  // assessment, interview discussion, committee votes) without having to
  // open the workbook. Read-only here; the Selection tool owns CRUD.
  //
  // Lazy-mounted: only fire the seven extra tab hooks when the Review
  // view is active, AND poll them every 5 minutes instead of every 30
  // seconds. Without this gating each open page burned 7 × 2 = 14
  // requests/minute on context that barely changes — fastest path to
  // hitting the per-100s quota.
  const selSheetId = reviewActive ? (selectionSheetId || null) : null;
  const selOpts = { userEmail: user?.email, intervalMs: SLOW_POLL };
  const scoring = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'scoringMatrix'), 'id', selOpts);
  const docReviews = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'docReviews'), 'id', selOpts);
  const companyNeeds = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'companyNeeds'), 'id', selOpts);
  const interviewAssessments = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'interviewAssessments'), 'id', selOpts);
  const interviewDiscussion = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'interviewDiscussion'), 'id', selOpts);
  const committeeVotes = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'committeeVotes'), 'id', selOpts);
  const selectionVotes = useSheetDoc<Record<string, string>>(selSheetId, getTab('selection', 'selectionVotes'), 'id', selOpts);

  // Intervention Assignments tab — drives the per-card pillar dots and the
  // "(N interventions)" badges on the kanban + roster. The detail page owns
  // the full CRUD; here we only need to read counts and pillar coverage.
  const assignments = useSheetDoc<Assignment>(
    masterSheetId || null,
    getTab('companies', 'assignments'),
    'assignment_id',
    { userEmail: user?.email }
  );

  // Auto-create the team-shared tabs (Reviews / Company Comments / Activity
  // Log / Interview Aliases) on first mount if the workbook doesn't have
  // them yet. The user never has to re-upload the file — the tabs appear
  // in-place with the canonical headers and useSheetDoc starts working
  // immediately. Aliases used to live in localStorage; they're now shared
  // with the team via this sheet tab.
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
        if (!cancelled) setSchemaReady(true);
      } catch (err) {
        // Non-fatal: review view will still render but writes will fail. Surface in console.
        console.warn('[companies] ensureSchema failed', err);
        if (!cancelled) setSchemaReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [masterSheetId]);

  const reviews = useSheetDoc<Review>(
    schemaReady && masterSheetId ? masterSheetId : null,
    getTab('companies', 'reviews'),
    'review_id',
    { userEmail: user?.email }
  );

  const comments = useSheetDoc<CompanyComment>(
    schemaReady && masterSheetId ? masterSheetId : null,
    getTab('companies', 'comments'),
    'comment_id',
    { userEmail: user?.email }
  );

  const aliasesDoc = useSheetDoc<InterviewAlias>(
    schemaReady && masterSheetId ? masterSheetId : null,
    getTab('companies', 'interviewAliases'),
    'alias_id',
    { userEmail: user?.email }
  );

  // Shared exclusion list. Any company name listed here is hidden from
  // every surface — review queue, materialize candidates, joined rows
  // — across all team members. This is the proper way to delete a
  // duplicate or irrelevant entry that otherwise keeps reappearing
  // because it lives in Source Data or the static interviewed list.
  const removedDoc = useSheetDoc<RemovedCompany>(
    schemaReady && masterSheetId ? masterSheetId : null,
    getTab('companies', 'removedCompanies'),
    'removed_id',
    { userEmail: user?.email }
  );

  // Pre-decision Recommendations — sourced from Israa's CSV / Raouf's
  // docx / future seeds via the importer. Used by Final Decision's
  // pre-fill logic.
  const preDecisionsDoc = useSheetDoc<PreDecisionRecommendation>(
    schemaReady && masterSheetId ? masterSheetId : null,
    getTab('companies', 'preDecisions'),
    'recommendation_id',
    { userEmail: user?.email }
  );

  const removedSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of removedDoc.rows) {
      const k = norm(r.company_name || '');
      if (k) s.add(k);
    }
    return s;
  }, [removedDoc.rows]);

  // One-time migration: pull any aliases the user previously saved in
  // localStorage (from before the shared-sheet refactor) and write them
  // to the Interview Aliases tab, then clear the localStorage entry so
  // we never run again. Only fires once the sheet has loaded so we know
  // which entries already exist there. Idempotent — entries already on
  // the sheet are skipped.
  const ALIAS_LEGACY_KEY = 'companies.interviewedAliases.v1';
  const [aliasMigrationRun, setAliasMigrationRun] = useState(false);
  useEffect(() => {
    if (aliasMigrationRun) return;
    if (!schemaReady) return;
    if (aliasesDoc.loading) return;       // wait for first poll
    let raw: string | null = null;
    try { raw = localStorage.getItem(ALIAS_LEGACY_KEY); } catch { /* private mode */ }
    if (!raw) { setAliasMigrationRun(true); return; }
    let parsed: Record<string, string> = {};
    try { parsed = JSON.parse(raw); } catch { setAliasMigrationRun(true); return; }
    const entries = Object.entries(parsed).filter(([k, v]) => k && v);
    if (entries.length === 0) {
      try { localStorage.removeItem(ALIAS_LEGACY_KEY); } catch { /* */ }
      setAliasMigrationRun(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const now = new Date().toISOString();
      let written = 0;
      let skipped = 0;
      for (const [scheduleName, target] of entries) {
        const id = aliasIdFor(scheduleName);
        const exists = aliasesDoc.rows.some(r => r.alias_id === id);
        if (exists) { skipped += 1; continue; }
        try {
          await aliasesDoc.createRow({
            alias_id: id,
            schedule_name: scheduleName,
            applicant_company_name: target,
            created_by: user?.email || '',
            created_at: now,
            updated_at: now,
            updated_by: user?.email || '',
          });
          written += 1;
        } catch (err) {
          console.warn('[alias-migration] failed for', scheduleName, err);
        }
        if (cancelled) return;
      }
      if (!cancelled) {
        try { localStorage.removeItem(ALIAS_LEGACY_KEY); } catch { /* */ }
        if (written > 0) {
          toast.success(`Migrated ${written} alias${written === 1 ? '' : 'es'} from your browser to the shared sheet`,
            skipped > 0 ? `${skipped} were already on the sheet.` : undefined);
        }
        setAliasMigrationRun(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaReady, aliasesDoc.loading]);

  // Static, hand-maintained list of Cohort 3 interviewed companies (see
  // interviewedSource.ts for the why). Used to overlay the "Interviewed"
  // status onto the master sheet without ever demoting a higher status.
  //
  // When a schedule name doesn't spell-match an applicant in Source Data,
  // the user can alias it to the right company. Aliases live in the
  // shared Interview Aliases tab so every team member sees the same set.
  const aliases = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of aliasesDoc.rows) {
      const n = (r.schedule_name || '').trim();
      const t = (r.applicant_company_name || '').trim();
      if (n && t) m[n] = t;
    }
    return m;
  }, [aliasesDoc.rows]);

  const setAlias = async (scheduleName: string, target: string) => {
    const t = (target || '').trim();
    const id = aliasIdFor(scheduleName);
    const existing = aliasesDoc.rows.find(r => r.alias_id === id);
    const now = new Date().toISOString();
    try {
      if (!t) {
        if (existing) await aliasesDoc.deleteRow(id);
        return;
      }
      if (existing) {
        await aliasesDoc.updateRow(id, {
          applicant_company_name: t,
          updated_at: now,
          updated_by: user?.email || '',
        });
      } else {
        await aliasesDoc.createRow({
          alias_id: id,
          schedule_name: scheduleName,
          applicant_company_name: t,
          created_by: user?.email || '',
          created_at: now,
          updated_at: now,
          updated_by: user?.email || '',
        });
      }
      // Auto-materialize the matched company into Companies Master so the
      // alias is reflected in the related sheet immediately, not waiting
      // on someone to click the Materialize banner. Idempotent — if a
      // master row already exists for that company, we leave it alone.
      const targetKey = norm(t);
      if (targetKey) {
        const alreadyInMaster = master.rows.some(m =>
          norm(m.company_name || '') === targetKey
        );
        if (!alreadyInMaster) {
          // Find the source-data applicant by name to seed the master row.
          const applicant = applicants.rows.find(a =>
            norm(a.name || a.companyName || a.company_name || '') === targetKey
          );
          const applicantId = applicant?.id || '';
          const companyId = applicantId ? padId(applicantId) : `E3-${Date.now()}`;
          try {
            await master.createRow({
              company_id: companyId,
              company_name: t,
              cohort: 'E3',
              status: 'Interviewed',
              stage: 'Interviewed',
              sector: applicant?.businessType || '',
              city: applicant?.city || '',
              governorate: '',
              employee_count: applicant?.totalEmployees || '',
              fund_code: '',
              profile_manager_email: '',
            } as Master);
          } catch (err) {
            // Non-fatal — alias still saved, master can be filled in later
            // via the Materialize banner. Surface only as a warning.
            console.warn('[alias→master] auto-materialize failed', err);
          }
        }
      }
    } catch (e) {
      toast.error('Alias save failed', (e as Error).message);
    }
  };
  const interviewedSet = useMemo(() => {
    const s = new Set(INTERVIEWED_NAMES);
    for (const v of Object.values(aliases)) {
      const n = norm(v);
      if (n) s.add(n);
    }
    return s;
  }, [aliases]);

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterDrawerValues>({ pm: [], stage: [], status: [], fund: [] });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // (view state is declared at the top of the component, gating the
  // Selection-workbook hooks for lazy-mounting.)
  const [savedView, setSavedView] = useState<'' | 'mine' | 'unassigned' | 'interviewed' | 'active'>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  // Default scope is the post-interview portfolio — the team's day-to-day
  // work is on companies that already had an interview, where the next move
  // is "decide whether to recommend, and what interventions to assign."
  // Flip this toggle to bring the pre-interview applicants back into view
  // (Applicant / Shortlisted / blank) for an admin-only audit pass.
  // Derived from the FilterDrawer toggle so the chrome and the filter state
  // stay in lockstep. Default = false (post-interview only).
  const includePreInterview = filters.includePreInterview === true;
  // Legacy collapse — kept so the existing FilterBar / chip wiring continues
  // to work, just hidden from the header. Functionally identical to flipping
  // both knobs to "post-interview only", which is now the default.
  const [selectedOnly] = useState(false);
  const SELECTED_STATUSES = ['Selected', 'Onboarded', 'Active', 'Interviewed', 'Reviewing', 'Recommended', 'Graduated'];

  const pms = getProfileManagers();

  // Cohort 3 only — require explicit E3 tag. Blank cohorts are legacy carryover and hidden.
  const masterE3 = useMemo(
    () => master.rows.filter(r => r.cohort && r.cohort.trim().toUpperCase() === 'E3'),
    [master.rows]
  );

  // Build a master-by-name lookup so we can overlay operational fields onto each applicant.
  const masterByName = useMemo(() => {
    const m = new Map<string, Master>();
    for (const row of masterE3) {
      const k = norm(row.company_name);
      if (k) m.set(k, row);
    }
    return m;
  }, [masterE3]);

  // Per-company intervention index: count of assignment rows + the unique
  // set of pillars covered. Drives the kanban dots and roster badge.
  const assignmentsByCompany = useMemo(() => {
    const m = new Map<string, { count: number; pillars: Set<string> }>();
    for (const a of assignments.rows) {
      const id = (a.company_id || '').trim();
      if (!id) continue;
      let bucket = m.get(id);
      if (!bucket) { bucket = { count: 0, pillars: new Set() }; m.set(id, bucket); }
      bucket.count += 1;
      const pillar = pillarFor(a.intervention_type || '')?.code;
      if (pillar) bucket.pillars.add(pillar);
    }
    return m;
  }, [assignments.rows]);

  // Build the joined set: every applicant, plus any Master-only rows that don't match one.
  const joined = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seenMasterIds = new Set<string>();

    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const key = norm(name);
      const m = key ? masterByName.get(key) : undefined;
      if (m?.company_id) seenMasterIds.add(m.company_id);

      // Status resolution:
      // 1) Start with master.status (fallback to 'Applicant' when blank)
      // 2) If the company name is in the interviewed source, lift to at
      //    least 'Interviewed' (never demote a higher status like Onboarded
      //    or Active that the master already has)
      const baseStatus = m?.status?.trim() || 'Applicant';
      const interviewed = isInterviewed(name, interviewedSet);
      const effectiveStatus = interviewed ? maxStatus(baseStatus, 'Interviewed') : baseStatus;

      const companyId = m?.company_id || padId(a.id || '');
      const aBucket = assignmentsByCompany.get(companyId);
      out.push({
        route_id: a.id || padId(a.id) || key,
        applicant_id: a.id || '',
        company_id: companyId,
        company_name: name,
        sector: m?.sector || a.businessType || '',
        city: a.city || m?.city || '',
        governorate: m?.governorate || '',
        employee_count: a.totalEmployees || m?.employee_count || '',
        readiness_score: a.readinessScore || '',
        fund_code: m?.fund_code || '',
        stage: m?.stage || 'Applied',
        status: effectiveStatus,
        profile_manager_email: m?.profile_manager_email || '',
        contact_email: a.contactEmail || a.email || '',
        source: m ? 'both' : 'applicant',
        intervention_count: aBucket?.count || 0,
        intervention_pillars: aBucket ? Array.from(aBucket.pillars) : [],
      });
    }

    // Include Master rows that don't correspond to any applicant (admin-added companies).
    for (const m of masterE3) {
      if (!m.company_id || seenMasterIds.has(m.company_id)) continue;
      const baseStatus = m.status?.trim() || '';
      const interviewed = isInterviewed(m.company_name || '', interviewedSet);
      const effectiveStatus = interviewed ? maxStatus(baseStatus || 'Applicant', 'Interviewed') : baseStatus;
      const aBucket = assignmentsByCompany.get(m.company_id);
      out.push({
        route_id: m.company_id,
        applicant_id: '',
        company_id: m.company_id,
        company_name: m.company_name || '',
        sector: m.sector || '',
        city: m.city || '',
        governorate: m.governorate || '',
        employee_count: m.employee_count || '',
        readiness_score: '',
        fund_code: m.fund_code || '',
        stage: m.stage || '',
        status: effectiveStatus,
        profile_manager_email: m.profile_manager_email || '',
        contact_email: '',
        source: 'master',
        intervention_count: aBucket?.count || 0,
        intervention_pillars: aBucket ? Array.from(aBucket.pillars) : [],
      });
    }

    // Apply the shared exclusion list — any name on the Removed
    // Companies tab is hidden from every downstream surface, including
    // the materialize queue. This is the canonical way to delete a
    // duplicate that would otherwise keep reappearing from Source
    // Data or the static interviewed list.
    return out.filter(r => !removedSet.has(norm(r.company_name)));
  }, [applicants.rows, masterE3, masterByName, interviewedSet, assignmentsByCompany, removedSet]);

  // The "include pre-interview" toggle is the primary scope knob; the
  // saved-view chips and the legacy Selected-only collapse compose on top.
  const userEmail = (user?.email || '').toLowerCase();
  const scoped = useMemo(() => {
    if (includePreInterview) return joined;
    return joined.filter(r => POST_INTERVIEW_STATUSES.has(r.status));
  }, [joined, includePreInterview]);

  const filteredBySavedView = useMemo(() => {
    switch (savedView) {
      case 'mine':
        return scoped.filter(r => (r.profile_manager_email || '').toLowerCase() === userEmail);
      case 'unassigned':
        return scoped.filter(r => !r.profile_manager_email);
      case 'interviewed':
        return scoped.filter(r => isInterviewed(r.company_name, interviewedSet));
      case 'active':
        return scoped.filter(r => r.status === 'Active' || r.status === 'Onboarded');
      default:
        return scoped;
    }
  }, [savedView, scoped, userEmail, interviewedSet]);

  const filteredBySelection = useMemo(() => {
    if (!selectedOnly) return filteredBySavedView;
    return filteredBySavedView.filter(r => SELECTED_STATUSES.includes(r.status));
  }, [filteredBySavedView, selectedOnly]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pm = (filters.pm as string[] | undefined) || [];
    const stage = (filters.stage as string[] | undefined) || [];
    const status = (filters.status as string[] | undefined) || [];
    const fund = typeof filters.fund === 'string' ? filters.fund : '';
    return filteredBySelection.filter(r => {
      if (pm.length > 0) {
        const key = r.profile_manager_email || '__unassigned__';
        if (!pm.includes(key)) return false;
      }
      if (stage.length > 0 && !stage.includes(r.stage)) return false;
      if (status.length > 0 && !status.includes(r.status)) return false;
      if (fund && r.fund_code !== fund) return false;
      if (q) {
        return [r.company_name, r.company_id, r.sector, r.governorate, r.city, r.status, r.stage]
          .some(v => (v || '').toLowerCase().includes(q));
      }
      return true;
    });
  }, [filteredBySelection, query, filters]);

  const counts = useMemo(() => {
    const byPm = new Map<string, number>();
    const byStage = new Map<string, number>();
    const byStatus = new Map<string, number>();
    const byFund = new Map<string, number>();
    for (const r of joined) {
      const pmKey = r.profile_manager_email || '__unassigned__';
      byPm.set(pmKey, (byPm.get(pmKey) || 0) + 1);
      if (r.stage) byStage.set(r.stage, (byStage.get(r.stage) || 0) + 1);
      if (r.status) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
      if (r.fund_code) byFund.set(r.fund_code, (byFund.get(r.fund_code) || 0) + 1);
    }
    return { byPm, byStage, byStatus, byFund, total: joined.length, filtered: filtered.length };
  }, [joined, filtered.length]);

  const filterFields: FilterFieldDef[] = useMemo(() => [
    {
      key: 'includePreInterview',
      type: 'toggle',
      label: 'Include pre-interview',
      hint: 'Bring Applicant + Shortlisted lanes back into view (defaults to post-interview only).',
    },
    {
      key: 'status',
      type: 'multiselect',
      label: 'Status',
      options: STATUSES.map(s => ({ value: s, label: s, count: counts.byStatus.get(s) || 0 })),
    },
    {
      key: 'pm',
      type: 'multiselect',
      label: 'Profile Manager',
      options: [
        { value: '__unassigned__', label: 'Unassigned', count: counts.byPm.get('__unassigned__') || 0 },
        ...pms.map(pm => ({ value: pm.email, label: pm.name, count: counts.byPm.get(pm.email) || 0 })),
      ],
    },
    {
      key: 'fund',
      type: 'chips',
      label: 'Fund',
      options: FUND_CODES.map(f => ({
        value: f,
        label: f === '97060' ? 'Dutch' : 'SIDA',
        count: counts.byFund.get(f) || 0,
      })),
    },
    {
      key: 'stage',
      type: 'multiselect',
      label: 'Stage',
      options: STAGES.map(s => ({ value: s, label: s, count: counts.byStage.get(s) || 0 })),
    },
  ], [pms, counts]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    for (const f of filterFields) {
      const v = filters[f.key];
      if (Array.isArray(v)) n += v.length;
      else if (typeof v === 'string' && v) n += 1;
      else if (v === true) n += 1;
    }
    if (query) n += 1;
    return n;
  }, [filterFields, filters, query]);

  const columns: Column<Row>[] = [
    {
      key: 'company_name',
      header: 'Company',
      render: r => (
        <div className="flex items-center gap-3">
          <CompanyAvatar name={r.company_name} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy-500 dark:text-white">{r.company_name || '—'}</div>
            <div className="truncate text-xs text-slate-500">
              {[r.sector, [r.city, r.governorate].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'employee_count',
      header: 'Team',
      width: '72px',
      render: r => (
        <span className="inline-flex items-center gap-1 text-sm">
          <Users className="h-3.5 w-3.5 text-slate-400" />
          {r.employee_count || '—'}
        </span>
      ),
    },
    {
      key: 'stage',
      header: 'Stage / Status',
      render: r => (
        <div className="flex flex-col gap-1">
          <Badge tone={statusTone(r.status)}>{r.status || 'Unset'}</Badge>
          {r.stage && <span className="text-[11px] text-slate-500">{r.stage}</span>}
        </div>
      ),
    },
    {
      key: 'fund_code',
      header: 'Fund',
      width: '100px',
      render: r => {
        if (!r.fund_code) return <span className="text-slate-400">—</span>;
        const dutch = r.fund_code === '97060';
        return (
          <Badge tone={dutch ? 'teal' : 'amber'}>
            {dutch ? 'Dutch' : 'SIDA'}
          </Badge>
        );
      },
    },
    {
      key: 'profile_manager_email',
      header: 'Profile Manager',
      render: r => {
        if (!r.profile_manager_email) {
          return <span className="text-xs text-slate-400">Unassigned</span>;
        }
        const name = displayName(r.profile_manager_email);
        return (
          <div className="flex items-center gap-2">
            <PMInitials name={name} />
            <span className="text-sm font-medium">{name}</span>
          </div>
        );
      },
    },
    {
      key: 'intervention_count',
      header: 'Interventions',
      width: '160px',
      render: r => {
        if (r.intervention_count === 0) {
          return <span className="text-xs text-slate-400 italic">none yet</span>;
        }
        return (
          <div
            className="inline-flex items-center gap-1.5"
            title={r.intervention_pillars.length ? r.intervention_pillars.join(', ') : undefined}
          >
            <span className="text-sm font-semibold text-navy-500 dark:text-slate-100">{r.intervention_count}</span>
            <div className="flex items-center gap-0.5">
              {r.intervention_pillars.map(p => (
                <span
                  key={p}
                  title={p}
                  className={`inline-block h-2 w-2 rounded-full ${PILLAR_DOT_COLOR[p] || 'bg-slate-400'}`}
                />
              ))}
            </div>
          </div>
        );
      },
    },
    {
      key: '_reviews',
      header: 'Reviews',
      width: '160px',
      render: r => {
        const s = reviewSummaryByCompany.get(r.company_id);
        if (!s || s.total === 0) {
          return <span className="text-xs text-slate-400 italic">no reviews</span>;
        }
        const tone =
          s.consensus === 'Recommend' ? 'green' :
          s.consensus === 'Reject' ? 'red' :
          s.consensus === 'Hold' ? 'amber' : 'amber';
        return (
          <div className="flex items-center gap-1.5">
            <Badge tone={tone as Tone}>{s.total}× {s.consensus}</Badge>
            {s.divergence && (
              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300" title="Divergent reviews">
                divergent
              </span>
            )}
          </div>
        );
      },
    },
  ];

  if (!masterSheetId && !selectionSheetId) {
    return (
      <Card>
        <CardHeader title="Companies" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_SELECTION</code> and{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SHEET_COMPANIES</code> in your environment, then reload.
        </p>
      </Card>
    );
  }

  const loading = applicants.loading || master.loading;
  const error = applicants.error || master.error;

  // Bulk actions on selected rows.
  const handleBulkSetStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Set status to "${status}" for ${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}?`)) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        const m = master.rows.find(r => r.company_id === id);
        if (!m) continue;
        try { await master.updateRow(id, { status } as Partial<Master>); ok += 1; }
        catch (err) { console.warn('[companies] bulk status skipped', id, err); }
      }
      toast.success('Bulk update', `${ok} of ${ids.length} updated to ${status}`);
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const handleBulkAssignPM = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const pmEmail = window.prompt('Profile Manager email (e.g. doaa@gazaskygeeks.com):');
    if (!pmEmail) return;
    setBulkRunning(true);
    let ok = 0;
    try {
      for (const id of ids) {
        try { await master.updateRow(id, { profile_manager_email: pmEmail } as Partial<Master>); ok += 1; }
        catch (err) { console.warn('[companies] bulk PM skipped', id, err); }
      }
      toast.success('Bulk assign', `${ok} of ${ids.length} assigned to ${pmEmail}`);
      setSelectedIds(new Set());
    } finally {
      setBulkRunning(false);
    }
  };

  const interviewedCount = useMemo(
    () => joined.filter(r => isInterviewed(r.company_name, interviewedSet)).length,
    [joined, interviewedSet]
  );

  // Interviewed companies that exist in Source Data but DON'T yet have a
  // row in the Companies Master sheet. The Materialize button below
  // creates those rows in one go so the master reflects the actual
  // post-interview cohort and direct edits on the sheet have somewhere
  // to attach. Idempotent — already-materialized companies are skipped.
  // The dedup check uses ALL master rows (not just E3-tagged). The
  // previous bug: masterByName was scoped to cohort=='E3', so any
  // pre-existing master row without an E3 tag (or with empty cohort)
  // was invisible — and materialize wrote a duplicate. This map keys
  // on both company_id AND normalized company_name so name drift
  // between Source Data and a hand-edited master row still matches.
  const allMasterIndex = useMemo(() => {
    const byId = new Map<string, Master>();
    const byName = new Map<string, Master>();
    for (const m of master.rows) {
      const id = (m.company_id || '').trim();
      const nm = norm(m.company_name || '');
      if (id) byId.set(id, m);
      if (nm) byName.set(nm, m);
    }
    return { byId, byName };
  }, [master.rows]);

  const needsMaterialize = useMemo(() => {
    return joined.filter(r => {
      if (!isInterviewed(r.company_name, interviewedSet)) return false;
      // Check ALL master rows by id and by name. If either matches, the
      // company already has a row and we should NOT re-create it.
      if (r.company_id && allMasterIndex.byId.has(r.company_id)) return false;
      const nm = norm(r.company_name);
      if (nm && allMasterIndex.byName.has(nm)) return false;
      return true;
    });
  }, [joined, interviewedSet, allMasterIndex]);

  const [materializing, setMaterializing] = useState(false);
  const [repairingDash, setRepairingDash] = useState(false);
  const handleRepairDashboard = async () => {
    if (!admin || !masterSheetId) return;
    setRepairingDash(true);
    try {
      const res = await repairDashboard(masterSheetId);
      if (res.errors.length === 0) {
        toast.success('Dashboard rebuilt', `Wrote ${res.rowsWritten} rows of canonical formulas to the Dashboard tab.`);
      } else {
        toast.error('Dashboard rebuild had errors', res.errors[0]);
      }
    } catch (e) {
      toast.error('Dashboard rebuild failed', (e as Error).message);
    } finally {
      setRepairingDash(false);
    }
  };

  // Import external comments + Pre-decision Recommendations from the
  // /external-comments-seed.json file produced by
  // sheet-builders/tools/import_external_comments.py. Idempotent —
  // already-imported entries are skipped.
  const [importingExt, setImportingExt] = useState(false);
  const handleImportExternal = async () => {
    if (!masterSheetId) return;
    setImportingExt(true);
    try {
      const seed = await loadSeed();
      if (!seed) {
        toast.error('Seed missing', 'Could not load /external-comments-seed.json. Re-run the Python parser.');
        return;
      }
      // Build a candidate list for fuzzy resolution: every interviewed
      // company (joined view) plus every master row that has a name
      // even if not interviewed.
      const candidates = joined.map(r => ({ company_id: r.company_id, company_name: r.company_name }));
      const resolve = (name: string) => fuzzyResolve(name, candidates);
      const result = await importExternalSeed(seed, {
        resolve,
        existingComments: comments.rows,
        existingRecs: preDecisionsDoc.rows,
        createComment: row => comments.createRow(row),
        createRecommendation: row => preDecisionsDoc.createRow(row),
      });
      const lines: string[] = [];
      lines.push(`${result.commentsAdded} comments + ${result.recsAdded} recommendations imported.`);
      if (result.commentsSkipped + result.recsSkipped > 0) {
        lines.push(`Skipped ${result.commentsSkipped + result.recsSkipped} already-present entries.`);
      }
      if (result.commentsUnmatched.length + result.recsUnmatched.length > 0) {
        const unmatched = Array.from(new Set([...result.commentsUnmatched, ...result.recsUnmatched])).slice(0, 6).join(', ');
        lines.push(`${result.commentsUnmatched.length + result.recsUnmatched.length} unmatched names (e.g. ${unmatched}). Add aliases or fix spelling.`);
      }
      if (result.errors.length > 0) {
        lines.push(`${result.errors.length} write error(s). Check console.`);
        console.warn('[importExternal] errors', result.errors);
      }
      toast.success('Import complete', lines.join(' '));
      await comments.refresh();
      await preDecisionsDoc.refresh();
    } catch (e) {
      toast.error('Import failed', (e as Error).message);
    } finally {
      setImportingExt(false);
    }
  };

  const handleMaterialize = async () => {
    if (!admin) return;
    if (needsMaterialize.length === 0) return;
    setMaterializing(true);
    // Track in-loop creations so a follow-up row with the same name doesn't
    // sneak past the dedup check before the next master.refresh() lands.
    const seenIds = new Set<string>(allMasterIndex.byId.keys());
    const seenNames = new Set<string>(allMasterIndex.byName.keys());
    let created = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const r of needsMaterialize) {
        const id = (r.company_id || '').trim();
        const nm = norm(r.company_name);
        if ((id && seenIds.has(id)) || (nm && seenNames.has(nm))) {
          skipped += 1;
          continue;
        }
        try {
          await master.createRow({
            company_id: r.company_id,
            company_name: r.company_name,
            cohort: 'E3',
            status: r.status || 'Interviewed',
            stage: r.stage || 'Interviewed',
            sector: r.sector || '',
            city: r.city || '',
            governorate: r.governorate || '',
            employee_count: r.employee_count || '',
            fund_code: r.fund_code || '',
            profile_manager_email: r.profile_manager_email || '',
          } as Master);
          if (id) seenIds.add(id);
          if (nm) seenNames.add(nm);
          created += 1;
        } catch (e) {
          failed += 1;
          console.warn('[materialize] failed for', r.company_name, e);
        }
      }
      if (created > 0) {
        toast.success(`Materialized ${created} compan${created === 1 ? 'y' : 'ies'} into Master`,
          [
            skipped > 0 ? `${skipped} already had a row` : '',
            failed > 0 ? `${failed} failed (likely permission)` : '',
          ].filter(Boolean).join(' · '));
      } else if (failed > 0) {
        toast.error('Materialize failed', `${failed} write${failed === 1 ? '' : 's'} rejected. Check Drive sharing.`);
      }
      await master.refresh();
    } finally {
      setMaterializing(false);
    }
  };

  // Auto-dedupe master sheet — same pattern as advisors. Detects rows
  // sharing a company_id OR a normalized company_name, removes the
  // older copies (latest updated_at wins). Admin-only, runs once per
  // page load, surfaces a toast on completion.
  const [masterDedupRan, setMasterDedupRan] = useState(false);
  useEffect(() => {
    if (masterDedupRan) return;
    if (!admin) return;
    if (master.loading) return;
    if (master.rows.length === 0) { setMasterDedupRan(true); return; }

    // Build groups: each duplicate group = list of rows with same id or name.
    const byId = new Map<string, Master[]>();
    const byName = new Map<string, Master[]>();
    for (const m of master.rows) {
      const id = (m.company_id || '').trim();
      const nm = norm(m.company_name || '');
      if (id) (byId.get(id) || byId.set(id, []).get(id)!).push(m);
      if (nm) (byName.get(nm) || byName.set(nm, []).get(nm)!).push(m);
    }
    const losers: Master[] = [];
    const flagged = new Set<Master>();
    const flagLosers = (group: Master[]) => {
      if (group.length < 2) return;
      // Keep the row with the most recent updated_at (lexicographic ISO
      // strings sort correctly), or the LAST one if all are blank — that's
      // the freshest sheet-row.
      const sorted = [...group].sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
      const winner = sorted[sorted.length - 1];
      for (const r of group) {
        if (r === winner) continue;
        if (flagged.has(r)) continue;
        flagged.add(r);
        losers.push(r);
      }
    };
    for (const g of byId.values()) flagLosers(g);
    for (const g of byName.values()) flagLosers(g);

    if (losers.length === 0) {
      setMasterDedupRan(true);
      return;
    }
    setMasterDedupRan(true);
    let cancelled = false;
    (async () => {
      let removed = 0;
      for (const l of losers) {
        if (cancelled) return;
        try {
          if (l.company_id) {
            await master.deleteRow(l.company_id);
            removed += 1;
          }
        } catch (err) {
          console.warn('[master-dedup] failed to remove duplicate', l.company_name, err);
        }
      }
      if (!cancelled && removed > 0) {
        toast.success(`Auto-removed ${removed} duplicate master row${removed === 1 ? '' : 's'}`,
          'Kept the most recently updated copy of each company.');
        await master.refresh();
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, master.loading, master.rows.length, masterDedupRan]);

  // Surface every interview-list name that did NOT find a match against any
  // applicant in Source Data. These are either spelling drift (fix the static
  // list or alias them inline below) or genuinely missing applicants (Phase 4
  // Day 2 had a few with no info). Aliases count as matched.
  const unmatchedInterviewed = useMemo(() => {
    const have = new Set(joined.map(r => norm(r.company_name)));
    return INTERVIEWED_RAW.filter(name => {
      const aliasTarget = aliases[name];
      if (aliasTarget && have.has(norm(aliasTarget))) return false;
      const k = norm(name);
      if (!k) return false;
      if (have.has(k)) return false;
      for (const h of have) {
        if (h.length < 4) continue;
        if (h.includes(k) || k.includes(h)) return false;
      }
      return true;
    });
  }, [joined, aliases]);
  const [showUnmatched, setShowUnmatched] = useState(false);

  // All applicant company names sorted, for the alias picker datalist.
  const applicantOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of joined) {
      const n = (r.company_name || '').trim();
      if (!n) continue;
      const k = norm(n);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [joined]);

  // Names that already got an alias the user has set — shown as "mapped" rows
  // separately so the user can see and clear them.
  const mappedAliases = useMemo(
    () => INTERVIEWED_RAW.filter(n => aliases[n]),
    [aliases]
  );

  // Per-company review aggregation — drives the kanban consensus chip and
  // the Roster review-status column. Indexed by company_id.
  const reviewSummaryByCompany = useMemo(() => {
    const m = new Map<string, ReviewSummary>();
    const grouped = new Map<string, Review[]>();
    for (const r of reviews.rows) {
      if (!r.company_id) continue;
      const arr = grouped.get(r.company_id) || [];
      arr.push(r);
      grouped.set(r.company_id, arr);
    }
    for (const [cid, arr] of grouped) m.set(cid, summarizeReviews(arr));
    return m;
  }, [reviews.rows]);

  // Apply review-aware count for the Review tab — companies still needing
  // *any* review by *anyone*. Shown as the small badge on the tab.
  const reviewableCompanies = filteredBySelection;
  const reviewedAnyone = useMemo(
    () => reviewableCompanies.filter(c => (reviewSummaryByCompany.get(c.company_id)?.total || 0) > 0).length,
    [reviewableCompanies, reviewSummaryByCompany]
  );

  // Final decision unlocks once every company in scope has at least
  // one team review. Admin-only — non-admins still see the tab so
  // they know it's coming, but it routes to a "still gathering reviews"
  // state in the view itself.
  const finalReady = reviewableCompanies.length > 0 && reviewedAnyone === reviewableCompanies.length;

  const tabs: TabItem[] = [
    { value: 'review', label: `Review · ${reviewedAnyone}/${reviewableCompanies.length}`, icon: <MessageCircle className="h-4 w-4" /> },
    {
      value: 'finalize',
      label: finalReady ? `Final Decision · ready` : `Final Decision · ${reviewableCompanies.length - reviewedAnyone} left`,
      icon: <BarChart3 className="h-4 w-4" />,
      disabled: !finalReady,
    },
    { value: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
    { value: 'pipeline', label: 'Pipeline', icon: <KanbanIcon className="h-4 w-4" />, count: counts.total },
    { value: 'roster', label: 'Roster', icon: <TableIcon className="h-4 w-4" />, count: counts.filtered },
  ];

  // Build the applicants-by-name lookup — needed by the Review view to
  // surface the Source Data application snapshot for each company.
  const applicantByName = useMemo(() => {
    const m = new Map<string, Applicant>();
    for (const a of applicants.rows) {
      const name = a.name || a.companyName || a.company_name || '';
      const k = norm(name);
      if (k) m.set(k, a);
    }
    return m;
  }, [applicants.rows]);

  const masterById = useMemo(() => {
    const m = new Map<string, Master>();
    for (const r of masterE3) if (r.company_id) m.set(r.company_id, r);
    return m;
  }, [masterE3]);

  // Index every Selection tab once, so per-company context lookups are O(1).
  const scoringIdx = useMemo(() => indexByCompanyName(scoring.rows), [scoring.rows]);
  const docReviewIdx = useMemo(() => indexByCompanyName(docReviews.rows), [docReviews.rows]);
  const needsIdx = useMemo(() => indexByCompanyName(companyNeeds.rows), [companyNeeds.rows]);
  const interviewAssessIdx = useMemo(() => indexByCompanyName(interviewAssessments.rows), [interviewAssessments.rows]);
  const interviewDiscIdx = useMemo(() => indexByCompanyName(interviewDiscussion.rows), [interviewDiscussion.rows]);
  const committeeIdx = useMemo(() => indexByCompanyName(committeeVotes.rows), [committeeVotes.rows]);
  const selectionVotesIdx = useMemo(() => indexByCompanyName(selectionVotes.rows), [selectionVotes.rows]);

  const reviewableForView: ReviewableCompany[] = useMemo(() => {
    return reviewableCompanies.map(r => {
      const selection: SelectionContext = {
        scoring: lookupByName(scoringIdx, r.company_name),
        docReview: lookupByName(docReviewIdx, r.company_name),
        needs: lookupByName(needsIdx, r.company_name),
        interviewAssessment: lookupByName(interviewAssessIdx, r.company_name),
        interviewDiscussion: lookupByName(interviewDiscIdx, r.company_name),
        committeeVotes: lookupByName(committeeIdx, r.company_name),
        selectionVotes: lookupByName(selectionVotesIdx, r.company_name),
      };
      return {
        route_id: r.route_id,
        applicant_id: r.applicant_id,
        company_id: r.company_id,
        company_name: r.company_name,
        sector: r.sector,
        city: r.city,
        governorate: r.governorate,
        employee_count: r.employee_count,
        readiness_score: r.readiness_score,
        fund_code: r.fund_code,
        status: r.status,
        profile_manager_email: r.profile_manager_email,
        contact_email: r.contact_email,
        applicantRaw: applicantByName.get(norm(r.company_name)) || null,
        masterRaw: (masterById.get(r.company_id) as unknown as Record<string, string>) || null,
        selection,
      };
    });
  }, [reviewableCompanies, applicantByName, masterById, scoringIdx, docReviewIdx, needsIdx, interviewAssessIdx, interviewDiscIdx, committeeIdx, selectionVotesIdx]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Companies"
        badges={[
          { label: `${joined.length} cohort 3`, tone: 'teal' },
          ...(interviewedSet.size > 0
            ? [{
                label: `${interviewedCount} / ${
                  // Denominator subtracts removed names so the badge
                  // reads e.g. 51/51 after one is excluded, not 51/52.
                  INTERVIEWED_RAW.filter(n => !removedSet.has(norm(n))).length
                } interviewed`,
                tone: 'amber' as Tone,
              }]
            : []),
          ...(unmatchedInterviewed.length > 0
            ? [{
                key: 'unmatched',
                label: (
                  <button
                    type="button"
                    onClick={() => setShowUnmatched(s => !s)}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    {unmatchedInterviewed.length} unmatched
                  </button>
                ),
                tone: 'amber' as Tone,
              }]
            : []),
        ]}
        actions={
          <>
            <FilterToggleButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
            <Button variant="ghost" onClick={() => { applicants.refresh(); master.refresh(); assignments.refresh(); }} title="Reload">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadCsv(timestampedFilename('companies'), filteredBySelection as unknown as Record<string, unknown>[])}
              disabled={filteredBySelection.length === 0}
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </>
        }
      />

      {showUnmatched && (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30">
          <datalist id="applicant-options">
            {applicantOptions.map(n => (<option key={n} value={n} />))}
          </datalist>
          {unmatchedInterviewed.length > 0 ? (
            <>
              <h3 className="mb-2 text-sm font-bold text-amber-900 dark:text-amber-200">
                {unmatchedInterviewed.length} schedule name{unmatchedInterviewed.length === 1 ? '' : 's'} didn't match — pick the right Source Data company for each
              </h3>
              <div className="space-y-1.5">
                {unmatchedInterviewed.map(name => (
                  <div key={name} className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="min-w-[14rem] flex-1 truncate font-medium" title={name}>{name}</div>
                    <span className="text-amber-700 dark:text-amber-300">→</span>
                    <input
                      type="text"
                      list="applicant-options"
                      placeholder="Type or pick an applicant…"
                      defaultValue={aliases[name] || ''}
                      onBlur={e => setAlias(name, e.currentTarget.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="min-w-[16rem] flex-1 rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm font-semibold text-emerald-700">All schedule names matched.</p>
          )}
          {mappedAliases.length > 0 && (
            <div className="mt-3 border-t border-amber-200 pt-2 dark:border-amber-900">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                {mappedAliases.length} mapped alias{mappedAliases.length === 1 ? '' : 'es'}
              </h4>
              <div className="space-y-1">
                {mappedAliases.map(name => (
                  <div key={name} className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="min-w-[14rem] flex-1 truncate" title={name}>{name}</div>
                    <span className="text-emerald-700 dark:text-emerald-300">→</span>
                    <div className="min-w-[16rem] flex-1 truncate font-medium text-emerald-800 dark:text-emerald-200" title={aliases[name]}>{aliases[name]}</div>
                    <button
                      type="button"
                      onClick={() => setAlias(name, '')}
                      className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px] hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
                    >
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-amber-800 opacity-80 dark:text-amber-300">
            Saved to the shared Interview Aliases tab — every team member sees the same matches and the matched company auto-materializes into Master.
          </p>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
      )}

      {/* Admin maintenance strip — Materialize + Repair Dashboard. Each
          chip shows up only when actually useful. */}
      {admin && (needsMaterialize.length > 0 || true) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {needsMaterialize.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-1.5 dark:border-amber-900 dark:bg-amber-950/30">
              <span className="font-bold text-amber-900 dark:text-amber-200">
                {needsMaterialize.length} interviewed compan{needsMaterialize.length === 1 ? 'y' : 'ies'} not yet in Master
              </span>
              <Button size="sm" variant="ghost" onClick={handleMaterialize} disabled={materializing}>
                {materializing ? 'Writing…' : 'Materialize'}
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-navy-700 dark:bg-navy-800">
            <span className="text-slate-600 dark:text-slate-300">Master Dashboard tab</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRepairDashboard}
              disabled={repairingDash}
              title="Overwrite the Dashboard tab with canonical COUNTIF formulas covering every current status (Interviewed / Reviewing / Recommended / Selected / Onboarded / Active / Graduated / Withdrawn) plus reviews + interventions"
            >
              {repairingDash ? 'Rebuilding…' : 'Repair'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-slate-500">Quick views:</span>
        {([
          { id: '', label: 'All' },
          { id: 'mine', label: 'My portfolio' },
          { id: 'interviewed', label: `Interviewed (${interviewedCount})` },
          { id: 'active', label: `Active + Onboarded (${joined.filter(r => r.status === 'Active' || r.status === 'Onboarded').length})` },
          { id: 'unassigned', label: `Unassigned (${joined.filter(r => !r.profile_manager_email).length})` },
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
      </div>

      <Tabs items={tabs} value={view} onChange={v => setView(v as typeof view)} />

      {view === 'review' && (
        <ReviewView
          companies={reviewableForView}
          reviews={reviews.rows}
          comments={comments.rows}
          reviewerEmail={user?.email || ''}
          isAdmin={admin}
          profileManagers={pms}
          onSaveReview={async r => {
            const lower = r.reviewer_email.toLowerCase();
            const existing = reviews.rows.find(x =>
              x.company_id === r.company_id &&
              x.reviewer_email.toLowerCase() === lower
            );
            if (existing) {
              await reviews.updateRow(existing.review_id, r);
            } else {
              await reviews.createRow(r);
            }
          }}
          onAddComment={async c => { await comments.createRow(c); }}
          onAssignPM={async (companyId, pmEmail) => {
            // Upsert the master row's PM assignment. If the company is
            // applicant-only (synthesized id), create a master row first
            // so the assignment has somewhere to land.
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
          }}
          onFinalize={async ({ companyId, pmEmail, status, interventions }) => {
            // 1) Lock the master row (status + optional PM). Create if needed.
            const existing = master.rows.find(m => m.company_id === companyId);
            const c = reviewableForView.find(c => c.company_id === companyId);
            if (!c) throw new Error('Company not found');
            if (existing) {
              await master.updateRow(companyId, {
                status,
                ...(pmEmail !== undefined ? { profile_manager_email: pmEmail } : {}),
              });
            } else {
              await master.createRow({
                company_id: companyId,
                company_name: c.company_name,
                cohort: 'E3',
                status,
                profile_manager_email: pmEmail || '',
                sector: c.sector || '',
                city: c.city || '',
                governorate: c.governorate || '',
                fund_code: c.fund_code || '',
              } as Master);
            }

            // 2) Materialize each intervention as an assignment row. We don't
            // delete prior assignments — a re-finalize is additive so any
            // edits the team already made on the assignments tab are safe.
            const now = new Date().toISOString();
            const existingPairs = new Set(
              assignments.rows
                .filter(a => a.company_id === companyId)
                .map(a => `${a.intervention_type}::${a.sub_intervention || ''}`)
            );
            for (const i of interventions) {
              const key = `${i.pillar}::${i.sub || ''}`;
              if (existingPairs.has(key)) continue;
              await assignments.createRow({
                assignment_id: `asn-${companyId}-${i.pillar}-${i.sub || 'all'}-${now}`,
                company_id: companyId,
                intervention_type: i.pillar,
                sub_intervention: i.sub || '',
                fund_code: c.fund_code || '',
                status: 'Planned',
                start_date: '',
                end_date: '',
                owner_email: pmEmail || c.profile_manager_email || '',
                budget_usd: '',
                notes: '',
              } as Assignment);
            }
          }}
          onJumpToCompany={rid => navigate(`/companies/${encodeURIComponent(rid)}`)}
          onRemoveCompany={async (companyId, companyName) => {
            // System-wide hide. Three steps:
            //  1) Add the name to the shared Removed Companies tab so
            //     every team member's joined / needsMaterialize / etc.
            //     filters skip it.
            //  2) Delete the master row (if any) so the sheet stops
            //     showing it.
            //  3) Delete any alias whose target was this name so
            //     auto-materialize never re-creates it.
            // Source Data in the Selection workbook is read-only and
            // not touched; the exclusion list is what makes the hide
            // stick.
            const ok = window.confirm(
              `Remove "${companyName}" from the system?\n\n` +
              `Adds it to the shared Removed Companies tab so it disappears from every team member's view, ` +
              `deletes the master row + matching alias, and stops it from being re-created on next materialize. ` +
              `Source Data in the Selection workbook is read-only and not touched.`
            );
            if (!ok) return;
            try {
              const now = new Date().toISOString();
              const id = removedIdFor(companyName);
              // Step 1: shared exclusion record (idempotent — upsert).
              const existing = removedDoc.rows.find(r => r.removed_id === id);
              if (existing) {
                await removedDoc.updateRow(id, {
                  company_name: companyName,
                  removed_by: user?.email || '',
                  removed_at: now,
                });
              } else {
                await removedDoc.createRow({
                  removed_id: id,
                  company_name: companyName,
                  removed_by: user?.email || '',
                  removed_at: now,
                  reason: '',
                });
              }
              // Step 2: master row.
              if (companyId && master.rows.some(m => m.company_id === companyId)) {
                await master.deleteRow(companyId);
              }
              // Also catch any other master rows that share the name
              // (handles duplicates with different IDs).
              const targetKey = norm(companyName);
              for (const m of master.rows) {
                if (m.company_id === companyId) continue;
                if (norm(m.company_name || '') === targetKey && m.company_id) {
                  try { await master.deleteRow(m.company_id); } catch { /* keep going */ }
                }
              }
              // Step 3: alias rows pointing at this name.
              for (const a of aliasesDoc.rows) {
                if (norm(a.applicant_company_name || '') === targetKey) {
                  try { await aliasesDoc.deleteRow(a.alias_id); } catch { /* keep going */ }
                }
              }
              toast.success('Removed', `${companyName} hidden from the system across the team.`);
              await master.refresh();
            } catch (e) {
              toast.error('Remove failed', (e as Error).message);
            }
          }}
        />
      )}

      {view === 'finalize' && (
        <FinalDecisionView
          companies={reviewableForView}
          reviews={reviews.rows}
          reviewerEmail={user?.email || ''}
          existingAssignments={assignments.rows.map(a => ({
            company_id: a.company_id,
            intervention_type: a.intervention_type,
            sub_intervention: a.sub_intervention,
            fund_code: a.fund_code,
          }))}
          onExport={async () => {
            if (!masterSheetId) throw new Error('No companies workbook configured');
            return exportReviewToSheet(masterSheetId, {
              companies: reviewableForView,
              reviews: reviews.rows,
              comments: comments.rows,
              assignments: assignments.rows as unknown as Record<string, string>[],
            }, user?.email || 'unknown');
          }}
          comments={comments.rows}
          preDecisions={preDecisionsDoc.rows}
          onImportExternal={admin ? handleImportExternal : undefined}
          importingExternal={importingExt}
          onLockDecision={async (args: FinalLockArgs) => {
            const c = reviewableForView.find(x => x.company_id === args.companyId);
            if (!c) throw new Error('Company not found');
            // Upsert master row.
            const existing = master.rows.find(m => m.company_id === args.companyId);
            // Determine the company-level fund_code: first per-pillar fund picked,
            // so the master sheet's status panel still shows a representative fund.
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
            // Materialize the per-pillar Intervention Assignment rows.
            const now = new Date().toISOString();
            const existingPairs = new Set(
              assignments.rows
                .filter(a => a.company_id === args.companyId)
                .map(a => `${a.intervention_type}::${a.sub_intervention || ''}`)
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
            await master.refresh();
            await assignments.refresh();
          }}
        />
      )}

      {view === 'dashboard' && (
        <CompanyDashboard
          rows={filteredBySavedView}
          interviewedCount={interviewedCount}
          loading={loading}
        />
      )}

      {view === 'pipeline' && (
        <CompanyPipelineKanban
          rows={filteredBySelection}
          reviewSummaryByCompany={reviewSummaryByCompany}
          onCardClick={r => navigate(`/companies/${encodeURIComponent(r.route_id)}`)}
          includePreInterview={includePreInterview}
        />
      )}

      {view === 'roster' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing <span className="font-bold text-navy-500 dark:text-slate-100">{counts.filtered}</span> of {counts.total} companies
            </span>
            <FilterToggleButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
          </div>
          {selectedIds.size > 0 && admin && (
            <Card accent="teal">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-navy-500 dark:text-white">{selectedIds.size} selected</span>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Reviewing')} disabled={bulkRunning}>→ Reviewing</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Recommended')} disabled={bulkRunning}>→ Recommended</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Selected')} disabled={bulkRunning}>→ Selected</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Onboarded')} disabled={bulkRunning}>→ Onboarded</Button>
                <Button size="sm" variant="ghost" onClick={() => handleBulkSetStatus('Active')} disabled={bulkRunning}>→ Active</Button>
                <Button size="sm" variant="ghost" onClick={handleBulkAssignPM} disabled={bulkRunning}>Assign PM…</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} disabled={bulkRunning}>Clear</Button>
              </div>
            </Card>
          )}
          <DataTable
            columns={admin
              ? [{
                  key: '_select',
                  header: (
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => selectedIds.has(r.company_id))}
                      ref={el => { if (el) el.indeterminate = filtered.some(r => selectedIds.has(r.company_id)) && !filtered.every(r => selectedIds.has(r.company_id)); }}
                      onChange={() => {
                        const next = new Set(selectedIds);
                        const allSel = filtered.every(r => selectedIds.has(r.company_id));
                        if (allSel) for (const r of filtered) next.delete(r.company_id);
                        else for (const r of filtered) next.add(r.company_id);
                        setSelectedIds(next);
                      }}
                    />
                  ),
                  width: '36px',
                  render: (r: Row) => (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.company_id)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => {
                        const next = new Set(selectedIds);
                        if (next.has(r.company_id)) next.delete(r.company_id); else next.add(r.company_id);
                        setSelectedIds(next);
                      }}
                    />
                  ),
                } satisfies Column<Row>, ...columns]
              : columns}
            rows={filtered}
            loading={loading}
            onRowClick={r => navigate(`/companies/${encodeURIComponent(r.route_id)}`)}
            emptyState={
              joined.length === 0 ? (
                <EmptyState
                  title="No companies yet"
                  description={includePreInterview ? "Once Source Data loads from the selection workbook, the 107 Cohort 3 applicants will show up here." : "No post-interview companies match. Toggle 'Include pre-interview' to see all 107 applicants."}
                  icon={<Users className="h-8 w-8" />}
                  action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New Company</Button>}
                />
              ) : (
                'No matches for your filters.'
              )
            }
          />
        </>
      )}

      <CreateCompanyDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async row => {
          try {
            await master.createRow(row);
            toast.success('Created', `${row.company_name} added to Master.`);
            setCreating(false);
          } catch (e) {
            toast.error('Create failed', (e as Error).message);
          }
        }}
      />

      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search company, sector, city…"
        fields={filterFields}
        values={filters}
        onValuesChange={setFilters}
        total={counts.total}
        filtered={counts.filtered}
        resultNoun="companies"
      />
    </div>
  );
}

// ----- Pipeline kanban -------------------------------------------------

// The post-interview workflow:
//   Interviewed   → just had/scheduled interview
//   Reviewing     → committee actively debating
//   Recommended   → committee has recommended for the final cohort
//   Selected      → final cohort locked, interventions getting assigned
//   Onboarded     → kickoff done, agreements signed
//   Active        → running interventions
//   Graduated     → done with the program
//   Withdrawn     → pulled out (kept visible so we don't lose the trail)
const PIPELINE_COLUMNS: { id: string; label: string; tone: Tone }[] = [
  { id: 'Interviewed', label: 'Interviewed', tone: 'teal' },
  { id: 'Reviewing', label: 'Reviewing', tone: 'amber' },
  { id: 'Recommended', label: 'Recommended', tone: 'orange' },
  { id: 'Selected', label: 'Selected', tone: 'orange' },
  { id: 'Onboarded', label: 'Onboarded', tone: 'green' },
  { id: 'Active', label: 'Active', tone: 'green' },
  { id: 'Graduated', label: 'Graduated', tone: 'neutral' },
  { id: 'Withdrawn', label: 'Withdrawn', tone: 'red' },
];

// Optional pre-interview lane shown above the main board when the user
// flips "Include pre-interview" in the header. Kept off the main path so
// the day-to-day workflow isn't cluttered.
const PRE_INTERVIEW_COLUMNS: { id: string; label: string; tone: Tone }[] = [
  { id: 'Applicant', label: 'Applicant', tone: 'neutral' },
  { id: 'Shortlisted', label: 'Shortlisted', tone: 'amber' },
];

const PILLAR_DOT_COLOR: Record<string, string> = {
  TTH: 'bg-brand-teal',
  Upskilling: 'bg-brand-orange',
  MKG: 'bg-brand-red',
  MA: 'bg-brand-navy',
  ElevateBridge: 'bg-amber-500',
  'C-Suite': 'bg-brand-teal',
  Conferences: 'bg-brand-orange',
};

function CompanyPipelineKanban({
  rows,
  reviewSummaryByCompany,
  onCardClick,
  includePreInterview,
}: {
  rows: Row[];
  reviewSummaryByCompany: Map<string, ReviewSummary>;
  onCardClick: (r: Row) => void;
  includePreInterview: boolean;
}) {
  const allColumns = includePreInterview
    ? [...PRE_INTERVIEW_COLUMNS, ...PIPELINE_COLUMNS]
    : PIPELINE_COLUMNS;
  const cols: KanbanColumn<string>[] = allColumns.map(c => ({ id: c.id, label: c.label, tone: c.tone }));
  const items: Array<KanbanItem<string> & { row: Row }> = rows.map(r => ({
    id: r.route_id || r.company_id,
    status: r.status || 'Interviewed',
    row: r,
  }));
  return (
    <Kanban<string, KanbanItem<string> & { row: Row }>
      columns={cols}
      items={items}
      readOnly
      onStatusChange={async () => {}}
      onCardClick={item => onCardClick(item.row)}
      renderCard={item => {
        const card: CardCompany = {
          route_id: item.row.route_id,
          company_id: item.row.company_id,
          company_name: item.row.company_name,
          sector: item.row.sector,
          city: item.row.city,
          governorate: item.row.governorate,
          fund_code: item.row.fund_code,
          status: item.row.status,
          profile_manager_email: item.row.profile_manager_email,
          contact_email: item.row.contact_email,
          intervention_count: item.row.intervention_count,
          intervention_pillars: item.row.intervention_pillars,
        };
        return (
          <ExpandableCompanyCard
            row={card}
            reviewSummary={reviewSummaryByCompany.get(item.row.company_id)}
            onOpen={() => onCardClick(item.row)}
          />
        );
      }}
      emptyHint="Empty"
    />
  );
}

// ----- Dashboard --------------------------------------------------------

function CompanyDashboard({
  rows,
  interviewedCount,
  loading,
}: {
  rows: Row[];
  interviewedCount: number;
  loading: boolean;
}) {
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPM: Record<string, number> = {};
    const byFund: Record<string, number> = {};
    const bySector: Record<string, number> = {};
    let unassigned = 0;
    for (const r of rows) {
      const s = r.status || 'Applicant';
      byStatus[s] = (byStatus[s] || 0) + 1;
      const pm = r.profile_manager_email || '__unassigned__';
      byPM[pm] = (byPM[pm] || 0) + 1;
      if (!r.profile_manager_email) unassigned += 1;
      if (r.fund_code) byFund[r.fund_code] = (byFund[r.fund_code] || 0) + 1;
      if (r.sector) bySector[r.sector] = (bySector[r.sector] || 0) + 1;
    }
    return {
      total: rows.length,
      byStatus,
      byPM,
      byFund,
      bySector,
      unassigned,
    };
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<RefreshCw className="h-6 w-6 animate-spin" />} title="Loading…" description="Reading from Master + Source Data + Interviewed sources." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total" value={stats.total} tone="navy" />
        <Stat label="Interviewed" value={interviewedCount} tone="teal" sub="From the read-only source" />
        <Stat label="Onboarded + Active" value={(stats.byStatus['Onboarded'] || 0) + (stats.byStatus['Active'] || 0)} tone="green" />
        <Stat label="Unassigned" value={stats.unassigned} tone={stats.unassigned > 0 ? 'amber' : 'green'} sub="Need a Profile Manager" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By status" subtitle="Pipeline distribution" />
          <FunnelList rows={PIPELINE_COLUMNS.map(c => ({ label: c.label, value: stats.byStatus[c.id] || 0, tone: c.tone }))} max={Math.max(1, ...Object.values(stats.byStatus))} />
        </Card>
        <Card>
          <CardHeader title="By PM" subtitle="Workload per Profile Manager" />
          {Object.keys(stats.byPM).length === 0 ? (
            <p className="text-xs text-slate-500">No PMs assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(stats.byPM).sort((a, b) => b[1] - a[1]).map(([pm, n]) => (
                <li key={pm} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
                  <span className="truncate font-semibold text-navy-500 dark:text-slate-100">
                    {pm === '__unassigned__' ? 'Unassigned' : displayName(pm)}
                  </span>
                  <Badge tone={pm === '__unassigned__' ? 'amber' : 'navy' as Tone}>{n}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="By fund" subtitle="Dutch (97060) vs SIDA (91763)" />
          <ul className="space-y-2">
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">Dutch (97060)</span>
              <Badge tone="teal">{stats.byFund['97060'] || 0}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">SIDA (91763)</span>
              <Badge tone="amber">{stats.byFund['91763'] || 0}</Badge>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700">
              <span className="font-semibold">Not yet set</span>
              <Badge tone="neutral">{stats.total - (stats.byFund['97060'] || 0) - (stats.byFund['91763'] || 0)}</Badge>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="Top sectors" subtitle="Most-represented sectors in this view" />
          {Object.keys(stats.bySector).length === 0 ? (
            <p className="text-xs text-slate-500">No sector data yet.</p>
          ) : (
            <FunnelList
              rows={Object.entries(stats.bySector).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => ({ label: s, value: n, tone: 'teal' as Tone }))}
              max={Math.max(1, ...Object.values(stats.bySector))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone: 'navy' | 'teal' | 'green' | 'amber' }) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-500/5 text-navy-500 dark:text-white',
    teal: 'bg-brand-teal/10 text-brand-teal',
    green: 'bg-emerald-500/10 text-emerald-700',
    amber: 'bg-amber-500/10 text-amber-700',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="mb-1 text-xs font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
    </div>
  );
}

function FunnelList({ rows, max }: { rows: { label: string; value: number; tone: Tone }[]; max: number }) {
  const toneBg: Record<string, string> = {
    red: 'bg-brand-red',
    teal: 'bg-brand-teal',
    orange: 'bg-brand-orange',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
    neutral: 'bg-slate-400',
  };
  return (
    <div className="space-y-2">
      {rows.map(row => {
        const pct = max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0;
        return (
          <div key={row.label} className="flex items-center gap-3">
            <div className="w-32 truncate text-xs font-semibold text-navy-500 dark:text-slate-200">{row.label}</div>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
              <div className={`h-full rounded-full ${toneBg[row.tone] || 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="w-10 text-right text-xs font-bold text-navy-500 dark:text-slate-200">{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function CreateCompanyDrawer({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (row: Partial<Master>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<Master>>({ cohort: 'E3', status: 'Applicant' });
  const [saving, setSaving] = useState(false);
  const pms = getProfileManagers();

  const handleCreate = async () => {
    if (!draft.company_name) return;
    setSaving(true);
    try {
      await onCreate(draft);
      setDraft({ cohort: 'E3', status: 'Applicant' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Company (Master)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !draft.company_name}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Applicants from Selection Source Data already appear in the list automatically. Use this form only for companies that aren't in the applicant pool (e.g. C-Suite pilots, direct invites).
        </p>
        <Field label="Company Name" required>
          <input
            className={inputClass}
            value={draft.company_name || ''}
            onChange={e => setDraft({ ...draft, company_name: e.target.value })}
          />
        </Field>
        <Field label="Legal Name">
          <input
            className={inputClass}
            value={draft.legal_name || ''}
            onChange={e => setDraft({ ...draft, legal_name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sector">
            <input
              className={inputClass}
              value={draft.sector || ''}
              onChange={e => setDraft({ ...draft, sector: e.target.value })}
            />
          </Field>
          <Field label="Governorate">
            <input
              className={inputClass}
              value={draft.governorate || ''}
              onChange={e => setDraft({ ...draft, governorate: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fund Code">
            <select
              className={inputClass}
              value={draft.fund_code || ''}
              onChange={e => setDraft({ ...draft, fund_code: e.target.value })}
            >
              <option value="">—</option>
              {FUND_CODES.map(f => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={draft.status || ''}
              onChange={e => setDraft({ ...draft, status: e.target.value })}
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stage">
            <select
              className={inputClass}
              value={draft.stage || ''}
              onChange={e => setDraft({ ...draft, stage: e.target.value })}
            >
              <option value="">—</option>
              {STAGES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Profile Manager">
            <select
              className={inputClass}
              value={draft.profile_manager_email || ''}
              onChange={e => setDraft({ ...draft, profile_manager_email: e.target.value })}
            >
              <option value="">— unassigned —</option>
              {pms.map(pm => (
                <option key={pm.email} value={pm.email}>
                  {pm.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          The sheet auto-generates a <code>company_id</code> in the E3-0001 format via formula.
        </p>
      </div>
    </Drawer>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-brand-red">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

const AVATAR_TONES = [
  'bg-brand-teal/15 text-brand-teal',
  'bg-brand-red/15 text-brand-red',
  'bg-brand-orange/15 text-brand-orange',
  'bg-navy-500/15 text-navy-500 dark:text-slate-100',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
];

function toneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function CompanyAvatar({ name }: { name: string }) {
  const tone = toneFor(name || '·');
  return (
    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ${tone}`}>
      {initialsOf(name)}
    </div>
  );
}

function PMInitials({ name }: { name: string }) {
  const tone = toneFor(name || '·');
  return (
    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone}`}>
      {initialsOf(name)}
    </div>
  );
}
