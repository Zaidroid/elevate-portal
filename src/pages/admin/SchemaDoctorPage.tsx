// Schema Doctor — admin-only diagnostic page.
//
// Surfaces the kind of silent failure that broke company profile pages:
//   1. A tab is declared in sheets.ts but missing from registry.ts
//      (resolveRange falls back to 'id' which then fails on writes)
//   2. The registry has an ID column that doesn't exist in the actual
//      sheet (header drift — column renamed in Drive)
//   3. Assignments/reviews/preDecisions carry `intervention_type` values
//      that don't resolve via resolveIntervention()
//
// Read-only diagnostic. No auto-fix — the team takes action on the
// underlying sheet or pushes a code change.

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardHeader, PageHeader } from '../../lib/ui';
import { SHEETS, getSheetId, type ModuleKey } from '../../config/sheets';
import { useModuleData } from '../../data/useModuleData';
import { useRegistryReport, useSheetDataContext } from '../../data/SheetDataProvider';
import { getIdColumns, makeKey } from '../../data/registry';
import { CANONICAL_HEADERS } from '../../data/canonicalHeaders';
import { resolveIntervention, canonicalAssignmentKey } from '../../config/interventions';

type Status = 'ok' | 'warn' | 'err' | 'unknown';

const STATUS_LABELS: Record<Status, string> = {
  ok: 'OK',
  warn: 'WARN',
  err: 'FAIL',
  unknown: '—',
};

const STATUS_TONE: Record<Status, 'green' | 'amber' | 'red' | 'neutral'> = {
  ok: 'green',
  warn: 'amber',
  err: 'red',
  unknown: 'neutral',
};

const RUNTIME_DISCOVERED_MODULES: ReadonlySet<string> = new Set([
  'procurementSource',
  'paymentsSource',
  'companiesInterviewed',
  'freelancersFormResponses',
  'advisorsFormResponses',
]);

export function SchemaDoctorPage() {
  const report = useRegistryReport();
  const ctx = useSheetDataContext();
  const idCols = getIdColumns();

  // Mount every (module, tab) the portal cares about so the Schema
  // Doctor can introspect headers from the SheetDataProvider's slot
  // state. Limit to the operational modules — selection workbook is
  // read elsewhere and would mount its 14 heavy tabs needlessly here.
  // For now, we read headers via useModuleData for the few critical
  // ones; the rest show registry/sheet status only (no header check).
  const masterHook       = useModuleData<Record<string, string>>('companies', 'companies');
  const contactsHook     = useModuleData<Record<string, string>>('companies', 'contacts');
  const assignmentsHook  = useModuleData<Record<string, string>>('companies', 'assignments');
  const reviewsHook      = useModuleData<Record<string, string>>('companies', 'reviews');
  const preDecisionsHook = useModuleData<Record<string, string>>('companies', 'preDecisions');

  // Collect all module/tab pairs declared in sheets.ts, skipping
  // runtime-discovered source workbooks.
  type ModuleTabRow = {
    module: string;
    tab: string;
    sheetTabName: string;
    key: string;
    idColumn: string | undefined;
    registryStatus: Status;
    headerStatus: Status;
    headerNote: string;
  };
  const rows = useMemo<ModuleTabRow[]>(() => {
    const out: ModuleTabRow[] = [];
    for (const [moduleName, cfg] of Object.entries(SHEETS)) {
      if (RUNTIME_DISCOVERED_MODULES.has(moduleName)) continue;
      for (const [tabKey, sheetTabName] of Object.entries(cfg.tabs)) {
        const key = makeKey(moduleName, tabKey);
        const idColumn = idCols[key];
        const registryStatus: Status = idColumn ? 'ok' : 'err';

        // Header check: we have header data for the 5 hooks above.
        // For other modules, mark unknown until a future automated
        // boot-time inspection is added.
        let headerStatus: Status = 'unknown';
        let headerNote = '';
        const headersFor = (slotKey: string): string[] | undefined => {
          const slot = ctx.getSlot(slotKey);
          if (slot.loading) return undefined;
          return slot.headers;
        };
        if (key === 'companies::companies' && headersFor(key)) headerNote = `${masterHook.headers.length} cols`;
        if (key === 'companies::contacts' && headersFor(key)) headerNote = `${contactsHook.headers.length} cols`;
        if (key === 'companies::assignments' && headersFor(key)) headerNote = `${assignmentsHook.headers.length} cols`;
        if (key === 'companies::reviews' && headersFor(key)) headerNote = `${reviewsHook.headers.length} cols`;
        if (key === 'companies::preDecisions' && headersFor(key)) headerNote = `${preDecisionsHook.headers.length} cols`;

        // Header validation, in order of severity:
        //   1. Slot still loading → 'unknown' (n/a)
        //   2. Slot reports a fetch error → 'err' with message
        //   3. Slot has no headers at all (empty array, not loading, no
        //      error) → tab is missing or misnamed in the workbook,
        //      OR the workbook has the tab but it's truly empty
        //   4. Declared idColumn not in headers → 'err'
        //   5. Canonical mismatch → 'err' (missing cols) / 'warn' (extras only)
        //   6. Otherwise → 'ok'
        if (idColumn && headerNote) {
          const slot = ctx.getSlot(key);
          const headers = slot.headers;
          if (slot.error) {
            headerStatus = 'err';
            headerNote = `fetch failed: ${slot.error.message}`;
          } else if (headers.length === 0) {
            // Three possible causes — we can't distinguish from here
            // without a Drive metadata call. Surface all options so the
            // admin can investigate. Loading state is already excluded
            // by the !slot.loading check above.
            headerStatus = 'err';
            headerNote = `tab '${sheetTabName}' returned no headers — check that the tab exists in the workbook with this exact name and has a header row in row 1`;
          } else if (!headers.includes(idColumn)) {
            headerStatus = 'err';
            headerNote = `idColumn '${idColumn}' not in headers (column renamed in Drive?)`;
          } else {
            const canonical = (CANONICAL_HEADERS as Record<string, readonly string[]>)[key];
            if (canonical) {
              const missing = canonical.filter(h => !headers.includes(h));
              const extra = headers.filter(h => !canonical.includes(h));
              if (missing.length === 0 && extra.length === 0) {
                headerStatus = 'ok';
                headerNote = `${headers.length} cols (canonical match)`;
              } else if (missing.length === 0) {
                // Extras are fine — sheet may carry team-added columns.
                headerStatus = 'warn';
                headerNote = `${headers.length} cols (+${extra.length} extra: ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? '…' : ''})`;
              } else {
                headerStatus = 'err';
                headerNote = `missing ${missing.length} canonical col(s): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`;
              }
            } else {
              headerStatus = 'ok';
              headerNote = `${headers.length} cols (no canonical baseline)`;
            }
          }
        }

        out.push({
          module: moduleName,
          tab: tabKey,
          sheetTabName,
          key,
          idColumn,
          registryStatus,
          headerStatus,
          headerNote,
        });
      }
    }
    return out;
  }, [idCols, ctx, masterHook.headers, contactsHook.headers, assignmentsHook.headers, reviewsHook.headers, preDecisionsHook.headers]);

  // Duplicate canonical assignments per company — two rows that
  // resolve to the same canonical intervention key. These cause the
  // Program tab to render duplicate cards (the bug that broke AI Pilot's
  // C-Suite display).
  const duplicateAssignments = useMemo(() => {
    type Dupe = { companyId: string; canonical: string; assignmentIds: string[] };
    const byCompanyCanonical = new Map<string, string[]>(); // `${companyId}::${canonical}` → assignment_ids
    for (const a of assignmentsHook.rows) {
      const cid = a.company_id;
      if (!cid) continue;
      const canonical = canonicalAssignmentKey({ intervention_type: a.intervention_type, sub_intervention: a.sub_intervention });
      const key = `${cid}::${canonical}`;
      const arr = byCompanyCanonical.get(key) || [];
      if (a.assignment_id) arr.push(a.assignment_id);
      byCompanyCanonical.set(key, arr);
    }
    const out: Dupe[] = [];
    for (const [key, ids] of byCompanyCanonical.entries()) {
      if (ids.length <= 1) continue;
      const [companyId, canonical] = key.split('::', 2);
      out.push({ companyId, canonical, assignmentIds: ids });
    }
    out.sort((a, b) => a.companyId.localeCompare(b.companyId));
    return out;
  }, [assignmentsHook.rows]);

  // Unmapped intervention_type across the three rows that carry one.
  const unmappedInterventions = useMemo(() => {
    const allRows = [
      ...assignmentsHook.rows.map(r => ({ src: 'assignments', val: r.intervention_type, sub: r.sub_intervention })),
      ...reviewsHook.rows.map(r => ({ src: 'reviews', val: r.proposed_pillars, sub: r.proposed_sub_interventions })),
      ...preDecisionsHook.rows.map(r => ({ src: 'preDecisions', val: r.pillar, sub: r.sub_intervention })),
    ];
    const bad = new Set<string>();
    for (const r of allRows) {
      const candidates: string[] = [];
      if (r.val) candidates.push(...String(r.val).split(/[;,]/).map(s => s.trim()).filter(Boolean));
      if (r.sub) candidates.push(...String(r.sub).split(/[;,]/).map(s => s.trim()).filter(Boolean));
      for (const c of candidates) {
        if (!resolveIntervention(c)) bad.add(`${r.src}: ${c}`);
      }
    }
    return Array.from(bad).sort();
  }, [assignmentsHook.rows, reviewsHook.rows, preDecisionsHook.rows]);

  // Group by module for display.
  const byModule = useMemo(() => {
    const m = new Map<string, ModuleTabRow[]>();
    for (const r of rows) {
      const arr = m.get(r.module) || [];
      arr.push(r);
      m.set(r.module, arr);
    }
    return m;
  }, [rows]);

  // Surface modules whose VITE_SHEET_<MODULE> env var is empty — that
  // workbook can't be read at all, and every traffic light for its
  // tabs would mislead an admin who doesn't notice the upstream cause.
  const modulesWithMissingEnv = useMemo(() => {
    const out: string[] = [];
    for (const moduleName of Object.keys(SHEETS) as ModuleKey[]) {
      if (RUNTIME_DISCOVERED_MODULES.has(moduleName)) continue;
      if (!getSheetId(moduleName)) out.push(moduleName);
    }
    return out;
  }, []);

  const overallStatus: Status =
    report.ok
    && unmappedInterventions.length === 0
    && modulesWithMissingEnv.length === 0
    && duplicateAssignments.length === 0
      ? 'ok'
      : 'warn';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Schema Doctor"
        subtitle="Read-only diagnostic: registry consistency, sheet headers, intervention taxonomy."
        badges={[
          { label: overallStatus === 'ok' ? 'Healthy' : 'Drift detected', tone: STATUS_TONE[overallStatus] },
          { label: `${report.totalDeclared} tabs · ${report.totalRegistered} registered`, tone: 'neutral' },
        ]}
        actions={
          <Button variant="ghost" onClick={() => ctx.refreshAll()} title="Reload all data">
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      {modulesWithMissingEnv.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardHeader
            title="Workbooks not configured"
            subtitle="These modules have no VITE_SHEET_<MODULE> env var set; every check below will fail until they're configured."
          />
          <ul className="list-disc pl-6 text-xs text-red-700 dark:text-red-300">
            {modulesWithMissingEnv.map(m => (
              <li key={m}>
                <code className="rounded bg-white px-1 dark:bg-navy-700">VITE_SHEET_{m.toUpperCase()}</code> — {SHEETS[m as ModuleKey]?.label || m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Registry consistency" subtitle="Every tab in sheets.ts must have an ID column in registry.ts." />
        {report.ok ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> No drift detected. {report.totalDeclared} tabs, all registered.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            {report.missing.length > 0 && (
              <div>
                <div className="font-semibold text-red-700 dark:text-red-300">
                  {report.missing.length} tab(s) declared but missing from registry:
                </div>
                <ul className="mt-1 list-disc pl-6 text-xs text-slate-600 dark:text-slate-300">
                  {report.missing.map(k => <li key={k}><code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{k}</code></li>)}
                </ul>
              </div>
            )}
            {report.orphan.length > 0 && (
              <div>
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  {report.orphan.length} orphan entries (registered but not declared in sheets.ts):
                </div>
                <ul className="mt-1 list-disc pl-6 text-xs text-slate-600 dark:text-slate-300">
                  {report.orphan.map(k => <li key={k}><code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{k}</code></li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Duplicate intervention assignments"
          subtitle="Multiple rows in companies::assignments for the same company + canonical intervention. Causes duplicate cards on company profile pages."
        />
        {duplicateAssignments.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> No duplicate canonical assignments.
          </p>
        ) : (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" /> {duplicateAssignments.length} duplicate canonical assignment(s):
            </p>
            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {duplicateAssignments.map(d => (
                <li key={`${d.companyId}::${d.canonical}`}>
                  <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{d.companyId}</code>
                  {' · '}
                  <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{d.canonical}</code>
                  {' → '}
                  {d.assignmentIds.join(' + ')}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Resolve by opening the company profile, finding the empty duplicate (no budget / fund / dates), and deleting that row.
              The Program tab collapses them visually but the underlying duplicate rows remain in the sheet until removed.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Intervention taxonomy"
          subtitle="Every intervention_type / sub_intervention value should resolve via resolveIntervention()."
        />
        {unmappedInterventions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> All values resolve cleanly.
          </p>
        ) : (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" /> {unmappedInterventions.length} unmapped value(s):
            </p>
            <ul className="list-disc pl-6 text-xs text-slate-600 dark:text-slate-300">
              {unmappedInterventions.map(v => <li key={v}><code className="rounded bg-slate-100 px-1 dark:bg-navy-700">{v}</code></li>)}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Fix by either canonicalising the values in the sheet or adding a LEGACY entry in <code>src/config/interventions.ts</code>.
            </p>
          </div>
        )}
      </Card>

      {Array.from(byModule.entries()).map(([moduleName, items]) => (
        <Card key={moduleName}>
          <CardHeader title={SHEETS[moduleName].label} subtitle={`Module: ${moduleName}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 dark:bg-navy-700 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2">Tab</th>
                  <th className="px-3 py-2">Sheet tab name</th>
                  <th className="px-3 py-2">ID column</th>
                  <th className="px-3 py-2 text-center">Registry</th>
                  <th className="px-3 py-2 text-center">Headers</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                {items.map(r => (
                  <tr key={r.key}>
                    <td className="px-3 py-1.5 font-mono">{r.tab}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.sheetTabName}</td>
                    <td className="px-3 py-1.5 font-mono">{r.idColumn || <span className="text-red-500">(missing)</span>}</td>
                    <td className="px-3 py-1.5 text-center"><Badge tone={STATUS_TONE[r.registryStatus]}>{STATUS_LABELS[r.registryStatus]}</Badge></td>
                    <td className="px-3 py-1.5 text-center">
                      {r.headerStatus === 'unknown' ? (
                        <span className="inline-flex items-center gap-1 text-slate-400"><Loader2 className="h-3 w-3" /> n/a</span>
                      ) : (
                        <Badge tone={STATUS_TONE[r.headerStatus]}>{STATUS_LABELS[r.headerStatus]}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{r.headerNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
