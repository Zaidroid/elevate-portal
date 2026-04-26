// Cleanup utility for the Advisors tab. Scans the live rows for duplicate
// emails (case-insensitive, trimmed) and deletes all but the earliest. The
// "earliest" is the row with the smallest timestamp; if timestamps are
// missing or tied, the smallest row number wins (preserving the original
// triage state of the older entry).
//
// Deletes happen via a single batchUpdate that lists every row in
// descending order, so subsequent indices stay valid as the rows shift.

import { batchUpdate, getSpreadsheetMetaCached } from '../../lib/sheets/client';
import type { Advisor } from '../../types/advisor';

export type DedupeResult = {
  scanned: number;
  duplicateGroups: number;
  rowsRemoved: number;
  errors: string[];
  removed: Array<{ email: string; rowNumber: number }>;
};

type RowWithIndex = {
  advisor: Advisor;
  rowNumber: number; // 1-based, matches the sheet
};

export async function deduplicateAdvisors(
  sheetId: string,
  tabName: string,
  advisors: Advisor[],
  rowKey: keyof Advisor = 'advisor_id'
): Promise<DedupeResult> {
  const result: DedupeResult = {
    scanned: advisors.length,
    duplicateGroups: 0,
    rowsRemoved: 0,
    errors: [],
    removed: [],
  };

  // Reconstruct sheet row numbers from the order useSheetDoc returns rows.
  // useSheetDoc reads A:ZZ minus the header, so index 0 → row 2, etc.
  const rowsWithIndex: RowWithIndex[] = advisors.map((a, i) => ({
    advisor: a,
    rowNumber: i + 2,
  }));

  // Group by lowercased email (skip rows with no email — those usually mean
  // empty padding rows that the formula left in place; nothing to dedupe).
  const groups = new Map<string, RowWithIndex[]>();
  for (const r of rowsWithIndex) {
    const email = (r.advisor.email || '').trim().toLowerCase();
    if (!email) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email)!.push(r);
  }

  // For each group with > 1 entry, pick the keeper (earliest timestamp,
  // smallest row number on tie) and queue the rest for deletion.
  const toDelete: RowWithIndex[] = [];
  for (const [email, members] of groups) {
    if (members.length < 2) continue;
    result.duplicateGroups += 1;
    const sorted = [...members].sort((a, b) => {
      const ta = (a.advisor.timestamp || '').slice(0, 19);
      const tb = (b.advisor.timestamp || '').slice(0, 19);
      if (ta !== tb) return ta.localeCompare(tb); // earliest timestamp first
      return a.rowNumber - b.rowNumber;            // tie-break on row order
    });
    const [, ...losers] = sorted;
    for (const l of losers) {
      toDelete.push(l);
      result.removed.push({ email, rowNumber: l.rowNumber });
    }
    void rowKey; // keep the type import alive for future callers
  }

  if (toDelete.length === 0) return result;

  // Resolve the tab's numeric sheetId for the batchUpdate range.
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

  // Batch deleteDimension request, sorted DESC by rowNumber so the index
  // shifts cancel out (deleting row 50 first does not affect row 100).
  const deleteRequests = toDelete
    .sort((a, b) => b.rowNumber - a.rowNumber)
    .map(r => ({
      deleteDimension: {
        range: {
          sheetId: sheetTabId,
          dimension: 'ROWS',
          startIndex: r.rowNumber - 1, // 0-based, row 2 → startIndex 1
          endIndex: r.rowNumber,
        },
      },
    }));

  // Sheets batchUpdate caps single-batch size; chunk to be safe.
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
