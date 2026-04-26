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
    label: 'E3 - Freelancers',
    sheetId: env('VITE_SHEET_FREELANCERS'),
    tabs: {
      freelancers: 'Freelancers',
      tracks: 'Track Assignments',
      income: 'Income Tracking',
      assessments: 'Assessments',
      lookups: 'Lookups',
    },
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
