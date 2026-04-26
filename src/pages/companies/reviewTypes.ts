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

export type ReviewDecision = 'Recommend' | 'Hold' | 'Reject';

export const REVIEW_DECISIONS: ReviewDecision[] = ['Recommend', 'Hold', 'Reject'];

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

// Per-company aggregation of all team reviews — what the kanban card and
// roster column show: total reviewer count, breakdown by decision, the
// modal recommendation, and whether there's divergence (>1 distinct vote).
export type ReviewSummary = {
  total: number;
  recommend: number;
  hold: number;
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
    else if (r.decision === 'Reject') summary.reject += 1;
    const email = (r.reviewer_email || '').toLowerCase();
    if (email && !seen.has(email)) { seen.add(email); summary.reviewerEmails.push(email); }
  }
  if (summary.total === 0) return summary;
  const counts: Array<[ReviewDecision, number]> = [
    ['Recommend', summary.recommend],
    ['Hold', summary.hold],
    ['Reject', summary.reject],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const distinct = counts.filter(c => c[1] > 0).length;
  summary.divergence = distinct > 1;
  summary.consensus = distinct === 1 ? counts[0][0] : 'Mixed';
  return summary;
}
