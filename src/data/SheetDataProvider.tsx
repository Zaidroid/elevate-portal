/**
 * SheetDataProvider — Centralised data layer for the Elevate Portal.
 *
 * PROBLEM IT SOLVES
 * ─────────────────
 * The old pattern (the now-removed `useSheetDoc` hook) had each page create
 * its own per-tab hook with an independent 30-second poll loop. With 69+
 * hooks across the app and 3 users, the portal easily hit Google Sheets'
 * 300-reads/min-per-project quota. This provider replaces that pattern.
 *
 * HOW IT WORKS
 * ────────────
 * 1. Pages call `useModuleData(module, tab)` which registers a DataKey with
 *    this provider.
 * 2. Every 120 seconds the provider groups all active keys by their workbook
 *    and fires ONE batchGet() per workbook instead of one request per tab.
 * 3. Results are cached in memory (cache.ts). Writes call invalidate() on the
 *    affected key so the next tick re-fetches fresh data. Path-B writes
 *    (direct adapter calls) trigger the same invalidation via the
 *    `writeEvents` listener below.
 * 4. Polling pauses when the browser tab is hidden — same as pollRange() in
 *    client.ts.
 *
 * QUOTA IMPACT
 * ────────────
 * Before: ~69 reads every 30 s = 138 reads/min per user.
 * After:  ~6 batchGet calls every 120 s = ~3 reads/min per user.
 *
 * DESIGN NOTES INHERITED FROM THE PREDECESSOR
 * ───────────────────────────────────────────
 * Wisdom from the original `useSheetDoc` (deleted May 2026 — full archive
 * at notes/archived-useSheetDoc.tsx.bak). These are not currently
 * implemented here but are documented so a future revision doesn't lose
 * the rationale:
 *
 * - **Resolve target row by key, not cached index.** When writing, re-read
 *   the tab and locate the target row by its idColumn value. Cached row
 *   indices break the moment another user inserts or deletes rows between
 *   polls — you'd overwrite the wrong row. (This provider's `updateRow`
 *   already does this, see line 232 onwards.)
 *
 * - **Optimistic update FIRST, network call after.** Drag-to-reorder on a
 *   kanban board freezes for >1 s on a cold sheet if the UI waits for the
 *   round-trip. Patch local state immediately, then write, then on failure
 *   roll back. (Already implemented here at line 244-247.)
 *
 * - **Re-merge against the server-resolved row shape.** Before writing,
 *   merge the user's `updates` into the row read from the sheet — not into
 *   the local cached copy. Otherwise you can drop fields that exist on the
 *   server but were never loaded into local state (e.g., a column the team
 *   added since the last poll). (Already implemented here at line 247.)
 *
 * - **Conflict detection: requires a paired UX surface to ship safely.**
 *   The predecessor threw a `SheetConflictError(serverRow, localRow,
 *   updates)` when the server's `updated_at` differed from the locally
 *   loaded copy. The three-row payload was specifically shaped so a UI
 *   could render a "row was edited by X — keep yours / take theirs / merge"
 *   diff. Adding the throw without that UI (as D3 attempted in this audit)
 *   regresses UX: races now produce generic toast errors with no recovery
 *   path. When this returns: ship throw + diff-resolution UI together, in
 *   the same change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { batchGet, appendRows, fetchRange, updateRange, deleteSheetRow, writeEvents, parseTabFromRange } from '../lib/sheets/client';
import { groupBySheet, resolveRange, validateRegistry, type RegistryReport } from './registry';
import { validateEnv, type EnvReport } from '../config/sheets';
import { getCached, setCache, invalidate } from './cache';
import { recordRun, outcomeFor } from '../lib/observability/last-run';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Row = Record<string, string | undefined>;

interface SlotState {
  rows: Row[];
  headers: string[];
  loading: boolean;
  error: Error | null;
}

interface ContextValue {
  register: (key: string) => void;
  unregister: (key: string) => void;
  getSlot: (key: string) => SlotState;
  refresh: (key: string) => void;
  refreshAll: () => void;
  updateRow: (key: string, id: string, updates: Partial<Row>) => Promise<void>;
  createRow: (key: string, row: Partial<Row>) => Promise<void>;
  deleteRow: (key: string, id: string) => Promise<void>;
  registryReport: RegistryReport;
  envReport: EnvReport;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const SheetDataContext = createContext<ContextValue | null>(null);

const EMPTY_SLOT: SlotState = { rows: [], headers: [], loading: false, error: null };
const POLL_MS = 120_000; // 2 min — matches useSheetDoc DEFAULT_INTERVAL

// ─── Helper: parse batchGet response into rows ────────────────────────────────

function parseValues(values: string[][] | undefined): { headers: string[]; rows: Row[] } {
  if (!values || values.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...dataRows] = values;
  const headers = headerRow.map(h => h?.trim() ?? '');
  const rows: Row[] = dataRows
    .filter(r => r.some(cell => (cell ?? '').trim() !== ''))
    .map(r => {
      const obj: Row = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      return obj;
    });
  return { headers, rows };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SheetDataProvider({ children }: { children: ReactNode }) {
  // Set of currently-registered DataKeys (pages that are mounted).
  const activeKeys = useRef(new Set<string>());
  // Slot state for every key that has ever been registered this session.
  const [, setSlots] = useState<Record<string, SlotState>>({});
  const slotsRef = useRef<Record<string, SlotState>>({});

  /** Merge partial state for one key without losing others. */
  const patchSlot = useCallback((key: string, patch: Partial<SlotState>) => {
    setSlots(prev => {
      const next = { ...prev, [key]: { ...(prev[key] ?? EMPTY_SLOT), ...patch } };
      slotsRef.current = next;
      return next;
    });
  }, []);

  // ─── Fetch one batch of keys grouped by workbook ──────────────────────────

  const fetchKeys = useCallback(async (keys: Iterable<string>) => {
    const keyList = Array.from(keys);
    if (keyList.length === 0) return;

    // Mark all as loading (only those not yet populated).
    keyList.forEach(k => {
      if (!(k in slotsRef.current) || slotsRef.current[k].loading) return;
      patchSlot(k, { loading: true, error: null });
    });

    // Group by workbook so we can use batchGet.
    const bySheet = groupBySheet(keyList);

    let okWorkbooks = 0;
    let failWorkbooks = 0;
    let firstError: string | undefined;

    for (const [sheetId, entries] of bySheet.entries()) {
      // Build ranges — check cache first to skip unnecessary API calls.
      const toFetch = entries.filter(e => !getCached(e.key));

      // Even if all are cached, still update slot state from cache.
      entries.forEach(e => {
        const cached = getCached(e.key);
        if (cached) {
          patchSlot(e.key, { rows: parseValues([cached.headers, ...cached.rows]).rows, headers: cached.headers, loading: false, error: null });
        }
      });

      if (toFetch.length === 0) continue;

      const ranges = toFetch.map(e => `${e.tab}!A:ZZ`);

      try {
        const results = await batchGet(sheetId, ranges);
        results.forEach((result, i) => {
          const entry = toFetch[i];
          if (!entry) return;
          const { headers, rows } = parseValues(result.values);
          setCache(entry.key, rows.map(r => headers.map(h => r[h] ?? '')), headers);
          patchSlot(entry.key, { rows, headers, loading: false, error: null });
        });
        okWorkbooks += 1;
      } catch (err) {
        toFetch.forEach(e => patchSlot(e.key, { loading: false, error: err as Error }));
        failWorkbooks += 1;
        if (!firstError) firstError = (err as Error).message || String(err);
      }
    }

    // Surface the cycle's outcome so the footer pill can show it.
    if (okWorkbooks > 0 || failWorkbooks > 0) {
      recordRun('Data sync', {
        outcome: outcomeFor(okWorkbooks, failWorkbooks),
        ok: okWorkbooks,
        fail: failWorkbooks,
        message: `${okWorkbooks} workbook${okWorkbooks === 1 ? '' : 's'} fetched${failWorkbooks > 0 ? `, ${failWorkbooks} failed` : ''}`,
        error: firstError,
      });
    }
  }, [patchSlot]);

  // ─── Initial fetch when keys are registered ───────────────────────────────

  const pendingInitial = useRef(new Set<string>());
  const initTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleInitialFetch = useCallback((key: string) => {
    pendingInitial.current.add(key);
    if (initTimer.current) clearTimeout(initTimer.current);
    // Debounce: wait 50 ms for other keys mounting in the same render cycle.
    initTimer.current = setTimeout(() => {
      const keys = Array.from(pendingInitial.current);
      pendingInitial.current.clear();
      fetchKeys(keys);
    }, 50);
  }, [fetchKeys]);

  // ─── Poll loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return; // Pause when tab is not visible.
      fetchKeys(activeKeys.current);
    };
    const interval = setInterval(tick, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchKeys]);

  // ─── Adapter write event → cache invalidation ─────────────────────────────
  //
  // "Path B" writers — admin tools, dedupe runs, dashboard rebuilders,
  // snapshot writers — call updateRange / appendRows / batchUpdate /
  // deleteSheetRow directly on the adapter, bypassing this provider's
  // updateRow / createRow methods. Without this listener, the cache and
  // slot state remained stale until the next 120 s poll, so the live
  // UI showed old data after admin actions like "Rebuild Dashboard"
  // or "Sync Stage 3 Distribution".
  //
  // The adapter dispatches { sheetId, range? } on every successful
  // write. We invalidate every active DataKey whose sheetId matches
  // (and whose tab matches when range is present), then trigger a
  // refetch so the UI refreshes within seconds, not minutes.
  useEffect(() => {
    const onWrite = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sheetId: string; range?: string };
      if (!detail || !detail.sheetId) return;
      const tabName = detail.range ? parseTabFromRange(detail.range) : null;

      const affected: string[] = [];
      for (const key of activeKeys.current) {
        const r = resolveRange(key);
        if (!r) continue;
        if (r.sheetId !== detail.sheetId) continue;
        if (tabName && r.tab !== tabName) continue;
        affected.push(key);
      }
      if (affected.length === 0) return;

      for (const k of affected) invalidate(k);
      void fetchKeys(affected);
    };
    writeEvents.addEventListener('write', onWrite);
    return () => writeEvents.removeEventListener('write', onWrite);
  }, [fetchKeys]);

  // ─── Context methods ──────────────────────────────────────────────────────

  const register = useCallback((key: string) => {
    activeKeys.current.add(key);
    // If we don't have data yet, fetch immediately.
    if (!(key in slotsRef.current)) {
      patchSlot(key, { ...EMPTY_SLOT, loading: true });
      scheduleInitialFetch(key);
    }
  }, [patchSlot, scheduleInitialFetch]);

  const unregister = useCallback((key: string) => {
    activeKeys.current.delete(key);
    // We intentionally keep the slot data in memory so navigating back is instant.
  }, []);

  const refresh = useCallback((key: string) => {
    invalidate(key);
    patchSlot(key, { loading: true, error: null });
    fetchKeys([key]);
  }, [fetchKeys, patchSlot]);

  const refreshAll = useCallback(() => {
    fetchKeys(activeKeys.current);
  }, [fetchKeys]);

  const getSlot = useCallback((key: string): SlotState => {
    return slotsRef.current[key] ?? EMPTY_SLOT;
  }, []);

  // ─── Write: updateRow ─────────────────────────────────────────────────────

  const updateRow = useCallback(async (key: string, id: string, updates: Partial<Row>) => {
    const resolved = resolveRange(key);
    if (!resolved) throw new Error(`[SheetDataProvider] Unknown key: ${key}`);

    const { sheetId, tab, idColumn } = resolved;
    const slot = slotsRef.current[key] ?? EMPTY_SLOT;

    // Refuse empty IDs. Without this, the row-matching loop below finds
    // the FIRST row whose ID column is also blank and overwrites it —
    // that's the "edited wemakefuture, web summit got clobbered" bug.
    // If a row has no ID, mint one in the caller before touching it.
    if (!id || !String(id).trim()) {
      throw new Error(`Cannot update row with blank ${idColumn}. Add an ID to the row first (open it, save once with a generated ID), then retry.`);
    }

    // Optimistic update.
    const optimisticRows = slot.rows.map(r =>
      r[idColumn] === id ? { ...r, ...updates } : r
    );
    patchSlot(key, { rows: optimisticRows });

    // Re-read the sheet to find the exact row number.
    try {
      const data = await fetchRange(sheetId, `${tab}!A:ZZ`);
      if (data.length === 0) throw new Error('Tab is empty');
      const headers = data[0].map(h => h?.trim() ?? '');
      const keyIdx = headers.indexOf(idColumn);
      if (keyIdx < 0) throw new Error(`ID column '${idColumn}' not found in ${tab}`);

      let targetRow = -1;
      for (let i = 1; i < data.length; i++) {
        if ((data[i][keyIdx] ?? '') === id) { targetRow = i + 1; break; }
      }
      if (targetRow < 0) throw new Error(`Row with ${idColumn}=${id} not found`);

      // Build the updated row values.
      const existingRow: Row = {};
      headers.forEach((h, i) => { existingRow[h] = data[targetRow - 1][i] ?? ''; });
      const merged = { ...existingRow, ...updates, updated_at: new Date().toISOString() };
      const rowValues = [headers.map(h => (merged as any)[h] ?? '')];

      // Use the adapter — gains 429 retry/backoff, assertWritable guard,
      // and consistent auth handling. This was previously a raw fetch()
      // that bypassed all of those.
      await updateRange(sheetId, `${tab}!A${targetRow}`, rowValues);

      // Invalidate cache and re-fetch.
      invalidate(key);
      await fetchKeys([key]);
    } catch (err) {
      // Rollback optimistic update.
      patchSlot(key, { rows: slot.rows, error: err as Error });
      throw err;
    }
  }, [fetchKeys, patchSlot]);

  // ─── Write: createRow ─────────────────────────────────────────────────────

  const createRow = useCallback(async (key: string, row: Partial<Row>) => {
    const resolved = resolveRange(key);
    if (!resolved) throw new Error(`[SheetDataProvider] Unknown key: ${key}`);

    const { sheetId, tab } = resolved;
    const slot = slotsRef.current[key] ?? EMPTY_SLOT;

    // Optimistic insert.
    const optimisticRows = [...slot.rows, row as Row];
    patchSlot(key, { rows: optimisticRows });

    try {
      const newRow = { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const headers = slot.headers.length > 0 ? slot.headers : Object.keys(newRow);
      const values = [headers.map(h => (newRow as Row)[h] ?? '')];
      await appendRows(sheetId, `${tab}!A:A`, values);
      invalidate(key);
      await fetchKeys([key]);
    } catch (err) {
      patchSlot(key, { rows: slot.rows, error: err as Error });
      throw err;
    }
  }, [fetchKeys, patchSlot]);

  // ─── Write: deleteRow ─────────────────────────────────────────────────────

  const deleteRow = useCallback(async (key: string, id: string) => {
    const resolved = resolveRange(key);
    if (!resolved) throw new Error(`[SheetDataProvider] Unknown key: ${key}`);

    const { sheetId, tab, idColumn } = resolved;
    const slot = slotsRef.current[key] ?? EMPTY_SLOT;

    // Optimistic delete.
    const optimisticRows = slot.rows.filter(r => r[idColumn] !== id);
    patchSlot(key, { rows: optimisticRows });

    try {
      const data = await fetchRange(sheetId, `${tab}!A:ZZ`);
      if (data.length === 0) throw new Error('Tab is empty');
      const headers = data[0].map(h => h?.trim() ?? '');
      const keyIdx = headers.indexOf(idColumn);
      if (keyIdx < 0) throw new Error(`ID column '${idColumn}' not found in ${tab}`);

      let targetRow = -1;
      for (let i = 1; i < data.length; i++) {
        if ((data[i][keyIdx] ?? '') === id) { targetRow = i + 1; break; }
      }
      if (targetRow < 0) throw new Error(`Row with ${idColumn}=${id} not found`);

      await deleteSheetRow(sheetId, tab, targetRow);
      invalidate(key);
      await fetchKeys([key]);
    } catch (err) {
      patchSlot(key, { rows: slot.rows, error: err as Error });
      throw err;
    }
  }, [fetchKeys, patchSlot]);

  // Boot-time drift checks. Runs once on mount; results are exposed
  // via context so admin banners / Schema Doctor can render them.
  // Non-blocking — the app continues to function regardless.
  const registryReport = useRef<RegistryReport>(validateRegistry());
  const envReport = useRef<EnvReport>(validateEnv());
  useEffect(() => {
    const r = registryReport.current;
    if (!r.ok) {
      if (r.missing.length > 0) {
        console.error(
          `[registry] ${r.missing.length} tab(s) declared in sheets.ts but missing from ID_COLUMNS:`,
          r.missing,
        );
      }
      if (r.orphan.length > 0) {
        console.warn(
          `[registry] ${r.orphan.length} orphan ID_COLUMNS entries (not declared in sheets.ts):`,
          r.orphan,
        );
      }
    }
    const e = envReport.current;
    if (!e.ok) {
      console.error(
        `[env] ${e.missingRequired.length} required workbook env var(s) missing:`,
        e.missingRequired.map(m => m.envVar),
      );
    }
  }, []);

  return (
    <SheetDataContext.Provider value={{ register, unregister, getSlot, refresh, refreshAll, updateRow, createRow, deleteRow, registryReport: registryReport.current, envReport: envReport.current }}>
      {children}
    </SheetDataContext.Provider>
  );
}

// ─── Internal hook (used by useModuleData) ────────────────────────────────────

export function useSheetDataContext(): ContextValue {
  const ctx = useContext(SheetDataContext);
  if (!ctx) throw new Error('useModuleData must be used inside <SheetDataProvider>');
  return ctx;
}

// Public hook for the admin banner / Schema Doctor page. Returns the
// drift report computed once at mount (see SheetDataProvider).
export function useRegistryReport(): RegistryReport {
  return useSheetDataContext().registryReport;
}

export function useEnvReport(): EnvReport {
  return useSheetDataContext().envReport;
}
