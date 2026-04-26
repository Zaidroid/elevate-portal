// Pipeline kanban view. Wraps lib/ui/Kanban with the 10 advisor pipeline
// statuses and an advisor-summary card. Drag = updateRow(pipeline_status).

import { Kanban, Badge } from '../../lib/ui';
import type { KanbanColumn, KanbanItem } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { CATEGORY_META, PIPELINE_COLUMNS } from '../../lib/advisor-scoring';
import type { AdvisorPipelineId } from '../../lib/advisor-scoring';
import type { EnrichedAdvisor } from './utils';

type AdvItem = KanbanItem<AdvisorPipelineId> & {
  advisor: EnrichedAdvisor;
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

export function AdvisorPipelineKanban({
  advisors,
  onMove,
  onCardClick,
  readOnly = false,
}: {
  advisors: EnrichedAdvisor[];
  onMove: (advisorId: string, next: AdvisorPipelineId) => Promise<void>;
  onCardClick: (advisor: EnrichedAdvisor) => void;
  readOnly?: boolean;
}) {
  const columns: KanbanColumn<AdvisorPipelineId>[] = PIPELINE_COLUMNS.map(c => ({
    id: c.id,
    label: c.label,
    tone: TONE_MAP[c.tone] || 'neutral',
    description: c.id === 'on_hold' ? 'Idle — review weekly' : undefined,
  }));

  const items: AdvItem[] = advisors.map(a => ({
    id: a.advisor_id,
    status: (normalizeStatus(a.pipeline_status) as AdvisorPipelineId),
    advisor: a,
  }));

  return (
    <Kanban<AdvisorPipelineId, AdvItem>
      columns={columns}
      items={items}
      readOnly={readOnly}
      onStatusChange={(id, next) => onMove(id, next)}
      onCardClick={item => onCardClick(item.advisor)}
      renderCard={item => <AdvisorCard advisor={item.advisor} />}
      emptyHint="Drop an advisor card here"
    />
  );
}

function AdvisorCard({ advisor }: { advisor: EnrichedAdvisor }) {
  const cat = CATEGORY_META[advisor.stage2.primary] || CATEGORY_META.Unqualified;
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-navy-500 dark:text-white">
            {advisor.full_name || '(unnamed)'}
          </div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {[advisor.position, advisor.employer].filter(Boolean).join(' @ ')}
          </div>
        </div>
        <Badge tone={catTone(cat.tone)}>{cat.label}</Badge>
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{advisor.country || '—'}</span>
        <span className="font-mono">S1 {advisor.stage1.total}</span>
      </div>
      {(advisor.open_followups > 0 || advisor.overdue_followups > 0) && (
        <div className="flex flex-wrap gap-1">
          {advisor.overdue_followups > 0 && (
            <Badge tone="red">{advisor.overdue_followups} overdue</Badge>
          )}
          {advisor.open_followups - advisor.overdue_followups > 0 && (
            <Badge tone="orange">{advisor.open_followups - advisor.overdue_followups} open</Badge>
          )}
        </div>
      )}
    </div>
  );
}

function catTone(tone: string): Tone {
  return TONE_MAP[tone] || 'neutral';
}

const STATUS_NORMALIZE: Record<string, AdvisorPipelineId> = {
  new: 'new',
  acknowledged: 'acknowledged',
  allocated: 'allocated',
  'intro scheduled': 'intro_sched',
  intro_sched: 'intro_sched',
  'intro done': 'intro_done',
  intro_done: 'intro_done',
  assessment: 'assessment',
  approved: 'approved',
  matched: 'matched',
  'on hold': 'on_hold',
  on_hold: 'on_hold',
  rejected: 'rejected',
};

function normalizeStatus(s: string | undefined): AdvisorPipelineId {
  return STATUS_NORMALIZE[(s || '').toLowerCase().trim()] || 'new';
}
