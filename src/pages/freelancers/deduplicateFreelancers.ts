// Cleanup utility — same shape as advisors/deduplicateAdvisors.ts but
// keyed on the freelancer's email. Deletes all but the earliest row for
// each duplicate email via batchUpdate deleteDimension requests.

import { batchUpdate, getSpreadsheetMetaCached } from '../../lib/sheets/client';
import type { Freelancer } from '../../types/freelancer';

export type DedupeResult = {
  scanned: number;
  duplicateGroups: number;
  rowsRemoved: number;
  errors: string[];
  removed: Array<{ email: string; rowNumber: number }>;
};

export async function deduplicateFreelancers(
  sheetId: string,
  tabName: string,
  freelancers: Freelancer[]
): Promise<DedupeResult> {
  const result: DedupeResult = {
    scanned: freelancers.length,
    duplicateGroups: 0,
    rowsRemoved: 0,
    errors: [],
    removed: [],
  };

  // useSheetDoc returns rows in sheet order, header at row 1, so index 0 maps
  // to row 2.
  const rowsWithIndex = freelancers.map((fl, i) => ({ fl, rowNumber: i + 2 }));

  const groups = new Map<string, Array<{ fl: Freelancer; rowNumber: number }>>();
  for (const r of rowsWithIndex) {
    const email = (r.fl.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email)!.push(r);
  }

  const toDelete: Array<{ email: string; rowNumber: number }> = [];
  for (const [email, members] of groups) {
    if (members.length < 2) continue;
    result.duplicateGroups += 1;
    const sorted = [...members].sort((a, b) => {
      const ta = (a.fl.updated_at || '').slice(0, 19);
      const tb = (b.fl.updated_at || '').slice(0, 19);
      if (ta !== tb) return ta.localeCompare(tb);
      return a.rowNumber - b.rowNumber;
    });
    const [, ...losers] = sorted;
    for (const l of losers) {
      toDelete.push({ email, rowNumber: l.rowNumber });
      result.removed.push({ email, rowNumber: l.rowNumber });
    }
  }

  if (toDelete.length === 0) return result;

  let sheetTabId: number;
  try {
    const meta = await getSpreadsheetMetaCached(sheetId);
    const tab = meta.sheets.find(s => s.title === tabName);
    if (!tab) {
      result.errors.push(`Tab "${tabName}" not found`);
      return result;
    }
    sheetTabId = tab.sheetId;
  } catch (err) {
    result.errors.push(`Failed to resolve tab id: ${(err as Error).message}`);
    return result;
  }

  const deleteRequests = toDelete
    .sort((a, b) => b.rowNumber - a.rowNumber)
    .map(r => ({
      deleteDimension: {
        range: {
          sheetId: sheetTabId,
          dimension: 'ROWS',
          startIndex: r.rowNumber - 1,
          endIndex: r.rowNumber,
        },
      },
    }));

  const CHUNK = 100;
  for (let i = 0; i < deleteRequests.length; i += CHUNK) {
    const chunk = deleteRequests.slice(i, i + CHUNK);
    try {
      await batchUpdate(sheetId, chunk);
      result.rowsRemoved += chunk.length;
    } catch (err) {
      result.errors.push(`Batch ${i / CHUNK + 1} failed: ${(err as Error).message}`);
    }
  }

  return result;
}
