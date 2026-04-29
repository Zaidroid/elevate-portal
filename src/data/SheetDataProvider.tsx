/**
 * SheetDataProvider — Centralised data layer for the Elevate Portal.
 *
 * PROBLEM IT SOLVES
 * ─────────────────
 * The old pattern had each page create its own `useSheetDoc` hook with an
 * independent 30-second poll loop. With 69+ hooks across the app and 3 users,
 * the portal easily hit Google Sheets' 300-reads/min-per-project quota.
 *
 * HOW IT WORKS
 * ────────────
 * 1. Pages call `useModuleData(module, tab)` which registers a DataKey with
 *    this provider.
 * 2. Every 120 seconds (matching DEFAULT_INTERVAL in useSheetDoc) the provider
 *    groups all active keys by their workbook and fires ONE batchGet() per
 *    workbook instead of one request per tab.
 * 3. Results are cached in memory (cache.ts). Writes call invalidate() on the
 *    affected key so the next tick re-fetches fresh data.
 * 4. Polling pauses when the browser tab is hidden — same as pollRange() in
 *    client.ts.
 *
 * QUOTA IMPACT
 * ────────────
 * Before: ~69 reads every 30 s = 138 reads/min per user.
 * After:  ~6 batchGet calls every 120 s = ~3 reads/min per user.
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
import { batchGet, appendRows, fetchRange } from '../lib/sheets/client';
import { makeKey, groupBySheet, resolveRange } from './registry';
import { getCached, setCache, invalidate } from './cache';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Row = Record<string, string>;

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
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
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

    for (const [sheetId, entries] of bySheet.entries()) {
      // Build ranges — check cache first to skip unnecessary API calls.
      const toFetch = entries.filter(e => !getCached(makeKey(...(e.key.split('::') as [string, string])).split('::') as unknown as string));

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
      } catch (err) {
        toFetch.forEach(e => patchSlot(e.key, { loading: false, error: err as Error }));
      }
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
      const rowValues = [headers.map(h => merged[h] ?? '')];

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${tab}!A${targetRow}`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('google_access_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: rowValues }),
        }
      );

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

  return (
    <SheetDataContext.Provider value={{ register, unregister, getSlot, refresh, refreshAll, updateRow, createRow }}>
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
