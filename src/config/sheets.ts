// Module → Google Sheet mapping. Each sheet ID comes from Vite env vars so
// staging and production can point at different workbooks without code changes.
// Populate these in .env / Netlify build settings after uploading via
// sheet-builders/tools/upload_to_drive.py.

type ModuleConfig = {
  label: string;
  sheetId: string;
  tabs: Record<string, string>;
};

const env = (key: string): string => (import.meta.env[key] as string | undefined) || '';

export const SHEETS: Record<string, ModuleConfig> = {
  companies: {
    label: 'E3 - Companies Master',
    sheetId: env('VITE_SHEET_COMPANIES'),
    tabs: {
      companies: 'Companies',
      contacts: 'Contacts',
      assignments: 'Intervention Assignments',
      statusLog: 'Status Log',
      historical: 'Historical Interventions',
      lookups: 'Lookups',
      // The post-interview review workflow lives here. Reviews are
      // auto-created on first read via ensureSchema; the team writes
      // one row per (reviewer, company) capturing their proposed
      // interventions, decision, and notes.
      reviews: 'Reviews',
      comments: 'Company Comments',
      activity: 'Activity Log',
      // Shared interviewed-list aliases. Each row maps a schedule-name
      // (from interviewedSource.ts) to the matching applicant in Source
      // Data so every team member sees the same overrides.
      interviewAliases: 'Interview Aliases',
      // Shared exclusion list. Any name written here is hidden from
      // the review queue, materialize candidates, and joined rows
      // across all team members. Used to permanently kill duplicates
      // and irrelevant entries.
      removedCompanies: 'Removed Companies',
    },
  },
  procurement: {
    label: 'E3 - Procurement Plan',
    sheetId: env('VITE_SHEET_PROCUREMENT'),
    tabs: {
      q1: 'Q1 2026',
      q2: 'Q2 2026',
      q3: 'Q3 2026',
      q4: 'Q4 2026',
      summary: 'Annual Summary',
      lookups: 'Lookups',
    },
  },
  payments: {
    label: 'E3 - Payments Tracker',
    sheetId: env('VITE_SHEET_PAYMENTS'),
    tabs: {
      payments: 'Payments',
      advisorFees: 'Advisor Fees',
      vendorFees: 'Vendor Fees',
      stipends: 'Participant Stipends',
      summary: 'Summary',
      lookups: 'Lookups',
    },
  },
  conferences: {
    label: 'E3 - Conferences and Travel',
    sheetId: env('VITE_SHEET_CONFERENCES'),
    tabs: {
      catalogue: 'Conference Catalogue',
      scoring: 'Scoring Matrix',
      tracker: 'Company x Conference Tracker',
      letters: 'Commitment Letters',
      dashboard: 'Summary Dashboard',
      lookups: 'Lookups',
    },
  },
  docs: {
    label: 'E3 - Docs and Agreements',
    sheetId: env('VITE_SHEET_DOCS'),
    tabs: {
      agreements: 'Agreements',
      letters: 'Commitment Letters',
      deliverables: 'Deliverables',
      templates: 'Templates',
      lookups: 'Lookups',
    },
  },
  freelancers: {
    label: 'E3 - Freelancers (ElevateBridge)',
    sheetId: env('VITE_SHEET_FREELANCERS'),
    tabs: {
      dashboard: 'Dashboard',
      freelancers: 'Freelancers',
      followups: 'FollowUps',
      activity: 'ActivityLog',
      comments: 'Comments',
      tracks: 'Track Assignments',
      income: 'Income Tracking',
      assessments: 'Assessments',
      lookups: 'Lookups',
    },
  },
  // Live Google Form responses sheet for ElevateBridge applicants — same
  // pattern as advisorsFormResponses. The portal auto-pulls new rows from
  // here every 5 minutes and appends them to the Freelancers tab as
  // status='Available'.
  freelancersFormResponses: {
    label: 'ElevateBridge Freelancers Application Responses (form)',
    sheetId: env('VITE_SHEET_FREELANCERS_FORM_RESPONSES'),
    tabs: { responses: 'Form Responses 1' },
  },
  // Read-only source sheets — the team / audit teams write here, the
  // portal reads and surfaces them next to our E3 derived output for
  // comparison. The portal NEVER writes back.
  procurementSource: {
    label: 'GSG Procurement Plan (team source, read-only)',
    sheetId: env('VITE_SHEET_PROCUREMENT_SOURCE'),
    tabs: {}, // tabs are discovered at runtime — one per month
  },
  paymentsSource: {
    label: 'GSG Payment Tracker (legacy, read-only)',
    sheetId: env('VITE_SHEET_PAYMENTS_SOURCE'),
    tabs: {},
  },
  // Read-only list of Cohort 3 companies that have completed interviews.
  // The Companies page joins this against the 107 applicants in Source Data
  // and overrides the status to "Interviewed" (or higher) for any name match.
  companiesInterviewed: {
    label: 'Cohort 3 Interviewed Companies (read-only)',
    sheetId: env('VITE_SHEET_COMPANIES_INTERVIEWED'),
    tabs: {},
  },
  teamRoster: {
    label: 'E3 - Team Roster',
    sheetId: env('VITE_SHEET_TEAM_ROSTER'),
    tabs: { roster: 'Roster' },
  },
  selection: {
    label: 'E3 - Selection Data',
    sheetId: env('VITE_SHEET_SELECTION'),
    tabs: {
      sourceData: 'Source Data',
      firstFiltration: '1st Filtration',
      additionalFiltration: 'Additional Factors Filtration 1',
      docReviews: 'Doc Reviews',
      companyNeeds: 'Company Needs',
      scoringMatrix: 'Scoring Matrix',
      interviewAssessments: 'Interview Assessments',
      interviewDiscussion: 'Interview Discussion',
      ebAssessments: 'ElevateBridge Assessments',
      committeeVotes: 'Committee Votes',
      selectionVotes: 'Selection Votes',
      shortlists: 'Shortlists',
      finalCohort: 'Final Cohort',
      configuration: 'Configuration',
    },
  },
  logframes: {
    label: 'E3 - Logframes',
    sheetId: env('VITE_SHEET_LOGFRAMES'),
    tabs: {
      dutch: 'Dutch Log Frame',
      sida: 'SIDA TechRise Log Frame',
      budget: 'Program Budget',
      monthly: 'Monthly Budget by LIN Code',
    },
  },
  advisors: {
    label: 'E3 - Non-Technical Advisors',
    sheetId: env('VITE_SHEET_ADVISORS'),
    tabs: {
      dashboard: 'Dashboard',
      advisors: 'Advisors',
      followups: 'FollowUps',
      activity: 'ActivityLog',
      comments: 'Comments',
      mentors: 'Mentors',
      lookups: 'Lookups',
    },
  },
  // Live Google Form responses sheet — read-only, the source of truth for
  // new advisor submissions. The portal periodically pulls new rows and
  // appends them to the Advisors tab in the workbook above.
  advisorsFormResponses: {
    label: 'Non-Technical Advisors Responses (form)',
    sheetId: env('VITE_SHEET_ADVISORS_FORM_RESPONSES'),
    tabs: { responses: 'Form Responses 1' },
  },
};

export type ModuleKey = keyof typeof SHEETS;

export function getSheetId(module: ModuleKey): string {
  const id = SHEETS[module].sheetId;
  if (!id) {
    console.warn(`[sheets config] Missing sheet ID for module '${module}'. Set VITE_SHEET_${module.toUpperCase()} in env.`);
  }
  return id;
}

export function getTab(module: ModuleKey, tab: string): string {
  return SHEETS[module].tabs[tab] || tab;
}
