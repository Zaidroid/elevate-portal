// Runtime guard against writing to source-of-truth sheets owned by other
// teams. The Elevate Portal reads from many shared sheets (call-for-advisors
// form responses, the procurement audit team's plan, the legacy payments
// tracker, the interview list) but is not permitted to write back to any of
// them — those are authoritative for their owners.
//
// This guard reverse-resolves a sheetId back to its module key in
// `src/config/sheets.ts` and throws if the module is on the deny list.
// Wired into appendRows / updateRange / batchUpdate / deleteSheetRow in
// client.ts so every mutation path is checked in one place.
//
// Unknown sheetIds (e.g. ad-hoc dev sheets that aren't registered in
// SHEETS) pass with a console warning — safer than refusing all writes if
// an env var is missing in a particular environment.

import { SHEETS } from '../../config/sheets';
import { recordRun } from '../observability/last-run';

const DENY_PATTERNS = [
  /Source$/,           // procurementSource, paymentsSource, …
  /FormResponses$/,    // advisorsFormResponses, freelancersFormResponses
];

const DENY_EXACT = new Set([
  'companiesInterviewed', // read-only interviewed companies list
]);

function moduleKeyForSheetId(sheetId: string): string | null {
  if (!sheetId) return null;
  for (const [key, cfg] of Object.entries(SHEETS)) {
    if (cfg.sheetId === sheetId) return key;
  }
  return null;
}

export function isReadOnlyModule(moduleKey: string): boolean {
  if (DENY_EXACT.has(moduleKey)) return true;
  return DENY_PATTERNS.some(rx => rx.test(moduleKey));
}

export class SourceSheetWriteError extends Error {
  constructor(moduleKey: string, sheetId: string) {
    super(
      `Refusing to write to read-only source sheet '${moduleKey}' (${sheetId}). ` +
      `Source sheets owned by other teams must never be mutated by the portal — ` +
      `route this write to a portal-owned sheet instead.`,
    );
    this.name = 'SourceSheetWriteError';
  }
}

export function assertWritable(sheetId: string): void {
  const key = moduleKeyForSheetId(sheetId);
  if (!key) {
    // Unknown sheet — likely a misconfiguration or an ad-hoc target.
    // Warn but don't block; the alternative is harder to diagnose
    // when an env var hasn't been set in some environment.
    if (sheetId) {
      console.warn(
        `[writeGuard] Unknown sheetId for write: ${sheetId}. ` +
        `Add it to SHEETS in src/config/sheets.ts so the read-only guard can verify it.`,
      );
      // Surface in the pill so a missing env var doesn't silently
      // bypass the read-only guard. Truncate the sheetId so the
      // popover stays compact.
      recordRun('Unknown sheetId for write', {
        outcome: 'fail',
        ok: 0,
        fail: 1,
        message: 'Write went through unguarded',
        error: `Unregistered sheetId ${sheetId.slice(0, 12)}…`,
      });
    }
    return;
  }
  if (isReadOnlyModule(key)) {
    throw new SourceSheetWriteError(key, sheetId);
  }
}
