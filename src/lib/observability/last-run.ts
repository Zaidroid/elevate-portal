/**
 * last-run — tiny pub/sub store for background-task status pills.
 *
 * Every background task that runs invisibly (autopilot, the 120s data poll,
 * advisor auto-import, advisor auto-dedupe, etc.) calls `recordRun()` on
 * each cycle. The footer pill in AppShell subscribes via `useLastRuns()`
 * and shows aggregate status, so a partial failure can no longer hide
 * behind a console.warn.
 *
 * This module is the canonical answer to the team rule
 *   "every background task needs a visible last-run status pill".
 */
import { useEffect, useState } from 'react';

export type RunOutcome = 'ok' | 'partial' | 'fail';

export interface LastRun {
  taskName: string;
  ranAt: number;        // epoch ms
  outcome: RunOutcome;
  ok: number;           // successful items
  fail: number;         // failed items
  message?: string;     // short human-friendly summary
  error?: string;       // first error message (if any)
}

type Listener = () => void;

const runs = new Map<string, LastRun>();
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn();
}

export function recordRun(taskName: string, partial: Omit<LastRun, 'taskName' | 'ranAt'>): void {
  // Short-circuit identical re-fires. If the same task fires the same
  // outcome/error/message we keep the original `ranAt` (which means
  // the pill's relative-time will tick forward — "just now" → "5 min
  // ago" → "30 min ago" — communicating *persistent* failure rather
  // than constantly resetting to "just now" on every poll cycle).
  // This was hitting hard on missing-tab entries from the 120 s data
  // poll and from the tab-missing branch in client.ts.
  const prev = runs.get(taskName);
  if (prev
    && prev.outcome === partial.outcome
    && prev.error === partial.error
    && prev.message === partial.message
    && prev.ok === partial.ok
    && prev.fail === partial.fail
  ) {
    return;
  }

  const entry: LastRun = {
    taskName,
    ranAt: Date.now(),
    ...partial,
  };
  runs.set(taskName, entry);
  notify();
}

export function getRuns(): LastRun[] {
  return Array.from(runs.values()).sort((a, b) => b.ranAt - a.ranAt);
}

export function useLastRuns(): LastRun[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion(v => v + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  // Reading runs through the version dependency keeps the snapshot stable
  // across renders that didn't trigger a notify.
  void version;
  return getRuns();
}

/** Compose an outcome from ok/fail counts. */
export function outcomeFor(ok: number, fail: number): RunOutcome {
  if (fail === 0 && ok === 0) return 'ok';
  if (fail === 0) return 'ok';
  if (ok === 0) return 'fail';
  return 'partial';
}

/** Worst outcome across multiple runs (for the aggregate pill). */
export function worstOutcome(rs: LastRun[]): RunOutcome {
  if (rs.some(r => r.outcome === 'fail')) return 'fail';
  if (rs.some(r => r.outcome === 'partial')) return 'partial';
  return 'ok';
}

/** Format epoch-ms as relative ("2 min ago"). */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
