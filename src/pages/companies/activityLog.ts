// Best-effort append-only activity log for the Companies workbook.
// Every meaningful write (review save, comment, lock decision, alias
// edit, removal, materialize, dashboard repair, export, import) calls
// `appendActivity` so the team has a real audit trail. Failures here
// must NEVER block the originating write — we swallow errors and log
// to console.

import { appendRows } from '../../lib/sheets/client';
import { ACTIVITY_HEADERS } from './reviewTypes';
import type { ActivityRow } from './reviewTypes';

export type ActivityAction =
  | 'review_saved'
  | 'comment_added'
  | 'pm_assigned'
  | 'finalize_locked'
  | 'alias_create'
  | 'alias_update'
  | 'alias_clear'
  | 'company_removed'
  | 'company_restored'
  | 'materialize'
  | 'dashboard_repair'
  | 'export'
  | 'auto_dedupe'
  | 'import_external'
  | 'pre_decision_added'
  | 'presence';

export type ActivityInput = {
  sheetId: string;
  tabName: string;
  user_email?: string;
  company_id?: string;
  action: ActivityAction;
  field?: string;
  old_value?: string;
  new_value?: string;
  details?: string;
};

function activityIdFor(timestamp: string, action: string, companyId: string): string {
  const slug = `${action}-${companyId}-${timestamp}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 100);
  return `act-${slug}`;
}

export async function appendActivity(input: ActivityInput): Promise<void> {
  if (!input.sheetId || !input.tabName) return;
  const now = new Date().toISOString();
  const row: ActivityRow = {
    activity_id: activityIdFor(now, input.action, input.company_id || 'global'),
    timestamp: now,
    user_email: input.user_email || '',
    company_id: input.company_id || '',
    action: input.action,
    field: input.field || '',
    old_value: input.old_value || '',
    new_value: input.new_value || '',
    details: input.details || '',
  };
  // Match the canonical header order from ACTIVITY_HEADERS.
  const values = [ACTIVITY_HEADERS.map(h => (row as unknown as Record<string, string>)[h] || '')];
  try {
    await appendRows(input.sheetId, `${input.tabName}!A1`, values);
  } catch (err) {
    console.warn('[activity-log] append failed', input.action, err);
  }
}

// Higher-order helper — wraps a write so we always log on success.
// Failure of the wrapped fn re-throws (the caller still needs to see it);
// activity logging is fire-and-forget either way.
export async function withActivityLog<T>(
  meta: Omit<ActivityInput, 'action'> & { action: ActivityAction },
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();
  void appendActivity(meta);
  return result;
}
