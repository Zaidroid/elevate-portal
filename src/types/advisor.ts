// Advisor types — ported from /Users/zaidsalem/Zlab/Advisors/src/types.ts.
//
// The shape of `Advisor` matches the form-response columns in the
// E3 - Non-Technical Advisors sheet (Advisors tab) plus the new tracker
// columns appended by sheet-builders/builders/advisors.py and the computed
// stage1/stage2 score fields the portal stamps back into the row.

export type CategoryKey = 'CEO' | 'CTO' | 'COO' | 'Marketing' | 'AI';

export type AdvisorStatus =
  | 'new'
  | 'acknowledged'
  | 'allocated'
  | 'intro_sched'
  | 'intro_done'
  | 'assessment'
  | 'approved'
  | 'rejected'
  | 'matched'
  | 'on_hold';

export interface Stage1Parts {
  tech_rating: number;
  eco_rating: number;
  clevel: number;
  years: number;
  experience: number;
  seniority: number;
  linkedin: number;
  cv: number;
}

export interface Stage1Score {
  total: number;          // 0–100
  parts: Stage1Parts;
  pass: boolean;
}

export interface Stage2Score {
  ceo: number;
  cto: number;
  coo: number;
  marketing: number;
  ai: number;
  primary: CategoryKey | 'Unqualified';
}

export interface Stage1Weights {
  tech_rating: number;
  eco_rating: number;
  clevel: number;
  years: number;
  experience: number;
  seniority: number;
  linkedin: number;
  cv: number;
}

export interface SeniorityTier {
  keyword: string;
  score: number;
}

export interface CategoryConfig {
  keywords: string[];
  areaWeights: Record<string, number>;
  titleBoost: number;
  techRatingBias: number;
}

export interface ScoringConfig {
  stage1_threshold: number;
  stage1_weights: Stage1Weights;
  years_multipliers: Record<string, number>;
  seniority_tiers: SeniorityTier[];
  category_ceo: CategoryConfig;
  category_cto: CategoryConfig;
  category_coo: CategoryConfig;
  category_marketing: CategoryConfig;
  category_ai: CategoryConfig;
  category_tiebreaker: 'raw_signal_count' | 'ceo_first';
}

// Raw advisor row as it lands from the sheet. All fields are strings because
// useSheetDoc returns string columns; the scoring engine parses on demand.
//
// `type` (not interface) so the shape is structurally compatible with
// Record<string, unknown> — that's what DataTable / useSheetDoc require.
export type Advisor = {
  // Form response columns
  advisor_id: string;
  timestamp: string;
  full_name: string;
  gender: string;
  country: string;
  email: string;
  whatsapp: string;
  linkedin: string;
  tech_rating: string;
  eco_rating: string;
  exp_areas: string;
  exp_detail: string;
  c_level: string;
  c_level_detail: string;
  position: string;
  employer: string;
  years: string;
  non_tech_subjects: string;
  gsg_past: string;
  paid_or_vol: string;
  hourly_rate: string;
  cv_link: string;
  notes: string;
  heard_from: string;
  opportunities: string;
  support_in: string;
  support_via: string;
  tech_specs: string;
  newsletter: string;

  // Tracker columns appended by builders/advisors.py
  pipeline_status: string;
  assignee_email: string;
  received_ack: string;
  intro_scheduled_date: string;
  intro_done_date: string;
  assessment_date: string;
  decision_date: string;
  tracker_notes: string;
  assignment_company_id: string;
  assignment_intervention_type: string;
  assignment_status: string;
  assignment_notes: string;

  // Computed score columns the portal writes back so the sheet's Dashboard
  // tab can sort/filter on the same values without re-running the engine.
  stage1_score: string;
  stage1_pass: string;
  stage2_category: string;
  stage2_score: string;

  // Audit
  updated_at: string;
  updated_by: string;
};

export type FollowUp = {
  followup_id: string;
  advisor_id: string;
  due_date: string;
  type: string;
  assignee_email: string;
  status: string;       // Open / Done / Snoozed
  notes: string;
  created_by: string;
  created_at: string;
  completed_at: string;
  updated_at: string;
  updated_by: string;
};

export type ActivityRow = {
  activity_id: string;
  timestamp: string;
  user_email: string;
  advisor_id: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  details: string;
};

export type AdvisorComment = {
  comment_id: string;
  advisor_id: string;
  author_email: string;
  body: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
};
