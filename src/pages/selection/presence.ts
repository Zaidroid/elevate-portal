// Lightweight multi-user presence for the Selection module. Appends
// `action='presence'` rows to the Companies workbook's Activity Log
// every 60s while a team member is on the page. The Selection module
// can read those rows back (filtered to last-90s) to show "who is
// looking at this company right now" badges.
//
// Best-effort: presence write failure is silent (same fail-soft
// philosophy as appendActivity). No retries, no toasts — if the API
// call fails the heartbeat just skips that tick.

import { appendActivity } from '../companies/activityLog';
import { getSheetId, getTab } from '../../config/sheets';

const HEARTBEAT_MS = 60_000;

// Start a heartbeat. Returns a cleanup function for the unmount.
export function startPresenceHeartbeat(userEmail: string, companyId?: string): () => void {
  const sheetId = getSheetId('companies');
  const tabName = getTab('companies', 'activity');
  if (!sheetId || !userEmail) return () => {};

  const ping = () => {
    void appendActivity({
      sheetId,
      tabName,
      user_email: userEmail,
      company_id: companyId || '',
      action: 'presence',
      details: companyId ? 'viewing company' : 'on selection page',
    });
  };

  // Fire one immediately so the badge appears within the first read.
  ping();
  const id = setInterval(ping, HEARTBEAT_MS);
  return () => clearInterval(id);
}

// Compute the set of user emails currently viewing each company. Reads
// the activity log rows passed in (already loaded by useSheetDoc) and
// filters to recent presence entries.
export type PresenceMap = Map<string, string[]>;   // companyId → user_emails (most recent first)

export function computePresence(activityRows: Array<{ action: string; user_email: string; company_id: string; timestamp: string }>, windowMs = 90_000): PresenceMap {
  const cutoff = Date.now() - windowMs;
  const seen = new Map<string, Map<string, number>>(); // companyId → (email → latestTs)
  for (const r of activityRows) {
    if (r.action !== 'presence') continue;
    const ts = Date.parse(r.timestamp || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const cid = r.company_id || '';
    const inner = seen.get(cid) || new Map<string, number>();
    const prev = inner.get(r.user_email) || 0;
    if (ts > prev) inner.set(r.user_email, ts);
    seen.set(cid, inner);
  }
  const out: PresenceMap = new Map();
  for (const [cid, emails] of seen) {
    out.set(cid, Array.from(emails.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]));
  }
  return out;
}
