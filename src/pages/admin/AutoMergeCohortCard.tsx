// One-click auto-merge for the Cohort 3 41 companies.
//
// Uses the explicit COHORT3_ALIASES map (src/config/cohort3Aliases.ts)
// — no fuzzy guessing, no per-cluster confirmation, no UI to click
// through. The button:
//
//   1. Walks every Companies-master row and resolves it to a canonical
//      cohort name via canonicalCohortName(). Rows that don't resolve
//      (i.e. companies that aren't in Cohort 3) are left alone.
//   2. Groups master rows by canonical. For any group with >1 row,
//      picks ONE canonical row by the same heuristic the dedupe tool
//      uses (assignments + signal + recency).
//   3. Repoints every assignment / comment / activity row from the
//      duplicates to the canonical company_id. Deletes the duplicate
//      master rows. Updates the canonical's company_name to the
//      official COHORT3_ALIASES name (so the master matches the
//      cohort taxonomy).
//   4. Logs an `auto_dedupe` activity row per merge.
//
// Idempotent: re-running on a clean master is a no-op. Designed so the
// admin clicks once after the seed and the master is in sync with the
// 41-company allocation.

import { useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, useToast } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company, Assignment } from '../../data/types';
import type { CompanyComment, ActivityRow } from '../companies/reviewTypes';
import { canonicalCohortName, COHORT3_ALIASES } from '../../config/cohort3Aliases';
import { displayName } from '../../config/team';
import { appendActivity } from '../companies/activityLog';
import { getSheetId, getTab } from '../../config/sheets';

type Plan = {
  /** Canonical cohort name → master rows that resolve to it. */
  groups: Map<string, Company[]>;
  /** Total dup rows that would be removed across all groups. */
  totalDups: number;
  /** Cohort canonicals that have NO master row at all. */
  missing: string[];
};

function pickCanonical(rows: Company[], asgCount: Map<string, number>): Company {
  const scored = rows.map(r => {
    const a = asgCount.get(r.company_id) ?? 0;
    let s = a * 100;
    if (r.profile_manager_email) s += 10;
    if (r.fund_code) s += 5;
    if (r.drive_folder_url) s += 3;
    if (r.updated_at) s += 1;
    return { row: r, s, ts: r.updated_at || '' };
  });
  scored.sort((x, y) => y.s - x.s || (y.ts > x.ts ? 1 : y.ts < x.ts ? -1 : 0));
  return scored[0].row;
}

export function AutoMergeCohortCard() {
  const { user } = useAuth();
  const toast = useToast();

  const master      = useModuleData<Company>('companies', 'companies');
  const assignments = useModuleData<Assignment>('companies', 'assignments');
  const comments    = useModuleData<CompanyComment>('companies', 'comments');
  const activity    = useModuleData<ActivityRow>('companies', 'activity');

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{
    mergedGroups: number;
    deletedRows: number;
    failures: string[];
  } | null>(null);

  // Build the plan from the current master state.
  const plan = useMemo<Plan>(() => {
    const groups = new Map<string, Company[]>();
    for (const c of master.rows) {
      const canon = canonicalCohortName(c.company_name || '');
      if (!canon) continue;
      const arr = groups.get(canon) ?? [];
      arr.push(c);
      groups.set(canon, arr);
    }
    let totalDups = 0;
    for (const arr of groups.values()) {
      if (arr.length > 1) totalDups += arr.length - 1;
    }
    const missing = COHORT3_ALIASES.map(a => a.canonical).filter(c => !groups.has(c));
    return { groups, totalDups, missing };
  }, [master.rows]);

  const matchedRows = useMemo(() => {
    let n = 0;
    for (const arr of plan.groups.values()) n += arr.length;
    return n;
  }, [plan]);

  const handleRun = async () => {
    setBusy(true);
    setResults(null);
    let mergedGroups = 0;
    let deletedRows = 0;
    const failures: string[] = [];

    // Pre-compute counts to drive canonical picking.
    const asgCount = new Map<string, number>();
    for (const a of assignments.rows) {
      if (a.company_id) asgCount.set(a.company_id, (asgCount.get(a.company_id) ?? 0) + 1);
    }

    const sheetId = getSheetId('companies');

    for (const [canon, rows] of plan.groups.entries()) {
      // Always normalize the canonical row's name to the official
      // canonical (even when there's only 1 row — keeps the master
      // matching the alias map). The "merge" happens when rows.length > 1.
      const canonical = pickCanonical(rows, asgCount);
      const dups = rows.filter(r => r.company_id !== canonical.company_id);

      try {
        // Rename canonical row to the official name if it differs.
        if ((canonical.company_name || '') !== canon) {
          await master.updateRow(canonical.company_id, { company_name: canon });
        }

        // Repoint assignments.
        for (const a of assignments.rows) {
          if (!dups.some(d => d.company_id === a.company_id)) continue;
          if (!a.assignment_id) continue;
          await assignments.updateRow(a.assignment_id, { company_id: canonical.company_id });
        }
        // Repoint comments.
        for (const c of comments.rows) {
          if (!dups.some(d => d.company_id === c.company_id)) continue;
          if (!c.comment_id) continue;
          await comments.updateRow(c.comment_id, { company_id: canonical.company_id });
        }
        // Repoint activity (best-effort).
        for (const r of activity.rows) {
          if (!dups.some(d => d.company_id === (r.company_id || ''))) continue;
          if (!r.activity_id) continue;
          try {
            await activity.updateRow(r.activity_id, { company_id: canonical.company_id });
          } catch { /* swallow */ }
        }
        // Delete duplicate master rows.
        for (const d of dups) {
          try {
            await master.deleteRow(d.company_id);
            deletedRows += 1;
          } catch (err) {
            failures.push(`Delete ${d.company_id}: ${(err as Error).message}`);
          }
        }
        if (dups.length > 0) {
          mergedGroups += 1;
          if (sheetId) {
            await appendActivity({
              sheetId,
              tabName: getTab('companies', 'activity'),
              user_email: user?.email,
              company_id: canonical.company_id,
              action: 'auto_dedupe',
              field: 'cohort_canonical_merge',
              new_value: canon,
              details: `merged ${dups.length} duplicate${dups.length === 1 ? '' : 's'} (${dups.map(d => d.company_id).join(', ')}) into ${canonical.company_id}`,
            });
          }
        }
      } catch (err) {
        failures.push(`${canon}: ${(err as Error).message}`);
      }
    }

    setResults({ mergedGroups, deletedRows, failures });
    setBusy(false);
    if (failures.length === 0) {
      toast.success(`Merged ${mergedGroups} cohort group${mergedGroups === 1 ? '' : 's'} (${deletedRows} duplicate row${deletedRows === 1 ? '' : 's'} removed)`);
    } else {
      toast.error(`Auto-merge finished with ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
    }
  };

  const groupsWithDups = Array.from(plan.groups.entries()).filter(([, rows]) => rows.length > 1);

  return (
    <Card accent="red">
      <CardHeader
        title="Auto-merge Cohort 3 duplicates"
        subtitle="Uses the explicit 41-company alias map. One click; no per-cluster confirmation."
        action={
          <Button onClick={handleRun} disabled={busy || (plan.totalDups === 0 && plan.groups.size === matchedRows)}>
            <Sparkles className="h-4 w-4" /> {busy ? 'Merging…' : 'Auto-merge now'}
          </Button>
        }
      />

      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">{master.rows.length} master rows</Badge>
          <Badge tone="teal">{matchedRows} resolve to a Cohort 3 canonical</Badge>
          {plan.totalDups > 0
            ? <Badge tone="red">{plan.totalDups} duplicate{plan.totalDups === 1 ? '' : 's'} to merge</Badge>
            : <Badge tone="green">No duplicates</Badge>}
          {plan.missing.length > 0 && (
            <Badge tone="amber">{plan.missing.length} canonical{plan.missing.length === 1 ? '' : 's'} not yet in master</Badge>
          )}
        </div>

        {groupsWithDups.length > 0 && (
          <details className="rounded-lg border border-slate-200 p-2 text-xs dark:border-navy-700">
            <summary className="cursor-pointer font-semibold">
              Preview: {groupsWithDups.length} cohort group{groupsWithDups.length === 1 ? '' : 's'} with duplicates
            </summary>
            <ul className="mt-2 space-y-1.5">
              {groupsWithDups.map(([canon, rows]) => (
                <li key={canon}>
                  <div className="font-semibold text-navy-500 dark:text-white">{canon}</div>
                  <ul className="ml-3 mt-0.5 space-y-0.5 text-slate-500">
                    {rows.map(r => (
                      <li key={r.company_id}>
                        <span className="font-mono">{r.company_id}</span> · {r.company_name}
                        {r.profile_manager_email && <> · {displayName(r.profile_manager_email)}</>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        )}

        {plan.missing.length > 0 && (
          <details className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
            <summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">
              {plan.missing.length} cohort canonical{plan.missing.length === 1 ? '' : 's'} not yet in master
            </summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800 dark:text-amber-200">
              {plan.missing.map(m => <li key={m}>{m}</li>)}
            </ul>
            <p className="mt-2 text-amber-700 dark:text-amber-300">
              Run the cohort allocation seed in /import to materialize these.
            </p>
          </details>
        )}

        {results && (
          <div className={`rounded-lg border p-2 text-xs ${results.failures.length === 0 ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950' : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950'}`}>
            {results.failures.length === 0 ? (
              <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> Merged {results.mergedGroups} group{results.mergedGroups === 1 ? '' : 's'} · {results.deletedRows} duplicate row{results.deletedRows === 1 ? '' : 's'} removed.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 font-semibold text-red-800 dark:text-red-200">
                  <AlertTriangle className="h-3.5 w-3.5" /> {results.failures.length} failure{results.failures.length === 1 ? '' : 's'}
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-700 dark:text-red-300">
                  {results.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
