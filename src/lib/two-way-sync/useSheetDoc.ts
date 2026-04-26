import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendRows,
  deleteSheetRow,
  fetchRange,
  pollRange,
  tabExists,
  updateRange,
} from '../sheets';

// useSheetDoc<T> — two-way sync hook for a single tab.
//
// Source of truth is the sheet. Local state mirrors rows, polling refreshes
// every intervalMs. Writes are optimistic: local state updates immediately,
// then the sheet write fires; on failure the row reverts and the caller gets an
// error.
//
// Conflict policy: before each write the hook re-reads the target row from the
// sheet and compares its updated_at with the value we loaded. If they differ,
// it throws SheetConflictError so the UI can prompt the user. The row is
// resolved by its key column value, not by cached row index, so inserts or
// deletes by other users between polls cannot corrupt the wrong row.

export type Row = Record<string, string>;

export type UseSheetDocOptions = {
  intervalMs?: number;
  valueRender?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  userEmail?: string;
};

export type UseSheetDocResult<T extends Row> = {
  rows: T[];
  headers: string[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  updateRow: (key: string, updates: Partial<T>) => Promise<void>;
  createRow: (row: Partial<T>) => Promise<void>;
  deleteRow: (key: string) => Promise<void>;
};

export class SheetConflictError extends Error {
  serverRow: Row;
  localRow: Row;
  updates: Row;
  constructor(serverRow: Row, localRow: Row, updates: Row) {
    super('Row was modified by another user since it was loaded');
    this.name = 'SheetConflictError';
    this.serverRow = serverRow;
    this.localRow = localRow;
    this.updates = updates;
  }
}

const DEFAULT_INTERVAL = 30_000;

function colLetter(index: number): string {
  // 0-based to A1 column letter
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function rowsToObjects<T extends Row>(headers: string[], data: string[][]): T[] {
  return data.map(r => {
    const obj: Row = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? '';
    });
    return obj as T;
  });
}

function objectToRow(headers: string[], obj: Row): string[] {
  return headers.map(h => obj[h] ?? '');
}

// Re-read the tab and locate the target row by its key column. Returns the
// 1-based row number and the current values. Null if the key is gone.
async function resolveRow(
  sheetId: string,
  tabName: string,
  rowKey: string,
  keyValue: string
): Promise<{ rowNumber: number; current: Row; headers: string[] } | null> {
  const data = await fetchRange(sheetId, `${tabName}!A:ZZ`);
  if (data.length === 0) return null;
  const hdrs = data[0];
  const keyIdx = hdrs.indexOf(rowKey);
  if (keyIdx < 0) {
    throw new Error(`Row key column '${rowKey}' not found in '${tabName}' headers`);
  }
  for (let i = 1; i < data.length; i++) {
    if ((data[i][keyIdx] ?? '') === keyValue) {
      const obj: Row = {};
      hdrs.forEach((h, j) => {
        obj[h] = data[i][j] ?? '';
      });
      return { rowNumber: i + 1, current: obj, headers: hdrs };
    }
  }
  return null;
}

export function useSheetDoc<T extends Row>(
  sheetId: string | null,
  tabName: string,
  rowKey: keyof T & string,
  options: UseSheetDocOptions = {}
): UseSheetDocResult<T> {
  const { intervalMs = DEFAULT_INTERVAL, valueRender, userEmail } = options;
  const [rows, setRows] = useState<T[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(!!sheetId);
  const [error, setError] = useState<Error | null>(null);

  const stateRef = useRef({ rows, headers });
  stateRef.current = { rows, headers };

  const range = useMemo(() => `${tabName}!A:ZZ`, [tabName]);

  const applyData = useCallback((data: string[][]) => {
    if (data.length === 0) {
      setHeaders([]);
      setRows([]);
      return;
    }
    const [header, ...body] = data;
    setHeaders(header);
    setRows(rowsToObjects<T>(header, body));
  }, []);

  const refresh = useCallback(async () => {
    if (!sheetId) return;
    try {
      const data = await fetchRange(sheetId, range, { valueRender });
      applyData(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    }
  }, [sheetId, range, valueRender, applyData]);

  useEffect(() => {
    if (!sheetId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const exists = await tabExists(sheetId, tabName);
      if (cancelled) return;
      if (!exists) {
        console.warn(`[sheets] Tab "${tabName}" not found in ${sheetId} — skipping poll.`);
        setHeaders([]);
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }
      unsubscribe = pollRange(
        sheetId,
        range,
        intervalMs,
        data => {
          if (cancelled) return;
          applyData(data);
          setError(null);
          setLoading(false);
        },
        err => {
          if (cancelled) return;
          setError(err as Error);
          setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [sheetId, tabName, range, intervalMs, applyData]);

  const updateRow = useCallback(
    async (key: string, updates: Partial<T>) => {
      if (!sheetId) throw new Error('No sheet configured');
      const { rows: current, headers: hdrs } = stateRef.current;
      if (hdrs.length === 0) throw new Error('Sheet headers not loaded yet');

      const localIdx = current.findIndex(r => r[rowKey] === key);
      if (localIdx < 0) throw new Error(`Row not found in local state: ${rowKey}=${key}`);
      const localRow = current[localIdx];

      const now = new Date().toISOString();

      // Apply the optimistic update FIRST, before any network call, so the UI
      // reflects the change instantly. We roll this back if the server write
      // fails. Without this, dragging a kanban card freezes for the duration
      // of the resolveRow + updateRange round-trip (often >1s on a cold sheet).
      const optimistic: T = {
        ...localRow,
        ...updates,
        ...(hdrs.includes('updated_at') ? { updated_at: now } : {}),
        ...(hdrs.includes('updated_by') && userEmail ? { updated_by: userEmail } : {}),
      } as T;
      const prevRows = current;
      const nextRows = [...current];
      nextRows[localIdx] = optimistic;
      setRows(nextRows);

      try {
        // Resolve the row on the server by key, not by cached index. This
        // survives inserts/deletes other users made between polls.
        const resolved = await resolveRow(sheetId, tabName, rowKey, key);
        if (!resolved) {
          throw new Error(`Row ${key} no longer exists on the sheet`);
        }

        // Conflict check: if updated_at on the server differs from what we
        // loaded, reject the write. Callers can catch SheetConflictError.
        if (
          resolved.headers.includes('updated_at') &&
          resolved.current.updated_at &&
          localRow.updated_at &&
          resolved.current.updated_at !== localRow.updated_at
        ) {
          throw new SheetConflictError(resolved.current, localRow, updates as Row);
        }

        // Re-merge against the server-resolved shape so we do not drop fields
        // that exist on the server but not in our local cache.
        const merged: T = {
          ...resolved.current,
          ...updates,
          ...(resolved.headers.includes('updated_at') ? { updated_at: now } : {}),
          ...(resolved.headers.includes('updated_by') && userEmail ? { updated_by: userEmail } : {}),
        } as T;

        // Reflect the server-resolved shape in local state (replaces the
        // optimistic merge that may have been missing server-only fields).
        const reconciled = [...stateRef.current.rows];
        const reIdx = reconciled.findIndex(r => r[rowKey] === key);
        if (reIdx >= 0) {
          reconciled[reIdx] = merged;
          setRows(reconciled);
        }

        const lastCol = colLetter(resolved.headers.length - 1);
        const a1 = `${tabName}!A${resolved.rowNumber}:${lastCol}${resolved.rowNumber}`;
        await updateRange(sheetId, a1, [objectToRow(resolved.headers, merged)]);
      } catch (err) {
        setRows(prevRows);
        throw err;
      }
    },
    [sheetId, tabName, rowKey, userEmail]
  );

  const createRow = useCallback(
    async (row: Partial<T>) => {
      if (!sheetId) throw new Error('No sheet configured');
      const { rows: current, headers: hdrs } = stateRef.current;
      if (hdrs.length === 0) throw new Error('Sheet headers not loaded yet');

      const now = new Date().toISOString();
      const complete: T = {
        ...row,
        ...(hdrs.includes('created_at') ? { created_at: now } : {}),
        ...(hdrs.includes('updated_at') ? { updated_at: now } : {}),
        ...(hdrs.includes('updated_by') && userEmail ? { updated_by: userEmail } : {}),
      } as T;

      const prevRows = current;
      setRows([...current, complete]);

      try {
        await appendRows(sheetId, `${tabName}!A:A`, [objectToRow(hdrs, complete)]);
        await refresh();
      } catch (err) {
        setRows(prevRows);
        throw err;
      }
    },
    [sheetId, tabName, userEmail, refresh]
  );

  const deleteRow = useCallback(
    async (key: string) => {
      if (!sheetId) throw new Error('No sheet configured');
      const { rows: current, headers: hdrs } = stateRef.current;
      if (hdrs.length === 0) throw new Error('Sheet headers not loaded yet');

      const resolved = await resolveRow(sheetId, tabName, rowKey, key);
      if (!resolved) {
        setRows(current.filter(r => r[rowKey] !== key));
        return;
      }

      const prevRows = current;
      setRows(current.filter(r => r[rowKey] !== key));

      try {
        await deleteSheetRow(sheetId, tabName, resolved.rowNumber);
      } catch (err) {
        setRows(prevRows);
        throw err;
      }
    },
    [sheetId, tabName, rowKey]
  );

  return { rows, headers, loading, error, refresh, updateRow, createRow, deleteRow };
}
