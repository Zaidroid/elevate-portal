// ─── Unified sheet types ─────────────────────────────────────────────
//
// Every type below mirrors a Google Sheets tab 1-to-1.  All fields are
// strings because that is what the Sheets API returns.  Pages that need
// parsed numbers or dates should derive them locally.
//
// Canonical source: this file.  Do NOT redefine these types in page
// components — import from here instead.
// ─────────────────────────────────────────────────────────────────────

/** Generic sheet row — useful when a page only accesses dynamic keys. */
export type Row = Record<string, string>;

// ─── Companies Module ────────────────────────────────────────────────

/** Companies Master tab. */
export type Company = {
  company_id: string;
  company_name: string;
  legal_name: string;
  city: string;
  governorate: string;
  sector: string;
  employee_count: string;
  revenue_bracket: string;
  international_revenue_pct: string;
  readiness_score: string;
  fund_code: string;
  cohort: string;
  status: string;
  stage: string;
  profile_manager_email: string;
  selection_date: string;
  onboarding_date: string;
  drive_folder_url: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

/** Intervention Assignments tab (Companies workbook). */
export type Assignment = {
  assignment_id: string;
  company_id: string;
  intervention_type: string;
  sub_intervention: string;
  fund_code: string;
  start_date: string;
  end_date: string;
  owner_email: string;
  status: string;
  budget_usd: string;
  notes: string;
};

/** Contacts tab (Companies workbook). */
export type Contact = {
  contact_id: string;
  company_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  role: string;
  notes: string;
};

/** Applicant row from the Selection Source Data tab. All-string generic. */
export type Applicant = Record<string, string>;

// ─── Procurement Module ──────────────────────────────────────────────

/** Procurement Request (one per quarter tab: Q1–Q4). */
export type PR = {
  pr_id: string;
  activity: string;
  intervention_type: string;
  company_id: string;
  office_code: string;
  gl_account: string;
  fund_code: string;
  lin_code: string;
  item_description: string;
  unit: string;
  qty: string;
  unit_cost_usd: string;
  total_cost_usd: string;
  threshold_class: string;
  sla_working_days: string;
  target_award_date: string;
  pr_submit_date: string;
  pr_deadline: string;
  local_international: string;
  requester_email: string;
  status: string;
  procurement_contact: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

// ─── Payments Module ─────────────────────────────────────────────────

export type Payment = {
  payment_id: string;
  pr_id: string;
  company_id: string;
  assignment_id: string;
  payee_type: string;
  payee_name: string;
  intervention_type: string;
  fund_code: string;
  amount_usd: string;
  currency: string;
  payment_date: string;
  status: string;
  finance_contact: string;
  invoice_url: string;
  receipt_url: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

// ─── Conferences Module ──────────────────────────────────────────────

/** Conference catalogue entry. */
export type Conference = {
  conference_id: string;
  name: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string;
  website: string;
  tier: string;
  fund_eligible: string;
  estimated_cost_per_company_usd: string;
  status: string;
  notes: string;
};

/** Company × Conference tracker row. */
export type ConferenceTrackerRow = {
  tracker_id: string;
  company_id: string;
  company_name: string;
  conference_id: string;
  conference_name: string;
  fit_score: string;
  decision: string;
  signatory_name: string;
  commitment_letter_url: string;
  travel_dates: string;
  flight_booked: string;
  visa_status: string;
  payment_id: string;
  notes: string;
};

// ─── Docs Module ─────────────────────────────────────────────────────

export type Agreement = {
  agreement_id: string;
  company_id: string;
  agreement_type: string;
  signed_date: string;
  signatory_name: string;
  signatory_title: string;
  gsg_signatory: string;
  drive_url: string;
  status: string;
  related_intervention: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

// ─── Team Roster Module ──────────────────────────────────────────────

export type TeamMember = {
  email: string;
  name: string;
  role: string;
  active: string;
  title: string;
  team: string;
  notes: string;
  updated_at?: string;
  updated_by?: string;
};

// ─── Selection Module ────────────────────────────────────────────────

/**
 * Generic selection-tool row (scoring matrix, doc reviews, needs, votes, etc.).
 * All columns are dynamic; the tab defines the schema.
 */
export type SelectionRow = Record<string, string>;
