/**
 * useModuleData — Page-level data hook routing through the centralized
 * SheetDataProvider. Replaced an older per-tab hook (`useSheetDoc`,
 * deleted May 2026) that created independent poll loops; the migration
 * to this central pattern reduced quota cost ~40× (see SheetDataProvider
 * doc-block for numbers).
 *
 * Usage:
 *   const { rows, loading, error, updateRow, createRow } = useModuleData<MyType>(
 *     'companies', 'assignments'
 *   );
 *
 * The hook registers the DataKey with the provider on mount and unregisters
 * on unmount. Data stays cached in memory between navigations.
 */

import { useEffect, useCallback } from 'react';
import { useState } from 'react';
import { makeKey } from './registry';
import { useSheetDataContext } from './SheetDataProvider';

export function useModuleData<T extends Record<string, string | undefined>>(
  module: string,
  tab: string
) {
  const key = makeKey(module, tab);
  const ctx = useSheetDataContext();

  // Register/unregister lifecycle.
  useEffect(() => {
    ctx.register(key);
    return () => ctx.unregister(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to slot changes via a local state mirror.
  const [slot, setSlot] = useState(() => ctx.getSlot(key));

  useEffect(() => {
    // Poll the context slot every 500 ms so we react to provider updates.
    // This is cheap — it's just a JS object comparison, no network call.
    const id = setInterval(() => {
      const current = ctx.getSlot(key);
      setSlot(prev => {
        // Shallow-compare: only trigger re-render when something changed.
        if (
          prev.rows === current.rows &&
          prev.loading === current.loading &&
          prev.error === current.error
        ) {
          return prev;
        }
        return current;
      });
    }, 500);
    return () => clearInterval(id);
  }, [key, ctx]);

  const updateRow = useCallback(
    (id: string, updates: Partial<T>) => ctx.updateRow(key, id, updates as Partial<Record<string, string>>),
    [key, ctx]
  );

  const createRow = useCallback(
    (row: Partial<T>) => ctx.createRow(key, row as Partial<Record<string, string>>),
    [key, ctx]
  );

  const deleteRow = useCallback(
    (id: string) => ctx.deleteRow(key, id),
    [key, ctx]
  );

  const refresh = useCallback(() => ctx.refresh(key), [key, ctx]);

  return {
    rows: slot.rows as T[],
    headers: slot.headers,
    loading: slot.loading,
    error: slot.error,
    updateRow,
    createRow,
    deleteRow,
    refresh,
  };
}
