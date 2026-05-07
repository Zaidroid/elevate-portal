// Advisor Pipeline Snapshot — portal-owned mirror tab in the Advisors
// workbook that rewrites on every meaningful change so the team can
// open the sheet directly and see the same data the portal shows.
//
// Mirrors the pattern of src/pages/selection/Stage3DistributionWriter.ts.
//
// Trigger: debounced (3 s) effect on AdvisorsPage that fires whenever
// the advisors / follow-ups rows change. Idempotent — re-running on
// unchanged data overwrites the same content.

import type { Advisor, FollowUp } from '../../types/advisor';
import { displayName } from '../../config/team';
import { updateRange } from '../../lib/sheets/client';
import { ensureHumanFriendlyTab, colLetter } from '../../lib/sheets/output-formatting';
import { getSheetId } from '../../config/sheets';

const TAB_NAME = 'Advisor Pipeline Snapshot';

const HEADERS = [
  'Advisor',                  // 0
  'Email',                    // 1
  'Country',                  // 2
  'Position',                 // 3
  'Employer',                 // 4
  'Pipeline Status',          // 5  (status conditional formatting)
  'Days in Status',           // 6
  'Stuck?',                   // 7
  'S1 Score',                 // 8
  'S1 Pass',                  // 9
  'S2 Category',              // 10
  'S2 Score',                 // 11
  'Assigned Company',         // 12
  'Intervention',             // 13
  'Assignment Status',        // 14
  'Open Follow-ups',          // 15
  'Last Outreach',            // 16
  'advisor_id',               // 17 (hidden)
];

const HIDDEN_COLS = [17];

const COL_WIDTHS: Record<number, number> = {
  0: 200,
  1: 220,
  2: 110,
  3: 180,
  4: 180,
  5: 140,
  6: 110,
  7: 80,
  8: 80,
  9: 80,
  10: 110,
  11: 80,
  12: 200,
  13: 160,
  14: 130,
  15: 110,
  16: 200,
};

function daysSince(iso: string): number {
  if (!iso) return -1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return -1;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

const SLA_DAYS: Record<string, number> = {
  'New': 3,
  'Acknowledged': 7,
  'Allocated': 14,
  'Intro Scheduled': 14,
  'Intro Done': 14,
  'Assessment': 14,
  'Approved': 30,
  'Matched': 90,
  'On Hold': 14,
  'Rejected': 0,
  'Archived': 0,
};

export type WriteSnapshotInput = {
  advisors: Advisor[];
  followups: FollowUp[];
  /** Map of company_id → display name. Optional; falls back to id. */
  companyNameById?: Map<string, string>;
  generatedBy: string;
};

export async function writeAdvisorPipelineSnapshot(input: WriteSnapshotInput): Promise<{ rowsWritten: number; tabName: string } | null> {
  const sheetId = getSheetId('advisors');
  if (!sheetId) return null;

  const openFuByAdvisor = new Map<string, number>();
  for (const f of input.followups) {
    if ((f.status || '').toLowerCase() !== 'open') continue;
    const k = f.advisor_id || '';
    if (!k) continue;
    openFuByAdvisor.set(k, (openFuByAdvisor.get(k) ?? 0) + 1);
  }

  // Sort: most actionable first (Approved/Matched at top, Archived at bottom),
  // then alphabetically by name.
  const ORDER = ['Approved', 'Matched', 'Assessment', 'Intro Done', 'Intro Scheduled',
    'Allocated', 'Acknowledged', 'New', 'On Hold', 'Rejected', 'Archived'];
  const rows = [...input.advisors].sort((a, b) => {
    const ai = ORDER.indexOf(a.pipeline_status || 'New');
    const bi = ORDER.indexOf(b.pipeline_status || 'New');
    if (ai !== bi) return ai - bi;
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  const subtitle = `Generated ${new Date().toLocaleString()} by ${displayName(input.generatedBy) || input.generatedBy} · ${rows.length} advisors`;

  await ensureHumanFriendlyTab(sheetId, TAB_NAME, {
    title: 'Advisor Pipeline Snapshot',
    subtitle,
    headers: HEADERS,
    hiddenColumnIndexes: HIDDEN_COLS,
    colWidths: COL_WIDTHS,
    statusColumn: 5,
    expectedBodyRows: Math.max(rows.length + 60, 200),
  });

  const headerRowOneBased = 3;
  const dataStartOneBased = 4;

  const matrix: (string | number | boolean)[][] = rows.map(a => {
    const status = a.pipeline_status || 'New';
    const sla = SLA_DAYS[status] ?? 0;
    const ts = a.intro_scheduled_date || a.intro_done_date || a.assessment_date || a.decision_date || a.timestamp || '';
    const days = daysSince(ts);
    const stuck = sla > 0 && days >= 0 && days >= sla ? 'Yes' : '';
    const companyName = a.assignment_company_id
      ? (input.companyNameById?.get(a.assignment_company_id) || a.assignment_company_id)
      : '';
    return [
      a.full_name || '',
      a.email || '',
      a.country || '',
      a.position || '',
      a.employer || '',
      status,
      days >= 0 ? days : '',
      stuck,
      a.stage1_score || '',
      a.stage1_pass || '',
      a.stage2_category || '',
      a.stage2_score || '',
      companyName,
      a.assignment_intervention_type || '',
      a.assignment_status || '',
      openFuByAdvisor.get(a.advisor_id) ?? 0,
      a.last_outreach_at || '',
      a.advisor_id,
    ];
  });

  const lastCol = colLetter(HEADERS.length - 1);

  await updateRange(
    sheetId,
    `${TAB_NAME}!A${headerRowOneBased}:${lastCol}${headerRowOneBased}`,
    [HEADERS],
  );
  if (matrix.length > 0) {
    await updateRange(
      sheetId,
      `${TAB_NAME}!A${dataStartOneBased}:${lastCol}${dataStartOneBased + matrix.length - 1}`,
      matrix,
    );
  }
  // Wipe any trailing rows from a previous larger write so old data
  // doesn't leak through.
  const wipeStart = dataStartOneBased + matrix.length;
  const wipeEnd = wipeStart + 80;
  if (wipeEnd >= wipeStart) {
    const blank = Array.from({ length: wipeEnd - wipeStart + 1 }, () => new Array(HEADERS.length).fill(''));
    try {
      await updateRange(sheetId, `${TAB_NAME}!A${wipeStart}:${lastCol}${wipeEnd}`, blank, { valueInput: 'RAW' });
    } catch { /* non-fatal */ }
  }

  return { rowsWritten: matrix.length, tabName: TAB_NAME };
}
