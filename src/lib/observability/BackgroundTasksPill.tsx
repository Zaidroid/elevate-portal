/**
 * BackgroundTasksPill — fixed-position health indicator for background tasks.
 *
 * Subscribes to the last-run store. Aggregates outcomes across all tasks
 * and shows:
 *   - green dot + "synced Xs ago" when everything is OK
 *   - amber dot + "N task(s) partial" when any task partially failed
 *   - red dot + "N task(s) failed" when any task fully failed
 *
 * Click to expand a small popover listing each task's last run.
 *
 * Stays out of the way: low-saturation, single-line, fixed bottom-right.
 */
import { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useLastRuns, worstOutcome, relativeTime } from './last-run';

export function BackgroundTasksPill() {
  const runs = useLastRuns();
  const [expanded, setExpanded] = useState(false);
  const [, force] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Tick once a minute so the relative time stays fresh.
  useEffect(() => {
    const id = window.setInterval(() => force(v => v + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Click-outside to close the popover.
  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [expanded]);

  if (runs.length === 0) return null;

  const worst = worstOutcome(runs);
  const failedTasks = runs.filter(r => r.outcome === 'fail').length;
  const partialTasks = runs.filter(r => r.outcome === 'partial').length;

  const dotColor =
    worst === 'fail' ? 'bg-red-500'
    : worst === 'partial' ? 'bg-amber-500'
    : 'bg-emerald-500';

  const label =
    worst === 'fail' ? `${failedTasks} task${failedTasks === 1 ? '' : 's'} failed`
    : worst === 'partial' ? `${partialTasks} task${partialTasks === 1 ? '' : 's'} partial`
    : `synced ${relativeTime(runs[0].ranAt)}`;

  const Icon = worst === 'ok' ? CheckCircle2 : worst === 'partial' ? Activity : AlertTriangle;

  return (
    <div className="fixed bottom-3 right-3 z-50">
      {expanded && (
        <div
          ref={popoverRef}
          className="mb-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-navy-700 dark:bg-navy-700"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
              Background tasks
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            {runs.map(r => (
              <div key={r.taskName} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-navy-500 dark:text-white">
                    {r.taskName}
                  </div>
                  {r.message && (
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {r.message}
                    </div>
                  )}
                  {r.error && (
                    <div className="truncate text-[11px] text-red-600 dark:text-red-400" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      r.outcome === 'fail' ? 'bg-red-500'
                      : r.outcome === 'partial' ? 'bg-amber-500'
                      : 'bg-emerald-500'
                    }`}
                  />
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {relativeTime(r.ranAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => setExpanded(v => !v)}
        title="Background tasks"
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow-sm hover:border-slate-300 hover:text-navy-500 dark:border-navy-700 dark:bg-navy-700 dark:text-slate-300 dark:hover:text-white"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </button>
    </div>
  );
}
