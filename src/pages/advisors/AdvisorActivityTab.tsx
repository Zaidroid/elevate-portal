// Read-only audit log of every change in the Advisors module. Filterable by
// action type and by advisor. Newest first.

import { useMemo, useState } from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState } from '../../lib/ui';
import type { Column, Tone } from '../../lib/ui';
import type { ActivityRow } from '../../types/advisor';
import type { EnrichedAdvisor } from './utils';

const ACTION_TONE: Record<string, Tone> = {
  status_change: 'orange',
  tracker_edit: 'teal',
  comment: 'amber',
  followup: 'neutral',
  score_recompute: 'neutral',
};

export function AdvisorActivityTab({
  activity,
  advisors,
  onOpenAdvisor,
}: {
  activity: ActivityRow[];
  advisors: EnrichedAdvisor[];
  onOpenAdvisor: (a: EnrichedAdvisor) => void;
}) {
  const [actionFilter, setActionFilter] = useState<string>('all');

  const advByKey = useMemo(() => {
    const m = new Map<string, EnrichedAdvisor>();
    for (const a of advisors) m.set(a.advisor_id, a);
    return m;
  }, [advisors]);

  const sorted = useMemo(() => {
    return [...activity]
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .filter(a => actionFilter === 'all' || a.action === actionFilter);
  }, [activity, actionFilter]);

  const actionTypes = useMemo(() => {
    const set = new Set<string>();
    for (const a of activity) if (a.action) set.add(a.action);
    return Array.from(set).sort();
  }, [activity]);

  const columns: Column<ActivityRow>[] = [
    {
      key: 'timestamp',
      header: 'When',
      render: a => (
        <span className="font-mono text-xs text-slate-500">
          {(a.timestamp || '').slice(0, 19).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'user_email',
      header: 'Who',
      render: a => <span className="text-xs">{a.user_email || '—'}</span>,
    },
    {
      key: 'advisor_id',
      header: 'Advisor',
      render: a => {
        const adv = advByKey.get(a.advisor_id);
        return adv ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenAdvisor(adv); }}
            className="text-xs font-semibold text-brand-teal hover:underline"
          >
            {adv.full_name || adv.email || a.advisor_id}
          </button>
        ) : <span className="text-xs text-slate-400">{a.advisor_id || '—'}</span>;
      },
    },
    {
      key: 'action',
      header: 'Action',
      render: a => <Badge tone={ACTION_TONE[a.action] || 'neutral'}>{a.action || '—'}</Badge>,
    },
    {
      key: 'field',
      header: 'Field',
      render: a => <span className="font-mono text-xs">{a.field || '—'}</span>,
    },
    {
      key: 'new_value',
      header: 'Change',
      render: a => (
        <span className="text-xs">
          {a.old_value ? <span className="text-slate-400 line-through">{truncate(a.old_value, 24)}</span> : null}
          {a.old_value && a.new_value ? <span className="mx-1">→</span> : null}
          <span className="font-semibold text-navy-500 dark:text-slate-200">{truncate(a.new_value, 32)}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip label={`All (${activity.length})`} active={actionFilter === 'all'} onClick={() => setActionFilter('all')} />
          {actionTypes.map(at => (
            <FilterChip
              key={at}
              label={`${at} (${activity.filter(a => a.action === at).length})`}
              active={actionFilter === at}
              onClick={() => setActionFilter(at)}
            />
          ))}
        </div>
      </Card>

      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ActivityIcon className="h-6 w-6" />}
            title="No activity yet"
            description="Every change in the Advisors module gets logged here."
          />
        </Card>
      ) : (
        <DataTable columns={columns} rows={sorted} />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-navy-500 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200 dark:hover:bg-navy-600'
      }`}
    >
      {label}
    </button>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
