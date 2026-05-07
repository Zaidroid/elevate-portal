// Outreach Log — portal-owned audit trail of advisor emails sent.
//
// Templates are composed and opened in the user's mail client (mailto/
// Outlook), so we can't observe the actual send. Instead, when the user
// clicks "Compose", we schedule a confirm prompt; if they confirm "Yes,
// I sent it", we append a row to the Outreach Log tab and stamp
// last_outreach_at + last_outreach_template on the advisor row.
//
// The tab is human-friendly: navy title, banded rows, hidden ID
// columns, status conditional formatting on template_key. The team can
// sort/filter the sheet directly to answer "who emailed whom when".

import { appendRows } from '../../lib/sheets/client';
import { ensureHumanFriendlyTab } from '../../lib/sheets/output-formatting';
import { getSheetId, getTab, SHEETS } from '../../config/sheets';

const OUTREACH_TAB_NAME = 'Outreach Log';

const OUTREACH_HEADERS = [
  'outreach_id',          // 0 — hidden, synthetic
  'advisor_id',           // 1 — hidden, FK
  'advisor_name',         // 2
  'email',                // 3
  'template_key',         // 4 — drives conditional formatting
  'template_label',       // 5
  'sender_email',         // 6
  'sent_at',              // 7
  'notes',                // 8
];

const HIDDEN_COLS = [0, 1];

const COL_WIDTHS: Record<number, number> = {
  2: 200,  // advisor_name
  3: 200,  // email
  4: 130,  // template_key
  5: 180,  // template_label
  6: 160,  // sender_email
  7: 140,  // sent_at
  8: 280,  // notes
};

export type OutreachEntry = {
  advisor_id: string;
  advisor_name: string;
  email: string;
  template_key: string;
  template_label: string;
  sender_email: string;
  sent_at: string;        // ISO timestamp
  notes?: string;
};

/**
 * Idempotent — safe to call before any append. Auto-registers the tab
 * the first time it runs and applies/refreshes the formatting recipe.
 */
export async function ensureOutreachTab(advisorsSheetId: string): Promise<void> {
  await ensureHumanFriendlyTab(advisorsSheetId, OUTREACH_TAB_NAME, {
    title: 'Advisor Outreach Log',
    subtitle: 'Append-only record of emails composed via the portal. One row per confirmed send.',
    headers: OUTREACH_HEADERS,
    hiddenColumnIndexes: HIDDEN_COLS,
    colWidths: COL_WIDTHS,
    statusColumn: 4,        // template_key drives the color
    expectedBodyRows: 500,
  });
}

function outreachIdFor(advisorId: string, templateKey: string, sentAt: string): string {
  const slug = `${templateKey}-${advisorId}-${sentAt}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 100);
  return `out-${slug}`;
}

/** Append a single outreach entry. Calls ensureOutreachTab first (idempotent). */
export async function appendOutreachEntry(
  advisorsSheetId: string,
  entry: OutreachEntry,
): Promise<void> {
  await ensureOutreachTab(advisorsSheetId);
  const id = outreachIdFor(entry.advisor_id, entry.template_key, entry.sent_at);
  const row: (string | number | boolean)[] = [
    id,
    entry.advisor_id,
    entry.advisor_name,
    entry.email,
    entry.template_key,
    entry.template_label,
    entry.sender_email,
    entry.sent_at,
    entry.notes ?? '',
  ];
  await appendRows(advisorsSheetId, `${OUTREACH_TAB_NAME}!A:A`, [row]);
}

/** Bulk-append: one batched write for many entries (used by bulk send). */
export async function appendOutreachBatch(
  advisorsSheetId: string,
  entries: OutreachEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await ensureOutreachTab(advisorsSheetId);
  const rows = entries.map(e => {
    const id = outreachIdFor(e.advisor_id, e.template_key, e.sent_at);
    return [
      id, e.advisor_id, e.advisor_name, e.email,
      e.template_key, e.template_label, e.sender_email, e.sent_at, e.notes ?? '',
    ] as (string | number | boolean)[];
  });
  await appendRows(advisorsSheetId, `${OUTREACH_TAB_NAME}!A:A`, rows);
}

/**
 * Stamp the advisor's last_outreach_at + last_outreach_template via the
 * provided advHook (useModuleData). Surface area kept small so the
 * caller controls the data layer without us importing it here.
 */
export type AdvisorUpdater = (advisorId: string, updates: Record<string, string | undefined>) => Promise<void>;

export async function stampLastOutreach(
  updateRow: AdvisorUpdater,
  advisorId: string,
  templateKey: string,
  sentAt: string,
): Promise<void> {
  await updateRow(advisorId, {
    last_outreach_at: sentAt,
    last_outreach_template: templateKey,
  });
}

// Re-exports so callers don't need to know the tab name / headers.
export const OUTREACH_TAB = OUTREACH_TAB_NAME;
export { OUTREACH_HEADERS };
// Tiny helper for callers that just need the advisors workbook id.
export function getAdvisorsSheetId(): string | null {
  // Only check that the module is registered — getSheetId already
  // logs a warning when the env var is missing.
  if (!SHEETS.advisors) return null;
  const id = getSheetId('advisors');
  return id || null;
}
// Tab key resolver kept here so call sites import one module.
export function getAdvisorsTabName(key: 'advisors' | 'comments' | 'activity' = 'advisors'): string {
  return getTab('advisors', key);
}
