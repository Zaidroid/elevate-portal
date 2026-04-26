// Follow-ups list across all advisors. Filter by status / overdue / assignee.
// Inline create form. Mark done flips status to "Done" and stamps completed_at.

import { useMemo, useState } from 'react';
import { Plus, Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import type { FollowUp } from '../../types/advisor';
import type { EnrichedAdvisor } from './utils';

type FollowUpFilter = 'all' | 'open' | 'overdue' | 'done' | 'snoozed';

const FOLLOWUP_TYPES = ['Email', 'Call', 'Meeting', 'Other'];

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function AdvisorFollowUpsTab({
  followups,
  advisors,
  userEmail,
  canEdit,
  onCreate,
  onMarkDone,
  onSnooze,
  onOpenAdvisor,
}: {
  followups: FollowUp[];
  advisors: EnrichedAdvisor[];
  userEmail: string;
  canEdit: boolean;
  onCreate: (fu: Partial<FollowUp>) => Promise<void>;
  onMarkDone: (id: string) => Promise<void>;
  onSnooze: (id: string) => Promise<void>;
  onOpenAdvisor: (advisor: EnrichedAdvisor) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [filter, setFilter] = useState<FollowUpFilter>('open');
  const [creating, setCreating] = useState(false);

  const advByKey = useMemo(() => {
    const m = new Map<string, EnrichedAdvisor>();
    for (const a of advisors) m.set(a.advisor_id, a);
    return m;
  }, [advisors]);

  const filtered = useMemo(() => {
    return followups
      .filter(f => {
        if (filter === 'all') return true;
        if (filter === 'overdue') return f.status === 'Open' && f.due_date && f.due_date < today;
        if (filter === 'done') return f.status === 'Done';
        if (filter === 'snoozed') return f.status === 'Snoozed';
        return f.status === 'Open';
      })
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  }, [followups, filter, today]);

  const counts = useMemo(() => ({
    open: followups.filter(f => f.status === 'Open').length,
    overdue: followups.filter(f => f.status === 'Open' && f.due_date && f.due_date < today).length,
    done: followups.filter(f => f.status === 'Done').length,
    snoozed: followups.filter(f => f.status === 'Snoozed').length,
  }), [followups, today]);

  const columns: Column<FollowUp>[] = [
    {
      key: 'advisor_id',
      header: 'Advisor',
      render: f => {
        const adv = advByKey.get(f.advisor_id);
        return adv ? (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenAdvisor(adv); }}
            className="font-semibold text-brand-teal hover:underline"
          >
            {adv.full_name || adv.email || f.advisor_id}
          </button>
        ) : <span className="text-slate-400">{f.advisor_id}</span>;
      },
    },
    { key: 'type', header: 'Type' },
    {
      key: 'due_date',
      header: 'Due',
      render: f => {
        const overdue = f.status === 'Open' && f.due_date && f.due_date < today;
        return f.due_date ? (
          <span className={overdue ? 'font-semibold text-brand-red' : ''}>
            {f.due_date}
            {overdue && <AlertTriangle className="ml-1 inline h-3 w-3" />}
          </span>
        ) : <span className="text-slate-400">—</span>;
      },
    },
    { key: 'assignee_email', header: 'Assignee' },
    {
      key: 'status',
      header: 'Status',
      render: f => <Badge tone={fuTone(f.status)}>{f.status || '—'}</Badge>,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: f => <span className="text-xs text-slate-500">{f.notes || ''}</span>,
    },
    {
      key: 'followup_id',
      header: '',
      width: '120px',
      render: f => (
        <div className="flex justify-end gap-1">
          {f.status !== 'Done' && (
            <button
              disabled={!canEdit}
              onClick={(e) => { e.stopPropagation(); void onMarkDone(f.followup_id); }}
              className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 dark:hover:bg-emerald-900/30"
              title="Mark done"
            >
              <CheckCircle2 className="h-4 w-4" />
            </button>
          )}
          {f.status === 'Open' && (
            <button
              disabled={!canEdit}
              onClick={(e) => { e.stopPropagation(); void onSnooze(f.followup_id); }}
              className="rounded p-1 text-amber-600 hover:bg-amber-50 disabled:opacity-30 dark:hover:bg-amber-900/30"
              title="Snooze"
            >
              <Calendar className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip label={`All (${followups.length})`} active={filter === 'all'} onClick={() => setFilter('all')} />
            <FilterChip label={`Open (${counts.open})`} active={filter === 'open'} onClick={() => setFilter('open')} />
            <FilterChip label={`Overdue (${counts.overdue})`} active={filter === 'overdue'} onClick={() => setFilter('overdue')} tone="red" />
            <FilterChip label={`Snoozed (${counts.snoozed})`} active={filter === 'snoozed'} onClick={() => setFilter('snoozed')} />
            <FilterChip label={`Done (${counts.done})`} active={filter === 'done'} onClick={() => setFilter('done')} />
          </div>
          {canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New follow-up
            </Button>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Calendar className="h-6 w-6" />}
            title="No follow-ups in this view"
            description="Try a different filter, or create a new follow-up for an advisor in the Roster tab."
          />
        </Card>
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}

      {creating && (
        <CreateFollowUpModal
          advisors={advisors}
          userEmail={userEmail}
          onClose={() => setCreating(false)}
          onCreate={async fu => {
            await onCreate(fu);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  tone = 'navy',
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: 'navy' | 'red';
  onClick: () => void;
}) {
  const activeBg = tone === 'red' ? 'bg-brand-red text-white' : 'bg-navy-500 text-white';
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? activeBg
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200 dark:hover:bg-navy-600'
      }`}
    >
      {label}
    </button>
  );
}

function fuTone(status: string) {
  if (status === 'Done') return 'green' as const;
  if (status === 'Snoozed') return 'amber' as const;
  if (status === 'Open') return 'orange' as const;
  return 'neutral' as const;
}

function CreateFollowUpModal({
  advisors,
  userEmail,
  onClose,
  onCreate,
}: {
  advisors: EnrichedAdvisor[];
  userEmail: string;
  onClose: () => void;
  onCreate: (fu: Partial<FollowUp>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<FollowUp>>({
    type: 'Email',
    status: 'Open',
    due_date: new Date().toISOString().slice(0, 10),
    assignee_email: userEmail,
    created_by: userEmail,
    created_at: new Date().toISOString(),
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
      <div className="m-3 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-navy-500">
        <h3 className="mb-4 text-lg font-bold text-navy-500 dark:text-white">New follow-up</h3>
        <div className="space-y-3">
          <Field label="Advisor" required>
            <select
              className={inputClass}
              value={draft.advisor_id || ''}
              onChange={e => setDraft({ ...draft, advisor_id: e.target.value })}
            >
              <option value="">Select an advisor…</option>
              {advisors.map(a => (
                <option key={a.advisor_id} value={a.advisor_id}>
                  {a.full_name || a.email || a.advisor_id}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                className={inputClass}
                value={draft.type || ''}
                onChange={e => setDraft({ ...draft, type: e.target.value })}
              >
                {FOLLOWUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Due">
              <input
                type="date"
                className={inputClass}
                value={draft.due_date || ''}
                onChange={e => setDraft({ ...draft, due_date: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Assignee email">
            <input
              className={inputClass}
              value={draft.assignee_email || ''}
              onChange={e => setDraft({ ...draft, assignee_email: e.target.value })}
            />
          </Field>
          <Field label="Notes">
            <textarea
              rows={3}
              className={inputClass}
              value={draft.notes || ''}
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!draft.advisor_id) return;
              setSaving(true);
              try { await onCreate(draft); } finally { setSaving(false); }
            }}
            disabled={!draft.advisor_id || saving}
          >
            {saving ? 'Saving…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label} {required && <span className="text-brand-red">*</span>}
      </span>
      {children}
    </label>
  );
}
