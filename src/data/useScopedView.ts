// useScopedView — generic 'mine' / 'all' toggle for AM-scoped views.
// Persists the selected scope in the URL query string (?scope=mine|all)
// so navigating away and back keeps the user's preference, and so a
// link to "/my-hub?scope=all" is shareable.
//
// Default rule: AMs (profile_manager tier or member tier) default to
// 'mine'; admins / leadership default to 'all'. Callers can override
// the default by passing `defaultScope`.

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getTier, isAdmin, isLeadership } from '../config/team';

export type Scope = 'mine' | 'all';

export type ScopedView<T> = {
  scope: Scope;
  setScope: (next: Scope) => void;
  scoped: T[];
  /** Total rows the user owns regardless of current scope. */
  mineCount: number;
  /** Total rows in the source list. */
  totalCount: number;
};

function defaultScopeFor(email: string): Scope {
  if (isAdmin(email) || isLeadership(email)) return 'all';
  const tier = getTier(email);
  if (tier === 'profile_manager' || tier === 'member') return 'mine';
  return 'all';
}

export function useScopedView<T>(
  rows: T[],
  ownerOf: (row: T) => string,
  currentUserEmail: string,
): ScopedView<T> {
  const [params, setParams] = useSearchParams();
  const fallback = defaultScopeFor(currentUserEmail);
  const scope: Scope = (params.get('scope') as Scope) || fallback;

  const setScope = useCallback(
    (next: Scope) => {
      const p = new URLSearchParams(params);
      if (next === fallback) p.delete('scope');
      else p.set('scope', next);
      setParams(p, { replace: true });
    },
    [params, setParams, fallback],
  );

  const me = (currentUserEmail || '').toLowerCase();

  const { mineCount, scoped } = useMemo(() => {
    let mc = 0;
    const mineRows: T[] = [];
    for (const r of rows) {
      const owner = (ownerOf(r) || '').toLowerCase();
      if (owner && owner === me) {
        mc += 1;
        mineRows.push(r);
      }
    }
    return {
      mineCount: mc,
      scoped: scope === 'mine' ? mineRows : rows,
    };
  }, [rows, ownerOf, me, scope]);

  return { scope, setScope, scoped, mineCount, totalCount: rows.length };
}
