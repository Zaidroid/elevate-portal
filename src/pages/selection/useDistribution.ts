// Pure derivation for the Stage 3 distribution dashboard. Takes the
// company master + intervention assignments and produces the buckets the
// dashboard panels render: per-AM rollups, per-sub-intervention counts
// (with the MA-Technical flavor of C-Suite split out), and per-AM
// budget totals.
//
// Lives in its own module so the dashboard component stays focused on
// presentation and so this logic can be exercised independently in
// future tests.

import { useMemo } from 'react';
import type { Company, Assignment } from '../../data/types';
import { pillarFor, loadWeightFor } from '../../config/interventions';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';

export type AmBucket = {
  email: string;
  /** Friendly display name; '(unassigned)' when no AM is set. */
  label: string;
  companies: Company[];
  assignments: Assignment[];
  totalBudget: number;
  /** Sum of loadWeightFor(sub) across this AM's assignments. */
  loadScore: number;
  /** Per-sub-intervention breakdown for this AM: { sub, count, load }. */
  perSub: { sub: string; count: number; load: number }[];
};

export type SubCount = {
  /** Canonical sub-intervention name (e.g. 'C-Suite', 'Train To Hire'). */
  sub: string;
  /** Total assignments hitting this sub. */
  total: number;
  /** When the sub has flavors (currently only C-Suite / Technical),
   *  break them out with their counts. Empty otherwise. */
  flavors: { label: string; count: number }[];
};

export type DistributionResult = {
  amBuckets: AmBucket[];
  subCounts: SubCount[];
  /** Per-fund total committed budget across all assignments. */
  fundTotals: { fund: string; total: number }[];
  /** Number of cohort companies (i.e. companies with at least one assignment). */
  companiesInCohort: number;
  /** Total assignment count. */
  totalAssignments: number;
  /** Sum of all assignment budgets. */
  totalBudget: number;
};

const FLAVOR_FROM_NOTES = (notes: string | undefined): string | null => {
  if (!notes) return null;
  // The cohort-allocation seeder writes 'Technical' (or 'something | Technical')
  // into the assignment notes column when the source code was MA-Technical.
  // Match either an exact 'Technical' token or a piped suffix.
  const m = notes.match(/(?:^|\|\s*)(Technical)(?:\s*\||$)/);
  return m ? m[1] : null;
};

function parseBudget(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function useDistribution(
  companies: Company[],
  assignments: Assignment[],
): DistributionResult {
  return useMemo<DistributionResult>(() => {
    const companyById = new Map<string, Company>();
    for (const c of companies) {
      if (c.company_id) companyById.set(c.company_id, c);
    }

    // Group assignments by company to know which companies are "in cohort".
    const asgByCompany = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!a.company_id) continue;
      const arr = asgByCompany.get(a.company_id) ?? [];
      arr.push(a);
      asgByCompany.set(a.company_id, arr);
    }

    // Per-AM bucket. Seed with the configured AMs so empty AMs still
    // appear as 0/0/0 rows; "unassigned" catches anything stranded.
    const buckets = new Map<string, AmBucket>();
    const seedAm = (email: string, label: string) => {
      buckets.set(email, { email, label, companies: [], assignments: [], totalBudget: 0, loadScore: 0, perSub: [] });
    };
    for (const am of ACCOUNT_MANAGERS) seedAm(am.email, displayName(am.email));
    seedAm('', '(unassigned)');

    for (const c of companies) {
      const asg = asgByCompany.get(c.company_id) ?? [];
      if (asg.length === 0) continue;
      const amEmail = (c.profile_manager_email || asg.find(a => a.owner_email)?.owner_email || '').toLowerCase();
      const bucket = buckets.get(amEmail) ?? buckets.get('')!;
      bucket.companies.push(c);
      for (const a of asg) {
        bucket.assignments.push(a);
        bucket.totalBudget += parseBudget(a.budget_usd);
      }
    }

    // Per-AM perSub breakdown + loadScore.
    for (const b of buckets.values()) {
      const subAgg = new Map<string, { count: number; load: number }>();
      for (const a of b.assignments) {
        const sub = a.sub_intervention || a.intervention_type || '';
        if (!sub) continue;
        const w = loadWeightFor(sub);
        const cur = subAgg.get(sub) ?? { count: 0, load: 0 };
        cur.count += 1;
        cur.load += w;
        subAgg.set(sub, cur);
      }
      b.perSub = Array.from(subAgg.entries())
        .map(([sub, v]) => ({ sub, count: v.count, load: v.load }))
        .sort((x, y) => y.load - x.load);
      b.loadScore = b.perSub.reduce((s, x) => s + x.load, 0);
    }

    const amBuckets = Array.from(buckets.values()).sort((a, b) => {
      if (a.email === '') return 1;
      if (b.email === '') return -1;
      return b.loadScore - a.loadScore || b.companies.length - a.companies.length || a.label.localeCompare(b.label);
    });

    // Sub-intervention counts. Group by canonical sub; track flavor for C-Suite.
    const subAgg = new Map<string, { total: number; flavors: Map<string, number> }>();
    for (const a of assignments) {
      const code = a.sub_intervention || a.intervention_type || '';
      if (!code) continue;
      // Use canonical name when we recognise it; otherwise use raw.
      const canonical = pillarFor(code) ? code : code;
      const cur = subAgg.get(canonical) ?? { total: 0, flavors: new Map() };
      cur.total += 1;
      const flavor = FLAVOR_FROM_NOTES(a.notes) ?? '';
      const flavorKey = flavor || 'Standard';
      cur.flavors.set(flavorKey, (cur.flavors.get(flavorKey) ?? 0) + 1);
      subAgg.set(canonical, cur);
    }
    const subCounts: SubCount[] = Array.from(subAgg.entries())
      .map(([sub, { total, flavors }]) => ({
        sub,
        total,
        flavors: flavors.size > 1
          ? Array.from(flavors.entries()).map(([label, count]) => ({ label, count }))
          : [],
      }))
      .sort((a, b) => b.total - a.total);

    // Fund totals.
    const fundAgg = new Map<string, number>();
    for (const a of assignments) {
      const fund = a.fund_code || '(no fund)';
      fundAgg.set(fund, (fundAgg.get(fund) ?? 0) + parseBudget(a.budget_usd));
    }
    const fundTotals = Array.from(fundAgg.entries())
      .map(([fund, total]) => ({ fund, total }))
      .sort((a, b) => b.total - a.total);

    const totalBudget = assignments.reduce((s, a) => s + parseBudget(a.budget_usd), 0);
    const companiesInCohort = asgByCompany.size;

    return {
      amBuckets,
      subCounts,
      fundTotals,
      companiesInCohort,
      totalAssignments: assignments.length,
      totalBudget,
    };
  }, [companies, assignments]);
}
