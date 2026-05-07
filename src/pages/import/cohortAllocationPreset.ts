// One-time ingest of the Elevate 2026 Budget Intervention Allocation
// xlsx into the portal-owned Companies + Intervention Assignments tabs.
//
// This is the seed for Stage 3 distribution: 41 companies, 3 AMs
// (Mohammad/Doaa/Muna), 6 intervention codes, 2 donors. Once seeded,
// the portal becomes the live editor of the cohort allocation; the
// xlsx is the historical record of how we got there.
//
// Idempotent: re-running against the same file produces zero new rows
// when the data already matches. Mismatches (e.g. someone changed an
// AM in Sheets after the seed) are reported as updates the operator
// can review before committing.
//
// Source xlsx columns: # | Company | City | Intervention | Intervention2
// | Intervention3 | Donor | LIN Code | POC | Total Estimated Budget
// | Agreement | Reg Document

import type { Company, Assignment } from '../../data/types';
import { resolveIntervention } from '../../config/interventions';
import type { ParsedSheet } from '../../lib/import/parse';
import { fuzzyNorm } from '../../lib/normalize';
import { canonicalCohortName } from '../../config/cohort3Aliases';

// POC display name in xlsx → email in team.ts.
// "Mohammad" without a surname maps to Mohammed Ayesh per the team.
export const POC_TO_EMAIL: Record<string, string> = {
  mohammad: 'ayesh@gazaskygeeks.com',
  mohammed: 'ayesh@gazaskygeeks.com',
  ayesh: 'ayesh@gazaskygeeks.com',
  doaa: 'doaa@gazaskygeeks.com',
  muna: 'muna@gazaskygeeks.com',
};

const REQUIRED_HEADERS = ['Company', 'City', 'Intervention', 'POC'];
const INTERVENTION_HEADERS = ['Intervention', 'Intervention2', 'Intervention3'];

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function pocToEmail(poc: string): string {
  const key = norm(poc);
  return POC_TO_EMAIL[key] ?? '';
}

function companyIdFor(name: string): string {
  return `co-${slugify(name)}`;
}

function assignmentIdFor(companyId: string, sub: string, idx: number): string {
  // Suffix with idx to disambiguate when a company has the same sub
  // listed twice (which currently never happens but stays safe).
  return `asg-${companyId}-${slugify(sub) || 'na'}${idx > 0 ? `-${idx}` : ''}`;
}

export type AllocationPlan = {
  /** Companies to create (no row in the master tab matches by name). */
  newCompanies: Company[];
  /** Companies whose master-tab row will receive non-destructive updates. */
  updateCompanies: { id: string; updates: Partial<Company> }[];
  /** Assignments to append (no existing row matches assignment_id). */
  newAssignments: Assignment[];
  /** Assignments whose row will receive non-destructive updates. */
  updateAssignments: { id: string; updates: Partial<Assignment> }[];
  /** Per-row warnings the operator should review. */
  warnings: string[];
};

function colIndexes(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headers.forEach((h, i) => { out[h.trim()] = i; });
  return out;
}

export function validateHeaders(sheet: ParsedSheet): string | null {
  const missing = REQUIRED_HEADERS.filter(h => !sheet.headers.some(sh => sh.trim() === h));
  if (missing.length > 0) {
    return `Missing required headers: ${missing.join(', ')}. ` +
      `Expected the Elevate 2026 Budget Intervention Allocation xlsx layout.`;
  }
  return null;
}

export function mapAllocationXlsx(
  sheet: ParsedSheet,
  existingCompanies: Company[],
  existingAssignments: Assignment[],
): AllocationPlan {
  const idx = colIndexes(sheet.headers);
  const plan: AllocationPlan = {
    newCompanies: [],
    updateCompanies: [],
    newAssignments: [],
    updateAssignments: [],
    warnings: [],
  };

  // Index existing data for fast lookup. Three indexes, in match priority:
  //   1. exact normalized name
  //   2. fuzzy normalized name (strips suffixes / punctuation)
  //   3. cohort canonical name — the explicit alias map in
  //      src/config/cohort3Aliases.ts. This is what catches "NCS" ⇄
  //      "National Cyber Security Company" and similar where neither
  //      exact nor fuzzy matching alone would.
  const companyByName = new Map<string, Company>();
  const companyByNameFuzzy = new Map<string, Company>();
  const companyByCanonical = new Map<string, Company>();
  const companyByIdSeen = new Set<string>();
  for (const c of existingCompanies) {
    if (c.company_name) {
      companyByName.set(norm(c.company_name), c);
      const fk = fuzzyNorm(c.company_name);
      if (fk && !companyByNameFuzzy.has(fk)) companyByNameFuzzy.set(fk, c);
      const canon = canonicalCohortName(c.company_name);
      if (canon && !companyByCanonical.has(canon)) companyByCanonical.set(canon, c);
    }
    if (c.company_id) companyByIdSeen.add(c.company_id);
  }
  const assignmentById = new Map<string, Assignment>();
  for (const a of existingAssignments) {
    if (a.assignment_id) assignmentById.set(a.assignment_id, a);
  }

  // Track ids we generated this pass, to keep multi-row dedup correct.
  const plannedNewCompanyIds = new Set<string>();
  const plannedNewAssignmentIds = new Set<string>();

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const name = (row[idx['Company']] ?? '').trim();
    if (!name) {
      // Skip blank-name rows (e.g. the unnamed MKG row on RPS Check sheet).
      continue;
    }
    const city = (row[idx['City']] ?? '').trim();
    const poc = (row[idx['POC']] ?? '').trim();
    const donor = (row[idx['Donor']] ?? '').trim();
    const linCode = idx['LIN Code'] !== undefined ? (row[idx['LIN Code']] ?? '').trim() : '';
    const budgetCol = idx['Total Estimated Budget'];
    const budget = budgetCol !== undefined ? (row[budgetCol] ?? '').trim() : '';
    const regDocCol = idx['Reg Document'] ?? idx['Reg Document '];
    const regDoc = regDocCol !== undefined ? (row[regDocCol] ?? '').trim() : '';

    const pmEmail = pocToEmail(poc);
    if (poc && !pmEmail) {
      plan.warnings.push(`Row ${r + 2} (${name}): unknown POC '${poc}' — assignment owner will be blank.`);
    }

    // Resolve or plan the company row. Try in order: exact name,
    // fuzzy normalized, then explicit cohort canonical (the alias map).
    // The alias map handles cases like "NCS" matching the existing
    // "National Cyber Security Company" master row.
    const canon = canonicalCohortName(name);
    const existing =
      companyByName.get(norm(name)) ||
      companyByNameFuzzy.get(fuzzyNorm(name)) ||
      (canon ? companyByCanonical.get(canon) : undefined);
    let companyId: string;
    // Track whether we're overwriting the AM on this row, so we can
    // also propagate the change to the assignments' owner_email below.
    let pocOverridden = false;
    if (existing) {
      companyId = existing.company_id;
      // Build a list of fields that have changed and aren't already filled
      // in the master row. The xlsx is treated as authoritative for AM
      // (POC), donor, and reg-document; non-AM operational fields (like
      // `status`) are left alone if already set so the team's
      // hand-advanced values aren't clobbered.
      const updates: Partial<Company> = {};
      if (!existing.city && city) updates.city = city;
      if (!existing.profile_manager_email && pmEmail) {
        updates.profile_manager_email = pmEmail;
      } else if (existing.profile_manager_email && pmEmail && existing.profile_manager_email !== pmEmail) {
        // The xlsx is the post-Stage-2 authoritative allocation, so on
        // a POC mismatch the xlsx wins. Surface a warning so the
        // operator can see exactly what's changing before commit.
        plan.warnings.push(
          `Row ${r + 2} (${name}): POC differs — overwriting '${existing.profile_manager_email}' → '${pmEmail}' from xlsx.`,
        );
        updates.profile_manager_email = pmEmail;
        pocOverridden = true;
      }
      if (!existing.fund_code && donor) updates.fund_code = donor;
      if (!existing.drive_folder_url && regDoc) updates.drive_folder_url = regDoc;
      if (Object.keys(updates).length > 0) {
        plan.updateCompanies.push({ id: companyId, updates });
      }
    } else {
      companyId = companyIdFor(name);
      // De-dup against earlier rows in the same xlsx that produced the same id.
      if (plannedNewCompanyIds.has(companyId) || companyByIdSeen.has(companyId)) {
        plan.warnings.push(`Row ${r + 2} (${name}): generated company_id '${companyId}' collides with existing — skipping creation.`);
      } else {
        plannedNewCompanyIds.add(companyId);
        plan.newCompanies.push({
          company_id: companyId,
          company_name: name,
          legal_name: '',
          city,
          governorate: '',
          sector: '',
          employee_count: '',
          revenue_bracket: '',
          international_revenue_pct: '',
          readiness_score: '',
          fund_code: donor,
          cohort: '3',
          status: 'Active',
          stage: 'Onboarding',
          profile_manager_email: pmEmail,
          selection_date: '',
          onboarding_date: '',
          drive_folder_url: regDoc,
          notes: '',
        });
      }
    }

    // For each non-empty Intervention column, plan an assignment.
    for (let i = 0; i < INTERVENTION_HEADERS.length; i++) {
      const colKey = INTERVENTION_HEADERS[i];
      const colIdx = idx[colKey];
      if (colIdx === undefined) continue;
      const code = (row[colIdx] ?? '').trim();
      if (!code) continue;
      const resolved = resolveIntervention(code);
      if (!resolved) {
        plan.warnings.push(`Row ${r + 2} (${name}): unknown intervention code '${code}' — skipped.`);
        continue;
      }
      const sub = resolved.sub || resolved.pillar;
      const aId = assignmentIdFor(companyId, sub, i);
      const flavor = resolved.flavor;
      // Only the first intervention column carries the budget, per the
      // xlsx convention; subsequent columns are blank unless the team
      // splits later.
      const budgetThisAsg = i === 0 ? budget : '';

      const existingAsg = assignmentById.get(aId);
      if (existingAsg) {
        const updates: Partial<Assignment> = {};
        if (!existingAsg.intervention_type && resolved.pillar) updates.intervention_type = resolved.pillar;
        if (!existingAsg.sub_intervention && sub) updates.sub_intervention = sub;
        if (!existingAsg.fund_code && donor) updates.fund_code = donor;
        if (!existingAsg.owner_email && pmEmail) updates.owner_email = pmEmail;
        // When the company's POC was overridden by the xlsx, the
        // matching assignment owners need to follow.
        else if (pocOverridden && pmEmail && existingAsg.owner_email !== pmEmail) {
          updates.owner_email = pmEmail;
        }
        if (!existingAsg.budget_usd && budgetThisAsg) updates.budget_usd = budgetThisAsg;
        if (flavor && !(existingAsg.notes || '').includes(flavor)) {
          updates.notes = existingAsg.notes ? `${existingAsg.notes} | ${flavor}` : flavor;
        }
        if (linCode && !existingAsg['lin_code']) {
          (updates as Assignment)['lin_code'] = linCode;
        }
        if (Object.keys(updates).length > 0) {
          plan.updateAssignments.push({ id: aId, updates });
        }
      } else if (!plannedNewAssignmentIds.has(aId)) {
        plannedNewAssignmentIds.add(aId);
        const newRow: Assignment = {
          assignment_id: aId,
          company_id: companyId,
          intervention_type: resolved.pillar,
          sub_intervention: sub,
          fund_code: donor,
          start_date: '',
          end_date: '',
          owner_email: pmEmail,
          status: 'Planned',
          budget_usd: budgetThisAsg,
          notes: flavor || '',
        };
        if (linCode) (newRow as Assignment)['lin_code'] = linCode;
        plan.newAssignments.push(newRow);
      }
    }

    // If we overrode the company's POC, also re-point every existing
    // assignment for this company that's still owned by someone else.
    // This catches assignments created via Stage 2 finalize (which use a
    // different assignment_id naming scheme than the seed) and assignments
    // for sub-interventions the xlsx doesn't list this round.
    if (pocOverridden && pmEmail) {
      const alreadyQueued = new Set(plan.updateAssignments.map(u => u.id));
      for (const a of existingAssignments) {
        if (a.company_id !== companyId) continue;
        if (!a.assignment_id || alreadyQueued.has(a.assignment_id)) continue;
        if ((a.owner_email || '').toLowerCase() === pmEmail.toLowerCase()) continue;
        plan.updateAssignments.push({
          id: a.assignment_id,
          updates: { owner_email: pmEmail },
        });
      }
    }
  }

  return plan;
}
