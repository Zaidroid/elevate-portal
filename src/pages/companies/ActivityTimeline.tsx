// Per-company / global activity timeline. Reads the Activity Log
// tab (auto-created on first mount via ensureSchema) and renders the
// most recent rows first with a small action chip + field old → new
// summary. Used in CompanyDetailPage's Activity tab and inline in the
// Final Decision view's row drill-down.

import { useMemo } from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { Card, EmptyState } from '../../lib/ui';
import { displayName } from '../../config/team';
import type { ActivityRow } from './reviewTypes';

type ActivityTone = 'green' | 'red' | 'amber' | 'orange' | 'teal' | 'navy' | 'purple' | 'slate';

const ACTION_TONE: Record<string, ActivityTone> = {
  finalize_locked: 'green',
  review_saved: 'teal',
  comment_added: 'navy',
  pm_assigned: 'purple',
  alias_create: 'amber',
  alias_update: 'amber',
  alias_clear: 'slate',
  company_removed: 'red',
  company_restored: 'teal',
  materialize: 'orange',
  dashboard_repair: 'slate',
  export: 'navy',
  auto_dedupe: 'slate',
  import_external: 'purple',
  pre_decision_added: 'purple',
};

const ACTION_LABEL: Record<string, string> = {
  finalize_locked: 'Locked decision',
  review_saved: 'Saved review',
  comment_added: 'Added comment',
  pm_assigned: 'Assigned PM',
  alias_create: 'Created alias',
  alias_update: 'Updated alias',
  alias_clear: 'Cleared alias',
  company_removed: 'Removed company',
  company_restored: 'Restored company',
  materialize: 'Materialized interventions',
  dashboard_repair: 'Repaired dashboard',
  export: 'Exported review',
  auto_dedupe: 'Auto-deduped',
  import_external: 'Imported external',
  pre_decision_added: 'Added recommendation',
};

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function ActivityTimeline({
  rows,
  companyId,
  loading,
  limit = 200,
  emptyText,
}: {
  rows: ActivityRow[];
  companyId?: string;
  loading?: boolean;
  limit?: number;
  emptyText?: string;
}) {
  const filtered = useMemo(() => {
    let out = rows;
    if (companyId) out = out.filter(r => r.company_id === companyId);
    return out
      .slice()
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, limit);
  }, [rows, companyId, limit]);

  if (loading && filtered.length === 0) {
    return <Card><div className="text-sm text-slate-500">Loading activity…</div></Card>;
  }
  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={<ActivityIcon className="h-5 w-5" />}
        title="No activity yet"
        description={emptyText || 'Actions will appear here as the team makes changes.'}
      />
    );
  }

  return (
    <ol className="space-y-2">
      {filtered.map(r => {
        const tone = ACTION_TONE[r.action] || 'slate';
        const label = ACTION_LABEL[r.action] || r.action;
        return (
          <li
            key={r.activity_id}
            className="rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-navy-700 dark:bg-navy-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${toneClass(tone)}`}>
                  {label}
                </span>
                {r.user_email && (
                  <span className="font-bold text-navy-500 dark:text-slate-100">
                    {displayName(r.user_email)}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">{formatTime(r.timestamp)}</span>
            </div>
            {(r.field || r.old_value || r.new_value) && (
              <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                {r.field && <span className="mr-1 font-semibold">{r.field}:</span>}
                {r.old_value && <span className="line-through text-slate-400 mr-1">{r.old_value}</span>}
                {r.new_value && <span>{r.new_value}</span>}
              </div>
            )}
            {r.details && (
              <div className="mt-1 text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                {r.details}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Tailwind-only tone class matching the rest of the portal palette.
function toneClass(tone: ActivityTone): string {
  switch (tone) {
    case 'green': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'red':   return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
    case 'amber': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
    case 'orange':return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
    case 'teal':  return 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200';
    case 'navy':  return 'bg-navy-100 text-navy-800 dark:bg-navy-800 dark:text-slate-100';
    case 'purple':return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200';
    case 'slate':
    default:      return 'bg-slate-100 text-slate-800 dark:bg-navy-800 dark:text-slate-200';
  }
}
