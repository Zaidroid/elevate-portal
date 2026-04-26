// ElevateBridge module helpers. Pipeline reflects the matching workflow:
// Available -> Matched -> Active -> Producing -> Released. The 203
// freelancers in the pool are pre-vetted and pre-selected — the team's
// job is to pair them with Cohort 3 companies so they can act as a sales
// funnel (Upwork proposals, social outreach, deal closing).

import { appendRows } from '../../lib/sheets/client';
import type {
  Freelancer,
  FreelancerActivity,
  FreelancerComment,
  FreelancerFollowUp,
} from '../../types/freelancer';

// SLA defaults — keep in sync with FREELANCER_SLA_DAYS in
// sheet-builders/gsg_sheets/taxonomies.py.
export const FL_SLA_DAYS: Record<string, number> = {
  Available: 30,
  Matched: 14,
  Active: 90,
  Producing: 365,
  'On Hold': 14,
  Released: 30,
  Dropped: 9999,
  Archived: 9999,
};

export function daysSinceIso(iso: string): number {
  if (!iso) return -1;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function lastStatusChangeIso(fl: Freelancer, activity: FreelancerActivity[]): string {
  let latest = '';
  for (const a of activity) {
    if (a.freelancer_id !== fl.freelancer_id) continue;
    if (a.action !== 'status_change') continue;
    if (!latest || (a.timestamp || '') > latest) latest = a.timestamp || '';
  }
  if (latest) return latest;
  return fl.updated_at || '';
}

export type CompanyLite = {
  company_id: string;
  company_name: string;
  sector?: string;
  governorate?: string;
  status?: string;
};

export type EnrichedFreelancer = Freelancer & {
  followups_for: FreelancerFollowUp[];
  comments_for: FreelancerComment[];
  activity_for: FreelancerActivity[];
  open_followups: number;
  overdue_followups: number;
  days_in_status: number;
  is_stuck: boolean;
  matched_company_name?: string; // resolved from company_id when present
};

export function enrichFreelancers(
  freelancers: Freelancer[],
  followups: FreelancerFollowUp[],
  comments: FreelancerComment[],
  activity: FreelancerActivity[],
  companies: CompanyLite[] = []
): EnrichedFreelancer[] {
  const todayIso = new Date().toISOString().slice(0, 10);
  const fByFl = new Map<string, FreelancerFollowUp[]>();
  const cByFl = new Map<string, FreelancerComment[]>();
  const aByFl = new Map<string, FreelancerActivity[]>();
  for (const f of followups) {
    if (!fByFl.has(f.freelancer_id)) fByFl.set(f.freelancer_id, []);
    fByFl.get(f.freelancer_id)!.push(f);
  }
  for (const c of comments) {
    if (!cByFl.has(c.freelancer_id)) cByFl.set(c.freelancer_id, []);
    cByFl.get(c.freelancer_id)!.push(c);
  }
  for (const a of activity) {
    if (!aByFl.has(a.freelancer_id)) aByFl.set(a.freelancer_id, []);
    aByFl.get(a.freelancer_id)!.push(a);
  }
  const companyById = new Map<string, CompanyLite>();
  for (const c of companies) if (c.company_id) companyById.set(c.company_id, c);

  return freelancers.map(fl => {
    const fs = fByFl.get(fl.freelancer_id) || [];
    const open = fs.filter(f => f.status === 'Open');
    const overdue = open.filter(f => f.due_date && f.due_date < todayIso);

    const lastChange = lastStatusChangeIso(fl, activity);
    const dis = daysSinceIso(lastChange);
    const status = fl.status || 'Available';
    const sla = FL_SLA_DAYS[status] ?? 9999;
    const stuck = dis > sla;

    const matchedCompany = fl.company_id ? companyById.get(fl.company_id) : undefined;

    return {
      ...fl,
      followups_for: fs,
      comments_for: cByFl.get(fl.freelancer_id) || [],
      activity_for: aByFl.get(fl.freelancer_id) || [],
      open_followups: open.length,
      overdue_followups: overdue.length,
      days_in_status: dis,
      is_stuck: stuck,
      matched_company_name: matchedCompany?.company_name,
    };
  });
}

export async function appendFreelancerActivity(
  sheetId: string,
  tabName: string,
  row: {
    user_email: string;
    freelancer_id: string;
    action: string;
    field?: string;
    old_value?: string;
    new_value?: string;
    details?: string;
  }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    // Column order: activity_id, timestamp, user_email, freelancer_id,
    // action, field, old_value, new_value, details
    const values: (string | number | boolean)[] = [
      '',
      now,
      row.user_email || '',
      row.freelancer_id,
      row.action,
      row.field || '',
      row.old_value || '',
      row.new_value || '',
      row.details || '',
    ];
    await appendRows(sheetId, `${tabName}!A:A`, [values]);
  } catch (err) {
    console.error('[freelancers] activity log append failed', err);
  }
}

export function diffForActivity(
  before: Partial<Freelancer>,
  updates: Partial<Freelancer>
): Array<{ field: string; old: string; next: string }> {
  const out: Array<{ field: string; old: string; next: string }> = [];
  for (const k of Object.keys(updates) as (keyof Freelancer)[]) {
    const oldV = String(before[k] ?? '');
    const nextV = String(updates[k] ?? '');
    if (oldV !== nextV) out.push({ field: k, old: oldV, next: nextV });
  }
  return out;
}

export function matchesFreelancerQuery(fl: EnrichedFreelancer, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    fl.full_name,
    fl.email,
    fl.location,
    fl.assigned_mentor,
    fl.assignee_email,
    fl.tracker_notes,
    fl.notes,
    fl.company_id,
    fl.matched_company_name,
    fl.track,
    fl.role_profile,
  ]
    .filter(Boolean)
    .some(v => String(v).toLowerCase().includes(needle));
}

// Pipeline columns rendered in the kanban — Dropped + Archived sit outside
// the active board.
export type FreelancerPipelineId =
  | 'available'
  | 'matched'
  | 'active'
  | 'producing'
  | 'on_hold'
  | 'released'
  | 'dropped';

export const FL_PIPELINE_COLUMNS: { id: FreelancerPipelineId; label: string; tone: string }[] = [
  { id: 'available', label: 'Available', tone: 'slate' },
  { id: 'matched', label: 'Matched', tone: 'amber' },
  { id: 'active', label: 'Active', tone: 'teal' },
  { id: 'producing', label: 'Producing', tone: 'green' },
  { id: 'on_hold', label: 'On Hold', tone: 'slate' },
  { id: 'released', label: 'Released', tone: 'navy' },
  { id: 'dropped', label: 'Dropped', tone: 'red' },
];

export const FL_PIPELINE_LABEL_BY_ID: Record<FreelancerPipelineId, string> = {
  available: 'Available',
  matched: 'Matched',
  active: 'Active',
  producing: 'Producing',
  on_hold: 'On Hold',
  released: 'Released',
  dropped: 'Dropped',
};

const FL_STATUS_NORMALIZE: Record<string, FreelancerPipelineId> = {
  available: 'available',
  matched: 'matched',
  active: 'active',
  producing: 'producing',
  'on hold': 'on_hold',
  on_hold: 'on_hold',
  released: 'released',
  dropped: 'dropped',
};

export function flNormalizeStatus(s: string | undefined): FreelancerPipelineId {
  return FL_STATUS_NORMALIZE[(s || '').toLowerCase().trim()] || 'available';
}

// Workflow guidance per status — pinned to each kanban card and surfaced
// at the top of the detail drawer.
export const FL_NEXT_ACTION: Record<FreelancerPipelineId, { label: string; intent: string; nextStatus?: FreelancerPipelineId }> = {
  available: {
    label: 'Match with a company',
    intent: 'Open the drawer and pick a Cohort 3 company that needs sales support',
    nextStatus: 'matched',
  },
  matched: {
    label: 'Onboard',
    intent: 'Brief the freelancer on the company\'s services, set up tools, kickoff call',
    nextStatus: 'active',
  },
  active: {
    label: 'Track production',
    intent: 'Confirm proposals are going out; first lead means -> Producing',
    nextStatus: 'producing',
  },
  producing: {
    label: 'Plan exit / continue',
    intent: 'Decide whether to extend, end the engagement, or roll to a new company',
    nextStatus: 'released',
  },
  on_hold: {
    label: 'Re-decide',
    intent: 'Resume, re-match, or move to Released / Dropped after a week',
  },
  released: {
    label: 'Re-match',
    intent: 'Match with a new company, or move back to Available',
    nextStatus: 'matched',
  },
  dropped: {
    label: 'Archive',
    intent: 'No further action — keep the record for reference',
  },
};

export function extractMentions(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  const re = /@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1].toLowerCase());
  return Array.from(new Set(out));
}
