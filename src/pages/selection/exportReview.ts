// One-click export: writes a 'Cohort Review Export' tab in the
// Companies workbook with three sections — per-company summary,
// per-review detail, per-intervention detail. Branded formatting
// applied via batchUpdate so the team gets a usable consolidated
// sheet without any manual cleanup.
//
// Triggered from the Final Decision tab. Idempotent — re-runs
// overwrite the tab in place. Source of truth for everything
// surfaced here is the same Reviews / Company Comments /
// Intervention Assignments / Master tabs the portal already syncs
// against.

import { batchUpdate, ensureSchema, getSpreadsheetMeta, updateRange } from '../../lib/sheets/client';
import { displayName } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import { summarizeReviews } from '../companies/reviewTypes';
import type { Review, CompanyComment } from '../companies/reviewTypes';

const EXPORT_TAB = 'Cohort Review Export';

// Brand palette — mirrors the portal.
const NAVY = { red: 0.07, green: 0.15, blue: 0.27 };
const TEAL = { red: 0.0, green: 0.66, blue: 0.74 };
const WHITE = { red: 1, green: 1, blue: 1 };
const SECTION_BG = { red: 0.93, green: 0.96, blue: 0.97 };
const HEADER_BG = { red: 0.96, green: 0.97, blue: 0.99 };
const GREEN = { red: 0.86, green: 0.96, blue: 0.91 };
const AMBER = { red: 1.0, green: 0.95, blue: 0.84 };
const RED = { red: 1.0, green: 0.92, blue: 0.92 };

export type ExportInputs = {
  // Each "company" record carries everything we need for that row.
  companies: Array<{
    company_id: string;
    company_name: string;
    sector: string;
    city: string;
    governorate: string;
    employee_count: string;
    fund_code: string;
    status: string;
    profile_manager_email: string;
    contact_email: string;
    readiness_score: string;
    applicantRaw: Record<string, string> | null;
    selection: {
      scoring: Record<string, string> | null;
      docReview: Record<string, string> | null;
      interviewAssessment: Record<string, string> | null;
      committeeVotes: Record<string, string> | null;
    };
  }>;
  reviews: Review[];
  comments: CompanyComment[];
  assignments: Array<Record<string, string>>;
};

export type ExportResult = {
  tabName: string;
  rowsWritten: number;
  sectionRowCounts: { summary: number; reviews: number; interventions: number };
  errors: string[];
};

// ──────────────── content builders ────────────────

function pickValue(row: Record<string, string> | null | undefined, pattern: RegExp): string {
  if (!row) return '';
  for (const [k, v] of Object.entries(row)) {
    if (!v || !v.toString().trim()) continue;
    if (pattern.test(k)) return v.toString().trim();
  }
  return '';
}

function describeApplicant(app: Record<string, string> | null | undefined): { about: string; why: string; pain: string } {
  if (!app) return { about: '', why: '', pain: '' };
  const get = (keys: string[]) => {
    for (const k of keys) if (app[k] && app[k].trim()) return app[k].trim();
    return '';
  };
  return {
    about: get(['businessDescription', 'whatTheyDo', 'productOrService', 'description', 'about']),
    why: get(['whyElevate', 'goals', 'reasonForApplying', 'why']),
    pain: get(['mainPainPoint', 'challenges', 'mainChallenge', 'problems', 'pain']),
  };
}

function buildRows(inputs: ExportInputs, generatedAt: string, generatedBy: string): { rows: (string | number)[][]; sectionStarts: { summary: number; reviews: number; interventions: number; end: number } } {
  const rows: (string | number)[][] = [];

  // ── Title block ──
  rows.push(['Cohort Review Export']);
  rows.push([`Generated ${generatedAt} by ${generatedBy}`]);
  rows.push([
    `${inputs.companies.length} companies · ${inputs.reviews.length} review${inputs.reviews.length === 1 ? '' : 's'} · ` +
    `${inputs.comments.length} comment${inputs.comments.length === 1 ? '' : 's'} · ` +
    `${inputs.assignments.length} intervention${inputs.assignments.length === 1 ? '' : 's'} locked`,
  ]);
  rows.push([]);

  // ── Section 1: Per-company summary ──
  const summaryStart = rows.length;
  rows.push(['SECTION 1 — Per-company summary']);
  const summaryHeaders = [
    'Company ID', 'Company name', 'Sector', 'City', 'Governorate', 'Employees',
    'Contact', 'Readiness',
    'Score class', 'Total score',
    'Interview rating', 'Committee vote',
    'About', 'Why Elevate', 'Pain points',
    'Total reviews', '# Recommend', '# Hold', '# Reject', 'Consensus', 'Divergent',
    'Final status', 'Final AM',
    'Final pillars', 'Final sub-interventions', 'Per-pillar funds',
    'Comments',
  ];
  rows.push(summaryHeaders);

  // Build per-company indexes once.
  const reviewsByCompany = new Map<string, Review[]>();
  for (const r of inputs.reviews) {
    if (!r.company_id) continue;
    (reviewsByCompany.get(r.company_id) || reviewsByCompany.set(r.company_id, []).get(r.company_id)!).push(r);
  }
  const commentsByCompany = new Map<string, CompanyComment[]>();
  for (const c of inputs.comments) {
    if (!c.company_id) continue;
    (commentsByCompany.get(c.company_id) || commentsByCompany.set(c.company_id, []).get(c.company_id)!).push(c);
  }
  const assignsByCompany = new Map<string, ExportInputs['assignments']>();
  for (const a of inputs.assignments) {
    if (!a.company_id) continue;
    (assignsByCompany.get(a.company_id) || assignsByCompany.set(a.company_id, []).get(a.company_id)!).push(a);
  }

  for (const c of inputs.companies) {
    const rs = reviewsByCompany.get(c.company_id) || [];
    const summary = summarizeReviews(rs);
    const cms = commentsByCompany.get(c.company_id) || [];
    const asg = assignsByCompany.get(c.company_id) || [];
    const desc = describeApplicant(c.applicantRaw);

    const finalPillars = Array.from(new Set(asg.map(a => pillarFor(a.intervention_type || '')?.code || a.intervention_type || ''))).filter(Boolean);
    const finalSubs = Array.from(new Set(asg.map(a => a.sub_intervention || '').filter(Boolean)));
    // Per-pillar funds: 'TTH=97060,MA=91763'
    const fundsByPillar = new Map<string, Set<string>>();
    for (const a of asg) {
      const p = pillarFor(a.intervention_type || '')?.code || a.intervention_type || '';
      const f = (a.fund_code || '').trim();
      if (!p || !f) continue;
      (fundsByPillar.get(p) || fundsByPillar.set(p, new Set()).get(p)!).add(f);
    }
    const fundsString = Array.from(fundsByPillar.entries())
      .map(([p, fs]) => `${p}=${Array.from(fs).join('|')}`)
      .join(', ');

    const commentsString = cms
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .map(cm => `${displayName(cm.author_email)}: ${cm.body}`)
      .join('\n\n');

    rows.push([
      c.company_id,
      c.company_name,
      c.sector,
      c.city,
      c.governorate,
      c.employee_count,
      c.contact_email,
      c.readiness_score || pickValue(c.applicantRaw, /readinessScore|readiness/i),
      pickValue(c.selection.scoring, /^(class|tier|grade)$/i),
      pickValue(c.selection.scoring, /total.*score|^score$|weighted/i),
      pickValue(c.selection.interviewAssessment, /rating|score|grade|recommend/i),
      pickValue(c.selection.committeeVotes, /vote|decision|recommend|outcome/i),
      desc.about,
      desc.why,
      desc.pain,
      summary.total,
      summary.recommend,
      summary.hold,
      summary.reject,
      summary.consensus || '',
      summary.divergence ? 'Yes' : '',
      c.status || '',
      c.profile_manager_email ? displayName(c.profile_manager_email) : '',
      finalPillars.join(', '),
      finalSubs.join(', '),
      fundsString,
      commentsString,
    ]);
  }
  rows.push([]);

  // ── Section 2: Per-review detail ──
  const reviewsStart = rows.length;
  rows.push(['SECTION 2 — Per-review detail']);
  rows.push(['Company', 'Reviewer', 'Decision', 'Proposed pillars', 'Proposed sub-interventions', 'Notes', 'Updated at']);
  for (const c of inputs.companies) {
    const rs = (reviewsByCompany.get(c.company_id) || []).sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''));
    for (const r of rs) {
      rows.push([
        c.company_name,
        r.reviewer_email ? displayName(r.reviewer_email) : '',
        r.decision || '',
        r.proposed_pillars || '',
        r.proposed_sub_interventions || '',
        r.notes || '',
        r.updated_at || r.created_at || '',
      ]);
    }
  }
  rows.push([]);

  // ── Section 3: Per-intervention detail ──
  const interventionsStart = rows.length;
  rows.push(['SECTION 3 — Locked interventions']);
  rows.push(['Company', 'Pillar', 'Sub-intervention', 'Fund code', 'Account Manager', 'Status', 'Updated at']);
  for (const c of inputs.companies) {
    const asg = (assignsByCompany.get(c.company_id) || []).slice().sort((a, b) =>
      (a.intervention_type || '').localeCompare(b.intervention_type || '')
    );
    for (const a of asg) {
      rows.push([
        c.company_name,
        pillarFor(a.intervention_type || '')?.code || a.intervention_type || '',
        a.sub_intervention || '',
        a.fund_code || '',
        a.owner_email ? displayName(a.owner_email) : '',
        a.status || '',
        a.updated_at || '',
      ]);
    }
  }

  return {
    rows,
    sectionStarts: {
      summary: summaryStart,
      reviews: reviewsStart,
      interventions: interventionsStart,
      end: rows.length,
    },
  };
}

// ──────────────── helpers ────────────────

function colLetter(n: number): string {
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function rangeRef(sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number) {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

// ──────────────── main entry ────────────────

export async function exportReviewToSheet(
  sheetId: string,
  inputs: ExportInputs,
  generatedBy: string
): Promise<ExportResult> {
  const errors: string[] = [];
  const generatedAt = new Date().toLocaleString();

  await ensureSchema(sheetId, EXPORT_TAB, ['Cohort Review Export']);

  // Resolve numeric tab id for batchUpdate formatting + unmerge.
  let exportTabId: number | null = null;
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const t = meta.sheets.find(s => s.title === EXPORT_TAB);
    if (t) exportTabId = t.sheetId;
  } catch (err) {
    errors.push(`could not look up export tab id: ${(err as Error).message}`);
  }

  const { rows, sectionStarts } = buildRows(inputs, generatedAt, generatedBy);
  const widthCols = Math.max(1, ...rows.map(r => r.length));
  const padded = rows.map(r => {
    const out: (string | number)[] = [...r];
    while (out.length < widthCols) out.push('');
    return out;
  });

  // Pre-clean: unmerge + reset formatting in the area we're about to write.
  if (exportTabId !== null) {
    try {
      await batchUpdate(sheetId, [
        { unmergeCells: { range: rangeRef(exportTabId, 0, padded.length + 30, 0, Math.max(widthCols, 28)) } },
        {
          repeatCell: {
            range: rangeRef(exportTabId, 0, padded.length + 30, 0, Math.max(widthCols, 28)),
            cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP', textFormat: { fontFamily: 'Source Sans Pro', fontSize: 10 } } },
            fields: 'userEnteredFormat',
          },
        },
      ]);
    } catch (err) {
      errors.push(`pre-clean failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // Write content.
  const lastCol = colLetter(widthCols - 1);
  try {
    await updateRange(sheetId, `${EXPORT_TAB}!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    errors.push(`content write failed: ${(err as Error).message}`);
    return {
      tabName: EXPORT_TAB,
      rowsWritten: 0,
      sectionRowCounts: { summary: 0, reviews: 0, interventions: 0 },
      errors,
    };
  }

  // Wipe trailing rows from prior runs.
  const wipeStart = padded.length + 1;
  const wipeEnd = padded.length + 200;
  try {
    const blank = new Array(wipeEnd - wipeStart + 1).fill(0).map(() => new Array(widthCols).fill(''));
    await updateRange(sheetId, `${EXPORT_TAB}!A${wipeStart}:${lastCol}${wipeEnd}`, blank, { valueInput: 'RAW' });
  } catch (err) {
    errors.push(`tail wipe failed (non-fatal): ${(err as Error).message}`);
  }

  // Apply formatting.
  if (exportTabId !== null) {
    const requests: unknown[] = [];

    // Column widths — generous because the sheet has narrative cells.
    const widths: Record<number, number> = {
      0: 90, 1: 200, 2: 120, 3: 100, 4: 100, 5: 70, 6: 180,
      7: 80, 8: 80, 9: 80,
      10: 100, 11: 110,
      12: 280, 13: 280, 14: 280,
      15: 60, 16: 60, 17: 60, 18: 60, 19: 100, 20: 70,
      21: 110, 22: 140,
      23: 200, 24: 220, 25: 200,
      26: 320,
    };
    for (const [col, px] of Object.entries(widths)) {
      const i = parseInt(col, 10);
      if (i >= widthCols) continue;
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: exportTabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    }

    // Title row.
    requests.push({ mergeCells: { range: rangeRef(exportTabId, 0, 1, 0, widthCols), mergeType: 'MERGE_ROWS' } });
    requests.push({
      repeatCell: {
        range: rangeRef(exportTabId, 0, 1, 0, widthCols),
        cell: {
          userEnteredFormat: {
            backgroundColor: NAVY,
            textFormat: { fontSize: 18, bold: true, foregroundColor: WHITE, fontFamily: 'Source Sans Pro' },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { top: 10, bottom: 10, left: 14, right: 14 },
          },
        },
        fields: 'userEnteredFormat',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: exportTabId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 42 },
        fields: 'pixelSize',
      },
    });

    // Subtitle rows (1, 2).
    for (const r of [1, 2]) {
      requests.push({ mergeCells: { range: rangeRef(exportTabId, r, r + 1, 0, widthCols), mergeType: 'MERGE_ROWS' } });
      requests.push({
        repeatCell: {
          range: rangeRef(exportTabId, r, r + 1, 0, widthCols),
          cell: {
            userEnteredFormat: {
              textFormat: { fontSize: 10, italic: true, foregroundColor: { red: 0.4, green: 0.45, blue: 0.55 }, fontFamily: 'Source Sans Pro' },
              horizontalAlignment: 'LEFT',
              padding: { top: 4, bottom: 4, left: 14, right: 14 },
            },
          },
          fields: 'userEnteredFormat',
        },
      });
    }

    // Section header rows.
    const sectionRows = [sectionStarts.summary, sectionStarts.reviews, sectionStarts.interventions];
    for (const r of sectionRows) {
      requests.push({ mergeCells: { range: rangeRef(exportTabId, r, r + 1, 0, widthCols), mergeType: 'MERGE_ROWS' } });
      requests.push({
        repeatCell: {
          range: rangeRef(exportTabId, r, r + 1, 0, widthCols),
          cell: {
            userEnteredFormat: {
              backgroundColor: TEAL,
              textFormat: { fontSize: 12, bold: true, foregroundColor: WHITE, fontFamily: 'Source Sans Pro' },
              horizontalAlignment: 'LEFT',
              padding: { top: 6, bottom: 6, left: 14, right: 14 },
            },
          },
          fields: 'userEnteredFormat',
        },
      });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: exportTabId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 },
          properties: { pixelSize: 30 },
          fields: 'pixelSize',
        },
      });
    }

    // Column header rows for each section (the row right after each
    // section header).
    const headerRows = [sectionStarts.summary + 1, sectionStarts.reviews + 1, sectionStarts.interventions + 1];
    for (const r of headerRows) {
      requests.push({
        repeatCell: {
          range: rangeRef(exportTabId, r, r + 1, 0, widthCols),
          cell: {
            userEnteredFormat: {
              backgroundColor: HEADER_BG,
              textFormat: { fontSize: 10, bold: true, foregroundColor: NAVY, fontFamily: 'Source Sans Pro' },
              horizontalAlignment: 'LEFT',
              padding: { top: 4, bottom: 4, left: 8, right: 8 },
            },
          },
          fields: 'userEnteredFormat',
        },
      });
    }

    // Color the Consensus column in Section 1 (col index 19).
    const summaryDataStart = sectionStarts.summary + 2; // after section header + column header
    const summaryDataEnd = sectionStarts.reviews - 1;   // exclusive
    if (summaryDataEnd > summaryDataStart) {
      // Apply conditional formatting via three repeatCell ranges based
      // on equality. Sheets API doesn't accept WHERE clauses; instead
      // we add three conditional-format rules.
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [rangeRef(exportTabId, summaryDataStart, summaryDataEnd, 19, 20)],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Recommend' }] },
              format: { backgroundColor: GREEN, textFormat: { bold: true } },
            },
          },
          index: 0,
        },
      });
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [rangeRef(exportTabId, summaryDataStart, summaryDataEnd, 19, 20)],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Hold' }] },
              format: { backgroundColor: AMBER, textFormat: { bold: true } },
            },
          },
          index: 1,
        },
      });
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [rangeRef(exportTabId, summaryDataStart, summaryDataEnd, 19, 20)],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Reject' }] },
              format: { backgroundColor: RED, textFormat: { bold: true } },
            },
          },
          index: 2,
        },
      });
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [rangeRef(exportTabId, summaryDataStart, summaryDataEnd, 19, 20)],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Mixed' }] },
              format: { backgroundColor: AMBER, textFormat: { bold: true } },
            },
          },
          index: 3,
        },
      });
    }

    // Light borders + zebra for Section 1 data rows.
    if (summaryDataEnd > summaryDataStart) {
      requests.push({
        updateBorders: {
          range: rangeRef(exportTabId, sectionStarts.summary + 1, summaryDataEnd, 0, widthCols),
          top: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.88, blue: 0.92 } },
          bottom: { style: 'SOLID', width: 1, color: { red: 0.85, green: 0.88, blue: 0.92 } },
          innerHorizontal: { style: 'SOLID', width: 1, color: { red: 0.92, green: 0.94, blue: 0.96 } },
        },
      });
    }

    // Section background for Section 2 + Section 3 data rows (subtle tint).
    const sec2DataStart = sectionStarts.reviews + 2;
    const sec2DataEnd = sectionStarts.interventions - 1;
    if (sec2DataEnd > sec2DataStart) {
      requests.push({
        repeatCell: {
          range: rangeRef(exportTabId, sec2DataStart, sec2DataEnd, 0, widthCols),
          cell: { userEnteredFormat: { backgroundColor: SECTION_BG } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }
    const sec3DataStart = sectionStarts.interventions + 2;
    const sec3DataEnd = sectionStarts.end;
    if (sec3DataEnd > sec3DataStart) {
      requests.push({
        repeatCell: {
          range: rangeRef(exportTabId, sec3DataStart, sec3DataEnd, 0, widthCols),
          cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.98, blue: 0.97 } } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }

    // Freeze the title + subtitle rows so users can scroll without
    // losing context.
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: exportTabId, gridProperties: { frozenRowCount: 3 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    // Chunk + send.
    if (requests.length > 0) {
      try {
        const chunks: unknown[][] = [];
        for (let i = 0; i < requests.length; i += 100) chunks.push(requests.slice(i, i + 100));
        for (const c of chunks) await batchUpdate(sheetId, c);
      } catch (err) {
        errors.push(`formatting failed (non-fatal): ${(err as Error).message}`);
      }
    }
  }

  return {
    tabName: EXPORT_TAB,
    rowsWritten: padded.length,
    sectionRowCounts: {
      summary: sectionStarts.reviews - sectionStarts.summary - 2,        // minus the section header + column header
      reviews: sectionStarts.interventions - sectionStarts.reviews - 2,
      interventions: sectionStarts.end - sectionStarts.interventions - 2,
    },
    errors,
  };
}
