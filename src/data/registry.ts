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
const ID_COLUMNS: Record<string, string> = {
  // Companies workbook
  'companies::companies':          'company_id',
  'companies::assignments':        'assignment_id',
  'companies::applicants':         'applicant_id',
  'companies::reviews':            'review_id',
  'companies::comments':           'comment_id',
  'companies::activity':           'activity_id',
  'companies::interviewAliases':   'alias_id',
  'companies::removedCompanies':   'removed_id',
  'companies::preDecisions':       'recommendation_id',
  // Payments workbook
  'payments::payments':            'payment_id',
  // Procurement workbook
  'procurement::q1':               'pr_id',
  'procurement::q2':               'pr_id',
  'procurement::q3':               'pr_id',
  'procurement::q4':               'pr_id',
  // Conferences workbook
  'conferences::catalogue':        'conference_id',
  'conferences::tracker':          'tracker_id',
  // Docs workbook
  'docs::agreements':              'agreement_id',
  // Advisors workbook
  'advisors::advisors':            'advisor_id',
  'advisors::followups':           'followup_id',
  'advisors::activity':            'activity_id',
  'advisors::comments':            'comment_id',
  // Freelancers workbook
  'freelancers::freelancers':      'freelancer_id',
  'freelancers::followups':        'followup_id',
  'freelancers::activity':         'activity_id',
  'freelancers::comments':         'comment_id',
  'freelancers::income':           'record_id',
  // Logframes workbook
  'logframes::dutch':              'ID',
  'logframes::sida':               'ID',
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
