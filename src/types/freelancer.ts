// ElevateBridge / Freelancer types. Mirror of types/advisor.ts but adapted
// to the freelancer pipeline (no Stage 1/2 scoring, mentor instead of
// company-facing match, simpler intake).

export type FreelancerStatus =
  | 'Applicant'
  | 'Acknowledged'
  | 'In Assessment'
  | 'Accepted'
  | 'In Program'
  | 'Graduated'
  | 'Dropped'
  | 'On Hold'
  | 'On File'
  | 'Archived';

// `type` (not interface) so the shape is structurally compatible with
// Record<string, unknown> — DataTable / useSheetDoc require it.
export type Freelancer = {
  freelancer_id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  track: string;            // Upwork / Social Media / Other
  role_profile: string;     // Individual / Job Hunter / Agency
  assigned_mentor: string;  // freelance industry mentor (external)
  company_id: string;       // GSG company match (post-graduation)
  status: string;           // pipeline status
  start_date: string;
  source_sheet: string;
  notes: string;            // intake notes
  // Tracker columns
  assignee_email: string;
  ack_sent: string;         // Yes/No
  assessment_date: string;
  decision_date: string;
  tracker_notes: string;
  // Audit
  updated_at: string;
  updated_by: string;
};

export type FreelancerFollowUp = {
  followup_id: string;
  freelancer_id: string;
  due_date: string;
  type: string;
  assignee_email: string;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
  completed_at: string;
  updated_at: string;
  updated_by: string;
};

export type FreelancerActivity = {
  activity_id: string;
  timestamp: string;
  user_email: string;
  freelancer_id: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  details: string;
};

export type FreelancerComment = {
  comment_id: string;
  freelancer_id: string;
  author_email: string;
  body: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
};
