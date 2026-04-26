// Advisors module helpers: scoring write-back, activity log appender,
// derived enrichment that joins follow-ups + comments + activity onto an
// advisor row, formatting + filtering.

import { appendRows } from '../../lib/sheets/client';
import { computeStage1, computeStage2 } from '../../lib/advisor-scoring';
import type {
  ActivityRow,
  Advisor,
  AdvisorComment,
  FollowUp,
  Stage1Score,
  Stage2Score,
} from '../../types/advisor';

export type EnrichedAdvisor = Advisor & {
  stage1: Stage1Score;
  stage2: Stage2Score;
  followups_for: FollowUp[];
  comments_for: AdvisorComment[];
  activity_for: ActivityRow[];
  open_followups: number;
  overdue_followups: number;
};

export function enrichAdvisors(
  advisors: Advisor[],
  followups: FollowUp[],
  comments: AdvisorComment[],
  activity: ActivityRow[]
): EnrichedAdvisor[] {
  const todayIso = new Date().toISOString().slice(0, 10);
  const fByAdv = new Map<string, FollowUp[]>();
  const cByAdv = new Map<string, AdvisorComment[]>();
  const aByAdv = new Map<string, ActivityRow[]>();
  for (const f of followups) {
    if (!fByAdv.has(f.advisor_id)) fByAdv.set(f.advisor_id, []);
    fByAdv.get(f.advisor_id)!.push(f);
  }
  for (const c of comments) {
    if (!cByAdv.has(c.advisor_id)) cByAdv.set(c.advisor_id, []);
    cByAdv.get(c.advisor_id)!.push(c);
  }
  for (const a of activity) {
    if (!aByAdv.has(a.advisor_id)) aByAdv.set(a.advisor_id, []);
    aByAdv.get(a.advisor_id)!.push(a);
  }
  return advisors.map(adv => {
    const stage1 = computeStage1(adv);
    const stage2 = stage1.pass
      ? computeStage2(adv)
      : { ceo: 0, cto: 0, coo: 0, marketing: 0, ai: 0, primary: 'Unqualified' as const };
    const fs = fByAdv.get(adv.advisor_id) || [];
    const open = fs.filter(f => f.status === 'Open');
    const overdue = open.filter(f => f.due_date && f.due_date < todayIso);
    return {
      ...adv,
      stage1,
      stage2,
      followups_for: fs,
      comments_for: cByAdv.get(adv.advisor_id) || [],
      activity_for: aByAdv.get(adv.advisor_id) || [],
      open_followups: open.length,
      overdue_followups: overdue.length,
    };
  });
}

// Stamp scores back onto the Advisors row whenever a field that affects
// scoring changes. The portal calls updateRow after this with the same set
// of fields plus the score columns so the sheet stays in lockstep.
export function scoreFields(adv: Partial<Advisor>): Partial<Advisor> {
  const s1 = computeStage1(adv);
  const s2 = s1.pass
    ? computeStage2(adv)
    : { ceo: 0, cto: 0, coo: 0, marketing: 0, ai: 0, primary: 'Unqualified' as const };
  return {
    stage1_score: String(s1.total),
    stage1_pass: s1.pass ? 'TRUE' : 'FALSE',
    stage2_category: s2.primary,
    stage2_score:
      s2.primary === 'Unqualified'
        ? '0'
        : String(s2[s2.primary.toLowerCase() as 'ceo' | 'cto' | 'coo' | 'marketing' | 'ai']),
  };
}

// Append a single activity row to the ActivityLog tab. Best-effort —
// failures are logged but do not block the originating write.
export async function appendActivity(
  sheetId: string,
  tabName: string,
  row: {
    user_email: string;
    advisor_id: string;
    action: string;
    field?: string;
    old_value?: string;
    new_value?: string;
    details?: string;
  }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    // Column order in the sheet: activity_id, timestamp, user_email,
    // advisor_id, action, field, old_value, new_value, details
    const values: (string | number | boolean)[] = [
      '', // activity_id is filled by the sheet's formula
      now,
      row.user_email || '',
      row.advisor_id,
      row.action,
      row.field || '',
      row.old_value || '',
      row.new_value || '',
      row.details || '',
    ];
    await appendRows(sheetId, `${tabName}!A:A`, [values]);
  } catch (err) {
    console.error('[advisors] activity log append failed', err);
  }
}

// Diff two advisor records, return the list of changes to log.
export function diffForActivity(
  before: Partial<Advisor>,
  updates: Partial<Advisor>
): Array<{ field: string; old: string; next: string }> {
  const out: Array<{ field: string; old: string; next: string }> = [];
  for (const k of Object.keys(updates) as (keyof Advisor)[]) {
    const oldV = String(before[k] ?? '');
    const nextV = String(updates[k] ?? '');
    if (oldV !== nextV) out.push({ field: k, old: oldV, next: nextV });
  }
  return out;
}

export function formatPipelineLabel(s: string): string {
  return s || 'New';
}

// String-based filter helpers used by the Roster table and Pipeline kanban.
export function matchesQuery(adv: EnrichedAdvisor, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    adv.full_name,
    adv.email,
    adv.country,
    adv.position,
    adv.employer,
    adv.tracker_notes,
    adv.assignment_company_id,
    adv.stage2_category,
  ]
    .filter(Boolean)
    .some(v => String(v).toLowerCase().includes(needle));
}

export const COUNTRY_NORMALIZE: Record<string, string> = {
  'gaza strip': 'Palestine',
  palestine: 'Palestine',
  'west bank': 'Palestine',
  jordan: 'Jordan',
  egypt: 'Egypt',
};

export function normalizeCountry(c: string): string {
  const k = (c || '').trim().toLowerCase();
  return COUNTRY_NORMALIZE[k] || (c || '').trim();
}
