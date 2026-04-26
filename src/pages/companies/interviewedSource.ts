// Read-only loader for the Cohort 3 "interviewed companies" source sheet
// (1NT-ZoJN_crFlH3Jgfa104uZHlycRrHal). Pulls every tab, hunts for the
// column whose header contains "company" or "name", and returns a Set of
// normalised company names. The Companies page joins this set against the
// 107 applicants and overrides their status to "Interviewed" so the
// post-interview cohort surfaces correctly even when the master sheet's
// status field is still blank.
//
// The portal NEVER writes to this sheet.

import { batchGet, getSpreadsheetMetaCached } from '../../lib/sheets/client';

export type InterviewedFetchResult = {
  names: Set<string>;
  tabs: string[];
  rawCount: number;
  errors: string[];
};

const NAME_HEADER_HINTS = ['company name', 'company', 'name', 'organization', 'startup', 'business'];

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNameColumn(headerRow: string[]): number {
  if (!headerRow || headerRow.length === 0) return -1;
  // Prefer the most-specific match.
  for (const hint of NAME_HEADER_HINTS) {
    const idx = headerRow.findIndex(h => (h || '').toLowerCase().trim() === hint);
    if (idx >= 0) return idx;
  }
  for (const hint of NAME_HEADER_HINTS) {
    const idx = headerRow.findIndex(h => (h || '').toLowerCase().includes(hint));
    if (idx >= 0) return idx;
  }
  // Last resort: first non-empty column.
  return headerRow.findIndex(h => (h || '').trim().length > 0);
}

export async function fetchInterviewedCompanies(sheetId: string): Promise<InterviewedFetchResult> {
  const result: InterviewedFetchResult = { names: new Set(), tabs: [], rawCount: 0, errors: [] };
  if (!sheetId) {
    result.errors.push('VITE_SHEET_COMPANIES_INTERVIEWED is not configured.');
    return result;
  }

  let tabs: string[] = [];
  try {
    const meta = await getSpreadsheetMetaCached(sheetId);
    tabs = meta.sheets.map(s => s.title);
  } catch (err) {
    result.errors.push(`Failed to read tab list: ${(err as Error).message}`);
    return result;
  }
  if (tabs.length === 0) return result;

  let valueRanges: Array<{ range: string; values?: string[][] }> = [];
  try {
    valueRanges = await batchGet(sheetId, tabs.map(t => `${t}!A:ZZ`));
  } catch (err) {
    result.errors.push(`batchGet failed: ${(err as Error).message}`);
    return result;
  }

  for (let i = 0; i < tabs.length; i++) {
    const rows = valueRanges[i]?.values || [];
    if (rows.length < 1) continue;
    // Find a likely header row in the first 10 rows. We do this defensively
    // because some sheets have a banner row above the header.
    let headerIdx = -1;
    let nameCol = -1;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const c = findNameColumn(rows[r]);
      if (c >= 0) { headerIdx = r; nameCol = c; break; }
    }
    if (headerIdx < 0 || nameCol < 0) continue;
    result.tabs.push(tabs[i]);
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const v = (rows[r][nameCol] || '').trim();
      if (!v) continue;
      // Skip obvious header repeats / separator rows.
      if (NAME_HEADER_HINTS.some(h => v.toLowerCase() === h)) continue;
      result.rawCount += 1;
      result.names.add(normName(v));
    }
  }
  return result;
}

export function isInterviewed(companyName: string, names: Set<string>): boolean {
  if (!companyName || names.size === 0) return false;
  const k = normName(companyName);
  if (!k) return false;
  if (names.has(k)) return true;
  // Loose substring fall-back to tolerate "Inc.", "Ltd", trailing notes etc.
  for (const n of names) {
    if (n.length < 4) continue;
    if (k.includes(n) || n.includes(k)) return true;
  }
  return false;
}
