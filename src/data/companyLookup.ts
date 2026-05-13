/**
 * companyLookup — canonical "company_id → derived view" map.
 *
 * Both PaymentsPage and ProcurementPage built this identically before:
 * a Map<company_id, { name, AM display name, donor, budget cap }>. The
 * shape and the builder were copy-pasted, which meant any change to the
 * cohort-alias resolution logic had to land in two places. This module
 * is the one place that owns the derivation.
 *
 * Inputs are the master Companies rows + the AM directory; outputs are
 * a typed Map keyed by company_id.
 */
import type { Company } from './types';
import { cohortEntryFor } from '../config/cohort3Aliases';
import { ACCOUNT_MANAGERS, displayName } from '../config/team';

export interface CompanyLookupRow {
  companyId: string;
  /** Canonical name from the alias map; falls back to the master row's
   *  company_name and finally the id (so the map is always renderable). */
  name: string;
  /** AM's display name. Resolved from the master row's
   *  profile_manager_email first, then the alias entry's `am` field. */
  amName: string;
  /** 'Dutch' | 'SIDA' | the master row's fund_code | ''. */
  donor: string;
  /** USD budget cap from the alias map; 0 if none specified. */
  budgetCap: number;
}

export function buildCompanyLookup(companies: Company[]): Map<string, CompanyLookupRow> {
  const m = new Map<string, CompanyLookupRow>();
  for (const c of companies) {
    if (!c.company_id) continue;
    const entry = cohortEntryFor(c.company_name || '');
    const am = (c.profile_manager_email || entry?.am || '').toLowerCase();
    const amName = ACCOUNT_MANAGERS.find(a => a.email.toLowerCase() === am)?.name
      || (am ? displayName(am) : '');
    m.set(c.company_id, {
      companyId: c.company_id,
      name: entry?.canonical || c.company_name || c.company_id,
      amName,
      donor: entry?.donor || c.fund_code || '',
      budgetCap: entry?.budgetUsd || 0,
    });
  }
  return m;
}
