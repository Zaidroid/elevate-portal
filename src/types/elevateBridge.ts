// ElevateBridge programme types. One row shape per tab in the
// `elevateBridge` workbook. All fields are strings — Google Sheets
// returns everything stringly-typed, and DataTable / useModuleData
// require Record<string, string | undefined> compatibility.

export type EbTrack = 'FL' | 'SM' | 'FL+SM' | '';
export type EbStage = 'Applied' | 'S1 Filter' | 'S2 Sort' | 'S3 Scoring' | 'Interview' | 'Decision';
export type EbDecision = 'Admitted' | 'Waitlisted' | 'Withdrew' | 'Dropped' | 'Disqualified' | '';
export type EbRegion = 'West Bank' | 'Gaza Strip' | 'Outside Palestine' | '';

// One row per of the 203 applicants. Aggregates the most-used columns
// from the workbook's Master Data + Deduplicated_Final_Report tabs.
export type EbApplicant = {
  applicant_id: string;        // EB-<sha1(email)[:8]>
  full_name_en: string;
  full_name_ar: string;
  email: string;
  phone: string;
  gender: string;
  dob: string;
  location: string;
  region: string;              // EbRegion
  specialization: string;
  education_level: string;
  university_name: string;
  university_major: string;
  has_disability: string;
  electricity_reliability: string;
  internet_reliability: string;
  track_registered: string;    // EbTrack
  track_assigned: string;      // EbTrack
  current_stage: string;       // EbStage
  decision: string;            // EbDecision
  killing_factor_result: string;
  killing_factor_reason: string;
  ssi_score: string;
  response_score_fl: string;
  response_score_sm: string;
  interview_score_fl: string;
  interview_score_sm: string;
  total_score: string;
  hours_per_week: string;
  session_commitment: string;
  notes: string;
  updated_at: string;
  updated_by: string;
};

// Raw form-responses mirror — sparsely typed; the drawer renders whatever
// keys it finds. Treat as opaque key/value bag.
export type EbResponse = Record<string, string | undefined> & {
  applicant_id: string;
};

export type EbStage1 = Record<string, string | undefined> & {
  applicant_id: string;
  full_name: string;
  email: string;
  track_registered: string;
  killing_factor_result: string; // Pass | Fail
  reason: string;
  total_upwork_income_i: string;
  upwork_income_jh: string;
  upwork_income_agency: string;
  sm_income_i: string;
  sm_income_agency: string;
};

export type EbStage2 = Record<string, string | undefined> & {
  applicant_id: string;
  full_name: string;
  email: string;
  track_registered: string;
  track_assigned: string;
  skills_category: string;
  jh_sector_upwork: string;
  jh_sector_sm: string;
};

export type EbStage3Ssi = {
  applicant_id: string;
  full_name: string;
  email: string;
  linkedin_url: string;
  ssi_score: string;
  ssi_deadline_met: string; // Yes | No | Extended
  notes: string;
};

// Long form: one row per (applicant, criterion). Drives the Scoring tab.
export type EbStage3Response = {
  score_id: string;            // <applicant_id>-<track>-<criterion_key>
  applicant_id: string;
  full_name: string;
  track: string;               // FL | SM | FL+SM
  category: string;            // e.g. "Upwork Earnings"
  criterion_key: string;       // stable slug
  criterion_label: string;
  weight: string;              // percent, e.g. "40"
  sub_weight: string;          // percent
  score: string;               // 1..5
  notes: string;
  scored_by: string;
  scored_at: string;
};

// Long form: one row per (applicant, question) for interview scoring.
export type EbInterview = {
  interview_id: string;        // <applicant_id>-<track>-Q<n>
  applicant_id: string;
  full_name: string;
  track: string;
  q_number: string;            // "1".."14"
  category: string;
  criterion_label: string;
  weight: string;
  sub_weight: string;
  score: string;               // 1..5 or Yes/No
  attended: string;            // Yes | No | Withdrew
  notes: string;
  scored_by: string;
  scored_at: string;
};

export type EbDecisionRow = {
  applicant_id: string;
  full_name: string;
  email: string;
  track: string;
  final_score: string;
  decision: string;            // EbDecision
  decision_date: string;
  decision_by: string;
  notes: string;
};

// Rubric rows — drive the Scoring tab UI. Each row defines one criterion's
// 1..5 descriptors so the score grid can render a tooltip per cell.
export type EbRubric = {
  rubric_id: string;
  track: string;               // FL | SM | FL+SM | All
  stage: string;               // Response | Interview | SSI
  category: string;
  criterion_key: string;
  criterion_label: string;
  weight: string;
  sub_weight: string;
  score_5: string;
  score_4: string;
  score_3: string;
  score_2: string;
  score_1: string;
  notes: string;
};

export type EbMentor = {
  mentor_id: string;
  full_name: string;
  email: string;
  whatsapp: string;
  track: string;               // Upwork Agency Building | Google Maps Lead Generation | Business Development & Tech Sales
  hourly_rate: string;
  total_hours: string;
  budget_total: string;
  bio: string;
};

export type EbSession = {
  session_id: string;
  track: string;
  session_num: string;
  date: string;
  topic: string;
  recording_url: string;
  passcode: string;
  curriculum_url: string;
  hours: string;
  status: string;              // Scheduled | Completed | Cancelled | Rescheduled
  notes: string;
  updated_at: string;
  updated_by: string;
};

export type EbAttendance = {
  attendance_id: string;       // <session_id>-<applicant_id>
  session_id: string;
  applicant_id: string;
  full_name: string;
  attended: string;            // Yes | No | Late
  notes: string;
  updated_at: string;
  updated_by: string;
};

export type EbTopPerformer = {
  applicant_id: string;
  overall_rank: string;
  city_rank: string;
  area: string;                // West Bank | Gaza Strip
  track: string;               // FL | SM | FL+SM
  full_name_en: string;
  full_name_ar: string;
  email: string;
  phone: string;
  gender: string;
  dob: string;
  location: string;
  specialization: string;
  education_level: string;
  total_earnings: string;
  performance_score: string;
  profile_url: string;
  withdrew: string;            // Yes | No
};

export type EbMatchStatus = 'Proposed' | 'Engaged' | 'Producing' | 'Completed' | 'Cancelled' | '';

export type EbMatch = {
  match_id: string;
  applicant_id: string;
  freelancer_name: string;
  freelancer_email: string;
  company_id: string;
  company_name: string;
  track: string;              // EbTrack
  status: string;             // EbMatchStatus
  hours_per_week: string;
  start_date: string;
  end_date: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

export type EbActivity = {
  activity_id: string;
  timestamp: string;
  user_email: string;
  entity_type: string;         // applicant | score | session | attendance | decision | mentor | rubric
  entity_id: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  details: string;
};
