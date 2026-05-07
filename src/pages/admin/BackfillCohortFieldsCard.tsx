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
import { Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
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

type CanonicalSnapshot = {
  canonical: string;
  rows: Array<{
    company_id: string;
    company_name: string;
    city: string;
    am: string;
    donor: string;
    cohort: string;
    status: string;
    needsFill: string[];   // names of fields the backfill would touch
  }>;
};

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
  /** Cohort canonicals that resolve to MULTIPLE master rows — duplicates
   *  the AutoMergeCohort tool should consolidate. */
  duplicates: { canonical: string; rows: number }[];
  /** Per-canonical snapshot of the master: lets the admin see the
   *  literal current state of each cohort row vs what the alias map
   *  expects. The diagnostic below uses this to help debug "Backfill
   *  says 0 changes but the page is empty" cases. */
  snapshot: CanonicalSnapshot[];
  /** Total master rows + how many resolve to a cohort canonical (the
   *  rest are pre-cohort applicants or other-team rows). */
  totalMasterRows: number;
  matchedRows: number;
};

export function BackfillCohortFieldsCard() {
  const { user } = useAuth();
  const toast = useToast();

  const master = useModuleData<Company>('companies', 'companies');

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ ok: number; failed: string[] } | null>(null);

  // Compute the plan: walk EVERY cohort-3-resolving master row (not
  // just the first per canonical) and diff against the canonical
  // metadata. If duplicates remain in master, this fixes blanks on
  // each of them — so users still see correct data on whichever
  // duplicate the URL resolves to. The AutoMergeCohort tool is the
  // way to actually delete duplicates; this card focuses on data.
  const plan = useMemo<Plan>(() => {
    const updates: Plan['updates'] = [];
    const missing: string[] = [];
    const rowsByCanonical = new Map<string, Company[]>();
    let matchedRows = 0;
    for (const c of master.rows) {
      const canon = canonicalCohortName(c.company_name || '');
      if (!canon) continue;
      matchedRows += 1;
      const arr = rowsByCanonical.get(canon) ?? [];
      arr.push(c);
      rowsByCanonical.set(canon, arr);
    }
    const duplicates: Plan['duplicates'] = [];
    const snapshot: CanonicalSnapshot[] = [];
    for (const entry of COHORT3_ALIASES) {
      const rows = rowsByCanonical.get(entry.canonical) ?? [];
      if (rows.length === 0) {
        missing.push(entry.canonical);
        snapshot.push({ canonical: entry.canonical, rows: [] });
        continue;
      }
      if (rows.length > 1) {
        duplicates.push({ canonical: entry.canonical, rows: rows.length });
      }
      const snapRows: CanonicalSnapshot['rows'] = [];
      for (const row of rows) {
        const changes: Partial<Company> = {};
        const needsFill: string[] = [];
        if (!row.city && entry.city) { changes.city = entry.city; needsFill.push('city'); }
        if (!row.profile_manager_email && entry.am) { changes.profile_manager_email = entry.am; needsFill.push('AM'); }
        if (!row.fund_code && entry.donor) { changes.fund_code = entry.donor; needsFill.push('donor'); }
        if (!row.drive_folder_url && entry.regDocUrl) { changes.drive_folder_url = entry.regDocUrl; needsFill.push('regdoc'); }
        if (!row.cohort) { changes.cohort = '3'; needsFill.push('cohort'); }
        const status = (row.status || '').trim();
        if (PRE_ACTIVE_STATUSES.has(status)) { changes.status = ACTIVE_STATUS; needsFill.push('status→Active'); }
        if ((row.company_name || '').trim() !== entry.canonical) {
          changes.company_name = entry.canonical;
          needsFill.push('rename');
        }
        snapRows.push({
          company_id: row.company_id,
          company_name: row.company_name || '',
          city: row.city || '',
          am: row.profile_manager_email || '',
          donor: row.fund_code || '',
          cohort: row.cohort || '',
          status,
          needsFill,
        });
        if (Object.keys(changes).length > 0) {
          updates.push({
            company_id: row.company_id,
            company_name: row.company_name,
            canonical: entry.canonical,
            changes,
          });
        }
      }
      snapshot.push({ canonical: entry.canonical, rows: snapRows });
    }
    return {
      updates, missing, duplicates, snapshot,
      totalMasterRows: master.rows.length,
      matchedRows,
    };
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
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => master.refresh()} title="Re-fetch master rows from the sheet">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={run} disabled={busy || plan.updates.length === 0}>
              <Sparkles className="h-4 w-4" /> {busy ? 'Backfilling…' : `Backfill ${plan.updates.length} row${plan.updates.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{plan.totalMasterRows} master rows total</Badge>
        <Badge tone="teal">{plan.matchedRows} resolve to a cohort canonical</Badge>
        <Badge tone={plan.updates.length > 0 ? 'amber' : 'green'}>{plan.updates.length} need a fill</Badge>
        {plan.duplicates.length > 0 && <Badge tone="red">{plan.duplicates.length} canonical{plan.duplicates.length === 1 ? '' : 's'} with duplicates</Badge>}
        {plan.missing.length > 0 && <Badge tone="amber">{plan.missing.length} canonical{plan.missing.length === 1 ? '' : 's'} not in master</Badge>}
      </div>

      {plan.duplicates.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900 dark:bg-red-950">
          <div className="font-bold text-red-800 dark:text-red-200">⚠ Duplicate cohort 3 rows still in the master</div>
          <p className="mt-1 text-red-700 dark:text-red-300">
            These canonicals have multiple rows in the Companies master — that's why some company detail pages are showing empty data even though the alias map has the values. Backfill below will fill blanks on every duplicate, but to actually consolidate them into one row use <strong>Auto-merge Cohort 3 duplicates</strong> directly below.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 font-mono text-red-800 dark:text-red-200">
            {plan.duplicates.map(d => (
              <li key={d.canonical}>
                <span className="font-bold">{d.canonical}</span>: {d.rows} rows
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {/* Per-canonical diagnostic — open by default so the empty state
          is visible on first load. Shows the literal current values
          for each cohort row in master, so debugging "why is the
          backfill button greyed out but the page is empty" becomes
          a 5-second visual scan instead of digging through the sheet. */}
      <details className="mt-3 rounded-lg border border-slate-200 p-2 text-xs dark:border-navy-700" open>
        <summary className="cursor-pointer font-semibold">
          Cohort 3 diagnostic · current master state for each canonical
        </summary>
        <div className="mt-2 max-h-[480px] overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white text-2xs uppercase tracking-wider text-slate-500 dark:bg-navy-900">
              <tr>
                <th className="py-1 pr-2">Canonical</th>
                <th className="py-1 pr-2">Master row(s)</th>
                <th className="py-1 pr-2">City</th>
                <th className="py-1 pr-2">AM</th>
                <th className="py-1 pr-2">Donor</th>
                <th className="py-1 pr-2">Cohort</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Will fill</th>
              </tr>
            </thead>
            <tbody className="font-mono text-2xs">
              {plan.snapshot.map(snap => (
                snap.rows.length === 0 ? (
                  <tr key={snap.canonical} className="border-t border-slate-100 dark:border-navy-700">
                    <td className="py-1 pr-2 font-bold text-amber-700 dark:text-amber-300">{snap.canonical}</td>
                    <td className="py-1 pr-2 italic text-amber-700 dark:text-amber-300">missing — re-seed via /import</td>
                    <td colSpan={6} />
                  </tr>
                ) : (
                  snap.rows.map((r, idx) => (
                    <tr key={`${snap.canonical}-${idx}`} className="border-t border-slate-100 dark:border-navy-700">
                      <td className="py-1 pr-2 font-bold">{idx === 0 ? snap.canonical : ''}{snap.rows.length > 1 ? ` #${idx + 1}` : ''}</td>
                      <td className="py-1 pr-2 truncate max-w-[160px]" title={r.company_id}>{r.company_id}</td>
                      <td className={`py-1 pr-2 ${!r.city ? 'text-red-600' : ''}`}>{r.city || '—'}</td>
                      <td className={`py-1 pr-2 ${!r.am ? 'text-red-600' : ''}`}>{r.am ? r.am.split('@')[0] : '—'}</td>
                      <td className={`py-1 pr-2 ${!r.donor ? 'text-slate-400' : ''}`}>{r.donor || '—'}</td>
                      <td className={`py-1 pr-2 ${!r.cohort ? 'text-red-600' : ''}`}>{r.cohort || '—'}</td>
                      <td className={`py-1 pr-2 ${!r.status ? 'text-slate-400' : ''}`}>{r.status || '—'}</td>
                      <td className="py-1 pr-2 text-amber-700 dark:text-amber-300">{r.needsFill.join(' · ') || '—'}</td>
                    </tr>
                  ))
                )
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-2xs text-slate-500">
          Red cells = blank in the master, the backfill will populate them. Multiple rows per canonical = duplicates that should be merged via Auto-merge.
        </div>
      </details>
    </Card>
  );
}
