import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { Badge } from './Badge';
import type { Tone } from './Badge';

// Generic kanban surface.
//
// Items are keyed by `id` and bucketed by `status`. Dropping a card onto another
// column calls `onStatusChange(id, newStatus)` — the caller is responsible for
// persisting that change (useSheetDoc.updateRow). Cards are rendered via the
// `renderCard` prop so each module can show its own summary.
//
// Columns can be hidden at read-time via `columns[].hidden` or collapsed with
// local state. Empty columns still accept drops so the board always resolves to
// a canonical set of statuses.

export type KanbanColumn<S extends string> = {
  id: S;
  label: string;
  tone?: Tone;
  description?: string;
  hidden?: boolean;
  accent?: string; // optional border/top color class
};

export type KanbanItem<S extends string> = {
  id: string;
  status: S;
  // Any extra data the card renderer needs.
  [k: string]: unknown;
};

export type KanbanProps<S extends string, T extends KanbanItem<S>> = {
  columns: KanbanColumn<S>[];
  items: T[];
  onStatusChange: (id: string, newStatus: S) => void | Promise<void>;
  renderCard: (item: T) => ReactNode;
  onCardClick?: (item: T) => void;
  columnAggregate?: (items: T[]) => ReactNode;
  readOnly?: boolean;
  emptyHint?: string;
  className?: string;
};

export function Kanban<S extends string, T extends KanbanItem<S>>({
  columns,
  items,
  onStatusChange,
  renderCard,
  onCardClick,
  columnAggregate,
  readOnly = false,
  emptyHint = 'Drop cards here',
  className = '',
}: KanbanProps<S, T>) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<S | null>(null);

  const visibleCols = useMemo(() => columns.filter(c => !c.hidden), [columns]);
  const grouped = useMemo(() => {
    const m: Record<string, T[]> = {};
    for (const c of visibleCols) m[c.id] = [];
    for (const it of items) {
      if (m[it.status]) m[it.status].push(it);
      // Silently drop items whose status is not in the visible column set.
    }
    return m;
  }, [items, visibleCols]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (readOnly) return;
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, [readOnly]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, status: S) => {
    if (readOnly) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(status);
  }, [readOnly]);

  const handleDrop = useCallback(
    async (e: React.DragEvent, newStatus: S) => {
      if (readOnly) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      setDraggedId(null);
      setDropTarget(null);
      if (!id) return;
      const item = items.find(i => i.id === id);
      if (!item || item.status === newStatus) return;
      await onStatusChange(id, newStatus);
    },
    [items, onStatusChange, readOnly]
  );

  return (
    <div className={`overflow-x-auto pb-4 ${className}`}>
      <div className="flex min-w-max gap-3">
        {visibleCols.map(col => {
          const colItems = grouped[col.id] || [];
          const isActive = dropTarget === col.id;
          return (
            <div
              key={col.id}
              className={`flex max-h-[70vh] w-[280px] flex-shrink-0 flex-col rounded-2xl border bg-slate-50 transition-colors dark:bg-navy-700 ${
                isActive
                  ? 'border-brand-teal bg-brand-teal/5'
                  : 'border-slate-200 dark:border-navy-600'
              } ${col.accent || ''}`}
              onDragOver={e => handleDragOver(e, col.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => handleDrop(e, col.id)}
            >
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-navy-600">
                <div className="flex min-w-0 items-center gap-2">
                  {col.tone && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotTone(col.tone)}`} />}
                  <span className="truncate text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-slate-100">
                    {col.label}
                  </span>
                  <Badge tone={colItems.length > 0 ? col.tone || 'neutral' : 'neutral'}>
                    {colItems.length}
                  </Badge>
                </div>
                {columnAggregate && (
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                    {columnAggregate(colItems)}
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {colItems.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-slate-400 dark:text-slate-500">
                    {emptyHint}
                  </div>
                ) : (
                  colItems.map(item => (
                    <div
                      key={item.id}
                      draggable={!readOnly}
                      onDragStart={e => handleDragStart(e, item.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onCardClick?.(item)}
                      className={`group cursor-grab rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-brand-teal hover:shadow-md active:cursor-grabbing dark:border-navy-600 dark:bg-navy-600 ${
                        draggedId === item.id ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        {!readOnly && (
                          <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                        <div className="min-w-0 flex-1">{renderCard(item)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function dotTone(tone: Tone): string {
  switch (tone) {
    case 'red':
      return 'bg-brand-red';
    case 'teal':
      return 'bg-brand-teal';
    case 'orange':
      return 'bg-brand-orange';
    case 'green':
      return 'bg-emerald-500';
    case 'amber':
      return 'bg-amber-500';
    default:
      return 'bg-slate-400';
  }
}
