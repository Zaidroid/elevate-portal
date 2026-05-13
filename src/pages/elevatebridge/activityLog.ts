// Best-effort append-only activity log for the ElevateBridge workbook.
// Mirrors the freelancers/companies pattern: writes ALWAYS proceed even
// if the log append fails. The Activity tab in the Overview reads this
// log back to render a unified audit trail.

import { appendRows } from '../../lib/sheets/client';

export type EbActivityAction =
  | 'applicant_updated'
  | 'decision_changed'
  | 'score_edited'
  | 'interview_scored'
  | 'session_created'
  | 'session_updated'
  | 'attendance_marked'
  | 'mentor_updated'
  | 'rubric_updated'
  | 'top_performer_updated'
  | 'import_external'
  | 'export';

export type EbActivityInput = {
  sheetId: string;
  tabName: string;
  user_email?: string;
  entity_type?: string;
  entity_id?: string;
  action: EbActivityAction;
  field?: string;
  old_value?: string;
  new_value?: string;
  details?: string;
};

const EB_ACTIVITY_HEADERS = [
  'activity_id',
  'timestamp',
  'user_email',
  'entity_type',
  'entity_id',
  'action',
  'field',
  'old_value',
  'new_value',
  'details',
];

let activityIdSeq = 0;
function mintActivityId(timestamp: string, action: string, entityId: string): string {
  activityIdSeq = (activityIdSeq + 1) % 1_000_000;
  const slug = `${action}-${entityId}-${timestamp}-${activityIdSeq.toString(36)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 100);
  return `eb-act-${slug}`;
}

export async function appendEbActivity(input: EbActivityInput): Promise<void> {
  if (!input.sheetId || !input.tabName) return;
  const now = new Date().toISOString();
  const row: Record<string, string> = {
    activity_id: mintActivityId(now, input.action, input.entity_id || 'global'),
    timestamp: now,
    user_email: input.user_email || '',
    entity_type: input.entity_type || '',
    entity_id: input.entity_id || '',
    action: input.action,
    field: input.field || '',
    old_value: input.old_value || '',
    new_value: input.new_value || '',
    details: input.details || '',
  };
  const values = [EB_ACTIVITY_HEADERS.map(h => row[h] || '')];
  try {
    await appendRows(input.sheetId, `${input.tabName}!A1`, values);
  } catch (err) {
    console.warn('[eb-activity-log] append failed', input.action, err);
  }
}

// Compute a small diff between two row snapshots so the drawer/save flow
// can record one activity row per changed field. Mirrors the companies
// reviews pattern.
export function diffForEbActivity<T extends Record<string, unknown>>(
  before: T,
  after: T,
): Array<{ field: string; old_value: string; new_value: string }> {
  const out: Array<{ field: string; old_value: string; new_value: string }> = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if ((a ?? '') === (b ?? '')) continue;
    out.push({
      field: k,
      old_value: a == null ? '' : String(a),
      new_value: b == null ? '' : String(b),
    });
  }
  return out;
}
