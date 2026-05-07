// One-click rebuilder for the master Dashboard tabs.
//
// Phase 1: Companies Master only — proves the pattern.
// Future:  same approach for Procurement / Payments / Conferences /
//          Docs / Freelancers / Advisors / Team Roster.
//
// The button computes metrics in code (using the portal's filtering +
// override logic) and writes static values to the Dashboard tab, so
// the sheet always matches what the portal shows.

import { useState } from 'react';
import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Card, CardHeader, useToast } from '../../lib/ui';
import { useModuleData } from '../../data/useModuleData';
import { useAuth } from '../../services/auth';
import type { Company, Assignment } from '../../data/types';
import type { Review } from '../companies/reviewTypes';
import { buildCompaniesDashboard } from './dashboardRebuilder';
import { getSheetId, SHEETS } from '../../config/sheets';
import { updateRange, batchUpdate, getSpreadsheetMeta } from '../../lib/sheets/client';

const COMPANIES_DASHBOARD_TAB = 'Dashboard';
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

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; rowsWritten: number; error?: string } | null>(null);

  const tabExists = !!SHEETS.companies && !!SHEETS.companies.tabs;

  const runCompanies = async () => {
    setBusy(true);
    setResult(null);
    try {
      const sheetId = getSheetId('companies');
      if (!sheetId) throw new Error('VITE_SHEET_COMPANIES is not set.');

      // Resolve the Dashboard tab's gid for batchUpdate formatting.
      const meta = await getSpreadsheetMeta(sheetId);
      const tab = meta.sheets.find(s => s.title === COMPANIES_DASHBOARD_TAB);
      if (!tab) throw new Error(`'${COMPANIES_DASHBOARD_TAB}' tab not found in the Companies workbook.`);
      const tabId = tab.sheetId;

      const built = buildCompaniesDashboard({
        companies: companies.rows,
        assignments: assignments.rows,
        reviews: reviews.rows,
        generatedBy: user?.email || '',
        tabId,
      });

      // 1. CLEAR existing formatting on rows we'll touch + below — so
      //    any prior manual edits don't fight with the new layout.
      //    (We rebuild the format completely; values come next.)
      const clearRange = {
        sheetId: tabId,
        startRowIndex: 0,
        endRowIndex: built.lastRow + WIPE_TRAILING_ROWS,
        startColumnIndex: 0,
        endColumnIndex: 12,
      };
      const clearRequests: unknown[] = [
        // Drop all merges in the range first, otherwise repeatCell on a
        // merged area errors out.
        { unmergeCells: { range: clearRange } },
        // Wipe formatting (background, borders, text format) so we
        // start from a clean slate.
        {
          repeatCell: {
            range: clearRange,
            cell: { userEnteredFormat: {} },
            fields: 'userEnteredFormat',
          },
        },
      ];
      try {
        await batchUpdate(sheetId, clearRequests);
      } catch (err) {
        // Non-fatal — the format steps below will still run.
        console.warn('[dashboard] clear step warning', err);
      }

      // 2. WRITE values.
      const valuesRange = `'${COMPANIES_DASHBOARD_TAB}'!A1:${COL_LETTER}${built.lastRow}`;
      await updateRange(sheetId, valuesRange, built.values);

      // 3. APPLY formatting requests (chunked to stay under Sheets API
      //    request count limits).
      for (let i = 0; i < built.requests.length; i += 100) {
        const chunk = built.requests.slice(i, i + 100);
        try {
          await batchUpdate(sheetId, chunk);
        } catch (err) {
          console.warn(`[dashboard] format chunk ${i} warning`, err);
        }
      }

      // 4. Wipe trailing rows so a smaller dashboard doesn't leak old data.
      const blank = Array.from({ length: WIPE_TRAILING_ROWS }, () =>
        new Array(12).fill('') as string[],
      );
      const wipeRange = `'${COMPANIES_DASHBOARD_TAB}'!A${built.lastRow + 1}:${COL_LETTER}${built.lastRow + WIPE_TRAILING_ROWS}`;
      try {
        await updateRange(sheetId, wipeRange, blank, { valueInput: 'RAW' });
      } catch { /* non-fatal */ }

      setResult({ ok: true, rowsWritten: built.lastRow });
      toast.success(`Companies Dashboard rebuilt — ${built.lastRow} rows + ${built.requests.length} format ops`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      setResult({ ok: false, rowsWritten: 0, error: msg });
      toast.error(`Rebuild failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  if (!tabExists) return null;

  const sheetUrl = (() => {
    const id = getSheetId('companies');
    if (!id) return null;
    return `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`;
  })();

  return (
    <Card accent="teal">
      <CardHeader
        title="Rebuild master dashboards"
        subtitle="Overwrites the Dashboard tab with values computed by the portal — same numbers you see in /companies, scoped to cohort 3, with the interviewed-list override applied. Replaces the brittle Sheets formulas that broke when fund codes / intervention taxonomy changed."
        action={
          <Button onClick={runCompanies} disabled={busy || companies.rows.length === 0}>
            <Sparkles className="h-4 w-4" /> {busy ? 'Rebuilding…' : 'Rebuild Companies Dashboard'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
        <div>
          <div className="text-2xs uppercase tracking-wider text-slate-400">Companies in master</div>
          <div className="font-mono text-base font-bold text-navy-500 dark:text-white">{companies.rows.length}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wider text-slate-400">Intervention assignments</div>
          <div className="font-mono text-base font-bold text-navy-500 dark:text-white">{assignments.rows.length}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wider text-slate-400">Selection reviews</div>
          <div className="font-mono text-base font-bold text-navy-500 dark:text-white">{reviews.rows.length}</div>
        </div>
      </div>

      {result && result.ok && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          Dashboard rewritten ({result.rowsWritten} rows).{' '}
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-teal hover:underline">
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
        Other masters (Procurement, Payments, Conferences, Docs, ElevateBridge, Advisors, Team) will be added once Companies is verified.
      </p>
    </Card>
  );
}
