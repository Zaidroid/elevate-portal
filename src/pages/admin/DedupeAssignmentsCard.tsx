// Admin card: find + delete duplicate intervention-assignment rows.
//
// "Duplicate" = same company_id + same canonical intervention (e.g.
// one row with intervention_type='C-Suite', one with
// intervention_type='MA' + sub_intervention='C-Suite'). These cause
// Program-tab cards to show twice, aggregates to over-count, and
// budgets to inflate. The card scans live data, picks a keeper per
// duplicate group (most data wins), inherits any missing fields from
// orphans onto the keeper, repoints PRs/payments that reference an
// orphan assignment_id, then deletes the orphan rows.
//
// All writes go through the central data layer (optimistic update +
// activity log). The card runs entirely client-side; safe to re-run
// because once a group is deduped there's only one row left and the
// planner skips it.

import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Wand2 } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { useModuleData } from '../../data/useModuleData';
import { getSheetId, getTab } from '../../config/sheets';
import { useToast, Badge, Button, Card, CardHeader } from '../../lib/ui';
import { appendActivity } from '../companies/activityLog';
import { buildDedupePlan, type AssignmentRow, type PrRow, type PaymentRow } from '../../lib/maintenance/dedupeAssignments';

export function DedupeAssignmentsCard() {
  const { user } = useAuth();
  const toast = useToast();

  const assignments = useModuleData<AssignmentRow>('companies', 'assignments');
  const masterHook  = useModuleData<Record<string, string>>('companies', 'companies');
  // PRs live in procurement (4 quarter tabs). Read all four so we can
  // repoint any that point at an orphan assignment_id.
  const q1 = useModuleData<PrRow>('procurement', 'q1');
  const q2 = useModuleData<PrRow>('procurement', 'q2');
  const q3 = useModuleData<PrRow>('procurement', 'q3');
  const q4 = useModuleData<PrRow>('procurement', 'q4');
  const payments = useModuleData<PaymentRow>('payments', 'payments');

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{
    mergedGroups: number;
    inheritedFields: number;
    repointedPrs: number;
    repointedPayments: number;
    deletedOrphans: number;
    failures: string[];
  } | null>(null);

  const allPrs = useMemo<PrRow[]>(
    () => [...q1.rows, ...q2.rows, ...q3.rows, ...q4.rows],
    [q1.rows, q2.rows, q3.rows, q4.rows],
  );

  // Look up which quarter a given PR row lives in so writes hit the
  // correct tab (PR ids are unique across quarters, but procurement is
  // partitioned per quarter).
  const prQuarterByPrId = useMemo(() => {
    const m = new Map<string, 'q1' | 'q2' | 'q3' | 'q4'>();
    for (const r of q1.rows) if (r.pr_id) m.set(r.pr_id, 'q1');
    for (const r of q2.rows) if (r.pr_id) m.set(r.pr_id, 'q2');
    for (const r of q3.rows) if (r.pr_id) m.set(r.pr_id, 'q3');
    for (const r of q4.rows) if (r.pr_id) m.set(r.pr_id, 'q4');
    return m;
  }, [q1.rows, q2.rows, q3.rows, q4.rows]);

  const prHookForQuarter = (q: 'q1' | 'q2' | 'q3' | 'q4') => {
    if (q === 'q1') return q1;
    if (q === 'q2') return q2;
    if (q === 'q3') return q3;
    return q4;
  };

  const plan = useMemo(
    () => buildDedupePlan(assignments.rows as AssignmentRow[], allPrs, payments.rows as PaymentRow[]),
    [assignments.rows, allPrs, payments.rows],
  );

  const companyName = (cid: string): string => {
    const c = masterHook.rows.find(m => m.company_id === cid);
    return c?.company_name || cid;
  };

  const handleRun = async () => {
    if (plan.groups.length === 0) return;
    if (!window.confirm(
      `Dedupe ${plan.groups.length} assignment group(s) — repoint ${plan.totalRepoints} PR/payment row(s), inherit ${plan.totalInherits} field(s), then delete ${plan.totalOrphans} orphan row(s). This is permanent.`,
    )) return;

    setBusy(true);
    setResults(null);
    const failures: string[] = [];
    let mergedGroups = 0;
    let inheritedFields = 0;
    let repointedPrs = 0;
    let repointedPayments = 0;
    let deletedOrphans = 0;

    const sheetId = getSheetId('companies');
    const activityTab = getTab('companies', 'activity');

    for (const g of plan.groups) {
      try {
        // 1. Inherit missing fields onto the keeper FIRST so we don't
        //    lose data when the orphan rows are deleted.
        if (Object.keys(g.inheritUpdates).length > 0 && g.keeper.assignment_id) {
          await assignments.updateRow(g.keeper.assignment_id, g.inheritUpdates);
          inheritedFields += Object.keys(g.inheritUpdates).length;
        }
        // 2. Repoint every PR that referenced an orphan to the keeper.
        //    Track failures so we don't delete the orphan if any
        //    dependent row is still pointing at it — otherwise the PR
        //    becomes orphaned (referencing a deleted assignment_id).
        let groupRepointFailed = false;
        for (const p of g.repointPrs) {
          if (!p.pr_id || !g.keeper.assignment_id) continue;
          const q = prQuarterByPrId.get(p.pr_id);
          if (!q) continue;
          try {
            await prHookForQuarter(q).updateRow(p.pr_id, { assignment_id: g.keeper.assignment_id });
            repointedPrs += 1;
          } catch (err) {
            failures.push(`Repoint PR ${p.pr_id}: ${(err as Error).message}`);
            groupRepointFailed = true;
          }
        }
        // 3. Repoint every payment that referenced an orphan.
        for (const p of g.repointPayments) {
          if (!p.payment_id || !g.keeper.assignment_id) continue;
          try {
            await payments.updateRow(p.payment_id, { assignment_id: g.keeper.assignment_id });
            repointedPayments += 1;
          } catch (err) {
            failures.push(`Repoint Payment ${p.payment_id}: ${(err as Error).message}`);
            groupRepointFailed = true;
          }
        }
        // 4. Delete the orphan rows ONLY if every dependent repoint
        //    succeeded. Otherwise we'd leave a dangling
        //    assignment_id in the procurement/payments tabs that no
        //    longer points at any assignment row.
        if (groupRepointFailed) {
          failures.push(`Group ${g.companyId}/${g.canonicalKey}: orphan rows kept (repoint failed; keeper now has inherited data but original duplicates remain in the sheet)`);
          continue;
        }
        for (const o of g.orphans) {
          if (!o.assignment_id) continue;
          try {
            await assignments.deleteRow(o.assignment_id);
            deletedOrphans += 1;
          } catch (err) {
            failures.push(`Delete orphan ${o.assignment_id}: ${(err as Error).message}`);
          }
        }
        // 5. Activity log entry — one per group.
        if (sheetId) {
          await appendActivity({
            sheetId,
            tabName: activityTab,
            user_email: user?.email,
            company_id: g.companyId,
            action: 'auto_dedupe',
            field: 'assignments',
            old_value: g.orphans.map(o => o.assignment_id).join(', '),
            new_value: g.keeper.assignment_id || '',
            details: `Merged ${g.orphans.length} duplicate row(s) of ${g.canonicalKey} into keeper. Inherited ${Object.keys(g.inheritUpdates).length} field(s); repointed ${g.repointPrs.length} PR + ${g.repointPayments.length} payment row(s).`,
          });
        }
        mergedGroups += 1;
      } catch (err) {
        failures.push(`Group ${g.companyId}/${g.canonicalKey}: ${(err as Error).message}`);
      }
    }

    setResults({ mergedGroups, inheritedFields, repointedPrs, repointedPayments, deletedOrphans, failures });
    setBusy(false);

    if (failures.length === 0 && mergedGroups > 0) {
      toast.success(`Deduped ${mergedGroups} group(s)`, `Deleted ${deletedOrphans} orphan row(s).`);
    } else if (mergedGroups > 0) {
      toast.error(`Deduped ${mergedGroups} of ${plan.groups.length} group(s)`, `${failures.length} failure(s) - see card.`);
    } else if (failures.length > 0) {
      toast.error('Dedupe failed', failures[0]);
    }
  };

  if (plan.groups.length === 0) {
    return (
      <Card>
        <CardHeader title="Duplicate assignments" subtitle="No duplicate intervention rows detected." />
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Every (company, canonical intervention) pair has at most one row.
        </p>
      </Card>
    );
  }

  return (
    <Card accent="orange">
      <CardHeader
        title="Duplicate assignments"
        subtitle="Two or more rows for the same canonical intervention on the same company. Merge inherits any missing fields onto the keeper, repoints PRs/payments, then deletes the orphans."
        action={
          <div className="flex items-center gap-2">
            <Badge tone="amber">{plan.groups.length} groups</Badge>
            <Badge tone="red">{plan.totalOrphans} orphan rows</Badge>
            <Button variant="primary" onClick={handleRun} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}
              {busy ? 'Merging…' : `Merge ${plan.groups.length} group(s)`}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-3">
        <Stat label="Duplicate groups" value={plan.groups.length} />
        <Stat label="Orphan rows" value={plan.totalOrphans} tone="red" />
        <Stat label="PR / Payment repoints" value={plan.totalRepoints} />
        <Stat label="Fields inherited" value={plan.totalInherits} />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-navy-700">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-navy-700 dark:text-slate-300">
            <tr>
              <th className="px-3 py-1.5">Company</th>
              <th className="px-3 py-1.5">Canonical</th>
              <th className="px-3 py-1.5">Keep</th>
              <th className="px-3 py-1.5">Delete</th>
              <th className="px-3 py-1.5">Inherits</th>
              <th className="px-3 py-1.5">Repoints</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
            {plan.groups.map(g => (
              <tr key={`${g.companyId}::${g.canonicalKey}`}>
                <td className="px-3 py-1.5 font-semibold text-navy-500 dark:text-white">{companyName(g.companyId)}</td>
                <td className="px-3 py-1.5 font-mono">{g.canonicalKey}</td>
                <td className="px-3 py-1.5 font-mono text-emerald-700 dark:text-emerald-300">
                  {g.keeper.assignment_id || '—'}
                  {g.keeper.budget_usd && <span className="ml-1 text-[10px] text-slate-500">${parseFloat(g.keeper.budget_usd).toLocaleString()}</span>}
                </td>
                <td className="px-3 py-1.5 font-mono text-red-700 dark:text-red-300">
                  {g.orphans.map(o => o.assignment_id).join(', ')}
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  {Object.keys(g.inheritUpdates).length === 0 ? '—' : Object.keys(g.inheritUpdates).join(', ')}
                </td>
                <td className="px-3 py-1.5 text-slate-500">
                  {g.repointPrs.length > 0 && `${g.repointPrs.length} PR`}
                  {g.repointPrs.length > 0 && g.repointPayments.length > 0 && ' · '}
                  {g.repointPayments.length > 0 && `${g.repointPayments.length} Pay`}
                  {g.repointPrs.length === 0 && g.repointPayments.length === 0 && '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-navy-700">
          <div className="font-semibold text-navy-500 dark:text-white">
            Merged {results.mergedGroups} group(s) · deleted {results.deletedOrphans} orphan row(s) · repointed {results.repointedPrs + results.repointedPayments} dependent row(s) · inherited {results.inheritedFields} field(s).
          </div>
          {results.failures.length > 0 && (
            <div className="mt-2">
              <div className="font-semibold text-red-700 dark:text-red-300">{results.failures.length} failure(s):</div>
              <ul className="list-disc pl-5 text-red-600 dark:text-red-300">
                {results.failures.slice(0, 5).map((f, i) => <li key={i}>{f}</li>)}
                {results.failures.length > 5 && <li>… {results.failures.length - 5} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
      <div className="text-2xs font-bold uppercase tracking-[0.1em] text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone === 'red' ? 'text-brand-red' : 'text-navy-500 dark:text-white'}`}>
        {value}
      </div>
    </div>
  );
}

