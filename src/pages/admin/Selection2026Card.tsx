// One-click rebuilder for the 2026 Selection workbook tabs.
//
// Writes 3 dashboard-quality tabs into `E3 - Selection Data`:
//   - Selection Funnel Dashboard  (KPI strip + per-AM/donor/city + funnel)
//   - Final Cohort 2026           (the 41 with city/AM/donor/budget/regdoc)
//   - Allocation 2026             (joined with live Companies for status/stage)
//
// All three derive from COHORT3_ALIASES + the live Companies master, so
// they always work — no upstream filtration / voting / interview data
// required. The remaining three tabs from the plan (Visit Schedule,
// Scoring Matrix, Waitlist) need their source tabs in `selection`
// populated first; tracked in notes/2026-selection-audit.md.
//
// Pattern matches RebuildDashboardsCard.tsx — same writeBuilt helper.

import { useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Card, CardHeader, useToast } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company } from '../../data/types';
import {
  buildSelectionFunnelDashboard,
  buildFinalCohort2026Tab,
  buildAllocation2026Tab,
  SELECTION_2026_TABS,
  type FormattedTab,
} from './selection2026Builder';
import { getSheetId } from '../../config/sheets';
import { updateRange, batchUpdate, getSpreadsheetMeta } from '../../lib/sheets/client';
import { recordRun } from '../../lib/observability/last-run';

const COL_LETTER = 'L';
const WIPE_TRAILING_ROWS = 60;

type TabKey = 'funnel' | 'finalCohort' | 'allocation';
type RunState = 'pending' | 'running' | 'done' | 'failed';

const TAB_LABELS: Record<TabKey, string> = {
  funnel: 'Selection Funnel Dashboard',
  finalCohort: 'Final Cohort 2026',
  allocation: 'Allocation 2026',
};

export function Selection2026Card() {
  const { user } = useAuth();
  const toast = useToast();
  const companies = useModuleData<Company>('companies', 'companies');

  const [busy, setBusy] = useState<TabKey | 'all' | null>(null);
  const [results, setResults] = useState<Record<TabKey, RunState>>({
    funnel: 'pending', finalCohort: 'pending', allocation: 'pending',
  });
  const [lastError, setLastError] = useState<string>('');
  const [openSheetUrl, setOpenSheetUrl] = useState<string>('');

  // Shared write-path: clear → values → formatting → wipe trailing.
  // Mirrors RebuildDashboardsCard.writeBuilt so the two cards behave
  // identically for the user.
  const writeBuilt = async (
    sheetId: string,
    tabName: string,
    tabId: number,
    built: FormattedTab,
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
      console.warn('[selection-2026] clear step warning', err);
    }
    await updateRange(sheetId, `'${tabName}'!A1:${COL_LETTER}${built.lastRow}`, built.values);
    for (let i = 0; i < built.requests.length; i += 100) {
      const chunk = built.requests.slice(i, i + 100);
      try {
        await batchUpdate(sheetId, chunk);
      } catch (err) {
        console.warn(`[selection-2026] format chunk ${i} warning`, err);
      }
    }
    const blank = Array.from({ length: WIPE_TRAILING_ROWS }, () => new Array(12).fill('') as string[]);
    const wipeRange = `'${tabName}'!A${built.lastRow + 1}:${COL_LETTER}${built.lastRow + WIPE_TRAILING_ROWS}`;
    try {
      await updateRange(sheetId, wipeRange, blank, { valueInput: 'RAW' });
    } catch { /* non-fatal */ }
  };

  // Resolve (or create) a tab in the selection workbook by name. The
  // existing dashboard-rebuilder pattern: addSheet on first run if the
  // tab doesn't exist yet, then re-fetch meta to grab its tabId.
  const ensureTab = async (sheetId: string, tabName: string): Promise<number> => {
    const meta = await getSpreadsheetMeta(sheetId);
    let tab = meta.sheets.find(s => s.title === tabName);
    if (!tab) {
      await batchUpdate(sheetId, [{ addSheet: { properties: { title: tabName } } }]);
      const meta2 = await getSpreadsheetMeta(sheetId);
      tab = meta2.sheets.find(s => s.title === tabName);
      if (!tab) throw new Error(`Could not create tab '${tabName}' in selection workbook`);
    }
    return tab.sheetId;
  };

  const runOne = async (key: TabKey) => {
    setBusy(key); setLastError('');
    try {
      const sheetId = getSheetId('selection');
      if (!sheetId) throw new Error('VITE_SHEET_SELECTION is not set.');
      setOpenSheetUrl(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`);

      const tabName = SELECTION_2026_TABS[key];
      const tabId = await ensureTab(sheetId, tabName);

      let built: FormattedTab;
      const ctx = { companies: companies.rows, generatedBy: user?.email || '', tabId };
      if (key === 'funnel')         built = buildSelectionFunnelDashboard(ctx);
      else if (key === 'finalCohort') built = buildFinalCohort2026Tab(ctx);
      else                          built = buildAllocation2026Tab(ctx);

      await writeBuilt(sheetId, tabName, tabId, built);
      setResults(prev => ({ ...prev, [key]: 'done' }));
      recordRun(`rebuildSelection2026.${key}`, {
        outcome: 'ok', ok: 1, fail: 0,
        message: `Wrote ${built.lastRow} rows to '${tabName}' + ${built.requests.length} format ops`,
      });
      toast.success(`${TAB_LABELS[key]} rebuilt — ${built.lastRow} rows`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setLastError(msg);
      setResults(prev => ({ ...prev, [key]: 'failed' }));
      recordRun(`rebuildSelection2026.${key}`, { outcome: 'fail', ok: 0, fail: 1, error: msg });
      toast.error(`${TAB_LABELS[key]} failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    setBusy('all'); setLastError('');
    setResults({ funnel: 'pending', finalCohort: 'pending', allocation: 'pending' });
    const order: TabKey[] = ['funnel', 'finalCohort', 'allocation'];
    let okCount = 0;
    for (const key of order) {
      setResults(prev => ({ ...prev, [key]: 'running' }));
      try {
        await runOne(key);
        okCount += 1;
      } catch { /* runOne already toasted */ }
      // restore master busy state since runOne flips it back to null
      setBusy('all');
    }
    setBusy(null);
    toast.success(`Rebuild Selection 2026: ${okCount} of ${order.length} tabs rewritten.`);
  };

  return (
    <Card accent="teal">
      <CardHeader
        title="Rebuild Selection 2026 dashboards"
        subtitle="Overwrites three tabs in E3 - Selection Data — Selection Funnel Dashboard, Final Cohort 2026, Allocation 2026 — using COHORT3_ALIASES + live Companies master. The remaining 3 tabs from the plan (Visit Schedule / Scoring Matrix / Waitlist) need their source tabs populated first; see notes/2026-selection-audit.md."
        action={
          <Button onClick={runAll} disabled={busy !== null || companies.rows.length === 0}>
            <Sparkles className="h-4 w-4" /> {busy === 'all' ? 'Rebuilding all…' : 'Rebuild all 3'}
          </Button>
        }
      />

      {/* Per-tab progress strip */}
      {(busy === 'all' || Object.values(results).some(s => s !== 'pending')) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-2xs dark:border-navy-700 dark:bg-navy-700/40">
          {(['funnel', 'finalCohort', 'allocation'] as const).map(k => {
            const s = results[k];
            const tone = s === 'done' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : s === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
              : s === 'running' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-slate-200 text-slate-600 dark:bg-navy-700 dark:text-slate-400';
            return (
              <span key={k} className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ${tone}`}>
                {TAB_LABELS[k]} · {s}
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['funnel', 'finalCohort', 'allocation'] as const).map(key => (
          <div key={key} className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-bold text-navy-500 dark:text-white">{TAB_LABELS[key]}</span>
            </div>
            <Button onClick={() => runOne(key)} disabled={busy !== null || companies.rows.length === 0}>
              <Sparkles className="h-4 w-4" /> {busy === key ? 'Rebuilding…' : 'Rebuild'}
            </Button>
          </div>
        ))}
      </div>

      {results.funnel === 'done' && results.finalCohort === 'done' && results.allocation === 'done' && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          All 3 tabs rebuilt.{' '}
          {openSheetUrl && (
            <a href={openSheetUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-teal hover:underline">
              Open E3 - Selection Data ↗
            </a>
          )}
        </div>
      )}
      {lastError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          {lastError}
        </div>
      )}

      <p className="mt-2 text-2xs text-slate-500">
        Word-doc package (Summary + 5 attachments) is generated separately by{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-navy-700">scripts/generate_2026_selection_package.py</code>.
      </p>
    </Card>
  );
}
