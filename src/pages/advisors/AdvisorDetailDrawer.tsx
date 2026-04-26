// Per-advisor detail drawer. Tabs:
//   Profile  — read-only summary of the form-response columns
//   Score    — Stage 1 weighted breakdown + Stage 2 category fits
//   Tracker  — editable triage state (status, assignee, dates, notes)
//   Follow-ups — list + create-for-this-advisor
//   Activity — audit trail filtered to this advisor
//   Comments — thread

import { useEffect, useMemo, useState } from 'react';
import { Award, ClipboardCheck, FileText, MessageSquare, ListChecks, Activity as ActivityIcon, ExternalLink } from 'lucide-react';
import { Badge, Button, Drawer, Tabs } from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import { CATEGORY_META, PIPELINE_COLUMNS } from '../../lib/advisor-scoring';
import type { FollowUp } from '../../types/advisor';
import type { EnrichedAdvisor } from './utils';

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

const TONE_MAP: Record<string, Tone> = {
  slate: 'neutral',
  navy: 'neutral',
  red: 'red',
  teal: 'teal',
  orange: 'orange',
  amber: 'amber',
  green: 'green',
};

export function AdvisorDetailDrawer({
  advisor,
  open,
  canEdit,
  userEmail,
  onClose,
  onTrackerSave,
  onCreateFollowUp,
  onMarkFollowUpDone,
  onAddComment,
}: {
  advisor: EnrichedAdvisor | null;
  open: boolean;
  canEdit: boolean;
  userEmail: string;
  onClose: () => void;
  onTrackerSave: (updates: Partial<EnrichedAdvisor>) => Promise<void>;
  onCreateFollowUp: (fu: Partial<FollowUp>) => Promise<void>;
  onMarkFollowUpDone: (id: string) => Promise<void>;
  onAddComment: (body: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<string>('profile');
  useEffect(() => {
    if (open) setTab('profile');
  }, [open, advisor?.advisor_id]);

  if (!open || !advisor) {
    return <Drawer open={false} onClose={onClose} title="" children={null} />;
  }

  const tabs: TabItem[] = [
    { value: 'profile', label: 'Profile', icon: <FileText className="h-3.5 w-3.5" /> },
    { value: 'score', label: 'Score', icon: <Award className="h-3.5 w-3.5" /> },
    { value: 'tracker', label: 'Tracker', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    {
      value: 'followups',
      label: 'Follow-ups',
      icon: <ListChecks className="h-3.5 w-3.5" />,
      count: advisor.followups_for.length,
    },
    {
      value: 'activity',
      label: 'Activity',
      icon: <ActivityIcon className="h-3.5 w-3.5" />,
      count: advisor.activity_for.length,
    },
    {
      value: 'comments',
      label: 'Comments',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      count: advisor.comments_for.length,
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div className="flex items-center gap-2">
          <span>{advisor.full_name || advisor.email || advisor.advisor_id}</span>
          <Badge tone={pipelineTone(advisor.pipeline_status)}>{advisor.pipeline_status || 'New'}</Badge>
        </div>
      }
      subtitle={
        <span className="text-xs text-slate-500">
          {[advisor.position, advisor.employer, advisor.country].filter(Boolean).join(' · ')}
        </span>
      }
    >
      <Tabs items={tabs} value={tab} onChange={setTab} />

      <div className="mt-4 space-y-4">
        {tab === 'profile' && <ProfileTab advisor={advisor} />}
        {tab === 'score' && <ScoreTab advisor={advisor} />}
        {tab === 'tracker' && (
          <TrackerTab advisor={advisor} canEdit={canEdit} onSave={onTrackerSave} />
        )}
        {tab === 'followups' && (
          <FollowUpsTab
            advisor={advisor}
            canEdit={canEdit}
            userEmail={userEmail}
            onCreate={onCreateFollowUp}
            onMarkDone={onMarkFollowUpDone}
          />
        )}
        {tab === 'activity' && <ActivityTab advisor={advisor} />}
        {tab === 'comments' && (
          <CommentsTab advisor={advisor} canEdit={canEdit} onAdd={onAddComment} />
        )}
      </div>
    </Drawer>
  );
}

// ----- Sub-tabs -----

function ProfileTab({ advisor }: { advisor: EnrichedAdvisor }) {
  const fields: Array<[string, string]> = [
    ['Email', advisor.email],
    ['WhatsApp', advisor.whatsapp],
    ['LinkedIn', advisor.linkedin],
    ['Country', advisor.country],
    ['Gender', advisor.gender],
    ['Position', advisor.position],
    ['Employer', advisor.employer],
    ['Years', advisor.years],
    ['Tech rating', advisor.tech_rating],
    ['Eco rating', advisor.eco_rating],
    ['C-level', advisor.c_level],
    ['C-level detail', advisor.c_level_detail],
    ['Experience areas', advisor.exp_areas],
    ['Experience detail', advisor.exp_detail],
    ['Non-tech subjects', advisor.non_tech_subjects],
    ['Paid / volunteer', advisor.paid_or_vol],
    ['Hourly rate', advisor.hourly_rate],
    ['CV link', advisor.cv_link],
    ['Heard from', advisor.heard_from],
    ['Notes', advisor.notes],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
      {fields.map(([label, value]) =>
        value ? (
          <div key={label} className="border-b border-slate-100 pb-1.5 last:border-0 dark:border-navy-700">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
            <dd className="text-sm text-navy-500 dark:text-slate-100">
              {label === 'LinkedIn' || label === 'CV link' ? (
                <a
                  href={value.startsWith('http') ? value : `https://${value}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-teal hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        ) : null
      )}
    </dl>
  );
}

function ScoreTab({ advisor }: { advisor: EnrichedAdvisor }) {
  const stage1Bands: Array<[string, number]> = [
    ['Tech rating', advisor.stage1.parts.tech_rating],
    ['Ecosystem rating', advisor.stage1.parts.eco_rating],
    ['C-level', advisor.stage1.parts.clevel],
    ['Years', advisor.stage1.parts.years],
    ['Experience', advisor.stage1.parts.experience],
    ['Seniority', advisor.stage1.parts.seniority],
    ['LinkedIn', advisor.stage1.parts.linkedin],
    ['CV', advisor.stage1.parts.cv],
  ];
  const stage2Items: Array<[string, number]> = [
    ['CEO', advisor.stage2.ceo],
    ['CTO', advisor.stage2.cto],
    ['COO', advisor.stage2.coo],
    ['Marketing', advisor.stage2.marketing],
    ['AI', advisor.stage2.ai],
  ];
  const cat = CATEGORY_META[advisor.stage2.primary] || CATEGORY_META.Unqualified;

  return (
    <div className="space-y-5">
      <div className={`rounded-xl border p-4 ${advisor.stage1.pass ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30'}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Stage 1</div>
            <div className="text-3xl font-extrabold text-navy-500 dark:text-white">{advisor.stage1.total}<span className="text-base font-normal text-slate-500"> / 100</span></div>
          </div>
          <Badge tone={advisor.stage1.pass ? 'green' : 'red'}>{advisor.stage1.pass ? 'PASS' : 'FAIL'}</Badge>
        </div>
        <div className="mt-3 space-y-1.5">
          {stage1Bands.map(([label, value]) => (
            <ScoreBand key={label} label={label} value={value} max={20} tone={advisor.stage1.pass ? 'teal' : 'red'} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-navy-700">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Stage 2 — primary</div>
            <div className="text-3xl font-extrabold text-navy-500 dark:text-white">{cat.label}</div>
            <div className="text-xs text-slate-500">{cat.blurb}</div>
          </div>
          <Badge tone={TONE_MAP[cat.tone] || 'neutral'}>{advisor.stage2.primary === 'Unqualified' ? '0' : maxStage2(advisor)}</Badge>
        </div>
        <div className="space-y-1.5">
          {stage2Items.map(([label, value]) => (
            <ScoreBand key={label} label={label} value={value} max={100} tone="navy" />
          ))}
        </div>
      </div>
    </div>
  );
}

function maxStage2(adv: EnrichedAdvisor): number {
  return Math.max(adv.stage2.ceo, adv.stage2.cto, adv.stage2.coo, adv.stage2.marketing, adv.stage2.ai);
}

function ScoreBand({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'teal' | 'red' | 'navy' }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const bar =
    tone === 'red' ? 'bg-brand-red'
    : tone === 'teal' ? 'bg-brand-teal'
    : 'bg-navy-500';
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-32 truncate text-slate-500 dark:text-slate-400">{label}</div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 text-right font-mono text-navy-500 dark:text-slate-200">{value}</div>
    </div>
  );
}

function TrackerTab({
  advisor,
  canEdit,
  onSave,
}: {
  advisor: EnrichedAdvisor;
  canEdit: boolean;
  onSave: (updates: Partial<EnrichedAdvisor>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<EnrichedAdvisor>>({
    pipeline_status: advisor.pipeline_status,
    assignee_email: advisor.assignee_email,
    received_ack: advisor.received_ack,
    intro_scheduled_date: advisor.intro_scheduled_date,
    intro_done_date: advisor.intro_done_date,
    assessment_date: advisor.assessment_date,
    decision_date: advisor.decision_date,
    tracker_notes: advisor.tracker_notes,
    assignment_company_id: advisor.assignment_company_id,
    assignment_intervention_type: advisor.assignment_intervention_type,
    assignment_status: advisor.assignment_status,
    assignment_notes: advisor.assignment_notes,
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pipeline status">
          <select
            disabled={!canEdit}
            className={inputClass}
            value={draft.pipeline_status || 'New'}
            onChange={e => setDraft({ ...draft, pipeline_status: e.target.value })}
          >
            {PIPELINE_COLUMNS.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Assignee email">
          <input
            disabled={!canEdit}
            className={inputClass}
            value={draft.assignee_email || ''}
            onChange={e => setDraft({ ...draft, assignee_email: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Received ack">
          <select
            disabled={!canEdit}
            className={inputClass}
            value={draft.received_ack || ''}
            onChange={e => setDraft({ ...draft, received_ack: e.target.value })}
          >
            <option value="">—</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </Field>
        <Field label="Intro scheduled">
          <input
            disabled={!canEdit}
            type="date"
            className={inputClass}
            value={draft.intro_scheduled_date || ''}
            onChange={e => setDraft({ ...draft, intro_scheduled_date: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Intro done">
          <input
            disabled={!canEdit}
            type="date"
            className={inputClass}
            value={draft.intro_done_date || ''}
            onChange={e => setDraft({ ...draft, intro_done_date: e.target.value })}
          />
        </Field>
        <Field label="Assessment">
          <input
            disabled={!canEdit}
            type="date"
            className={inputClass}
            value={draft.assessment_date || ''}
            onChange={e => setDraft({ ...draft, assessment_date: e.target.value })}
          />
        </Field>
        <Field label="Decision">
          <input
            disabled={!canEdit}
            type="date"
            className={inputClass}
            value={draft.decision_date || ''}
            onChange={e => setDraft({ ...draft, decision_date: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Tracker notes">
        <textarea
          disabled={!canEdit}
          rows={3}
          className={inputClass}
          value={draft.tracker_notes || ''}
          onChange={e => setDraft({ ...draft, tracker_notes: e.target.value })}
        />
      </Field>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-navy-700">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Assignment to a company</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company ID">
            <input
              disabled={!canEdit}
              className={inputClass}
              value={draft.assignment_company_id || ''}
              onChange={e => setDraft({ ...draft, assignment_company_id: e.target.value })}
              placeholder="E3-0001"
            />
          </Field>
          <Field label="Intervention type">
            <input
              disabled={!canEdit}
              className={inputClass}
              value={draft.assignment_intervention_type || ''}
              onChange={e => setDraft({ ...draft, assignment_intervention_type: e.target.value })}
              placeholder="C-Suite, MA, ..."
            />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Assignment status">
            <select
              disabled={!canEdit}
              className={inputClass}
              value={draft.assignment_status || ''}
              onChange={e => setDraft({ ...draft, assignment_status: e.target.value })}
            >
              <option value="">—</option>
              <option value="Planned">Planned</option>
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Assignment notes">
            <input
              disabled={!canEdit}
              className={inputClass}
              value={draft.assignment_notes || ''}
              onChange={e => setDraft({ ...draft, assignment_notes: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          disabled={!canEdit || saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave(draft); } finally { setSaving(false); }
          }}
        >
          {saving ? 'Saving…' : 'Save tracker'}
        </Button>
      </div>
    </div>
  );
}

function FollowUpsTab({
  advisor,
  canEdit,
  userEmail,
  onCreate,
  onMarkDone,
}: {
  advisor: EnrichedAdvisor;
  canEdit: boolean;
  userEmail: string;
  onCreate: (fu: Partial<FollowUp>) => Promise<void>;
  onMarkDone: (id: string) => Promise<void>;
}) {
  const [type, setType] = useState('Email');
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(() => {
    return [...advisor.followups_for].sort((a, b) =>
      (a.due_date || '').localeCompare(b.due_date || '')
    );
  }, [advisor.followups_for]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">New follow-up</div>
        <div className="grid grid-cols-3 gap-2">
          <select disabled={!canEdit} className={inputClass} value={type} onChange={e => setType(e.target.value)}>
            <option>Email</option>
            <option>Call</option>
            <option>Meeting</option>
            <option>Other</option>
          </select>
          <input disabled={!canEdit} type="date" className={inputClass} value={due} onChange={e => setDue(e.target.value)} />
          <Button
            disabled={!canEdit || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onCreate({
                  advisor_id: advisor.advisor_id,
                  due_date: due,
                  type,
                  status: 'Open',
                  assignee_email: userEmail,
                  notes,
                  created_by: userEmail,
                  created_at: new Date().toISOString(),
                });
                setNotes('');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving…' : 'Add'}
          </Button>
        </div>
        <textarea
          disabled={!canEdit}
          rows={2}
          className={`${inputClass} mt-2`}
          placeholder="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-slate-500">No follow-ups for this advisor yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map(f => (
            <li key={f.followup_id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-3 dark:border-navy-700">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Badge tone={f.status === 'Done' ? 'green' : f.status === 'Snoozed' ? 'amber' : 'orange'}>{f.status}</Badge>
                  <span>{f.type}</span>
                  <span>·</span>
                  <span className="font-mono">{f.due_date || '—'}</span>
                </div>
                {f.notes && <p className="mt-1 text-sm text-navy-500 dark:text-slate-200">{f.notes}</p>}
                <p className="mt-1 text-[10px] text-slate-400">By {f.created_by} · {f.created_at?.slice(0, 10)}</p>
              </div>
              {canEdit && f.status !== 'Done' && (
                <Button variant="ghost" onClick={() => void onMarkDone(f.followup_id)}>
                  Mark done
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityTab({ advisor }: { advisor: EnrichedAdvisor }) {
  const sorted = useMemo(() => {
    return [...advisor.activity_for].sort((a, b) =>
      (b.timestamp || '').localeCompare(a.timestamp || '')
    );
  }, [advisor.activity_for]);

  if (sorted.length === 0) {
    return <p className="text-xs text-slate-500">No activity recorded for this advisor yet.</p>;
  }

  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-navy-700">
      {sorted.map(a => (
        <li key={a.activity_id || `${a.timestamp}-${a.field}`} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-teal" />
          <div className="text-xs text-slate-500">
            <span className="font-mono">{(a.timestamp || '').slice(0, 19).replace('T', ' ')}</span>
            <span className="mx-1">·</span>
            <span>{a.user_email || '—'}</span>
            <span className="mx-1">·</span>
            <Badge tone="neutral">{a.action}</Badge>
          </div>
          <p className="mt-1 text-sm text-navy-500 dark:text-slate-200">
            {a.field && <span className="font-mono text-xs">{a.field}: </span>}
            {a.old_value && <span className="text-slate-400 line-through">{a.old_value}</span>}
            {a.old_value && a.new_value && <span className="mx-1">→</span>}
            <span>{a.new_value}</span>
          </p>
          {a.details && <p className="mt-0.5 text-xs text-slate-500">{a.details}</p>}
        </li>
      ))}
    </ol>
  );
}

function CommentsTab({
  advisor,
  canEdit,
  onAdd,
}: {
  advisor: EnrichedAdvisor;
  canEdit: boolean;
  onAdd: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(
    () => [...advisor.comments_for].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    [advisor.comments_for]
  );

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {sorted.length === 0 && <li className="text-xs text-slate-500">No comments yet.</li>}
        {sorted.map(c => (
          <li key={c.comment_id} className="rounded-lg border border-slate-100 p-3 dark:border-navy-700">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {c.author_email} · {c.created_at?.slice(0, 19).replace('T', ' ')}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-navy-500 dark:text-slate-200">{c.body}</p>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
          <textarea
            rows={3}
            className={inputClass}
            placeholder="Add a comment…"
            value={body}
            onChange={e => setBody(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              disabled={!body.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try { await onAdd(body.trim()); setBody(''); } finally { setSaving(false); }
              }}
            >
              {saving ? 'Posting…' : 'Post'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function pipelineTone(s: string | undefined): Tone {
  switch ((s || 'New')) {
    case 'Approved':
    case 'Matched': return 'green';
    case 'Acknowledged':
    case 'Allocated':
    case 'Intro Scheduled':
    case 'Intro Done':
    case 'Assessment': return 'amber';
    case 'Rejected': return 'red';
    case 'On Hold': return 'neutral';
    default: return 'neutral';
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
