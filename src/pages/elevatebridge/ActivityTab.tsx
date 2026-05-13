// Activity tab — unified append-only audit trail. Merges the
// ElevateBridge programme workbook's ActivityLog with the freelancers
// (matching) workbook's ActivityLog so admins see one timeline across
// scoring, decisions, capacity changes, kanban moves, and follow-ups.

import { useMemo } from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { Badge, Card, EmptyState } from '../../lib/ui';
import type { EbActivity } from '../../types/elevateBridge';
import type { FreelancerActivity } from '../../types/freelancer';

type UnifiedRow = {
  id: string;
  source: 'programme' | 'matching';
  timestamp: string;
  user_email: string;
  entity_type: string;
  entity_id: string;
  action: string;
  field: string;
  old_value: string;
  new_value: string;
  details: string;
};

type Props = {
  rows: EbActivity[];
  freelancerRows?: FreelancerActivity[];
};

const ACTION_LABEL: Record<string, string> = {
  applicant_updated: 'Applicant updated',
  decision_changed: 'Decision changed',
  score_edited: 'Score edited',
  interview_scored: 'Interview scored',
  session_created: 'Session created',
  session_updated: 'Session updated',
  attendance_marked: 'Attendance marked',
  mentor_updated: 'Mentor updated',
  rubric_updated: 'Rubric updated',
  top_performer_updated: 'Top performer updated',
  import_external: 'External import',
  export: 'Export',
};

export function ActivityTab({ rows, freelancerRows = [] }: Props) {
  const unified = useMemo<UnifiedRow[]>(() => {
    const programme: UnifiedRow[] = rows.map(r => ({
      id: `eb-${r.activity_id}`,
      source: 'programme',
      timestamp: r.timestamp || '',
      user_email: r.user_email || '',
      entity_type: r.entity_type || '',
      entity_id: r.entity_id || '',
      action: r.action || '',
      field: r.field || '',
      old_value: r.old_value || '',
      new_value: r.new_value || '',
      details: r.details || '',
    }));
    const matching: UnifiedRow[] = freelancerRows.map(r => ({
      id: `fl-${r.activity_id}`,
      source: 'matching',
      timestamp: r.timestamp || '',
      user_email: r.user_email || '',
      entity_type: 'freelancer',
      entity_id: r.freelancer_id || '',
      action: r.action || '',
      field: r.field || '',
      old_value: r.old_value || '',
      new_value: r.new_value || '',
      details: r.details || '',
    }));
    return [...programme, ...matching].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [rows, freelancerRows]);

  if (unified.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ActivityIcon className="h-6 w-6" />}
          title="No activity yet"
          description="Decisions, score edits, session updates, attendance marks, and matching kanban moves all appear here."
        />
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="divide-y divide-slate-100 dark:divide-navy-700">
        {unified.map(r => (
          <div key={r.id} className="flex items-start gap-3 px-4 py-3">
            <div className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${r.source === 'matching' ? 'bg-brand-orange' : 'bg-brand-teal'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge tone={r.source === 'matching' ? 'orange' : 'teal'}>{r.source}</Badge>
                <span className="font-semibold text-navy-500 dark:text-white">
                  {ACTION_LABEL[r.action] || r.action}
                </span>
                {r.field && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">· {r.field}</span>
                )}
                {(r.old_value || r.new_value) && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {r.old_value ? <span className="text-brand-red line-through">{r.old_value}</span> : null}
                    {r.old_value && r.new_value && ' → '}
                    {r.new_value && <span className="text-brand-teal">{r.new_value}</span>}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {r.user_email || 'system'} · {r.entity_type || ''} {r.entity_id ? `· ${r.entity_id}` : ''}
                {r.details ? ` · ${r.details}` : ''}
              </div>
            </div>
            <div className="flex-shrink-0 text-[10px] tabular-nums text-slate-400">
              {r.timestamp ? new Date(r.timestamp).toLocaleString() : ''}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
