// Cohort 3 aggregations — single source of truth for the per-AM,
// per-city, per-donor, per-sub-intervention rollups that HomePage,
// MyHubPage, and the dashboard rebuilder all consume.
//
// Pure functions: no React, no fetches. Inputs are the already-loaded
// rows from useModuleData; outputs are stable shapes the UI can render
// directly. Pages are responsible for cohort filtering (via
// canonicalCohortName) BEFORE calling these helpers — that keeps the
// helpers reusable for any sub-population (e.g. "scope to my AM pool").
//
// Why centralised: the "31 active vs 32 active" discrepancy between
// HomePage and the sheet dashboard last cycle came from two slightly
// different rollup loops. One file, one truth.

import type { Company, Assignment, Payment, PR } from './types';
import {
  COHORT3_BUDGET_2026,
  COHORT3_BUDGET_TOTAL_USD,
  PILLARS,
  pillarFor,
  resolveIntervention,
} from '../config/interventions';
import { ACCOUNT_MANAGERS, displayName } from '../config/team';
import { cohortEntryFor } from '../config/cohort3Aliases';

// Stage 3 writes assignments with intervention_type as the pillar code
// ('CB' / 'MA' / 'MKG') and sub_intervention as the actual sub. Older
// rows (and Reviews) sometimes pack the sub into intervention_type.
// This helper picks the right field so downstream rollups don't drop
// rows whose intervention_type is just a pillar code.
//
// When we can identify a pillar but not a sub (e.g. MKG::MKG seen in
// the wild — both fields are the pillar code), we route the row to a
// synthetic "<pillar> (unallocated)" sub so it remains visible. Better
// to surface 9 unallocated MKG rows in their own bucket than to drop
// them silently.
const UNALLOCATED_LABEL: Record<string, string> = {
  CB:  'Capacity Building (unallocated)',
  MKG: 'Marketing & Branding (unallocated)',
  MA:  'Market Access (unallocated)',
};
function unallocatedSub(pillarCode: string): string | null {
  return UNALLOCATED_LABEL[pillarCode] ?? null;
}

function resolveAssignmentSub(a: Assignment): { pillar: string; sub: string } | null {
  // Prefer the explicit sub_intervention field when set (Stage 3 path).
  const subRaw = (a.sub_intervention || '').trim();
  if (subRaw) {
    const r = resolveIntervention(subRaw);
    if (r && r.sub) return { pillar: r.pillar, sub: r.sub };
  }
  // Fall back to intervention_type — for legacy rows that packed the
  // sub into that single column.
  const it = (a.intervention_type || '').trim();
  if (it) {
    const r = resolveIntervention(it);
    if (r && r.sub) return { pillar: r.pillar, sub: r.sub };
    // Pillar-only row (e.g. intervention_type='MKG', sub_intervention=''
    // or sub_intervention='MKG'). Bucket into the pillar's "unallocated"
    // slot so the UI can show how many such rows exist.
    if (r && !r.sub) {
      const u = unallocatedSub(r.pillar);
      if (u) return { pillar: r.pillar, sub: u };
    }
  }
  return null;
}

function resolvePaymentSub(p: Payment): { pillar: string; sub: string } | null {
  const it = (p.intervention_type || '').trim();
  if (!it) return null;
  const r = resolveIntervention(it);
  if (r && r.sub) return { pillar: r.pillar, sub: r.sub };
  if (r && !r.sub) {
    const u = unallocatedSub(r.pillar);
    if (u) return { pillar: r.pillar, sub: u };
  }
  return null;
}

// ─── shared helpers ──────────────────────────────────────────────────

function parseUsd(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fundDonor(fund: string | undefined): 'Dutch' | 'SIDA' | null {
  const f = (fund || '').trim();
  if (!f) return null;
  if (/dutch/i.test(f) || f === '97060') return 'Dutch';
  if (/sida/i.test(f) || f === '91763') return 'SIDA';
  return null;
}

const OPEN_PR_STATUSES = new Set(['draft', 'submitted', 'under review']);

function isPaid(payment: Payment): boolean {
  return (payment.status || '').toLowerCase() === 'paid';
}

// Index payments by the company that owns them. Falls back to canonical
// name lookup when company_id is blank — the cohort row may have been
// renamed/merged after the payment was logged.
function indexPaymentsByCompany(
  payments: readonly Payment[],
  cohortIds: ReadonlySet<string>,
): Map<string, Payment[]> {
  const out = new Map<string, Payment[]>();
  for (const p of payments) {
    const id = p.company_id;
    if (!id || !cohortIds.has(id)) continue;
    const bucket = out.get(id) ?? [];
    bucket.push(p);
    out.set(id, bucket);
  }
  return out;
}

// ─── by Account Manager ──────────────────────────────────────────────

export type AmAggregation = {
  email: string;            // empty string for unassigned
  name: string;             // 'Mohammed Ayesh' / '(unassigned)'
  companies: number;        // count of cohort companies whose profile_manager_email = this AM
  interventions: number;    // count of assignments owned by this AM (owner_email)
  plannedUsd: number;       // sum of assignment.budget_usd for assignments owned by this AM
  paidUsd: number;          // sum of payments where the company belongs to this AM AND status=paid
  openPrs: number;          // count of PRs whose company belongs to this AM AND status open
};

export function aggregateByAm(
  cohort: readonly Company[],
  assignments: readonly Assignment[],
  payments: readonly Payment[],
  prs: readonly PR[],
): AmAggregation[] {
  type Bucket = {
    email: string;
    companies: Set<string>;     // company_ids whose profile_manager_email = this AM
    interventions: number;
    plannedUsd: number;
    paidUsd: number;
    openPrs: number;
  };
  const byEmail = new Map<string, Bucket>();
  const seed = (email: string) => {
    const k = email.toLowerCase();
    if (!byEmail.has(k)) {
      byEmail.set(k, { email: k, companies: new Set(), interventions: 0, plannedUsd: 0, paidUsd: 0, openPrs: 0 });
    }
    return byEmail.get(k)!;
  };

  // Always seed the canonical 3 AMs so they appear even with zero load.
  for (const am of ACCOUNT_MANAGERS) seed(am.email);
  seed(''); // unassigned bucket

  // Companies → bucket by profile_manager_email
  const companyToAm = new Map<string, string>();
  for (const c of cohort) {
    const pm = (c.profile_manager_email || '').toLowerCase();
    seed(pm).companies.add(c.company_id);
    companyToAm.set(c.company_id, pm);
  }

  // Assignments → bucket by owner_email (may differ from profile_manager_email)
  for (const a of assignments) {
    if (!companyToAm.has(a.company_id)) continue; // not in cohort
    const owner = (a.owner_email || '').toLowerCase();
    const b = seed(owner);
    b.interventions += 1;
    b.plannedUsd += parseUsd(a.budget_usd);
  }

  // Payments → attribute to the company's profile_manager_email
  for (const p of payments) {
    const pmAm = companyToAm.get(p.company_id);
    if (pmAm === undefined) continue; // not in cohort
    if (!isPaid(p)) continue;
    seed(pmAm).paidUsd += parseUsd(p.amount_usd);
  }

  // Open PRs → attribute to the company's profile_manager_email
  for (const pr of prs) {
    const pmAm = companyToAm.get(pr.company_id);
    if (pmAm === undefined) continue;
    if (!OPEN_PR_STATUSES.has((pr.status || '').toLowerCase().trim())) continue;
    seed(pmAm).openPrs += 1;
  }

  return Array.from(byEmail.values())
    .filter(b => b.companies.size > 0 || b.interventions > 0 || b.paidUsd > 0 || b.openPrs > 0)
    .map(b => ({
      email: b.email,
      name: b.email
        ? (ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === b.email)?.name ?? displayName(b.email))
        : '(unassigned)',
      companies: b.companies.size,
      interventions: b.interventions,
      plannedUsd: b.plannedUsd,
      paidUsd: b.paidUsd,
      openPrs: b.openPrs,
    }))
    .sort((a, b) => b.companies - a.companies);
}

// ─── by City ─────────────────────────────────────────────────────────

export type CityAggregation = {
  city: string;
  companies: number;
  interventions: number;
  plannedUsd: number;
  paidUsd: number;
};

export function aggregateByCity(
  cohort: readonly Company[],
  assignments: readonly Assignment[],
  payments: readonly Payment[],
): CityAggregation[] {
  type Bucket = { city: string; companies: Set<string>; interventions: number; plannedUsd: number; paidUsd: number };
  const byCity = new Map<string, Bucket>();
  const seed = (city: string) => {
    const k = city || '(unspecified)';
    if (!byCity.has(k)) byCity.set(k, { city: k, companies: new Set(), interventions: 0, plannedUsd: 0, paidUsd: 0 });
    return byCity.get(k)!;
  };

  // Master row.city wins; fall back to cohortEntryFor when blank
  // (the alias map carries authoritative city per the xlsx).
  const companyCity = new Map<string, string>();
  for (const c of cohort) {
    const city = (c.city || '').trim() || cohortEntryFor(c.company_name)?.city || '';
    seed(city).companies.add(c.company_id);
    companyCity.set(c.company_id, city);
  }

  for (const a of assignments) {
    const city = companyCity.get(a.company_id);
    if (city === undefined) continue;
    const b = seed(city);
    b.interventions += 1;
    b.plannedUsd += parseUsd(a.budget_usd);
  }

  for (const p of payments) {
    const city = companyCity.get(p.company_id);
    if (city === undefined) continue;
    if (!isPaid(p)) continue;
    seed(city).paidUsd += parseUsd(p.amount_usd);
  }

  return Array.from(byCity.values())
    .map(b => ({
      city: b.city,
      companies: b.companies.size,
      interventions: b.interventions,
      plannedUsd: b.plannedUsd,
      paidUsd: b.paidUsd,
    }))
    .sort((a, b) => b.companies - a.companies);
}

// ─── by Donor (Dutch / SIDA) ─────────────────────────────────────────

export type DonorSubLine = {
  sub: string;
  pillar: string;
  pillarLabel: string;
  slotsFilled: number;       // count of cohort companies with this sub assigned, on this donor
  slotsCap: number;          // budget slots for this sub on this donor
  plannedUsd: number;        // sum of assignment.budget_usd for this (donor, sub)
  paidUsd: number;           // sum of paid payments for this (donor, sub)
  capUsd: number;            // budget cap for this (donor, sub)
};

export type DonorAggregation = {
  donor: 'Dutch' | 'SIDA';
  companies: number;         // unique companies with at least one assignment on this donor
  plannedUsd: number;
  paidUsd: number;
  capUsd: number;
  burnPct: number;           // paidUsd / capUsd * 100, clamped 0..150
  subs: DonorSubLine[];
};

export function aggregateByDonor(
  cohort: readonly Company[],
  assignments: readonly Assignment[],
  payments: readonly Payment[],
): DonorAggregation[] {
  const cohortIds = new Set(cohort.map(c => c.company_id));
  const byDonorSub = new Map<
    string,                                                                // 'Dutch::C-Suite'
    { pillar: string; sub: string; slotsFilled: Set<string>; plannedUsd: number; paidUsd: number }
  >();
  const totals: Record<'Dutch' | 'SIDA', { companies: Set<string>; plannedUsd: number; paidUsd: number }> = {
    Dutch: { companies: new Set(), plannedUsd: 0, paidUsd: 0 },
    SIDA:  { companies: new Set(), plannedUsd: 0, paidUsd: 0 },
  };

  const ensure = (donor: 'Dutch' | 'SIDA', sub: string, pillar: string) => {
    const k = `${donor}::${sub}`;
    if (!byDonorSub.has(k)) byDonorSub.set(k, { pillar, sub, slotsFilled: new Set(), plannedUsd: 0, paidUsd: 0 });
    return byDonorSub.get(k)!;
  };

  for (const a of assignments) {
    if (!cohortIds.has(a.company_id)) continue;
    const donor = fundDonor(a.fund_code);
    if (!donor) continue;
    const r = resolveAssignmentSub(a);
    if (!r) continue;
    const usd = parseUsd(a.budget_usd);
    totals[donor].companies.add(a.company_id);
    totals[donor].plannedUsd += usd;
    const bucket = ensure(donor, r.sub, r.pillar);
    bucket.slotsFilled.add(a.company_id);
    bucket.plannedUsd += usd;
  }

  for (const p of payments) {
    if (!cohortIds.has(p.company_id)) continue;
    if (!isPaid(p)) continue;
    const donor = fundDonor(p.fund_code);
    if (!donor) continue;
    const usd = parseUsd(p.amount_usd);
    totals[donor].paidUsd += usd;
    const r = resolvePaymentSub(p);
    if (r) ensure(donor, r.sub, r.pillar).paidUsd += usd;
  }

  const subSlotsCapFor = (donor: 'Dutch' | 'SIDA', sub: string) =>
    COHORT3_BUDGET_2026[sub]?.slots[donor === 'Dutch' ? 'dutch' : 'sida'] ?? 0;
  const subUsdCapFor = (donor: 'Dutch' | 'SIDA', sub: string) =>
    COHORT3_BUDGET_2026[sub]?.usd[donor === 'Dutch' ? 'dutch' : 'sida'] ?? 0;

  const subsFor = (donor: 'Dutch' | 'SIDA'): DonorSubLine[] => {
    const seen = new Set<string>();
    const out: DonorSubLine[] = [];
    // Walk the canonical taxonomy first so subs appear in pillar order
    // even when no assignment has been made yet.
    for (const p of PILLARS) {
      for (const sub of p.subInterventions) {
        const k = `${donor}::${sub}`;
        const b = byDonorSub.get(k);
        seen.add(sub);
        const slotsCap = subSlotsCapFor(donor, sub);
        const capUsd = subUsdCapFor(donor, sub);
        if (!b && slotsCap === 0 && capUsd === 0) continue; // skip subs with no donor allocation
        out.push({
          sub,
          pillar: p.code,
          pillarLabel: p.label,
          slotsFilled: b?.slotsFilled.size ?? 0,
          slotsCap,
          plannedUsd: b?.plannedUsd ?? 0,
          paidUsd: b?.paidUsd ?? 0,
          capUsd,
        });
      }
    }
    // Append any rogue subs (legacy codes that didn't map to a sub above).
    for (const [k, b] of byDonorSub) {
      const [d, sub] = k.split('::');
      if (d !== donor || seen.has(sub)) continue;
      out.push({
        sub,
        pillar: b.pillar,
        pillarLabel: pillarFor(b.pillar)?.label ?? b.pillar,
        slotsFilled: b.slotsFilled.size,
        slotsCap: 0,
        plannedUsd: b.plannedUsd,
        paidUsd: b.paidUsd,
        capUsd: 0,
      });
    }
    return out;
  };

  const donorRow = (donor: 'Dutch' | 'SIDA'): DonorAggregation => {
    const capUsd = donor === 'Dutch' ? COHORT3_BUDGET_TOTAL_USD.dutch : COHORT3_BUDGET_TOTAL_USD.sida;
    const t = totals[donor];
    return {
      donor,
      companies: t.companies.size,
      plannedUsd: t.plannedUsd,
      paidUsd: t.paidUsd,
      capUsd,
      burnPct: capUsd > 0 ? Math.min(150, (t.paidUsd / capUsd) * 100) : 0,
      subs: subsFor(donor),
    };
  };

  return [donorRow('Dutch'), donorRow('SIDA')];
}

// ─── by Sub-intervention ─────────────────────────────────────────────

export type SubAggregation = {
  pillar: string;            // 'MA'
  pillarLabel: string;       // 'Market Access'
  pillarColor: string;       // 'navy' / 'red' / 'teal' (Tailwind token)
  sub: string;               // 'C-Suite'
  companies: number;         // unique cohort companies with this sub assigned
  assignmentsTotal: number;
  status: { planned: number; in_progress: number; completed: number; other: number };
  plannedUsd: number;
  paidUsd: number;
};

export function aggregateBySub(
  cohort: readonly Company[],
  assignments: readonly Assignment[],
  payments: readonly Payment[],
): SubAggregation[] {
  const cohortIds = new Set(cohort.map(c => c.company_id));
  const bySub = new Map<
    string,
    {
      pillar: string;
      sub: string;
      companies: Set<string>;
      assignmentsTotal: number;
      status: { planned: number; in_progress: number; completed: number; other: number };
      plannedUsd: number;
      paidUsd: number;
    }
  >();

  const seed = (sub: string, pillar: string) => {
    if (!bySub.has(sub)) {
      bySub.set(sub, {
        pillar, sub, companies: new Set(),
        assignmentsTotal: 0,
        status: { planned: 0, in_progress: 0, completed: 0, other: 0 },
        plannedUsd: 0,
        paidUsd: 0,
      });
    }
    return bySub.get(sub)!;
  };

  // Pre-seed every canonical sub so the table always shows the full
  // taxonomy in the right order, even when nothing's been assigned.
  for (const p of PILLARS) for (const s of p.subInterventions) seed(s, p.code);

  for (const a of assignments) {
    if (!cohortIds.has(a.company_id)) continue;
    const r = resolveAssignmentSub(a);
    if (!r) continue;
    const b = seed(r.sub, r.pillar);
    b.companies.add(a.company_id);
    b.assignmentsTotal += 1;
    const s = (a.status || '').toLowerCase().trim();
    if (s === 'planned') b.status.planned += 1;
    else if (s === 'in progress' || s === 'in_progress') b.status.in_progress += 1;
    else if (s === 'completed' || s === 'done') b.status.completed += 1;
    else b.status.other += 1;
    b.plannedUsd += parseUsd(a.budget_usd);
  }

  for (const p of payments) {
    if (!cohortIds.has(p.company_id)) continue;
    if (!isPaid(p)) continue;
    const r = resolvePaymentSub(p);
    if (!r) continue;
    seed(r.sub, r.pillar).paidUsd += parseUsd(p.amount_usd);
  }

  // Emit in canonical pillar/sub order. Append the per-pillar
  // "unallocated" bucket immediately after each pillar's canonical subs
  // when it has any rows — keeps the visual grouping intact while making
  // the under-specified rows visible.
  const seen = new Set<string>();
  const out: SubAggregation[] = [];
  for (const p of PILLARS) {
    for (const sub of p.subInterventions) {
      const b = bySub.get(sub)!;
      seen.add(sub);
      out.push({
        pillar: p.code,
        pillarLabel: p.label,
        pillarColor: p.color,
        sub: b.sub,
        companies: b.companies.size,
        assignmentsTotal: b.assignmentsTotal,
        status: b.status,
        plannedUsd: b.plannedUsd,
        paidUsd: b.paidUsd,
      });
    }
    const unallocated = unallocatedSub(p.code);
    if (unallocated) {
      const b = bySub.get(unallocated);
      if (b && b.assignmentsTotal > 0) {
        seen.add(unallocated);
        out.push({
          pillar: p.code,
          pillarLabel: p.label,
          pillarColor: p.color,
          sub: b.sub,
          companies: b.companies.size,
          assignmentsTotal: b.assignmentsTotal,
          status: b.status,
          plannedUsd: b.plannedUsd,
          paidUsd: b.paidUsd,
        });
      }
    }
  }
  // Anything still in bySub that we didn't emit (rogue legacy codes
  // that resolveIntervention couldn't slot into a known pillar) — fall
  // through with their best-effort pillar metadata. Empty seed buckets
  // (assignmentsTotal === 0) stay hidden so we don't pad the table.
  for (const [sub, b] of bySub) {
    if (seen.has(sub)) continue;
    if (b.assignmentsTotal === 0) continue;
    const p = pillarFor(b.pillar);
    out.push({
      pillar: b.pillar,
      pillarLabel: p?.label ?? b.pillar,
      pillarColor: p?.color ?? 'navy',
      sub: b.sub,
      companies: b.companies.size,
      assignmentsTotal: b.assignmentsTotal,
      status: b.status,
      plannedUsd: b.plannedUsd,
      paidUsd: b.paidUsd,
    });
  }
  return out;
}

// ─── re-export the helper consumers also need ────────────────────────

export { indexPaymentsByCompany };
