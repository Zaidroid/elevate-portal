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
  FilterBar,
  Kanban,
  Tabs,
  statusTone,
  useToast,
  downloadCsv,
  timestampedFilename,
} from '../../lib/ui';
import type { Column, FilterGroup, FilterValues, KanbanColumn, KanbanItem, TabItem, Tone } from '../../lib/ui';
import { displayName, getProfileManagers, isAdmin } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import { INTERVIEWED_NAMES, INTERVIEWED_RAW, isInterviewed } from './interviewedSource';
import { ReviewView } from './ReviewView';
import type { ReviewableCompany } from './ReviewView';
import { ExpandableCompanyCard } from './ExpandableCompanyCard';
import type { CardCompany } from './ExpandableCompanyCard';
import {
  ACTIVITY_HEADERS,
  COMMENTS_HEADERS,
  REVIEWS_HEADERS,
  summarizeReviews,
} from './reviewTypes';
import type { CompanyComment, Review, ReviewSummary } from './reviewTypes';

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

  // Intervention Assignments tab — drives the per-card pillar dots and the
  // "(N interventions)" badges on the kanban + roster. The detail page owns
  // the full CRUD; here we only need to read counts and pillar coverage.
  const assignments = useSheetDoc<Assignment>(
    masterSheetId || null,
    getTab('companies', 'assignments'),
    'assignment_id',
    { userEmail: user?.email }
  );

  // Auto-create the post-interview review tabs (Reviews / Company Comments /
  // Activity Log) on first mount if the workbook doesn't have them yet. The
  // user never has to re-upload the file — the tabs appear in-place with the
  // canonical headers and useSheetDoc starts working immediately.
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

  // Static, hand-maintained list of Cohort 3 interviewed companies (see
  // interviewedSource.ts for the why). Used to overlay the "Interviewed"
  // status onto the master sheet without ever demoting a higher status.
  //
  // When a schedule name doesn't spell-match an applicant in Source Data,
  // the user can manually alias it to the right company below. Aliases live
  // in localStorage so they persist across reloads, and the effective
  // interviewed set is (static list) ∪ (alias targets).
  const ALIAS_KEY = 'companies.interviewedAliases.v1';
  const [aliases, setAliases] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); }
    catch { return {}; }
  });
  const setAlias = (scheduleName: string, target: string) => {
    setAliases(prev => {
      const next = { ...prev };
      const t = (target || '').trim();
      if (!t) delete next[scheduleName]; else next[scheduleName] = t;
      try { localStorage.setItem(ALIAS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
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
  const [filters, setFilters] = useState<FilterValues>({ pm: [], stage: [], status: [], fund: [] });
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'review' | 'dashboard' | 'pipeline' | 'roster'>('review');
  const [savedView, setSavedView] = useState<'' | 'mine' | 'unassigned' | 'interviewed' | 'active'>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  // Default scope is the post-interview portfolio — the team's day-to-day
  // work is on companies that already had an interview, where the next move
  // is "decide whether to recommend, and what interventions to assign."
  // Flip this toggle to bring the pre-interview applicants back into view
  // (Applicant / Shortlisted / blank) for an admin-only audit pass.
  const [includePreInterview, setIncludePreInterview] = useState(false);
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

    return out;
  }, [applicants.rows, masterE3, masterByName, interviewedSet, assignmentsByCompany]);

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
    const pm = filters.pm || [];
    const stage = filters.stage || [];
    const status = filters.status || [];
    const fund = filters.fund || [];
    return filteredBySelection.filter(r => {
      if (pm.length > 0) {
        const key = r.profile_manager_email || '__unassigned__';
        if (!pm.includes(key)) return false;
      }
      if (stage.length > 0 && !stage.includes(r.stage)) return false;
      if (status.length > 0 && !status.includes(r.status)) return false;
      if (fund.length > 0 && !fund.includes(r.fund_code)) return false;
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

  const filterGroups: FilterGroup[] = useMemo(() => [
    {
      key: 'pm',
      label: 'Profile Manager',
      options: [
        { value: '__unassigned__', label: 'Unassigned', count: counts.byPm.get('__unassigned__') || 0 },
        ...pms.map(pm => ({ value: pm.email, label: pm.name, count: counts.byPm.get(pm.email) || 0 })),
      ],
    },
    {
      key: 'stage',
      label: 'Stage',
      options: STAGES.map(s => ({ value: s, label: s, count: counts.byStage.get(s) || 0 })),
    },
    {
      key: 'status',
      label: 'Status',
      options: STATUSES.map(s => ({ value: s, label: s, count: counts.byStatus.get(s) || 0 })),
    },
    {
      key: 'fund',
      label: 'Fund',
      options: FUND_CODES.map(f => ({
        value: f,
        label: f === '97060' ? 'Dutch (97060)' : 'SIDA (91763)',
        count: counts.byFund.get(f) || 0,
      })),
    },
  ], [pms, counts]);

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

  const tabs: TabItem[] = [
    { value: 'review', label: `Review · ${reviewedAnyone}/${reviewableCompanies.length}`, icon: <MessageCircle className="h-4 w-4" /> },
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

  const reviewableForView: ReviewableCompany[] = useMemo(() => {
    return reviewableCompanies.map(r => ({
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
    }));
  }, [reviewableCompanies, applicantByName, masterById]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Companies</h1>
            <Badge tone="teal">{joined.length} cohort 3</Badge>
            {interviewedSet.size > 0 && (
              <Badge tone="amber">
                {interviewedCount} / {INTERVIEWED_RAW.length} interviewed
              </Badge>
            )}
            {unmatchedInterviewed.length > 0 && (
              <button
                type="button"
                onClick={() => setShowUnmatched(s => !s)}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                title="Click to view names that didn't match any applicant in Source Data"
              >
                {unmatchedInterviewed.length} unmatched
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Post-interview triage: {INTERVIEWED_RAW.length} companies scheduled across Phases 1–4 (April 2026) flow through
            Reviewing → Recommended → Selected, then get interventions assigned. Pre-interview applicants are hidden by default —
            flip <em>Include pre-interview</em> to see all 107.
          </p>
          {showUnmatched && (
            <div className="mt-2 max-w-3xl rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <datalist id="applicant-options">
                {applicantOptions.map(n => (<option key={n} value={n} />))}
              </datalist>

              {unmatchedInterviewed.length > 0 ? (
                <>
                  <div className="mb-2 font-semibold">
                    {unmatchedInterviewed.length} schedule name{unmatchedInterviewed.length === 1 ? '' : 's'} didn't match any applicant. Pick the right company from Source Data to map them:
                  </div>
                  <div className="space-y-1.5">
                    {unmatchedInterviewed.map(name => (
                      <div key={name} className="flex flex-wrap items-center gap-2">
                        <div className="min-w-[14rem] flex-1 truncate font-medium" title={name}>{name}</div>
                        <span className="text-amber-700 dark:text-amber-300">→</span>
                        <input
                          type="text"
                          list="applicant-options"
                          placeholder="Type or pick an applicant…"
                          defaultValue={aliases[name] || ''}
                          onBlur={e => setAlias(name, e.currentTarget.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="min-w-[16rem] flex-1 rounded border border-amber-300 bg-white px-2 py-1 text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="font-semibold">All schedule names matched. Nothing to reconcile.</div>
              )}

              {mappedAliases.length > 0 && (
                <div className="mt-3 border-t border-amber-200 pt-2 dark:border-amber-900">
                  <div className="mb-1 font-semibold">
                    {mappedAliases.length} mapped alias{mappedAliases.length === 1 ? '' : 'es'}:
                  </div>
                  <div className="space-y-1">
                    {mappedAliases.map(name => (
                      <div key={name} className="flex flex-wrap items-center gap-2">
                        <div className="min-w-[14rem] flex-1 truncate" title={name}>{name}</div>
                        <span className="text-emerald-700 dark:text-emerald-300">→</span>
                        <div className="min-w-[16rem] flex-1 truncate font-medium text-emerald-800 dark:text-emerald-200" title={aliases[name]}>
                          {aliases[name]}
                        </div>
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

              <div className="mt-2 text-[11px] opacity-80">
                Aliases are saved per-browser (localStorage). To make them permanent, edit the entry in{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">interviewedSource.ts</code>
                {' '}to match Source Data's spelling.
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"
            title="Default scope is the post-interview portfolio. Flip this to bring the pre-interview applicants back into view."
          >
            <input
              type="checkbox"
              checked={includePreInterview}
              onChange={() => setIncludePreInterview(v => !v)}
              className="rounded"
            />
            Include pre-interview
          </label>
          <Button variant="ghost" onClick={() => { applicants.refresh(); master.refresh(); assignments.refresh(); }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadCsv(timestampedFilename('companies'), filteredBySelection as unknown as Record<string, unknown>[])}
            disabled={filteredBySelection.length === 0}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New Company
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {error.message}</p>
        </Card>
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
          onSaveReview={async r => {
            // Replace any existing review by (reviewer_email, company_id) with
            // the new one — keeps the tab tidy across edits.
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
          onJumpToCompany={rid => navigate(`/companies/${encodeURIComponent(rid)}`)}
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
          <FilterBar
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search by company, sector, city, governorate…"
            groups={filterGroups}
            values={filters}
            onValuesChange={setFilters}
            total={counts.total}
            filtered={counts.filtered}
            resultNoun="companies"
          />
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
