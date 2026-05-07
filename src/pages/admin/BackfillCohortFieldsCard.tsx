// One-click backfill for cohort 3 master rows.
//
// During earlier auto-merge / dedupe rounds, some master rows lost their
// city / sector / AM / donor / drive_folder_url because the canonical
// row picked by the merge heuristic had blanks where the duplicate had
// values. The data is preserved in COHORT3_ALIASES (extracted from the
// xlsx allocation), so we can reliably restore it.
//
// This tool also normalises status: any cohort 3 company whose status
// is empty / 'Applicant' / 'Shortlisted' / 'Interviewed' / 'Reviewing'
// / 'Recommended' / 'Selected' is set to 'Active'. The team's mental
// model is that the 41 cohort companies are all active in parallel —
// not split between Interviewed (29) and Active (32). Backfilling
// makes the sheet match that mental model so dashboards stop showing
// the artificial split.
//
// Idempotent: re-running on a clean cohort is a no-op. Only fills
// blank fields and only normalises pre-Active statuses; never
// overwrites a value the team has set explicitly.

import { useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Card, CardHeader, useToast, Badge } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company } from '../../data/types';
import { COHORT3_ALIASES, canonicalCohortName } from '../../config/cohort3Aliases';
import { appendActivity } from '../companies/activityLog';
import { getSheetId, getTab } from '../../config/sheets';

const ACTIVE_STATUS = 'Active';
const PRE_ACTIVE_STATUSES = new Set([
  '', 'Applicant', 'Shortlisted', 'Interviewed', 'Reviewing', 'Recommended', 'Selected',
]);

type Plan = {
  /** Per-cohort-row updates we'll apply. */
  updates: Array<{
    company_id: string;
    company_name: string;
    canonical: string;
    changes: Partial<Company>;
  }>;
  /** Cohort canonicals not in master (so the team can re-seed). */
  missing: string[];
};

export function BackfillCohortFieldsCard() {
  const { user } = useAuth();
  const toast = useToast();

  const master = useModuleData<Company>('companies', 'companies');

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: string[] } | null>(null);

  // Compute the plan: walk each canonical, find the master row, diff
  // against the canonical metadata, build a partial-update payload.
  const plan = useMemo<Plan>(() => {
    const updates: Plan['updates'] = [];
    const missing: string[] = [];
    const masterByCanonical = new Map<string, Company>();
    for (const c of master.rows) {
      const canon = canonicalCohortName(c.company_name || '');
      if (!canon) continue;
      // First-write-wins; AutoMergeCohortCard collapses dupes so this
      // map has at most one row per canonical after merge.
      if (!masterByCanonical.has(canon)) masterByCanonical.set(canon, c);
    }
    for (const entry of COHORT3_ALIASES) {
      const row = masterByCanonical.get(entry.canonical);
      if (!row) {
        missing.push(entry.canonical);
        continue;
      }
      const changes: Partial<Company> = {};
      // Only fill blanks; never overwrite team edits.
      if (!row.city && entry.city) changes.city = entry.city;
      if (!row.profile_manager_email && entry.am) changes.profile_manager_email = entry.am;
      if (!row.fund_code && entry.donor) changes.fund_code = entry.donor;
      if (!row.drive_folder_url && entry.regDocUrl) changes.drive_folder_url = entry.regDocUrl;
      if (!row.cohort) changes.cohort = '3';
      // Status: normalise pre-Active labels to Active. The 41 cohort
      // companies are all in delivery in parallel.
      const status = (row.status || '').trim();
      if (PRE_ACTIVE_STATUSES.has(status)) changes.status = ACTIVE_STATUS;
      // Also normalise the company_name to the canonical form when
      // they differ (catches old short-names like "AI Pilot" left by
      // the seed before auto-merge ran).
      if ((row.company_name || '').trim() !== entry.canonical) {
        changes.company_name = entry.canonical;
      }
      if (Object.keys(changes).length > 0) {
        updates.push({
          company_id: row.company_id,
          company_name: row.company_name,
          canonical: entry.canonical,
          changes,
        });
      }
    }
    return { updates, missing };
  }, [master.rows]);

  const run = async () => {
    setBusy(true);
    setResults(null);
    let ok = 0;
    const failed: string[] = [];
    const sheetId = getSheetId('companies');
    for (const u of plan.updates) {
      try {
        await master.updateRow(u.company_id, u.changes);
        ok += 1;
      } catch (err) {
        failed.push(`${u.canonical}: ${(err as Error).message}`);
      }
    }
    if (sheetId) {
      try {
        await appendActivity({
          sheetId,
          tabName: getTab('companies', 'activity'),
          user_email: user?.email,
          action: 'auto_dedupe',
          field: 'backfill_cohort_fields',
          new_value: String(ok),
          details: `restored city/AM/donor/regdoc + normalised status for ${ok} cohort 3 rows`,
        });
      } catch { /* non-fatal */ }
    }
    setBusy(false);
    setResults({ ok, failed });
    if (failed.length === 0) toast.success(`Backfilled ${ok} cohort 3 rows`);
    else toast.error(`Backfill finished with ${failed.length} failure${failed.length === 1 ? '' : 's'}`);
  };

  // Quick preview of what's missing on each row.
  const preview = useMemo(() => {
    const lines: { row: string; what: string[] }[] = [];
    for (const u of plan.updates.slice(0, 50)) {
      const what: string[] = [];
      if (u.changes.city) what.push('city');
      if (u.changes.profile_manager_email) what.push('AM');
      if (u.changes.fund_code) what.push('donor');
      if (u.changes.drive_folder_url) what.push('regdoc');
      if (u.changes.cohort) what.push('cohort');
      if (u.changes.status) what.push('status→Active');
      if (u.changes.company_name) what.push('rename');
      lines.push({ row: `${u.company_name || u.canonical}`, what });
    }
    return lines;
  }, [plan.updates]);

  return (
    <Card accent="orange">
      <CardHeader
        title="Backfill cohort 3 fields"
        subtitle="Restores city / AM / donor / reg-document / cohort + normalises status to Active for the 41 cohort 3 master rows. Idempotent — uses COHORT3_ALIASES as the source of truth. Never overwrites team-edited values."
        action={
          <Button onClick={run} disabled={busy || plan.updates.length === 0}>
            <Sparkles className="h-4 w-4" /> {busy ? 'Backfilling…' : `Backfill ${plan.updates.length} row${plan.updates.length === 1 ? '' : 's'}`}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone="teal">{plan.updates.length} rows to update</Badge>
        {plan.missing.length > 0 && <Badge tone="amber">{plan.missing.length} canonical{plan.missing.length === 1 ? '' : 's'} not in master</Badge>}
        {plan.updates.length === 0 && plan.missing.length === 0 && <Badge tone="green">Cohort is already in sync</Badge>}
      </div>

      {plan.updates.length > 0 && (
        <details className="mt-3 rounded-lg border border-slate-200 p-2 text-xs dark:border-navy-700">
          <summary className="cursor-pointer font-semibold">Preview · what gets backfilled</summary>
          <ul className="mt-2 space-y-1">
            {preview.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span className="font-semibold text-navy-500 dark:text-white">{p.row}</span>
                <span className="text-slate-500">{p.what.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.missing.length > 0 && (
        <details className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
          <summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">
            {plan.missing.length} canonical{plan.missing.length === 1 ? '' : 's'} not yet in master
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800 dark:text-amber-200">
            {plan.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
          <p className="mt-2 text-amber-700 dark:text-amber-300">
            Run <code>Cohort 3 allocation seed</code> in <code>/import</code> to materialise these.
          </p>
        </details>
      )}

      {results && results.ok > 0 && results.failed.length === 0 && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Backfilled {results.ok} cohort 3 rows.
        </div>
      )}
      {results && results.failed.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> {results.failed.length} failure{results.failed.length === 1 ? '' : 's'}
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {results.failed.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}
