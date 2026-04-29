// ─── Human-Readable Donor Export System ──────────────────────────────
//
// Generates branded, professional tabs in a designated Google Sheets
// workbook for external stakeholders (donors, management). All output
// uses human-readable column names, display names instead of emails,
// fund labels instead of codes, and formatted USD amounts.
//
// Follows the formatting pattern from exportReview.ts — navy headers,
// teal section dividers, Source Sans Pro, frozen rows, conditional
// colors on status columns.
//
// Usage:
//   import { exportAllDonorReports } from '../../lib/export/donorExport';
//   await exportAllDonorReports(data, generatedBy, onProgress);
// ─────────────────────────────────────────────────────────────────────

import { batchUpdate, ensureSchema, getSpreadsheetMeta, updateRange } from '../sheets/client';
import { displayName } from '../../config/team';
import { pillarFor } from '../../config/interventions';
import type { Company, Assignment, PR, Payment, Conference, ConferenceTrackerRow, Agreement } from '../../data/types';

// ──────────────── brand palette ────────────────

const NAVY  = { red: 0.07, green: 0.15, blue: 0.27 };

const WHITE = { red: 1, green: 1, blue: 1 };
const HEADER_BG = { red: 0.96, green: 0.97, blue: 0.99 };
const GREEN_BG  = { red: 0.86, green: 0.96, blue: 0.91 };
const AMBER_BG  = { red: 1.0,  green: 0.95, blue: 0.84 };
const RED_BG    = { red: 1.0,  green: 0.92, blue: 0.92 };
const ZEBRA_ODD = { red: 0.98, green: 0.98, blue: 0.99 };

// ──────────────── value transforms ────────────────

const FUND_LABELS: Record<string, string> = {
  '97060': 'Dutch',
  '91763': 'SIDA TechRise',
};

function humanFund(code: string): string {
  return FUND_LABELS[code?.trim()] || code || '';
}

function humanUSD(val: string): string {
  const n = parseFloat(val || '0');
  if (!n || !Number.isFinite(n)) return '';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function humanEmail(email: string): string {
  if (!email || !email.includes('@')) return email || '';
  return displayName(email);
}

// ──────────────── sheet helpers ────────────────

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

// ──────────────── formatting template ────────────────

function buildFormatting(tabId: number, totalRows: number, totalCols: number, generatedAtRow: number): unknown[] {
  const requests: unknown[] = [];

  // Title row: navy background, white text.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, 0, 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: { fontSize: 14, bold: true, foregroundColor: WHITE, fontFamily: 'Source Sans Pro' },
          horizontalAlignment: 'LEFT',
          padding: { top: 8, bottom: 8, left: 12, right: 12 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });
  requests.push({ mergeCells: { range: rangeRef(tabId, 0, 1, 0, totalCols), mergeType: 'MERGE_ROWS' } });

  // Generated-at subtitle row.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, generatedAtRow, generatedAtRow + 1, 0, totalCols),
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 9, italic: true, foregroundColor: { red: 0.45, green: 0.5, blue: 0.58 }, fontFamily: 'Source Sans Pro' },
          padding: { top: 2, bottom: 2, left: 12, right: 12 },
        },
      },
      fields: 'userEnteredFormat',
    },
  });
  requests.push({ mergeCells: { range: rangeRef(tabId, generatedAtRow, generatedAtRow + 1, 0, totalCols), mergeType: 'MERGE_ROWS' } });

  // Column header row (row after subtitle).
  const headerRow = generatedAtRow + 1;
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, headerRow, headerRow + 1, 0, totalCols),
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

  // Freeze title + subtitle + header.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId: tabId, gridProperties: { frozenRowCount: headerRow + 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  // Zebra striping on data rows.
  const dataStart = headerRow + 1;
  for (let r = dataStart; r < totalRows; r += 2) {
    requests.push({
      repeatCell: {
        range: rangeRef(tabId, r, Math.min(r + 1, totalRows), 0, totalCols),
        cell: { userEnteredFormat: { backgroundColor: ZEBRA_ODD } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // Default font for all data.
  requests.push({
    repeatCell: {
      range: rangeRef(tabId, dataStart, totalRows, 0, totalCols),
      cell: {
        userEnteredFormat: {
          textFormat: { fontSize: 10, fontFamily: 'Source Sans Pro' },
          verticalAlignment: 'TOP',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy',
    },
  });

  return requests;
}

function statusConditionalFormat(tabId: number, startRow: number, endRow: number, col: number): unknown[] {
  const rules: unknown[] = [];
  const range = [rangeRef(tabId, startRow, endRow, col, col + 1)];

  const pairs: [string, typeof GREEN_BG][] = [
    ['Completed', GREEN_BG], ['Active', GREEN_BG], ['Paid', GREEN_BG], ['Executed', GREEN_BG], ['Attended', GREEN_BG],
    ['Delivered', GREEN_BG], ['Awarded', GREEN_BG],
    ['In Progress', AMBER_BG], ['Planned', AMBER_BG], ['Pending Approval', AMBER_BG], ['Approved', AMBER_BG],
    ['Sent to Finance', AMBER_BG], ['Submitted', AMBER_BG], ['Under Review', AMBER_BG], ['Drafted', AMBER_BG],
    ['Cancelled', RED_BG], ['Rejected', RED_BG], ['Overdue', RED_BG], ['Withdrawn', RED_BG],
  ];
  for (let i = 0; i < pairs.length; i++) {
    rules.push({
      addConditionalFormatRule: {
        rule: {
          ranges: range,
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: pairs[i][0] }] },
            format: { backgroundColor: pairs[i][1], textFormat: { bold: true } },
          },
        },
        index: i,
      },
    });
  }
  return rules;
}

// ──────────────── export data types ────────────────

export type DonorExportData = {
  companies: Company[];
  assignments: Assignment[];
  payments: Payment[];
  prs: PR[];           // all quarters merged
  conferences: Conference[];
  confTracker: ConferenceTrackerRow[];
  agreements: Agreement[];
};

export type DonorExportProgress = {
  current: string;
  step: number;
  total: number;
};

// ──────────────── tab writers ────────────────

async function writeTab(
  sheetId: string,
  tabName: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
  generatedBy: string,
  colWidths?: Record<number, number>,
  statusCol?: number,
): Promise<{ rowsWritten: number; error?: string }> {
  const generatedAt = new Date().toLocaleString();

  await ensureSchema(sheetId, tabName, [title]);

  // Resolve tab ID for formatting.
  let tabId: number | null = null;
  try {
    const meta = await getSpreadsheetMeta(sheetId);
    const t = meta.sheets.find(s => s.title === tabName);
    if (t) tabId = t.sheetId;
  } catch { /* non-fatal */ }

  // Build content: title row, generated-at, header, data rows.
  const content: (string | number)[][] = [
    [title],
    [`Generated ${generatedAt} by ${humanEmail(generatedBy)} — ${rows.length} rows`],
    headers,
    ...rows,
  ];

  const totalCols = Math.max(headers.length, ...content.map(r => r.length));
  const padded = content.map(r => {
    const out = [...r];
    while (out.length < totalCols) out.push('');
    return out;
  });

  // Write content.
  const lastCol = colLetter(totalCols - 1);
  try {
    await updateRange(sheetId, `${tabName}!A1:${lastCol}${padded.length}`, padded);
  } catch (err) {
    return { rowsWritten: 0, error: (err as Error).message };
  }

  // Wipe trailing rows.
  try {
    const wipeStart = padded.length + 1;
    const wipeEnd = padded.length + 100;
    const blank = Array.from({ length: wipeEnd - wipeStart }, () => new Array(totalCols).fill(''));
    await updateRange(sheetId, `${tabName}!A${wipeStart}:${lastCol}${wipeEnd}`, blank, { valueInput: 'RAW' });
  } catch { /* non-fatal */ }

  // Apply formatting.
  if (tabId !== null) {
    const requests: unknown[] = [];

    // Base formatting (title, subtitle, header, freeze, zebra).
    requests.push(...buildFormatting(tabId, padded.length, totalCols, 1));

    // Column widths.
    if (colWidths) {
      for (const [col, px] of Object.entries(colWidths)) {
        const i = parseInt(col, 10);
        if (i >= totalCols) continue;
        requests.push({
          updateDimensionProperties: {
            range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: px },
            fields: 'pixelSize',
          },
        });
      }
    }

    // Status conditional formatting.
    if (statusCol !== undefined && rows.length > 0) {
      requests.push(...statusConditionalFormat(tabId, 3, padded.length, statusCol));
    }

    // Send formatting in chunks of 100.
    try {
      for (let i = 0; i < requests.length; i += 100) {
        await batchUpdate(sheetId, requests.slice(i, i + 100));
      }
    } catch { /* non-fatal */ }
  }

  return { rowsWritten: rows.length };
}

// ──────────────── individual reports ────────────────

async function exportCompanyPortfolio(sheetId: string, data: DonorExportData, generatedBy: string) {
  const assignByCompany = new Map<string, Assignment[]>();
  for (const a of data.assignments) {
    const arr = assignByCompany.get(a.company_id) || [];
    arr.push(a);
    assignByCompany.set(a.company_id, arr);
  }

  const sorted = [...data.companies].sort((a, b) => {
    if (a.status === b.status) return (a.company_name || '').localeCompare(b.company_name || '');
    const activeOrder = ['Active', 'Onboarded', 'Selected', 'Interviewed'];
    return (activeOrder.indexOf(b.status) - activeOrder.indexOf(a.status)) || a.company_name.localeCompare(b.company_name);
  });

  const headers = ['Company Name', 'Sector', 'City', 'Region', 'Employees', 'Fund', 'Status', 'Account Manager', 'Interventions'];
  const rows = sorted.map(c => {
    const asg = assignByCompany.get(c.company_id) || [];
    const interventions = asg.map(a => a.sub_intervention || a.intervention_type || '').filter(Boolean).join(', ');
    return [
      c.company_name, c.sector, c.city, c.governorate, c.employee_count,
      humanFund(c.fund_code), c.status, humanEmail(c.profile_manager_email), interventions,
    ];
  });

  return writeTab(sheetId, 'Company Portfolio', 'Company Portfolio', headers, rows, generatedBy,
    { 0: 220, 1: 130, 2: 100, 3: 100, 4: 80, 5: 110, 6: 100, 7: 150, 8: 280 }, 6);
}

async function exportInterventionDelivery(sheetId: string, data: DonorExportData, generatedBy: string) {
  const companyNames = new Map(data.companies.map(c => [c.company_id, c.company_name]));

  const sorted = [...data.assignments].sort((a, b) =>
    (companyNames.get(a.company_id) || '').localeCompare(companyNames.get(b.company_id) || '')
  );

  const headers = ['Company Name', 'Pillar', 'Intervention', 'Fund', 'Account Manager', 'Status', 'Start Date', 'End Date', 'Budget (USD)'];
  const rows = sorted.map(a => [
    companyNames.get(a.company_id) || a.company_id,
    pillarFor(a.intervention_type)?.shortLabel || a.intervention_type,
    a.sub_intervention || a.intervention_type,
    humanFund(a.fund_code),
    humanEmail(a.owner_email),
    a.status,
    a.start_date,
    a.end_date,
    humanUSD(a.budget_usd),
  ]);

  // Summary row.
  const totalBudget = data.assignments.reduce((s, a) => s + (parseFloat(a.budget_usd || '0') || 0), 0);
  rows.push([]);
  rows.push(['TOTAL', '', '', '', '', `${data.assignments.length} interventions`, '', '', humanUSD(String(totalBudget))]);

  return writeTab(sheetId, 'Intervention Delivery', 'Intervention Delivery', headers, rows, generatedBy,
    { 0: 220, 1: 100, 2: 160, 3: 110, 4: 150, 5: 110, 6: 100, 7: 100, 8: 120 }, 5);
}

async function exportFinancialSummary(sheetId: string, data: DonorExportData, generatedBy: string) {
  const companyNames = new Map(data.companies.map(c => [c.company_id, c.company_name]));

  const headers = ['Reference', 'Type', 'Company', 'Description', 'Fund', 'Amount (USD)', 'Date', 'Status'];

  // PRs.
  const prRows: (string | number)[][] = data.prs.map(pr => [
    pr.pr_id, 'Procurement', companyNames.get(pr.company_id) || pr.company_id,
    pr.item_description || pr.activity, humanFund(pr.fund_code),
    humanUSD(pr.total_cost_usd), pr.pr_deadline || pr.target_award_date, pr.status,
  ]);

  // Payments.
  const payRows: (string | number)[][] = data.payments.map(p => [
    p.payment_id, 'Payment', companyNames.get(p.company_id) || p.company_id,
    `${p.payee_type || ''} — ${p.payee_name || ''}`.trim().replace(/^—\s*/, ''),
    humanFund(p.fund_code), humanUSD(p.amount_usd), p.payment_date, p.status,
  ]);

  const rows = [...prRows, ...payRows];

  // Totals.
  const prTotal = data.prs.reduce((s, pr) => s + (parseFloat(pr.total_cost_usd || '0') || 0), 0);
  const payTotal = data.payments.reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0);
  rows.push([]);
  rows.push(['', 'Procurement Total', '', '', '', humanUSD(String(prTotal)), '', `${data.prs.length} PRs`]);
  rows.push(['', 'Payments Total', '', '', '', humanUSD(String(payTotal)), '', `${data.payments.length} payments`]);
  rows.push(['', 'GRAND TOTAL', '', '', '', humanUSD(String(prTotal + payTotal)), '', '']);

  return writeTab(sheetId, 'Financial Summary', 'Financial Summary', headers, rows, generatedBy,
    { 0: 110, 1: 110, 2: 200, 3: 250, 4: 110, 5: 120, 6: 100, 7: 100 }, 7);
}

async function exportConferenceTravel(sheetId: string, data: DonorExportData, generatedBy: string) {
  const confNames = new Map(data.conferences.map(c => [c.conference_id, c.name]));

  // Only committed/attended.
  const relevant = data.confTracker.filter(t =>
    ['Committed', 'Attended', 'Nominated'].includes(t.decision || '')
  );

  const headers = ['Company', 'Conference', 'Decision', 'Signatory', 'Travel Dates', 'Visa Status', 'Commitment Letter'];
  const rows = relevant.map(t => [
    t.company_name,
    confNames.get(t.conference_id) || t.conference_name || t.conference_id,
    t.decision,
    t.signatory_name,
    t.travel_dates,
    t.visa_status,
    t.commitment_letter_url ? 'Linked' : '',
  ]);

  return writeTab(sheetId, 'Conference & Travel', 'Conference & Travel', headers, rows, generatedBy,
    { 0: 220, 1: 200, 2: 100, 3: 150, 4: 120, 5: 100, 6: 100 }, 2);
}

async function exportAgreements(sheetId: string, data: DonorExportData, generatedBy: string) {
  const companyNames = new Map(data.companies.map(c => [c.company_id, c.company_name]));

  const headers = ['Company', 'Agreement Type', 'Signatory', 'Title', 'Date Signed', 'Status', 'Related Intervention'];
  const rows = data.agreements.map(a => [
    companyNames.get(a.company_id) || a.company_id,
    a.agreement_type,
    a.signatory_name,
    a.signatory_title,
    a.signed_date,
    a.status,
    a.related_intervention,
  ]);

  return writeTab(sheetId, 'Agreements', 'Agreements', headers, rows, generatedBy,
    { 0: 220, 1: 120, 2: 150, 3: 150, 4: 100, 5: 100, 6: 160 }, 5);
}

// ──────────────── main entry ────────────────

export async function exportAllDonorReports(
  donorSheetId: string,
  data: DonorExportData,
  generatedBy: string,
  onProgress?: (p: DonorExportProgress) => void,
): Promise<{ reports: string[]; errors: string[] }> {
  const reports: string[] = [];
  const errors: string[] = [];

  const steps: { label: string; fn: () => Promise<{ rowsWritten: number; error?: string }> }[] = [
    { label: 'Company Portfolio',    fn: () => exportCompanyPortfolio(donorSheetId, data, generatedBy) },
    { label: 'Intervention Delivery', fn: () => exportInterventionDelivery(donorSheetId, data, generatedBy) },
    { label: 'Financial Summary',    fn: () => exportFinancialSummary(donorSheetId, data, generatedBy) },
    { label: 'Conference & Travel',  fn: () => exportConferenceTravel(donorSheetId, data, generatedBy) },
    { label: 'Agreements',           fn: () => exportAgreements(donorSheetId, data, generatedBy) },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress?.({ current: step.label, step: i + 1, total: steps.length });
    try {
      const result = await step.fn();
      if (result.error) {
        errors.push(`${step.label}: ${result.error}`);
      } else {
        reports.push(`${step.label} (${result.rowsWritten} rows)`);
      }
    } catch (err) {
      errors.push(`${step.label}: ${(err as Error).message}`);
    }
  }

  return { reports, errors };
}
