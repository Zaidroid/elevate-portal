// Shared types + constants for the post-interview review workflow.
// These rows are written to the Companies workbook tabs Reviews,
// Company Comments, and Activity Log. ensureSchema in lib/sheets/client
// auto-creates the tabs on first read so users don't have to re-upload
// the workbook.

export type Review = {
  review_id: string;
  company_id: string;
  reviewer_email: string;
  decision: ReviewDecision | '';
  proposed_pillars: string;          // comma-separated pillar codes
  proposed_sub_interventions: string; // comma-separated sub-intervention codes
  notes: string;
  created_at: string;
  updated_at: string;
};

export type CompanyComment = {
  comment_id: string;
  company_id: string;
  author_email: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type ActivityRow = {
  activity_id: string;
  timestamp: string;
  user_email: string;
  company_id: string;
  action: string;       // status_change | intervention_added | review_saved | comment | pm_assigned
  field: string;
  old_value: string;
  new_value: string;
  details: string;
};

// 'Reject' is the legacy code; 'Waitlist' is the canonical. Both are
// accepted at the type level so existing rows in the Reviews tab still
// load. New saves always use 'Waitlist'. Aggregations (summarizeReviews)
// treat the two as the same decision.
export type ReviewDecision = 'Recommend' | 'Hold' | 'Waitlist' | 'Reject';

export const REVIEW_DECISIONS: ReviewDecision[] = ['Recommend', 'Hold', 'Waitlist'];

// Normalize a legacy decision to its canonical form.
export function canonicalDecision(d: string | undefined | null): ReviewDecision | '' {
  if (!d) return '';
  if (d === 'Reject') return 'Waitlist';
  if (d === 'Recommend' || d === 'Hold' || d === 'Waitlist') return d;
  return '';
}

export const REVIEWS_HEADERS = [
  'review_id',
  'company_id',
  'reviewer_email',
  'decision',
  'proposed_pillars',
  'proposed_sub_interventions',
  'notes',
  'created_at',
  'updated_at',
];

export const COMMENTS_HEADERS = [
  'comment_id',
  'company_id',
  'author_email',
  'body',
  'created_at',
  'updated_at',
];

export const ACTIVITY_HEADERS = [
  'activity_id',
  'timestamp',
  'user_email',
  'company_id',
  'action',
  'field',
  'old_value',
  'new_value',
  'details',
];

// Shared interviewed-list aliases. One row per schedule_name; the
// applicant_company_name field points at the Source Data company the
// schedule entry should be matched to. Used to overlay the Interviewed
// status when the team's spelling drifts from the master sheet.
export type InterviewAlias = {
  alias_id: string;            // slugged schedule_name; one row per schedule_name
  schedule_name: string;       // exact value from interviewedSource.ts
  applicant_company_name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

export const ALIAS_HEADERS = [
  'alias_id',
  'schedule_name',
  'applicant_company_name',
  'created_by',
  'created_at',
  'updated_at',
  'updated_by',
];

// Stable id for an alias = lowercased + dashed schedule name.
export function aliasIdFor(scheduleName: string): string {
  return (scheduleName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

// Shared exclusion list. Any name listed here is hidden from the
// review queue, materialize candidates, and the joined rows across
// every surface and every team member.
export type RemovedCompany = {
  removed_id: string;          // slug of company_name; one row per name
  company_name: string;
  removed_by: string;
  removed_at: string;
  reason: string;              // optional free-text
};

export const REMOVED_HEADERS = [
  'removed_id',
  'company_name',
  'removed_by',
  'removed_at',
  'reason',
];

export function removedIdFor(companyName: string): string {
  // Use a different prefix from aliases so we never collide if the
  // same name happens to be an alias too.
  return 'rm-' + ((companyName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 76) || 'unknown');
}

// Pre-decision Recommendations — structured pillar/sub picks captured
// before tomorrow's final-selection session. Sourced from Israa's
// voting CSV + Raouf's docx + future authors. Each row is one
// (company, author, pillar, sub) recommendation with an optional
// fund_hint and a free-text note. Used by the Final Decision view as
// the highest-priority pre-fill source after existing locks.
export type PreDecisionRecommendation = {
  recommendation_id: string;
  company_id: string;
  company_name: string;
  author_email: string;
  pillar: string;
  sub_intervention: string;
  fund_hint: string;
  note: string;
  source: string;          // 'israa-csv' / 'raouf-docx' / 'manual' / etc.
  created_at: string;
};

export const PRE_DECISION_HEADERS = [
  'recommendation_id',
  'company_id',
  'company_name',
  'author_email',
  'pillar',
  'sub_intervention',
  'fund_hint',
  'note',
  'source',
  'created_at',
];

export function preDecisionIdFor(companyId: string, author: string, pillar: string, sub: string, source: string): string {
  return ['rec', companyId, author, pillar, sub || 'all', source]
    .map(s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join('-')
    .slice(0, 100);
}

// Per-company aggregation of all team reviews — what the kanban card and
// roster column show: total reviewer count, breakdown by decision, the
// modal recommendation, and whether there's divergence (>1 distinct vote).
//
// `waitlist` counts both legacy 'Reject' and canonical 'Waitlist' decisions.
// `reject` is kept as an alias to avoid breaking existing consumers.
export type ReviewSummary = {
  total: number;
  recommend: number;
  hold: number;
  waitlist: number;
  /** @deprecated alias for `waitlist` — kept for backward compat. */
  reject: number;
  consensus: ReviewDecision | 'Mixed' | null;
  divergence: boolean;
  reviewerEmails: string[];
};

export function summarizeReviews(rows: Review[]): ReviewSummary {
  const summary: ReviewSummary = {
    total: 0,
    recommend: 0,
    hold: 0,
    waitlist: 0,
    reject: 0,
    consensus: null,
    divergence: false,
    reviewerEmails: [],
  };
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.decision) continue;
    summary.total += 1;
    if (r.decision === 'Recommend') summary.recommend += 1;
    else if (r.decision === 'Hold') summary.hold += 1;
    else if (r.decision === 'Waitlist' || r.decision === 'Reject') summary.waitlist += 1;
    const email = (r.reviewer_email || '').toLowerCase();
    if (email && !seen.has(email)) { seen.add(email); summary.reviewerEmails.push(email); }
  }
  summary.reject = summary.waitlist;
  if (summary.total === 0) return summary;
  const counts: Array<[ReviewDecision, number]> = [
    ['Recommend', summary.recommend],
    ['Hold', summary.hold],
    ['Waitlist', summary.waitlist],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const distinct = counts.filter(c => c[1] > 0).length;
  summary.divergence = distinct > 1;
  summary.consensus = distinct === 1 ? counts[0][0] : 'Mixed';
  return summary;
}
