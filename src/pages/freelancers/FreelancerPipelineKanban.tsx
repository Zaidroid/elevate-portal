// Pipeline kanban for ElevateBridge — wraps lib/ui/Kanban with the seven
// freelancer pipeline columns and a freelancer-specific summary card.

import { ArrowRight } from 'lucide-react';
import { Kanban, Badge } from '../../lib/ui';
import type { KanbanColumn, KanbanItem } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import {
  FL_NEXT_ACTION,
  FL_PIPELINE_COLUMNS,
  flNormalizeStatus,
  type EnrichedFreelancer,
  type FreelancerPipelineId,
} from './utils';

type FlItem = KanbanItem<FreelancerPipelineId> & {
  freelancer: EnrichedFreelancer;
};

const TONE_MAP: Record<string, Tone> = {
  slate: 'neutral',
  navy: 'neutral',
  red: 'red',
  teal: 'teal',
  orange: 'orange',
  amber: 'amber',
  green: 'green',
};

export function FreelancerPipelineKanban({
  freelancers,
  onMove,
  onCardClick,
  readOnly = false,
}: {
  freelancers: EnrichedFreelancer[];
  onMove: (id: string, next: FreelancerPipelineId) => Promise<void>;
  onCardClick: (fl: EnrichedFreelancer) => void;
  readOnly?: boolean;
}) {
  const columns: KanbanColumn<FreelancerPipelineId>[] = FL_PIPELINE_COLUMNS.map(c => ({
    id: c.id,
    label: c.label,
    tone: TONE_MAP[c.tone] || 'neutral',
  }));

  const items: FlItem[] = freelancers
    .filter(fl => fl.status !== 'Archived')
    .map(fl => ({
      id: fl.freelancer_id,
      status: flNormalizeStatus(fl.status),
      freelancer: fl,
    }));

  return (
    <Kanban<FreelancerPipelineId, FlItem>
      columns={columns}
      items={items}
      readOnly={readOnly}
      onStatusChange={(id, next) => onMove(id, next)}
      onCardClick={item => onCardClick(item.freelancer)}
      renderCard={item => <FreelancerCard freelancer={item.freelancer} />}
      emptyHint="Drop a freelancer card here"
    />
  );
}

function FreelancerCard({ freelancer }: { freelancer: EnrichedFreelancer }) {
  const status = flNormalizeStatus(freelancer.status);
  const next = FL_NEXT_ACTION[status];
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-navy-500 dark:text-white">
            {freelancer.full_name || '(unnamed)'}
          </div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {[freelancer.track, freelancer.role_profile].filter(Boolean).join(' · ')}
          </div>
        </div>
        {freelancer.matched_company_name && (
          <Badge tone="teal">{freelancer.matched_company_name}</Badge>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{freelancer.location || '—'}</span>
        <span>{freelancer.assignee_email ? `→ ${freelancer.assignee_email.split('@')[0]}` : 'unassigned'}</span>
      </div>
      {freelancer.is_stuck && (
        <Badge tone="red">Stuck {freelancer.days_in_status}d</Badge>
      )}
      {next && (
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:border-navy-700 dark:bg-navy-700 dark:text-slate-300">
          <ArrowRight className="h-3 w-3" />
          <span className="truncate">{next.label}</span>
        </div>
      )}
      {(freelancer.open_followups > 0 || freelancer.overdue_followups > 0) && (
        <div className="flex flex-wrap gap-1">
          {freelancer.overdue_followups > 0 && (
            <Badge tone="red">{freelancer.overdue_followups} overdue</Badge>
          )}
          {freelancer.open_followups - freelancer.overdue_followups > 0 && (
            <Badge tone="orange">{freelancer.open_followups - freelancer.overdue_followups} open</Badge>
          )}
        </div>
      )}
    </div>
  );
}
