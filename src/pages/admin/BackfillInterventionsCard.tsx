// One-click backfill for cohort 3 sub-intervention coverage.
//
// Two classes of fix this tool applies (idempotent — re-running on a
// clean cohort is a no-op):
//
// 1. MKG / pillar-only assignments. Stage 3 sometimes wrote
//    intervention_type='MKG' AND sub_intervention='MKG' (or '') —
//    pillar code as the sub. The home dashboard surfaces these in a
//    "(unallocated)" bucket; this tool sets sub_intervention to the
//    canonical default ('Marketing Agency' for MKG-only, since it has
//    the larger budget allocation; team can override per-row in the
//    sheet if any are Marketing Resources).
//
// 2. Conference tracker → Companies Assignments sync. If a cohort
//    company has a Conference Tracker row with decision Committed or
//    Attended but no matching sub_intervention='Conferences' row in
//    Companies Assignments, the tool creates one. That's why the
//    home dashboard read 0 Conferences despite 4 Web Summit Qatar
//    companies in the tracker — the two workbooks weren't synced.
//
// Each apply also writes an activity-log entry so the audit trail
// captures what changed and who triggered it.

import { useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button, Card, CardHeader, useToast, Badge } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company, Assignment, ConferenceTrackerRow } from '../../data/types';
import { canonicalCohortName } from '../../config/cohort3Aliases';
import { keepCompaniesSection } from '../../lib/sheets/sections';
import { appendActivity } from '../companies/activityLog';
import { getSheetId, getTab } from '../../config/sheets';

const MKG_DEFAULT_SUB = 'Marketing Agency';
const CONF_TRACKER_COMMIT_DECISIONS = new Set(['committed', 'attended']);

// Set of values that mean "no actual sub" — we treat the row as
// pillar-only and need to fix the sub.
const MKG_EMPTY_SUB_VALUES = new Set(['', 'mkg', 'marketing']);

type MkgFix = {
  assignment_id: string;
  company_id: string;
  company_name: string;
  current_sub: string;
  next_sub: string;
};

type ConfAdd = {
  // Synthesised when we apply (mintAssignmentId at apply time).
  company_id: string;
  company_name: string;
  conference_name: string;
  decision: string;
};

type Plan = {
  mkgFixes: MkgFix[];
  confAdds: ConfAdd[];
  // Cohort companies that already have a Conferences assignment — for
  // the diagnostic so the user can see which are already sync'd.
  alreadyOnConferences: string[];
};

import { mintAssignmentId as canonicalMint } from '../../lib/ids/assignments';

function mintAssignmentId(companyId: string): string {
  // Conferences-specific helper; delegates to the canonical minter so
  // the id shape stays consistent across every writer.
  return canonicalMint({ companyId, intervention_type: 'MA', sub_intervention: 'Conferences' });
}

export function BackfillInterventionsCard() {
  const { user } = useAuth();
  const toast = useToast();

  const master       = useModuleData<Company>('companies', 'companies');
  const assignments  = useModuleData<Assignment>('companies', 'assignments');
  const confTracker  = useModuleData<ConferenceTrackerRow>('conferences', 'tracker');

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ mkg: number; confs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan: Plan = useMemo(() => {
    // Cohort 3 master rows indexed by company_id, also by canonical
    // name (so we can match conference tracker rows that carry only
    // company_name).
    const cohortById = new Map<string, Company>();
    const cohortByCanonical = new Map<string, Company>();
    for (const c of master.rows) {
      const canon = canonicalCohortName(c.company_name || '');
      if (!canon) continue;
      cohortById.set(c.company_id, c);
      cohortByCanonical.set(canon, c);
    }

    // 1) MKG-only assignments needing a sub backfill.
    const mkgFixes: MkgFix[] = [];
    for (const a of assignments.rows) {
      if (!cohortById.has(a.company_id)) continue;
      const it = (a.intervention_type || '').trim().toLowerCase();
      const sub = (a.sub_intervention || '').trim().toLowerCase();
      if (it !== 'mkg' && it !== 'marketing & branding' && it !== 'marketing') continue;
      if (!MKG_EMPTY_SUB_VALUES.has(sub)) continue; // already has a real sub
      const c = cohortById.get(a.company_id)!;
      mkgFixes.push({
        assignment_id: a.assignment_id,
        company_id: a.company_id,
        company_name: c.company_name || a.company_id,
        current_sub: a.sub_intervention || '',
        next_sub: MKG_DEFAULT_SUB,
      });
    }

    // 2) Conference tracker → Companies Assignments sync.
    // Map of company_id → set of subs already assigned.
    const subsByCompany = new Map<string, Set<string>>();
    for (const a of assignments.rows) {
      const id = a.company_id;
      if (!id) continue;
      const sub = (a.sub_intervention || '').trim();
      if (!sub) continue;
      if (!subsByCompany.has(id)) subsByCompany.set(id, new Set());
      subsByCompany.get(id)!.add(sub);
    }

    // Section-aware: tracker is team-grouped; only Companies-section
    // rows count.
    const trackerRows = keepCompaniesSection(confTracker.rows, confTracker.headers) as ConferenceTrackerRow[];

    // For each cohort company that has at least one committed/attended
    // tracker row but no Conferences assignment yet, propose creating one.
    const seenConfAddIds = new Set<string>();
    const confAdds: ConfAdd[] = [];
    for (const r of trackerRows) {
      const decision = (r.decision || '').trim().toLowerCase();
      if (!CONF_TRACKER_COMMIT_DECISIONS.has(decision)) continue;
      // Resolve the cohort company. Prefer company_id; fall back to
      // canonical name (some tracker rows carry only the name).
      let comp: Company | undefined;
      if (r.company_id && cohortById.has(r.company_id)) comp = cohortById.get(r.company_id);
      if (!comp && r.company_name) {
        const canon = canonicalCohortName(r.company_name);
        if (canon) comp = cohortByCanonical.get(canon);
      }
      if (!comp) continue;
      if (seenConfAddIds.has(comp.company_id)) continue;
      const existing = subsByCompany.get(comp.company_id);
      if (existing && existing.has('Conferences')) continue; // already sync'd
      seenConfAddIds.add(comp.company_id);
      confAdds.push({
        company_id: comp.company_id,
        company_name: comp.company_name,
        conference_name: r.conference_name || '',
        decision: r.decision || '',
      });
    }

    // Already-sync'd companies (for the diagnostic).
    const alreadyOnConferences: string[] = [];
    for (const [cid, subs] of subsByCompany) {
      if (subs.has('Conferences') && cohortById.has(cid)) {
        alreadyOnConferences.push(cohortById.get(cid)!.company_name);
      }
    }

    return { mkgFixes, confAdds, alreadyOnConferences };
  }, [master.rows, assignments.rows, confTracker.rows, confTracker.headers]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    let mkgCount = 0;
    let confCount = 0;
    try {
      const sheetId = getSheetId('companies');
      const activityTab = getTab('companies', 'activity');

      // 1) MKG fixes: updateRow each.
      for (const fix of plan.mkgFixes) {
        await assignments.updateRow(fix.assignment_id, { sub_intervention: fix.next_sub });
        if (sheetId) {
          await appendActivity({
            sheetId,
            tabName: activityTab,
            user_email: user?.email || '',
            company_id: fix.company_id,
            action: 'dashboard_repair',
            field: 'sub_intervention',
            old_value: fix.current_sub,
            new_value: fix.next_sub,
            details: `Backfilled MKG-only assignment ${fix.assignment_id} → ${fix.next_sub}`,
          });
        }
        mkgCount += 1;
      }

      // 2) Conferences sync: createRow each.
      for (const add of plan.confAdds) {
        const newRow: Partial<Assignment> = {
          assignment_id: mintAssignmentId(add.company_id),
          company_id: add.company_id,
          intervention_type: 'MA',
          sub_intervention: 'Conferences',
          fund_code: '',
          start_date: '',
          end_date: '',
          owner_email: '',
          status: add.decision.toLowerCase() === 'attended' ? 'Completed' : 'In Progress',
          budget_usd: '',
          notes: `Auto-created from Conference Tracker (${add.conference_name}, ${add.decision})`,
        };
        await assignments.createRow(newRow);
        if (sheetId) {
          await appendActivity({
            sheetId,
            tabName: activityTab,
            user_email: user?.email || '',
            company_id: add.company_id,
            action: 'dashboard_repair',
            field: 'assignment',
            old_value: '',
            new_value: 'Conferences',
            details: `Created Conferences assignment from Tracker (${add.conference_name})`,
          });
        }
        confCount += 1;
      }

      setDone({ mkg: mkgCount, confs: confCount });
      toast.success(`Backfilled ${mkgCount} MKG row${mkgCount === 1 ? '' : 's'} + created ${confCount} Conferences row${confCount === 1 ? '' : 's'}.`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setError(msg);
      toast.error(`Backfill failed after ${mkgCount} MKG + ${confCount} Conf rows: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    master.refresh();
    assignments.refresh();
    confTracker.refresh();
  };

  const total = plan.mkgFixes.length + plan.confAdds.length;
  const nothingToDo = total === 0;

  return (
    <Card accent="orange">
      <CardHeader
        title="Backfill cohort interventions"
        subtitle="Fix two known cohort 3 data gaps at the source so the home dashboard counts match the team's mental model."
        action={
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={refresh} title="Re-read sheets">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={apply} disabled={busy || nothingToDo}>
              <Sparkles className="h-4 w-4" /> {busy ? 'Applying…' : nothingToDo ? 'Nothing to do' : `Apply ${total} fix${total === 1 ? '' : 'es'}`}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="MKG rows to refine" value={plan.mkgFixes.length} hint={`Will set sub_intervention="${MKG_DEFAULT_SUB}"`} tone={plan.mkgFixes.length > 0 ? 'amber' : 'neutral'} />
        <Stat label="Conferences to create" value={plan.confAdds.length} hint="From Conference Tracker (Committed / Attended)" tone={plan.confAdds.length > 0 ? 'amber' : 'neutral'} />
        <Stat label="Already on Conferences" value={plan.alreadyOnConferences.length} hint="No-op for these" tone="neutral" />
      </div>

      {plan.mkgFixes.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">Marketing rows that will be set to "{MKG_DEFAULT_SUB}"</h4>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs dark:divide-navy-700 dark:border-navy-700">
            {plan.mkgFixes.map(f => (
              <li key={f.assignment_id} className="flex items-center justify-between px-3 py-1.5">
                <span className="font-semibold text-navy-500 dark:text-white">{f.company_name}</span>
                <span className="text-slate-500">
                  <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{f.current_sub || '∅'}</code>
                  <span className="mx-1">→</span>
                  <code className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{f.next_sub}</code>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-2xs text-slate-500">
            If any of these are actually <code>Marketing Resources</code> instead, edit the row in the Companies Assignments sheet after applying — the AM owns the call.
          </p>
        </div>
      )}

      {plan.confAdds.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-slate-500">Conferences assignments that will be created</h4>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs dark:divide-navy-700 dark:border-navy-700">
            {plan.confAdds.map(a => (
              <li key={a.company_id} className="flex items-center justify-between px-3 py-1.5">
                <span className="font-semibold text-navy-500 dark:text-white">{a.company_name}</span>
                <span className="text-slate-500">
                  {a.conference_name} · <Badge tone={a.decision.toLowerCase() === 'attended' ? 'green' : 'teal'}>{a.decision}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          Done: refined {done.mkg} Marketing row{done.mkg === 1 ? '' : 's'}, created {done.confs} Conferences row{done.confs === 1 ? '' : 's'}. Reload Home to see the updated counts.
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'amber' | 'neutral' }) {
  const fill = tone === 'amber'
    ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
    : 'bg-slate-50 text-slate-600 dark:bg-navy-700 dark:text-slate-300';
  return (
    <div className={`rounded-lg p-3 ${fill}`}>
      <div className="text-2xs font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold">{value}</div>
      <div className="mt-0.5 text-2xs opacity-75">{hint}</div>
    </div>
  );
}
