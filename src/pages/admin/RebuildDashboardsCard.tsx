// One-click rebuilder for the master Dashboard tabs.
//
// Phase 1: Companies Master.
// Phase 2: Procurement (this commit).
// Future:  Payments / Conferences / Docs / ElevateBridge / Advisors.
//
// The button computes metrics in code (using the portal's filtering +
// override logic) and writes static values to the Dashboard tab, so
// the sheet always matches what the portal shows.

import { useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Card, CardHeader, useToast } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company, Assignment, PR, Payment, Conference, ConferenceTrackerRow } from '../../data/types';
import type { Review } from '../companies/reviewTypes';
import { buildCompaniesDashboard, buildProcurementDashboard, buildPaymentsDashboard, buildConferencesDashboard } from './dashboardRebuilder';
import { getSheetId, SHEETS } from '../../config/sheets';
import { updateRange, batchUpdate, getSpreadsheetMeta } from '../../lib/sheets/client';
import { keepCompaniesSection } from '../../lib/sheets/sections';

const DASHBOARD_TAB = 'Dashboard';
// Width of the grid we write. Matches `dashboardRebuilder` (12 cols).
const COL_LETTER = 'L';
// Cap how many trailing rows we wipe so a smaller new dashboard doesn't
// leave stale rows behind from a previous run.
const WIPE_TRAILING_ROWS = 80;

export function RebuildDashboardsCard() {
  const { user } = useAuth();
  const toast = useToast();

  const companies   = useModuleData<Company>('companies', 'companies');
  const assignments = useModuleData<Assignment>('companies', 'assignments');
  const reviews     = useModuleData<Review>('companies', 'reviews');
  // Procurement inputs — all 4 quarters + cross-module Payments.
  const q1 = useModuleData<PR>('procurement', 'q1');
  const q2 = useModuleData<PR>('procurement', 'q2');
  const q3 = useModuleData<PR>('procurement', 'q3');
  const q4 = useModuleData<PR>('procurement', 'q4');
  const payments = useModuleData<Payment>('payments', 'payments');
  const confCatalogue = useModuleData<Conference>('conferences', 'catalogue');
  const confTracker   = useModuleData<ConferenceTrackerRow>('conferences', 'tracker');

  type Target = 'companies' | 'procurement' | 'payments' | 'conferences';
  const [busy, setBusy] = useState<Target | 'all' | null>(null);
  const [result, setResult] = useState<{ target: Target; ok: boolean; rowsWritten: number; error?: string } | null>(null);
  // For the master "Rebuild all" run — per-target status while the
  // sequential rebuild is in flight, then summary when done.
  const [allRun, setAllRun] = useState<Record<Target, 'pending' | 'running' | 'done' | 'failed'>>({
    companies: 'pending', procurement: 'pending', payments: 'pending', conferences: 'pending',
  });

  const tabExists = !!SHEETS.companies && !!SHEETS.companies.tabs;

  // Common write path: clear → values → formatting → wipe trailing.
  // Used by every dashboard target; differences are confined to the
  // `built` object the caller supplies.
  const writeBuilt = async (
    sheetId: string,
    tabName: string,
    tabId: number,
    built: { values: (string | number)[][]; requests: unknown[]; lastRow: number },
  ) => {
    const clearRange = {
      sheetId: tabId,
      startRowIndex: 0,
      endRowIndex: built.lastRow + WIPE_TRAILING_ROWS,
      startColumnIndex: 0,
      endColumnIndex: 12,
    };
    try {
      await batchUpdate(sheetId, [
        { unmergeCells: { range: clearRange } },
        { repeatCell: { range: clearRange, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } },
      ]);
    } catch (err) {
      console.warn('[dashboard] clear step warning', err);
    }
    await updateRange(sheetId, `'${tabName}'!A1:${COL_LETTER}${built.lastRow}`, built.values);
    for (let i = 0; i < built.requests.length; i += 100) {
      const chunk = built.requests.slice(i, i + 100);
      try {
        await batchUpdate(sheetId, chunk);
      } catch (err) {
        console.warn(`[dashboard] format chunk ${i} warning`, err);
      }
    }
    const blank = Array.from({ length: WIPE_TRAILING_ROWS }, () => new Array(12).fill('') as string[]);
    const wipeRange = `'${tabName}'!A${built.lastRow + 1}:${COL_LETTER}${built.lastRow + WIPE_TRAILING_ROWS}`;
    try {
      await updateRange(sheetId, wipeRange, blank, { valueInput: 'RAW' });
    } catch { /* non-fatal */ }
  };

  const runCompanies = async () => {
    setBusy('companies');
    setResult(null);
    try {
      const sheetId = getSheetId('companies');
      if (!sheetId) throw new Error('VITE_SHEET_COMPANIES is not set.');

      const meta = await getSpreadsheetMeta(sheetId);
      const tab = meta.sheets.find(s => s.title === DASHBOARD_TAB);
      if (!tab) throw new Error(`'${DASHBOARD_TAB}' tab not found in the Companies workbook.`);

      const built = buildCompaniesDashboard({
        companies: companies.rows,
        assignments: assignments.rows,
        reviews: reviews.rows,
        generatedBy: user?.email || '',
        tabId: tab.sheetId,
      });
      await writeBuilt(sheetId, DASHBOARD_TAB, tab.sheetId, built);
      setResult({ target: 'companies', ok: true, rowsWritten: built.lastRow });
      toast.success(`Companies Dashboard rebuilt — ${built.lastRow} rows + ${built.requests.length} format ops`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setResult({ target: 'companies', ok: false, rowsWritten: 0, error: msg });
      toast.error(`Rebuild failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const runProcurement = async () => {
    setBusy('procurement');
    setResult(null);
    try {
      const sheetId = getSheetId('procurement');
      if (!sheetId) throw new Error('VITE_SHEET_PROCUREMENT is not set.');

      const meta = await getSpreadsheetMeta(sheetId);
      let tab = meta.sheets.find(s => s.title === DASHBOARD_TAB);
      if (!tab) {
        // Create the Dashboard tab on first run so the team doesn't have
        // to add it manually.
        await batchUpdate(sheetId, [{ addSheet: { properties: { title: DASHBOARD_TAB } } }]);
        const meta2 = await getSpreadsheetMeta(sheetId);
        tab = meta2.sheets.find(s => s.title === DASHBOARD_TAB);
        if (!tab) throw new Error('Dashboard tab could not be created in Procurement workbook.');
      }

      // Section-aware reads: only Companies-section PRs feed the dashboard.
      const built = buildProcurementDashboard({
        prsByQuarter: {
          q1: keepCompaniesSection(q1.rows, q1.headers) as PR[],
          q2: keepCompaniesSection(q2.rows, q2.headers) as PR[],
          q3: keepCompaniesSection(q3.rows, q3.headers) as PR[],
          q4: keepCompaniesSection(q4.rows, q4.headers) as PR[],
        },
        companies: companies.rows,
        payments: payments.rows,
        generatedBy: user?.email || '',
        tabId: tab.sheetId,
      });
      await writeBuilt(sheetId, DASHBOARD_TAB, tab.sheetId, built);
      setResult({ target: 'procurement', ok: true, rowsWritten: built.lastRow });
      toast.success(`Procurement Dashboard rebuilt — ${built.lastRow} rows + ${built.requests.length} format ops`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setResult({ target: 'procurement', ok: false, rowsWritten: 0, error: msg });
      toast.error(`Rebuild failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  if (!tabExists) return null;

  const runPayments = async () => {
    setBusy('payments');
    setResult(null);
    try {
      const sheetId = getSheetId('payments');
      if (!sheetId) throw new Error('VITE_SHEET_PAYMENTS is not set.');

      const meta = await getSpreadsheetMeta(sheetId);
      let tab = meta.sheets.find(s => s.title === DASHBOARD_TAB);
      if (!tab) {
        await batchUpdate(sheetId, [{ addSheet: { properties: { title: DASHBOARD_TAB } } }]);
        const meta2 = await getSpreadsheetMeta(sheetId);
        tab = meta2.sheets.find(s => s.title === DASHBOARD_TAB);
        if (!tab) throw new Error('Dashboard tab could not be created in Payments workbook.');
      }

      // Section-aware reads on Payments + all 4 procurement quarters.
      const built = buildPaymentsDashboard({
        payments: keepCompaniesSection(payments.rows, payments.headers) as Payment[],
        prs: [
          ...keepCompaniesSection(q1.rows, q1.headers) as PR[],
          ...keepCompaniesSection(q2.rows, q2.headers) as PR[],
          ...keepCompaniesSection(q3.rows, q3.headers) as PR[],
          ...keepCompaniesSection(q4.rows, q4.headers) as PR[],
        ],
        companies: companies.rows,
        generatedBy: user?.email || '',
        tabId: tab.sheetId,
      });
      await writeBuilt(sheetId, DASHBOARD_TAB, tab.sheetId, built);
      setResult({ target: 'payments', ok: true, rowsWritten: built.lastRow });
      toast.success(`Payments Dashboard rebuilt — ${built.lastRow} rows + ${built.requests.length} format ops`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setResult({ target: 'payments', ok: false, rowsWritten: 0, error: msg });
      toast.error(`Rebuild failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const runConferences = async () => {
    setBusy('conferences');
    setResult(null);
    try {
      const sheetId = getSheetId('conferences');
      if (!sheetId) throw new Error('VITE_SHEET_CONFERENCES is not set.');

      const meta = await getSpreadsheetMeta(sheetId);
      let tab = meta.sheets.find(s => s.title === DASHBOARD_TAB);
      if (!tab) {
        await batchUpdate(sheetId, [{ addSheet: { properties: { title: DASHBOARD_TAB } } }]);
        const meta2 = await getSpreadsheetMeta(sheetId);
        tab = meta2.sheets.find(s => s.title === DASHBOARD_TAB);
        if (!tab) throw new Error('Dashboard tab could not be created in Conferences workbook.');
      }

      const built = buildConferencesDashboard({
        catalogue: keepCompaniesSection(confCatalogue.rows, confCatalogue.headers) as Conference[],
        tracker:   keepCompaniesSection(confTracker.rows,   confTracker.headers)   as ConferenceTrackerRow[],
        companies: companies.rows,
        generatedBy: user?.email || '',
        tabId: tab.sheetId,
      });
      await writeBuilt(sheetId, DASHBOARD_TAB, tab.sheetId, built);
      setResult({ target: 'conferences', ok: true, rowsWritten: built.lastRow });
      toast.success(`Conferences Dashboard rebuilt — ${built.lastRow} rows + ${built.requests.length} format ops`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setResult({ target: 'conferences', ok: false, rowsWritten: 0, error: msg });
      toast.error(`Rebuild failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  // Run all four rebuilders sequentially. We chain rather than parallelise
  // so we don't hammer the Sheets quota — each rebuild does ~50–200
  // batchUpdate ops and they're rate-limited per workbook independently.
  const runAll = async () => {
    setBusy('all');
    setResult(null);
    setAllRun({ companies: 'pending', procurement: 'pending', payments: 'pending', conferences: 'pending' });
    const targets: Array<{ key: Target; run: () => Promise<void> }> = [
      { key: 'companies',   run: runCompanies },
      { key: 'procurement', run: runProcurement },
      { key: 'payments',    run: runPayments },
      { key: 'conferences', run: runConferences },
    ];
    let okCount = 0;
    for (const t of targets) {
      setAllRun(prev => ({ ...prev, [t.key]: 'running' }));
      try {
        // Each runX flips busy itself; we restore 'all' afterwards so
        // the master button stays in its busy state until the chain ends.
        await t.run();
        setAllRun(prev => ({ ...prev, [t.key]: 'done' }));
        okCount += 1;
      } catch {
        setAllRun(prev => ({ ...prev, [t.key]: 'failed' }));
      }
      setBusy('all');
    }
    setBusy(null);
    toast.success(`Rebuild all: ${okCount} of ${targets.length} dashboards rewritten.`);
  };

  const sheetUrlFor = (mod: 'companies' | 'procurement' | 'payments' | 'conferences') => {
    const id = getSheetId(mod);
    if (!id) return null;
    return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`;
  };

  return (
    <Card accent="teal">
      <CardHeader
        title="Rebuild master dashboards"
        subtitle="Overwrites each workbook's Dashboard tab with values computed by the portal — same numbers you see in the UI, scoped to cohort 3, with overrides applied. Replaces brittle Sheets formulas that broke whenever fund codes or intervention taxonomy changed."
        action={
          <Button onClick={runAll} disabled={busy !== null}>
            <Sparkles className="h-4 w-4" /> {busy === 'all' ? 'Rebuilding all…' : 'Rebuild all dashboards'}
          </Button>
        }
      />

      {/* Master-run progress strip — only renders while a run-all is in
          flight or just finished. Each pill shows pending → running → done
          / failed. Hidden when no run-all has been triggered yet. */}
      {(busy === 'all' || Object.values(allRun).some(s => s !== 'pending')) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-2xs dark:border-navy-700 dark:bg-navy-700/40">
          {(['companies', 'procurement', 'payments', 'conferences'] as const).map(t => {
            const s = allRun[t];
            const tone = s === 'done' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : s === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
              : s === 'running' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-slate-200 text-slate-600 dark:bg-navy-700 dark:text-slate-400';
            return (
              <span key={t} className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ${tone}`}>
                {t} · {s}
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Companies */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-bold text-navy-500 dark:text-white">Companies Master</span>
            <span className="text-2xs text-slate-500">
              {companies.rows.length} co · {assignments.rows.length} int
            </span>
          </div>
          <Button onClick={runCompanies} disabled={busy !== null || companies.rows.length === 0}>
            <Sparkles className="h-4 w-4" /> {busy === 'companies' ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </div>

        {/* Procurement */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-bold text-navy-500 dark:text-white">Procurement</span>
            <span className="text-2xs text-slate-500">
              {q1.rows.length + q2.rows.length + q3.rows.length + q4.rows.length} PRs
            </span>
          </div>
          <Button
            onClick={runProcurement}
            disabled={busy !== null || (q1.rows.length + q2.rows.length + q3.rows.length + q4.rows.length) === 0}
          >
            <Sparkles className="h-4 w-4" /> {busy === 'procurement' ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </div>

        {/* Payments */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-bold text-navy-500 dark:text-white">Payments</span>
            <span className="text-2xs text-slate-500">
              {payments.rows.length} entries
            </span>
          </div>
          <Button
            onClick={runPayments}
            disabled={busy !== null || payments.rows.length === 0}
          >
            <Sparkles className="h-4 w-4" /> {busy === 'payments' ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </div>

        {/* Conferences */}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-bold text-navy-500 dark:text-white">Conferences</span>
            <span className="text-2xs text-slate-500">
              {confCatalogue.rows.length} cat · {confTracker.rows.length} track
            </span>
          </div>
          <Button
            onClick={runConferences}
            disabled={busy !== null || (confCatalogue.rows.length + confTracker.rows.length) === 0}
          >
            <Sparkles className="h-4 w-4" /> {busy === 'conferences' ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </div>
      </div>

      {result && result.ok && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          {result.target === 'companies' ? 'Companies' : result.target === 'procurement' ? 'Procurement' : result.target === 'payments' ? 'Payments' : 'Conferences'} Dashboard rewritten ({result.rowsWritten} rows).{' '}
          {sheetUrlFor(result.target) && (
            <a href={sheetUrlFor(result.target)!} target="_blank" rel="noreferrer" className="font-semibold text-brand-teal hover:underline">
              Open in Sheets ↗
            </a>
          )}
        </div>
      )}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {result.error}
        </div>
      )}

      <p className="mt-2 text-2xs text-slate-500">
        Docs / ElevateBridge / Advisors come in subsequent phases.
      </p>
    </Card>
  );
}
