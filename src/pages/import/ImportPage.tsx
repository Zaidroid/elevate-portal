// /import — bulk-import wizard.
//
// Lets a non-engineer pull rows out of a legacy .xlsx or .csv file and append
// them to one of the E3 master sheets. Mirrors the Python migrators in
// sheet-builders/migrators/ but runs entirely in the browser using the same
// OAuth token and the same useSheetDoc-style append path, so writes go through
// the existing rate-limit + session-expired plumbing.
//
// Steps: 1) pick target  2) drop file  3) pick worksheet  4) map columns
//        5) preview  6) commit (chunked appendRows + per-chunk progress).

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Lock,
  Upload,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { Button, Card, CardHeader, EmptyState } from '../../lib/ui';
import { appendRows, getSpreadsheetMetaCached } from '../../lib/sheets/client';
import { getSheetId, getTab } from '../../config/sheets';
import { IMPORT_TARGETS, findTarget, type ImportTarget } from '../../lib/import/schemas';
import { autoMatch, parseFile, type ParsedSheet, type ParsedWorkbook } from '../../lib/import/parse';

type StepStatus = 'idle' | 'loading' | 'done' | 'error';

const CHUNK_SIZE = 100;
const HARD_ROW_LIMIT = 2000;

export function ImportPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.email || '');

  const [targetKey, setTargetKey] = useState<string>('');
  const target = useMemo(() => findTarget(targetKey), [targetKey]);

  const [file, setFile] = useState<File | null>(null);
  const [parseStatus, setParseStatus] = useState<StepStatus>('idle');
  const [parseError, setParseError] = useState<string>('');
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheetName, setSheetName] = useState<string>('');
  const sheet = useMemo<ParsedSheet | null>(
    () => workbook?.sheets.find(s => s.name === sheetName) || null,
    [workbook, sheetName]
  );

  // Mapping: target header -> source header (or '' for "leave blank")
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [commitStatus, setCommitStatus] = useState<StepStatus>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number; errors: string[] }>({
    done: 0,
    total: 0,
    errors: [],
  });

  const onPickTarget = (key: string) => {
    setTargetKey(key);
    // Reset downstream state so a target switch does not carry stale mapping.
    setFile(null);
    setWorkbook(null);
    setSheetName('');
    setMapping({});
    setParseStatus('idle');
    setParseError('');
    setCommitStatus('idle');
    setProgress({ done: 0, total: 0, errors: [] });
  };

  const onPickFile = useCallback(async (f: File) => {
    setFile(f);
    setParseStatus('loading');
    setParseError('');
    setWorkbook(null);
    setSheetName('');
    try {
      const wb = await parseFile(f);
      setWorkbook(wb);
      // Pick the first non-empty sheet by default.
      const first = wb.sheets.find(s => s.headers.length > 0) || wb.sheets[0];
      if (first) setSheetName(first.name);
      setParseStatus('done');
    } catch (err) {
      setParseStatus('error');
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Auto-match mapping whenever target or sheet changes.
  useMemo(() => {
    if (!target || !sheet) return;
    const next: Record<string, string> = {};
    for (const h of target.headers) {
      if (target.autoFilled?.includes(h)) {
        next[h] = '';
        continue;
      }
      next[h] = autoMatch(h, sheet.headers);
    }
    setMapping(next);
  }, [target, sheet]);

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <EmptyState
            icon={<Lock className="h-7 w-7" />}
            title="Admin only"
            description="Bulk import is restricted to admins. Ask Zaid or Israa to run the import for you, or paste rows directly into the sheet."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-500 dark:text-white">
          Bulk import
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload a legacy .xlsx or .csv file, map columns, append rows to a master sheet.
          Mirrors what the Python migrators in <code>sheet-builders/migrators/</code> do, but for non-engineers.
        </p>
      </header>

      <ol className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Step active={!target} done={!!target} label="1. Target" />
        <ChevronRight className="h-3 w-3" />
        <Step active={!!target && !sheet} done={!!sheet} label="2. File" />
        <ChevronRight className="h-3 w-3" />
        <Step active={!!sheet && commitStatus === 'idle'} done={commitStatus === 'done'} label="3. Map and commit" />
      </ol>

      <PickTarget value={targetKey} onChange={onPickTarget} />

      {target && (
        <FilePicker
          file={file}
          onPick={onPickFile}
          status={parseStatus}
          error={parseError}
        />
      )}

      {target && workbook && workbook.sheets.length > 1 && (
        <SheetPicker
          workbook={workbook}
          value={sheetName}
          onChange={setSheetName}
        />
      )}

      {target && sheet && (
        <ColumnMapper
          target={target}
          sheet={sheet}
          mapping={mapping}
          onChange={setMapping}
        />
      )}

      {target && sheet && (
        <CommitPanel
          target={target}
          sheet={sheet}
          mapping={mapping}
          userEmail={user?.email || ''}
          status={commitStatus}
          progress={progress}
          onCommit={async () => {
            setCommitStatus('loading');
            setProgress({ done: 0, total: 0, errors: [] });
            try {
              const sheetId = getSheetId(target.module);
              const tabName = getTab(target.module, target.tabKey);
              if (!sheetId) throw new Error(`Missing sheet ID for module ${target.module}`);

              // Confirm the tab exists so we surface a clear error before
              // appendRows fails with a vague Sheets API range error.
              const meta = await getSpreadsheetMetaCached(sheetId);
              if (!meta.sheets.some(s => s.title === tabName)) {
                throw new Error(`Tab "${tabName}" not found in sheet ${meta.title}`);
              }

              const builtRows = buildRowsForCommit(target, sheet, mapping, user?.email || '');
              if (builtRows.length === 0) {
                throw new Error('No rows passed validation. Check required columns.');
              }
              if (builtRows.length > HARD_ROW_LIMIT) {
                throw new Error(`Refusing to import more than ${HARD_ROW_LIMIT} rows in one go.`);
              }
              setProgress({ done: 0, total: builtRows.length, errors: [] });

              for (let i = 0; i < builtRows.length; i += CHUNK_SIZE) {
                const chunk = builtRows.slice(i, i + CHUNK_SIZE);
                try {
                  await appendRows(sheetId, `${tabName}!A:A`, chunk);
                  setProgress(p => ({ ...p, done: Math.min(p.total, i + chunk.length) }));
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setProgress(p => ({
                    ...p,
                    errors: [...p.errors, `Rows ${i + 1}-${i + chunk.length}: ${msg}`],
                  }));
                }
              }
              setCommitStatus('done');
            } catch (err) {
              setCommitStatus('error');
              setProgress(p => ({
                ...p,
                errors: [...p.errors, err instanceof Error ? err.message : String(err)],
              }));
            }
          }}
          onReset={() => {
            setCommitStatus('idle');
            setProgress({ done: 0, total: 0, errors: [] });
          }}
        />
      )}
    </div>
  );
}

function Step({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 ${
        done
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : active
          ? 'bg-brand-red/15 text-brand-red'
          : 'bg-slate-100 text-slate-500 dark:bg-navy-700 dark:text-slate-400'
      }`}
    >
      {label}
    </span>
  );
}

function PickTarget({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <Card>
      <CardHeader title="1. Pick a target" subtitle="Where should these rows land?" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {IMPORT_TARGETS.map(t => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`group rounded-xl border p-4 text-left transition-all ${
              value === t.key
                ? 'border-brand-red bg-brand-red/5 shadow-card'
                : 'border-slate-200 bg-white hover:border-brand-red/40 dark:border-navy-700 dark:bg-navy-700'
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-bold text-navy-500 dark:text-white">
              <FileSpreadsheet className="h-4 w-4 text-brand-teal" />
              {t.label}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.description}</p>
            <p className="mt-2 text-2xs uppercase tracking-wider text-slate-400">
              {t.module} · {t.tabKey} · {t.required.length} required
            </p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function FilePicker({
  file,
  onPick,
  status,
  error,
}: {
  file: File | null;
  onPick: (f: File) => void;
  status: StepStatus;
  error: string;
}) {
  return (
    <Card>
      <CardHeader title="2. Pick a file" subtitle=".xlsx, .xls, or .csv" />
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center transition-colors hover:border-brand-teal hover:bg-brand-teal/5 dark:border-navy-700 dark:bg-navy-700/50"
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
      >
        <Upload className="h-7 w-7 text-brand-teal" />
        <div className="text-sm font-semibold text-navy-500 dark:text-white">
          Drop a file or click to browse
        </div>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
        />
        {file && (
          <div className="mt-2 text-xs text-slate-500">
            {file.name} · {Math.round(file.size / 1024)} KB
          </div>
        )}
      </label>
      {status === 'loading' && (
        <p className="mt-3 text-xs text-slate-500">Parsing…</p>
      )}
      {status === 'error' && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </Card>
  );
}

function SheetPicker({
  workbook,
  value,
  onChange,
}: {
  workbook: ParsedWorkbook;
  value: string;
  onChange: (n: string) => void;
}) {
  return (
    <Card>
      <CardHeader title="2b. Pick a worksheet" subtitle="The workbook has multiple tabs" />
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {workbook.sheets.map(s => (
          <button
            key={s.name}
            onClick={() => onChange(s.name)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              value === s.name
                ? 'border-brand-teal bg-brand-teal/10 text-navy-500 dark:text-white'
                : 'border-slate-200 bg-white hover:border-brand-teal/40 dark:border-navy-700 dark:bg-navy-700'
            }`}
          >
            <div className="font-semibold">{s.name}</div>
            <div className="text-xs text-slate-500">
              {s.headers.length} cols · {s.rows.length} rows
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ColumnMapper({
  target,
  sheet,
  mapping,
  onChange,
}: {
  target: ImportTarget;
  sheet: ParsedSheet;
  mapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  const requiredMissing = target.required.filter(h => !mapping[h]);
  return (
    <Card>
      <CardHeader
        title="3. Map columns"
        subtitle={`Target columns from "${target.label}" on the left, source columns from "${sheet.name}" on the right.`}
      />
      {requiredMissing.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          Missing required mappings: {requiredMissing.join(', ')}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-navy-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-2xs uppercase tracking-wider text-slate-500 dark:bg-navy-700">
            <tr>
              <th className="px-3 py-2 text-left">Target</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Sample</th>
            </tr>
          </thead>
          <tbody>
            {target.headers.map(h => {
              const isAuto = target.autoFilled?.includes(h);
              const isReq = target.required.includes(h);
              const src = mapping[h] || '';
              const sampleIdx = src ? sheet.headers.indexOf(src) : -1;
              const sample = sampleIdx >= 0 ? (sheet.rows[0]?.[sampleIdx] ?? '') : '';
              return (
                <tr key={h} className="border-t border-slate-100 dark:border-navy-700">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-navy-500 dark:text-slate-200">{h}</span>
                    {isReq && <span className="ml-1 text-[10px] font-bold text-brand-red">REQ</span>}
                    {isAuto && <span className="ml-1 text-[10px] font-bold text-slate-400">AUTO</span>}
                  </td>
                  <td className="px-3 py-2">
                    {isAuto ? (
                      <span className="text-xs text-slate-400">filled by sheet / app</span>
                    ) : (
                      <select
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-navy-700 dark:bg-navy-700 dark:text-white"
                        value={src}
                        onChange={e => onChange({ ...mapping, [h]: e.target.value })}
                      >
                        <option value="">(leave blank)</option>
                        {sheet.headers.map(sh => (
                          <option key={sh} value={sh}>{sh}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-xs text-slate-500">
                    {sample || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CommitPanel({
  target,
  sheet,
  mapping,
  userEmail,
  status,
  progress,
  onCommit,
  onReset,
}: {
  target: ImportTarget;
  sheet: ParsedSheet;
  mapping: Record<string, string>;
  userEmail: string;
  status: StepStatus;
  progress: { done: number; total: number; errors: string[] };
  onCommit: () => Promise<void>;
  onReset: () => void;
}) {
  const willImport = useMemo(
    () => buildRowsForCommit(target, sheet, mapping, userEmail).length,
    [target, sheet, mapping, userEmail]
  );
  const requiredMissing = target.required.filter(h => !mapping[h]);
  const blocked = requiredMissing.length > 0 || willImport === 0;

  return (
    <Card accent="red">
      <CardHeader
        title="4. Preview and commit"
        subtitle={`${willImport} of ${sheet.rows.length} rows will append to ${target.module} → ${getTab(target.module, target.tabKey)}.`}
      />

      {status === 'done' && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="mr-1 inline h-4 w-4" />
          Imported {progress.done} of {progress.total} rows.
          {progress.errors.length > 0 && ` ${progress.errors.length} chunk(s) failed.`}
        </div>
      )}

      {status === 'loading' && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>Appending rows…</span>
            <span>{progress.done} / {progress.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-navy-700">
            <div
              className="h-full rounded-full bg-brand-red transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {progress.errors.length > 0 && (
        <details className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <summary className="cursor-pointer font-semibold">
            {progress.errors.length} error{progress.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {progress.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </details>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={onCommit}
          disabled={blocked || status === 'loading'}
          variant="primary"
        >
          {status === 'loading' ? 'Importing…' : (
            <>
              <ArrowRight className="h-4 w-4" /> Import {willImport} row{willImport === 1 ? '' : 's'}
            </>
          )}
        </Button>
        {(status === 'done' || status === 'error') && (
          <Button variant="ghost" onClick={onReset}>Reset</Button>
        )}
        <Link to={`/${target.module === 'companies' ? 'companies' : target.module}`}
          className="inline-flex items-center gap-1 text-xs text-brand-teal hover:underline">
          <ArrowLeft className="h-3 w-3" /> Open destination module
        </Link>
      </div>
      {blocked && requiredMissing.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          No rows pass validation yet. Check that the source has data in the required columns.
        </p>
      )}
    </Card>
  );
}

// Build the row payload that will be appended. Skips rows where any required
// target field maps to an empty value. Order matches target.headers exactly.
function buildRowsForCommit(
  target: ImportTarget,
  sheet: ParsedSheet,
  mapping: Record<string, string>,
  userEmail: string
): string[][] {
  const headerToSourceIdx: Record<string, number> = {};
  for (const h of target.headers) {
    const src = mapping[h];
    headerToSourceIdx[h] = src ? sheet.headers.indexOf(src) : -1;
  }
  const now = new Date().toISOString().slice(0, 10);
  const out: string[][] = [];
  for (const srcRow of sheet.rows) {
    const built: string[] = [];
    let missingReq = false;
    for (const h of target.headers) {
      let v = '';
      const idx = headerToSourceIdx[h];
      if (idx >= 0) v = srcRow[idx] ?? '';
      // Stamp updated_at / updated_by for any target that exposes them, even
      // if the user did not map them — matches what useSheetDoc does on writes.
      if (!v && h === 'updated_at') v = now;
      if (!v && h === 'updated_by' && userEmail) v = userEmail;
      if (target.required.includes(h) && !v) {
        missingReq = true;
        break;
      }
      built.push(v);
    }
    if (!missingReq) out.push(built);
  }
  return out;
}
