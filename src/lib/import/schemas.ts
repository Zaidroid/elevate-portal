// Declarative import targets. Each entry maps a UI choice to a target
// sheet/tab plus the column shape we expect. Used by /import to drive the
// column-mapping step and the final append. Mirrors what the Python migrators
// in sheet-builders/migrators/ write — but runs in the browser so non-engineers
// can self-serve.

import type { ModuleKey } from '../../config/sheets';

export type ImportTarget = {
  key: string;
  label: string;
  description: string;
  module: ModuleKey;
  tabKey: string;            // resolves via getTab(module, tabKey)
  headers: string[];         // target column order
  required: string[];        // headers that must be present in source
  // Headers we never want users to fill from a source file. The sheet sets
  // them via formula (e.g. company_id = "E3-"&TEXT(ROW(),"0000")) or the
  // useSheetDoc hook stamps them on write (updated_at, updated_by).
  autoFilled?: string[];
  // Soft cap so a runaway file does not blow API quota.
  maxRows?: number;
};

export const IMPORT_TARGETS: ImportTarget[] = [
  {
    key: 'companies',
    label: 'Companies',
    description: 'Add new Cohort 3 companies. company_id is auto-assigned by the sheet formula.',
    module: 'companies',
    tabKey: 'companies',
    headers: [
      'company_id', 'company_name', 'legal_name', 'city', 'governorate',
      'sector', 'employee_count', 'revenue_bracket', 'international_revenue_pct',
      'readiness_score', 'fund_code', 'cohort', 'status', 'selection_date',
      'onboarding_date', 'primary_contact_id', 'drive_folder_url', 'notes',
      'updated_at', 'updated_by',
    ],
    required: ['company_name'],
    autoFilled: ['company_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'historical_interventions',
    label: 'Historical interventions (E1 / E2)',
    description: 'Backfill prior cohort intervention rows. historical_id is auto-assigned.',
    module: 'companies',
    tabKey: 'historical',
    headers: [
      'historical_id', 'cohort', 'company_name', 'company_id', 'offering_name',
      'specialization', 'cohort_name', 'donor', 'fund_code', 'start_date',
      'end_date', 'year', 'agreement_link', 'source', 'notes',
      'updated_at', 'updated_by',
    ],
    required: ['cohort', 'company_name', 'offering_name'],
    autoFilled: ['historical_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'assignments',
    label: 'Intervention assignments',
    description: 'Plan or backfill live Cohort 3 intervention assignments.',
    module: 'companies',
    tabKey: 'assignments',
    headers: [
      'assignment_id', 'company_id', 'intervention_type', 'sub_intervention',
      'fund_code', 'start_date', 'end_date', 'owner_email', 'status',
      'budget_usd', 'procurement_pr_id', 'notes', 'updated_at', 'updated_by',
    ],
    required: ['company_id', 'intervention_type'],
    autoFilled: ['assignment_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'procurement_q1',
    label: 'Procurement plan — Q1 2026',
    description: 'Q1 PRs. pr_id, total_cost_usd, threshold_class, sla_working_days, pr_deadline are formula-driven.',
    module: 'procurement',
    tabKey: 'q1',
    headers: [
      'pr_id', 'activity', 'intervention_type', 'company_id', 'office_code',
      'gl_account', 'fund_code', 'lin_code', 'item_description', 'unit', 'qty',
      'unit_cost_usd', 'total_cost_usd', 'threshold_class', 'sla_working_days',
      'target_award_date', 'pr_submit_date', 'pr_deadline', 'local_international',
      'requester_email', 'status', 'procurement_contact', 'notes',
      'updated_at', 'updated_by',
    ],
    required: ['activity'],
    autoFilled: [
      'pr_id', 'total_cost_usd', 'threshold_class', 'sla_working_days',
      'pr_deadline', 'updated_at', 'updated_by',
    ],
  },
  {
    key: 'procurement_q2',
    label: 'Procurement plan — Q2 2026',
    description: 'Q2 PRs. Same shape as Q1.',
    module: 'procurement',
    tabKey: 'q2',
    headers: [
      'pr_id', 'activity', 'intervention_type', 'company_id', 'office_code',
      'gl_account', 'fund_code', 'lin_code', 'item_description', 'unit', 'qty',
      'unit_cost_usd', 'total_cost_usd', 'threshold_class', 'sla_working_days',
      'target_award_date', 'pr_submit_date', 'pr_deadline', 'local_international',
      'requester_email', 'status', 'procurement_contact', 'notes',
      'updated_at', 'updated_by',
    ],
    required: ['activity'],
    autoFilled: [
      'pr_id', 'total_cost_usd', 'threshold_class', 'sla_working_days',
      'pr_deadline', 'updated_at', 'updated_by',
    ],
  },
  {
    key: 'payments',
    label: 'Payments',
    description: 'Bulk add disbursements. Use needs_review = TRUE for legacy rows missing FKs.',
    module: 'payments',
    tabKey: 'payments',
    headers: [
      'payment_id', 'pr_id', 'company_id', 'assignment_id', 'payee_type',
      'payee_name', 'intervention_type', 'fund_code', 'amount_usd', 'currency',
      'payment_date', 'status', 'finance_contact', 'invoice_url', 'receipt_url',
      'needs_review', 'notes', 'updated_at', 'updated_by',
    ],
    required: ['payee_name', 'amount_usd'],
    autoFilled: ['payment_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'docs_agreements',
    label: 'Docs & Agreements',
    description: 'MJPSAs, addenda, NDAs, commitment letters. agreement_id is auto-assigned.',
    module: 'docs',
    tabKey: 'agreements',
    headers: [
      'agreement_id', 'company_id', 'company_name', 'agreement_type',
      'signed_date', 'signatory_name', 'signatory_title', 'gsg_signatory',
      'drive_url', 'status', 'related_intervention', 'assignment_id',
      'notes', 'updated_at', 'updated_by',
    ],
    required: ['company_name', 'agreement_type'],
    autoFilled: ['agreement_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'conferences_catalogue',
    label: 'Conferences catalogue',
    description: 'Tracked international conferences. conference_id is auto-assigned.',
    module: 'conferences',
    tabKey: 'catalogue',
    headers: [
      'conference_id', 'name', 'city', 'country', 'start_date', 'end_date',
      'website', 'tier', 'fund_eligible', 'estimated_cost_per_company_usd',
      'status', 'notes', 'updated_at', 'updated_by',
    ],
    required: ['name'],
    autoFilled: ['conference_id', 'updated_at', 'updated_by'],
  },
  {
    key: 'freelancers',
    label: 'Freelancers (ElevateBridge)',
    description: 'Bulk add freelancers. freelancer_id is auto-assigned.',
    module: 'freelancers',
    tabKey: 'freelancers',
    headers: [
      'freelancer_id', 'full_name', 'email', 'phone', 'location', 'track',
      'role_profile', 'assigned_mentor', 'company_id', 'status', 'start_date',
      'notes', 'updated_at', 'updated_by',
    ],
    required: ['full_name'],
    autoFilled: ['freelancer_id', 'updated_at', 'updated_by'],
  },
];

export function findTarget(key: string): ImportTarget | null {
  return IMPORT_TARGETS.find(t => t.key === key) || null;
}
