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
      // Structured per-company intervention recommendations made
      // before the final decision session — populated from Israa's
      // voting CSV, Raouf's notes docx, and any future seeds. The
      // Final Decision view's pre-fill logic uses these as the
      // highest-priority hint after existing locks.
      preDecisions: 'Pre-decision Recommendations',
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
  // The full ElevateBridge programme workbook — selection funnel
  // (S1 → S2 → S3), scoring rubrics, interview scores, final decisions,
  // mentors, training sessions, attendance, and top performers. Sourced
  // by importing the four xlsx files in /Elevate 3.0/ElevateBridge/ into
  // a single Drive workbook ("Elevate Bridge — Portal"). The Matching tab
  // still reads from the `freelancers` module above; this module owns
  // everything from intake to admission.
  elevateBridge: {
    label: 'E3 - Elevate Bridge Programme',
    sheetId: env('VITE_SHEET_ELEVATE_BRIDGE'),
    tabs: {
      applicants:    'Applicants',
      responses:     'Form Responses',
      stage1:        'S1 Killing Factor',
      stage2:        'S2 Tracks Sorting',
      stage3Ssi:     'S3 SSI',
      stage3Resp:    'S3 Response Scoring',
      interviews:    'Interview Scoring',
      decisions:     'Final Decisions',
      rubrics:       'Scoring Rubrics',
      mentors:       'Mentors',
      sessions:      'Training Sessions',
      attendance:    'Session Attendance',
      topPerformers: 'Top Performers',
      matches:       'Matches',
      activity:      'ActivityLog',
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
      // Stage 3 distribution mirror tab — written by Stage3DistributionWriter
      // every time AM reassignment or lock state changes. Doubles as the
      // human-friendly view of the cohort allocation that the team can open
      // directly in Sheets.
      stage3Distribution: 'Stage3 Distribution',
    },
  },
  logframes: {
    label: 'E3 - Logframes',
    sheetId: env('VITE_SHEET_LOGFRAMES'),
    tabs: {
      dutch: 'Dutch Log Frame',
      sida: 'SIDA TechRise Log Frame',
      // Consolidated 2026 commitments — Dutch indicators rows 1–10,
      // SIDA indicators rows 12–25. Has the team's "2026 Planned
      // Target" column which beats the donor 2026 Target as the
      // realistic capacity signal for live decisions.
      targets: 'Targets',
      budget: 'Program Budget',
      monthly: 'Monthly Budget Per LinCode',
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
  donorReports: {
    label: 'E3 - Donor Reports (auto-generated)',
    sheetId: env('VITE_SHEET_DONOR_REPORTS'),
    tabs: {
      portfolio: 'Company Portfolio',
      interventions: 'Intervention Delivery',
      financial: 'Financial Summary',
      conferences: 'Conference & Travel',
      agreements: 'Agreements',
    },
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

// ─── Boot-time env validation ─────────────────────────────────────────
//
// Modules the portal cannot operate without. New environments
// (Netlify, staging, local dev) silently render empty pages when an
// env var is missing — this helper surfaces the gap up-front via an
// admin banner so we don't keep diagnosing it page-by-page.
//
// "Required" = a module whose absence breaks the primary user flow
// (company profile + interventions). Optional modules (form-response
// auto-syncs, donor reports, ElevateBridge programme workbook) live
// in OPTIONAL_MODULES and get warned but not flagged red.

const REQUIRED_MODULES: ModuleKey[] = [
  'companies',
  'payments',
  'procurement',
  'conferences',
  'docs',
  'advisors',
  'freelancers',
  'teamRoster',
  'selection',
  'logframes',
];

const OPTIONAL_MODULES: ModuleKey[] = [
  'elevateBridge',
  'freelancersFormResponses',
  'advisorsFormResponses',
  'procurementSource',
  'paymentsSource',
  'companiesInterviewed',
  'donorReports',
];

export type EnvReport = {
  ok: boolean;
  missingRequired: Array<{ module: string; envVar: string; label: string }>;
  missingOptional: Array<{ module: string; envVar: string; label: string }>;
};

function envVarFor(module: ModuleKey): string {
  // Mirrors the convention used inside SHEETS — `VITE_SHEET_<MODULE>`,
  // with the camelCase module key UPPERCASED. The actual code passed
  // to `env()` is hardcoded per module above, so we approximate via the
  // module key. Special cases are spelt out so the banner shows the
  // EXACT env var the developer needs to set.
  const SPECIAL: Partial<Record<ModuleKey, string>> = {
    elevateBridge: 'VITE_SHEET_ELEVATE_BRIDGE',
    teamRoster: 'VITE_SHEET_TEAM_ROSTER',
    freelancersFormResponses: 'VITE_SHEET_FREELANCERS_FORM_RESPONSES',
    advisorsFormResponses: 'VITE_SHEET_ADVISORS_FORM_RESPONSES',
    procurementSource: 'VITE_SHEET_PROCUREMENT_SOURCE',
    paymentsSource: 'VITE_SHEET_PAYMENTS_SOURCE',
    companiesInterviewed: 'VITE_SHEET_COMPANIES_INTERVIEWED',
    donorReports: 'VITE_SHEET_DONOR_REPORTS',
  };
  return SPECIAL[module] || `VITE_SHEET_${module.toUpperCase()}`;
}

export function validateEnv(): EnvReport {
  const missingRequired: EnvReport['missingRequired'] = [];
  const missingOptional: EnvReport['missingOptional'] = [];
  for (const m of REQUIRED_MODULES) {
    if (!SHEETS[m].sheetId) {
      missingRequired.push({ module: m, envVar: envVarFor(m), label: SHEETS[m].label });
    }
  }
  for (const m of OPTIONAL_MODULES) {
    if (!SHEETS[m].sheetId) {
      missingOptional.push({ module: m, envVar: envVarFor(m), label: SHEETS[m].label });
    }
  }
  return {
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  };
}
