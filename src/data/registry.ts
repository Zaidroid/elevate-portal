// Central registry of every module+tab → sheetId+tabName+idColumn.
// This is the single source of truth for ALL data reads in the portal.
// Adding a new tab? Add one entry here — nothing else needs to change.

import { getSheetId, getTab } from '../config/sheets';

export type DataKey = string; // pattern: "module::tab"

export function makeKey(module: string, tab: string): DataKey {
  return `${module}::${tab}`;
}

export function splitKey(key: DataKey): { module: string; tab: string } {
  const [module, tab] = key.split('::');
  return { module, tab };
}

// Maps each DataKey to the ID column used by that tab's rows.
//
// Every tab declared in src/config/sheets.ts SHOULD have an entry here —
// missing entries fall back to 'id' which works for reads but blocks
// updateRow() (the ID-column header validation in SheetDataProvider
// requires the column to exist in the actual sheet). The validateRegistry()
// helper below flags any drift on app boot.
const ID_COLUMNS: Record<string, string> = {
  // Companies workbook
  'companies::companies':          'company_id',
  'companies::contacts':           'contact_id',
  'companies::assignments':        'assignment_id',
  'companies::statusLog':          'log_id',
  'companies::historical':         'historical_id',
  'companies::lookups':            'lookup_id',
  'companies::reviews':            'review_id',
  'companies::comments':           'comment_id',
  'companies::activity':           'activity_id',
  'companies::interviewAliases':   'alias_id',
  'companies::removedCompanies':   'removed_id',
  'companies::preDecisions':       'recommendation_id',
  // Payments workbook
  'payments::payments':            'payment_id',
  'payments::advisorFees':         'fee_id',
  'payments::vendorFees':          'fee_id',
  'payments::stipends':            'stipend_id',
  'payments::summary':             'row_id',
  'payments::lookups':             'lookup_id',
  // Procurement workbook
  'procurement::q1':               'pr_id',
  'procurement::q2':               'pr_id',
  'procurement::q3':               'pr_id',
  'procurement::q4':               'pr_id',
  'procurement::summary':          'row_id',
  'procurement::lookups':          'lookup_id',
  // Conferences workbook
  'conferences::catalogue':        'conference_id',
  'conferences::scoring':          'score_id',
  'conferences::tracker':          'tracker_id',
  'conferences::letters':          'letter_id',
  'conferences::dashboard':        'row_id',
  'conferences::lookups':          'lookup_id',
  // Docs workbook
  'docs::agreements':              'agreement_id',
  'docs::letters':                 'letter_id',
  'docs::deliverables':            'deliverable_id',
  'docs::templates':               'template_id',
  'docs::lookups':                 'lookup_id',
  // Advisors workbook
  'advisors::dashboard':           'row_id',
  'advisors::advisors':            'advisor_id',
  'advisors::followups':           'followup_id',
  'advisors::activity':            'activity_id',
  'advisors::comments':            'comment_id',
  'advisors::mentors':             'mentor_id',
  'advisors::lookups':             'lookup_id',
  // Freelancers workbook
  'freelancers::dashboard':        'row_id',
  'freelancers::freelancers':      'freelancer_id',
  'freelancers::followups':        'followup_id',
  'freelancers::activity':         'activity_id',
  'freelancers::comments':         'comment_id',
  'freelancers::tracks':           'assignment_id',
  'freelancers::income':           'record_id',
  'freelancers::assessments':      'assessment_id',
  'freelancers::lookups':          'lookup_id',
  // Selection workbook (read-only joins from CompanyDetailPage)
  'selection::sourceData':            'id',
  'selection::firstFiltration':       'id',
  'selection::additionalFiltration':  'id',
  'selection::docReviews':            'id',
  'selection::companyNeeds':          'id',
  'selection::scoringMatrix':         'id',
  'selection::interviewAssessments':  'id',
  'selection::interviewDiscussion':   'id',
  'selection::ebAssessments':         'id',
  'selection::committeeVotes':        'id',
  'selection::selectionVotes':        'id',
  'selection::shortlists':            'id',
  'selection::finalCohort':           'id',
  'selection::configuration':         'key',
  // Logframes workbook (extra tabs beyond Dutch/SIDA)
  'logframes::targets':            'ID',
  'logframes::budget':             'ID',
  'logframes::monthly':            'ID',
  // Donor reports (auto-generated)
  'donorReports::portfolio':       'row_id',
  'donorReports::interventions':   'row_id',
  'donorReports::financial':       'row_id',
  'donorReports::conferences':     'row_id',
  'donorReports::agreements':      'row_id',
  // Team roster (single sheet)
  'teamRoster::roster':            'email',
  // ElevateBridge programme workbook
  'elevateBridge::applicants':     'applicant_id',
  'elevateBridge::responses':      'applicant_id',
  'elevateBridge::stage1':         'applicant_id',
  'elevateBridge::stage2':         'applicant_id',
  'elevateBridge::stage3Ssi':      'applicant_id',
  'elevateBridge::stage3Resp':     'score_id',
  'elevateBridge::interviews':     'interview_id',
  'elevateBridge::decisions':      'applicant_id',
  'elevateBridge::rubrics':        'rubric_id',
  'elevateBridge::mentors':        'mentor_id',
  'elevateBridge::sessions':       'session_id',
  'elevateBridge::attendance':     'attendance_id',
  'elevateBridge::topPerformers':  'applicant_id',
  'elevateBridge::matches':        'match_id',
  'elevateBridge::activity':       'activity_id',
  // Logframes workbook
  'logframes::dutch':              'ID',
  'logframes::sida':               'ID',
  // Selection workbook (Stage 3 distribution mirror — synthetic id per row)
  'selection::stage3Distribution': 'distribution_id',
};

export interface ResolvedRange {
  sheetId: string;
  tab: string;
  idColumn: string;
}

export function resolveRange(key: DataKey): ResolvedRange | null {
  const { module, tab } = splitKey(key);
  const sheetId = getSheetId(module);
  const tabName  = getTab(module, tab);
  if (!sheetId || !tabName) return null;
  return {
    sheetId,
    tab: tabName,
    idColumn: ID_COLUMNS[key] || 'id',
  };
}

/**
 * Groups a list of DataKeys by their sheetId so callers can use
 * batchGet() — one API call per workbook instead of one per tab.
 */
export function groupBySheet(
  keys: DataKey[]
): Map<string, Array<{ tab: string; key: DataKey; idColumn: string }>> {
  const map = new Map<string, Array<{ tab: string; key: DataKey; idColumn: string }>>();
  for (const key of keys) {
    const r = resolveRange(key);
    if (!r) continue;
    const arr = map.get(r.sheetId) ?? [];
    arr.push({ tab: r.tab, key, idColumn: r.idColumn });
    map.set(r.sheetId, arr);
  }
  return map;
}

// ─── Drift validation ─────────────────────────────────────────────────────
//
// Every tab declared in src/config/sheets.ts SHOULD have an entry in
// ID_COLUMNS above. If it doesn't, the read still works (resolveRange
// falls back to 'id') but writes will fail at the SheetDataProvider
// header-validation step because 'id' isn't an actual column in most
// tabs. Worse, the missing-entry pattern hides the human signal that a
// new module/tab was added without finishing the wiring.
//
// validateRegistry() walks every (module, tabKey) pair from sheets.ts
// and reports the ones missing from ID_COLUMNS. Called from
// SheetDataProvider on mount; admins see a banner if drift is detected.

import { SHEETS, type ModuleKey } from '../config/sheets';

export type RegistryReport = {
  ok: boolean;
  missing: DataKey[];           // declared in sheets.ts, no ID_COLUMNS entry
  orphan: DataKey[];            // has ID_COLUMNS entry, not declared in sheets.ts
  totalDeclared: number;
  totalRegistered: number;
};

// Source workbooks whose tabs are discovered at runtime (not declared).
// We skip these — they would otherwise show up as 0-tab modules.
const RUNTIME_DISCOVERED_MODULES: ReadonlySet<string> = new Set([
  'procurementSource',
  'paymentsSource',
  'companiesInterviewed',
  'freelancersFormResponses',
  'advisorsFormResponses',
]);

export function validateRegistry(): RegistryReport {
  const missing: DataKey[] = [];
  const declared: Set<string> = new Set();

  for (const [moduleName, cfg] of Object.entries(SHEETS) as Array<[ModuleKey, typeof SHEETS[ModuleKey]]>) {
    if (RUNTIME_DISCOVERED_MODULES.has(moduleName)) continue;
    for (const tabKey of Object.keys(cfg.tabs)) {
      const key = makeKey(moduleName, tabKey);
      declared.add(key);
      if (!(key in ID_COLUMNS)) missing.push(key);
    }
  }

  const orphan: DataKey[] = [];
  for (const key of Object.keys(ID_COLUMNS)) {
    if (!declared.has(key)) orphan.push(key);
  }

  return {
    ok: missing.length === 0 && orphan.length === 0,
    missing,
    orphan,
    totalDeclared: declared.size,
    totalRegistered: Object.keys(ID_COLUMNS).length,
  };
}

// Expose the raw map so the Schema Doctor admin page can render it.
export function getIdColumns(): Readonly<Record<DataKey, string>> {
  return ID_COLUMNS;
}
