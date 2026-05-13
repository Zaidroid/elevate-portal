// Pure helpers for finding + planning the removal of duplicate
// intervention assignment rows.
//
// "Duplicate" means: two or more rows in companies::assignments that
// share the same company_id AND resolve (via canonicalAssignmentKey)
// to the same canonical pillar/sub.
//
// The plan:
//   1. Group raw assignments by (company_id, canonical_key).
//   2. For each group with >1 row, pick the KEEPER:
//        - Most data wins. Score = field-richness across budget,
//          status, fund_code, start_date, end_date, owner_email, notes.
//        - Tie-breaker: earliest start_date, then oldest assignment_id
//          (most likely the original, longest-trusted row).
//   3. Identify PRs and Payments that reference an orphan
//      assignment_id — those must be REPOINTED to the keeper before
//      delete to avoid breaking the procurement/payment chain.
//   4. Build a delete-list of orphan assignment_ids.
//
// All helpers are pure: take rows, return plan. The admin card calls
// updateRow / deleteRow once the user confirms.

import { canonicalAssignmentKey } from '../../config/interventions';

export type AssignmentRow = {
  assignment_id?: string;
  company_id?: string;
  intervention_type?: string;
  sub_intervention?: string;
  fund_code?: string;
  status?: string;
  budget_usd?: string;
  start_date?: string;
  end_date?: string;
  owner_email?: string;
  notes?: string;
  [k: string]: string | undefined;
};

export type PrRow = {
  pr_id?: string;
  assignment_id?: string;
  [k: string]: string | undefined;
};

export type PaymentRow = {
  payment_id?: string;
  assignment_id?: string;
  [k: string]: string | undefined;
};

export type DedupeGroup = {
  companyId: string;
  canonicalKey: string;
  keeper: AssignmentRow;
  orphans: AssignmentRow[];
  // PRs and payments that point at an orphan assignment_id and need
  // their assignment_id rewritten to the keeper's id before delete.
  repointPrs: PrRow[];
  repointPayments: PaymentRow[];
  // Fields the keeper is missing that an orphan has — these get
  // inherited into the keeper before deleting the orphans so we don't
  // lose data.
  inheritUpdates: Partial<AssignmentRow>;
};

export type DedupePlan = {
  groups: DedupeGroup[];
  totalOrphans: number;
  totalRepoints: number;
  totalInherits: number;
};

// Fields the keeper inherits from an orphan when the keeper's own
// value is empty. Order doesn't matter; first non-empty orphan wins.
const INHERITABLE_FIELDS = [
  'budget_usd',
  'fund_code',
  'status',
  'start_date',
  'end_date',
  'owner_email',
  'notes',
] as const;

// Field-richness score for keeper selection. Budget has the highest
// weight because it's the strongest signal of "this is the active row".
const FIELD_WEIGHTS: Record<string, number> = {
  budget_usd: 10,
  status: 5,
  fund_code: 4,
  start_date: 3,
  end_date: 2,
  owner_email: 2,
  notes: 1,
};

// Normalise a budget cell like "$1,000", "1,000", "1000", "1.5K" to a
// number. Returns 0 for unparseable input. Used by rowScore AND
// inheritableFromOrphans so both agree about what counts as "real".
function parseBudgetCell(raw: string): number {
  const v = (raw || '').toString().trim();
  if (!v) return 0;
  // Strip leading $, commas, spaces; case-insensitive K/M suffix.
  const cleaned = v.replace(/[$\s,]/g, '');
  const km = cleaned.match(/^(-?\d+(?:\.\d+)?)([kKmM])$/);
  if (km) {
    const n = parseFloat(km[1]);
    const mult = km[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return isFinite(n) ? n * mult : 0;
  }
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

const PLACEHOLDER_TOKENS = new Set(['-', '—', 'tbd', 'n/a', 'na', 'pending', '']);

function rowScore(a: AssignmentRow): number {
  let s = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const v = (a[field] || '').toString().trim();
    if (!v) continue;
    if (PLACEHOLDER_TOKENS.has(v.toLowerCase())) continue;
    if (field === 'budget_usd') {
      // Score budget only if it's a real positive amount. Without this
      // guard, `budget_usd='abc'` or `budget_usd='TBD'` would add 10 pts
      // to a row that effectively has no budget — inverting the
      // keeper-picking logic.
      if (parseBudgetCell(v) <= 0) continue;
    }
    s += weight;
  }
  return s;
}

function pickKeeper(rows: AssignmentRow[]): AssignmentRow {
  // Highest score wins. Ties → earliest start_date. Ties → oldest
  // assignment_id (timestamp suffix is the most common id pattern).
  let best = rows[0];
  let bestScore = rowScore(best);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const s = rowScore(r);
    if (s > bestScore) { best = r; bestScore = s; continue; }
    if (s < bestScore) continue;
    // Tie on score — prefer earlier start_date.
    const bStart = (best.start_date || '').trim();
    const rStart = (r.start_date || '').trim();
    if (bStart && rStart && rStart < bStart) { best = r; continue; }
    if (rStart && !bStart) { best = r; continue; }
    // Final tie-break: oldest assignment_id.
    if ((r.assignment_id || '') < (best.assignment_id || '')) best = r;
  }
  return best;
}

function isMeaningful(field: string, raw: string): boolean {
  const v = (raw || '').toString().trim();
  if (!v) return false;
  if (PLACEHOLDER_TOKENS.has(v.toLowerCase())) return false;
  if (field === 'budget_usd') return parseBudgetCell(v) > 0;
  return true;
}

function inheritableFromOrphans(keeper: AssignmentRow, orphans: AssignmentRow[]): Partial<AssignmentRow> {
  const updates: Partial<AssignmentRow> = {};
  for (const f of INHERITABLE_FIELDS) {
    if (isMeaningful(f, keeper[f] || '')) continue;
    for (const o of orphans) {
      const ov = (o[f] || '').toString().trim();
      if (!isMeaningful(f, ov)) continue;
      updates[f] = ov;
      break;
    }
  }
  return updates;
}

// Runtime-only dedup: return one assignment row per (company_id,
// canonical_key) using the same keeper-pick logic as the data-level
// plan. Use this from every page that aggregates assignments
// (HomePage, ReportsPage, MyHubPage, LogframesPage, CompanyDetailPage's
// non-Program counters) so over-counts stop appearing BEFORE the admin
// runs the data-level dedupe. The sheet may still contain duplicates;
// this keeps reads honest until cleanup happens.
export function dedupeAssignmentRowsForRead<T extends AssignmentRow>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const groups = new Map<string, T[]>();
  const ungroupable: T[] = []; // missing company_id, ID, or canonical = UNKNOWN
  for (const a of rows) {
    const cid = (a.company_id || '').trim();
    const aid = (a.assignment_id || '').trim();
    if (!cid || !aid) {
      ungroupable.push(a);
      continue;
    }
    const canonical = canonicalAssignmentKey({
      intervention_type: a.intervention_type,
      sub_intervention: a.sub_intervention,
    });
    if (canonical.startsWith('UNKNOWN::')) {
      ungroupable.push(a);
      continue;
    }
    const key = `${cid}::${canonical}`;
    const arr = groups.get(key) || [];
    arr.push(a);
    groups.set(key, arr);
  }
  const out: T[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      out.push(arr[0]);
    } else {
      out.push(pickKeeper(arr) as T);
    }
  }
  return [...out, ...ungroupable];
}

export function buildDedupePlan(
  assignments: AssignmentRow[],
  prs: PrRow[],
  payments: PaymentRow[],
): DedupePlan {
  // Group by (company_id, canonical_key).
  const groups = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const cid = (a.company_id || '').trim();
    if (!cid) continue;
    const canonical = canonicalAssignmentKey({
      intervention_type: a.intervention_type,
      sub_intervention: a.sub_intervention,
    });
    // Skip rows whose canonical is UNKNOWN — those need taxonomy
    // attention, not silent merging.
    if (canonical.startsWith('UNKNOWN::')) continue;
    const key = `${cid}::${canonical}`;
    const arr = groups.get(key) || [];
    arr.push(a);
    groups.set(key, arr);
  }

  const out: DedupeGroup[] = [];
  let totalOrphans = 0;
  let totalRepoints = 0;
  let totalInherits = 0;

  for (const [key, rows] of groups.entries()) {
    if (rows.length <= 1) continue;
    // Drop rows that have no assignment_id at all — we can't delete or
    // repoint them through the data layer, surface them separately.
    const idable = rows.filter(r => (r.assignment_id || '').trim());
    if (idable.length <= 1) continue;
    const [companyId, canonical] = key.split('::', 2);
    const keeper = pickKeeper(idable);
    const orphans = idable.filter(r => r.assignment_id !== keeper.assignment_id);
    if (orphans.length === 0) continue;

    const orphanIds = new Set(orphans.map(o => o.assignment_id).filter(Boolean) as string[]);
    const repointPrs = prs.filter(p => p.assignment_id && orphanIds.has(p.assignment_id));
    const repointPayments = payments.filter(p => p.assignment_id && orphanIds.has(p.assignment_id));
    const inheritUpdates = inheritableFromOrphans(keeper, orphans);

    totalOrphans += orphans.length;
    totalRepoints += repointPrs.length + repointPayments.length;
    totalInherits += Object.keys(inheritUpdates).length;

    out.push({
      companyId,
      canonicalKey: canonical,
      keeper,
      orphans,
      repointPrs,
      repointPayments,
      inheritUpdates,
    });
  }

  out.sort((a, b) => a.companyId.localeCompare(b.companyId));
  return { groups: out, totalOrphans, totalRepoints, totalInherits };
}
