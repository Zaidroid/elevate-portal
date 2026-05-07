// Background maintenance pipeline.
//
// Runs once after admin sign-in. Detects drift in the cohort 3 data
// the team thinks of as automatic (Conference Tracker decisions
// should land as cohort assignments; pillar-only Marketing rows
// should carry a real sub) and writes the fixes silently.
// Non-fatal if Sheets writes fail — the manual cards on /admin/lookups
// remain as the safety net.
//
// The autopilot is keyed by session storage so it only runs once per
// browser tab per sign-in. Closing + reopening the tab triggers
// another sync; signing out + back in does too.

import type { Company, Assignment, ConferenceTrackerRow } from '../../data/types';
import { canonicalCohortName } from '../../config/cohort3Aliases';
import { keepCompaniesSection } from '../sheets/sections';

const MKG_DEFAULT_SUB = 'Marketing Agency';
const MKG_EMPTY_SUB_VALUES = new Set(['', 'mkg', 'marketing']);
const COMMITTED_DECISIONS = new Set(['committed', 'attended']);

export type AutopilotFix = {
  kind: 'mkg_sub_set' | 'conf_assignment_created';
  company_id: string;
  company_name: string;
  detail: string;
};

export type AutopilotPlan = {
  mkgFixes: AutopilotFix[];
  confAdds: Array<{
    company_id: string;
    company_name: string;
    conference_name: string;
    decision: string;
  }>;
};

// Compute the plan without writing. Pure function so callers can show
// it in the UI before / after the autopilot runs.
export function computeAutopilotPlan(input: {
  companies: Company[];
  assignments: Assignment[];
  trackerRows: ConferenceTrackerRow[];
  trackerHeaders: string[];
}): AutopilotPlan {
  const cohortById = new Map<string, Company>();
  const cohortByCanonical = new Map<string, Company>();
  for (const c of input.companies) {
    const canon = canonicalCohortName(c.company_name || '');
    if (!canon) continue;
    cohortById.set(c.company_id, c);
    cohortByCanonical.set(canon, c);
  }

  // 1) MKG-only assignments.
  const mkgFixes: AutopilotFix[] = [];
  for (const a of input.assignments) {
    if (!cohortById.has(a.company_id)) continue;
    const it = (a.intervention_type || '').trim().toLowerCase();
    const sub = (a.sub_intervention || '').trim().toLowerCase();
    if (it !== 'mkg' && it !== 'marketing & branding' && it !== 'marketing') continue;
    if (!MKG_EMPTY_SUB_VALUES.has(sub)) continue;
    const c = cohortById.get(a.company_id)!;
    mkgFixes.push({
      kind: 'mkg_sub_set',
      company_id: a.company_id,
      company_name: c.company_name || a.company_id,
      detail: `${a.assignment_id}: sub_intervention → ${MKG_DEFAULT_SUB}`,
    });
  }

  // 2) Conference Tracker → Companies Assignments sync.
  const subsByCompany = new Map<string, Set<string>>();
  for (const a of input.assignments) {
    const id = a.company_id;
    if (!id) continue;
    const sub = (a.sub_intervention || '').trim();
    if (!sub) continue;
    if (!subsByCompany.has(id)) subsByCompany.set(id, new Set());
    subsByCompany.get(id)!.add(sub);
  }

  const trackerCompanies = keepCompaniesSection(input.trackerRows, input.trackerHeaders) as ConferenceTrackerRow[];
  const seen = new Set<string>();
  const confAdds: AutopilotPlan['confAdds'] = [];
  for (const r of trackerCompanies) {
    const decision = (r.decision || '').trim().toLowerCase();
    if (!COMMITTED_DECISIONS.has(decision)) continue;
    let comp: Company | undefined;
    if (r.company_id && cohortById.has(r.company_id)) comp = cohortById.get(r.company_id);
    if (!comp && r.company_name) {
      const canon = canonicalCohortName(r.company_name);
      if (canon) comp = cohortByCanonical.get(canon);
    }
    if (!comp) continue;
    if (seen.has(comp.company_id)) continue;
    if (subsByCompany.get(comp.company_id)?.has('Conferences')) continue;
    seen.add(comp.company_id);
    confAdds.push({
      company_id: comp.company_id,
      company_name: comp.company_name,
      conference_name: r.conference_name || '',
      decision: r.decision || '',
    });
  }

  return { mkgFixes, confAdds };
}

export function mintConferenceAssignmentId(companyId: string): string {
  // Match the Stage-3 writer's id shape so audit + dedupe still work.
  return `asn-${companyId}-MA-Conferences-${Date.now()}`;
}

// Session-storage key so we don't re-run within the same tab session.
// Encodes a hash of the plan so a meaningfully changed plan still
// triggers a re-run if the page is refreshed.
const SESSION_KEY = 'elevate.autopilot.lastRun';

function planSignature(plan: AutopilotPlan): string {
  const mkg = plan.mkgFixes.map(f => f.company_id).sort().join(',');
  const conf = plan.confAdds.map(c => c.company_id).sort().join(',');
  return `mkg:${mkg}|conf:${conf}`;
}

export function shouldRun(plan: AutopilotPlan): boolean {
  if (plan.mkgFixes.length === 0 && plan.confAdds.length === 0) return false;
  try {
    const last = sessionStorage.getItem(SESSION_KEY);
    if (last && last === planSignature(plan)) return false;
  } catch {
    // sessionStorage unavailable — run anyway.
  }
  return true;
}

export function markRan(plan: AutopilotPlan): void {
  try {
    sessionStorage.setItem(SESSION_KEY, planSignature(plan));
  } catch { /* non-fatal */ }
}
