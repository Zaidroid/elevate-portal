// Detail drawer for a single freelancer. Tabs: Profile / Tracker /
// Follow-ups / Activity / Comments. Surfaces the workflow next-step card,
// the Smart match panel (when status === Available), and the email
// templates picker.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardCheck,
  Download,
  FileText,
  ListChecks,
  Mail,
  MessageSquare,
  Sparkles,
  Activity as ActivityIcon,
} from 'lucide-react';
import { Badge, Button, Drawer, Tabs } from '../../lib/ui';
import type { TabItem, Tone } from '../../lib/ui';
import type { FreelancerFollowUp } from '../../types/freelancer';
import {
  FL_NEXT_ACTION,
  FL_PIPELINE_LABEL_BY_ID,
  type CompanyLite,
  type EnrichedFreelancer,
  type FreelancerPipelineId,
  flNormalizeStatus,
} from './utils';
import {
  flSuggestedTemplate,
  flTemplateMailto,
  flTemplateOutlookWebUrl,
  FL_ALL_TEMPLATE_KEYS,
  FL_TEMPLATE_LABELS,
  renderFlTemplate,
  type FlTemplateKey,
} from './emailTemplates';
import {
  downloadMarkdown,
  freelancerToMarkdown,
  suggestFreelancerMatches,
  type CompanyWithEbNeed,
} from './smartMatch';

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-2 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white';

export function FreelancerDetailDrawer({
  freelancer,
  open,
  canEdit,
  userEmail,
  userName,
  userTitle,
  companies = [],
  ebCandidateCompanies = [],
  onClose,
  onTrackerSave,
  onCreateFollowUp,
  onMarkFollowUpDone,
  onAddComment,
}: {
  freelancer: EnrichedFreelancer | null;
  open: boolean;
  canEdit: boolean;
  userEmail: string;
  userName?: string;
  userTitle?: string;
  companies?: CompanyLite[];
  ebCandidateCompanies?: CompanyWithEbNeed[];
  onClose: () => void;
  onTrackerSave: (updates: Partial<EnrichedFreelancer>) => Promise<void>;
  onCreateFollowUp: (fu: Partial<FreelancerFollowUp>) => Promise<void>;
  onMarkFollowUpDone: (id: string) => Promise<void>;
  onAddComment: (body: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<string>('profile');
  useEffect(() => { if (open) setTab('profile'); }, [open, freelancer?.freelancer_id]);

  if (!open || !freelancer) {
    return <Drawer open={false} onClose={onClose} title="" children={null} />;
  }

  const tabs: TabItem[] = [
    { value: 'profile', label: 'Profile', icon: <FileText className="h-3.5 w-3.5" /> },
    { value: 'tracker', label: 'Tracker', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    {
      value: 'followups',
      label: 'Follow-ups',
      icon: <ListChecks className="h-3.5 w-3.5" />,
      count: freelancer.followups_for.length,
    },
    {
      value: 'activity',
      label: 'Activity',
      icon: <ActivityIcon className="h-3.5 w-3.5" />,
      count: freelancer.activity_for.length,
    },
    {
      value: 'comments',
      label: 'Comments',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      count: freelancer.comments_for.length,
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div className="flex items-center gap-2">
          <span>{freelancer.full_name || freelancer.email || freelancer.freelancer_id}</span>
          <Badge tone={pipelineTone(freelancer.status)}>{freelancer.status || 'Available'}</Badge>
        </div>
      }
      subtitle={
        <span className="text-xs text-slate-500">
          {[freelancer.track, freelancer.role_profile, freelancer.location].filter(Boolean).join(' · ')}
          {freelancer.matched_company_name && (
            <span className="ml-2 inline-flex items-center gap-1 text-brand-teal">
              <Building2 className="h-3 w-3" /> matched with {freelancer.matched_company_name}
            </span>
          )}
        </span>
      }
    >
      <Tabs items={tabs} value={tab} onChange={setTab} />

      <div className="mt-4 space-y-4">
        {freelancer.is_stuck && freelancer.status !== 'Archived' && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-brand-red">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-bold">Stuck for {freelancer.days_in_status} days in "{freelancer.status}"</span>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Past the SLA for this stage. Match, re-decide, or move to On Hold.
            </p>
          </div>
        )}
        {canEdit && freelancer.status !== 'Archived' && (
          <NextActionCard
            freelancer={freelancer}
            userEmail={userEmail}
            userName={userName}
            userTitle={userTitle}
            companies={companies}
            onAdvance={async (next) => {
              await onTrackerSave({ status: next } as Partial<EnrichedFreelancer>);
            }}
          />
        )}
        {freelancer.status === 'Available' && ebCandidateCompanies.length > 0 && canEdit && (
          <SmartMatchPanel
            freelancer={freelancer}
            companies={ebCandidateCompanies}
            onMatch={async (companyId) => {
              await onTrackerSave({
                company_id: companyId,
                status: 'Matched',
              } as Partial<EnrichedFreelancer>);
            }}
          />
        )}
        {tab === 'profile' && <ProfileTab freelancer={freelancer} />}
        {tab === 'tracker' && (
          <TrackerTab freelancer={freelancer} canEdit={canEdit} onSave={onTrackerSave} companies={companies} />
        )}
        {tab === 'followups' && (
          <FollowUpsInline
            freelancer={freelancer}
            canEdit={canEdit}
            userEmail={userEmail}
            onCreate={onCreateFollowUp}
            onMarkDone={onMarkFollowUpDone}
          />
        )}
        {tab === 'activity' && <ActivityInline freelancer={freelancer} />}
        {tab === 'comments' && (
          <CommentsInline freelancer={freelancer} canEdit={canEdit} onAdd={onAddComment} />
        )}
      </div>
    </Drawer>
  );
}

const STATUS_TO_ID: Record<string, FreelancerPipelineId> = {
  Available: 'available',
  Matched: 'matched',
  Active: 'active',
  Producing: 'producing',
  'On Hold': 'on_hold',
  Released: 'released',
  Dropped: 'dropped',
};

function NextActionCard({
  freelancer,
  userEmail,
  userName,
  userTitle,
  companies,
  onAdvance,
}: {
  freelancer: EnrichedFreelancer;
  userEmail: string;
  userName?: string;
  userTitle?: string;
  companies: CompanyLite[];
  onAdvance: (nextLabel: string) => Promise<void>;
}) {
  const [advancing, setAdvancing] = useState(false);
  const currentId = STATUS_TO_ID[freelancer.status || 'Available'] || flNormalizeStatus(freelancer.status);
  const action = FL_NEXT_ACTION[currentId];
  if (!action) return null;
  const nextLabel = action.nextStatus ? FL_PIPELINE_LABEL_BY_ID[action.nextStatus] : null;

  const suggested: FlTemplateKey = flSuggestedTemplate(freelancer.status || 'Available');
  const [tplKey, setTplKey] = useState<FlTemplateKey>(suggested);
  useEffect(() => { setTplKey(suggested); }, [suggested]);

  const matchedCompany = freelancer.company_id
    ? companies.find(c => c.company_id === freelancer.company_id)
    : undefined;
  const rendered = renderFlTemplate(tplKey, {
    freelancer: { full_name: freelancer.full_name, email: freelancer.email, track: freelancer.track, role_profile: freelancer.role_profile, location: freelancer.location },
    sender: { name: userName, email: userEmail, title: userTitle },
    company: matchedCompany ? { company_name: matchedCompany.company_name, sector: matchedCompany.sector } : undefined,
  });
  const mailto = flTemplateMailto(rendered);
  const outlookWeb = flTemplateOutlookWebUrl(rendered);

  return (
    <div className="rounded-xl border border-brand-red/30 bg-brand-red/5 p-3 dark:bg-brand-red/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-red">
            <Sparkles className="h-3.5 w-3.5" />
            Suggested next step
          </div>
          <div className="mt-0.5 text-sm font-bold text-navy-500 dark:text-white">{action.label}</div>
          <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{action.intent}</div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {nextLabel && (
            <Button
              size="sm"
              disabled={advancing}
              onClick={async () => {
                setAdvancing(true);
                try { await onAdvance(nextLabel); } finally { setAdvancing(false); }
              }}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              {advancing ? '…' : `Move to ${nextLabel}`}
            </Button>
          )}
          {freelancer.email && (
            <div className="flex flex-col items-end gap-1">
              <a
                href={mailto}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-teal/40 bg-brand-teal/10 px-3 py-1.5 text-xs font-semibold text-brand-teal transition-colors hover:bg-brand-teal hover:text-white"
                title="Opens your default mail client (Outlook on macOS/Windows when set as default) with the message pre-filled"
              >
                <Mail className="h-3 w-3" />
                {FL_TEMPLATE_LABELS[tplKey]}
              </a>
              <a
                href={outlookWeb}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xs font-semibold text-slate-500 hover:text-brand-teal hover:underline"
              >
                Outlook web →
              </a>
            </div>
          )}
        </div>
      </div>
      {freelancer.email && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-brand-red/15 pt-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Switch template:</span>
          {FL_ALL_TEMPLATE_KEYS.map(k => (
            <button
              key={k}
              onClick={() => setTplKey(k)}
              className={`rounded-full px-2 py-0.5 text-2xs font-semibold transition-colors ${
                tplKey === k
                  ? 'bg-brand-teal text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200 dark:hover:bg-navy-600'
              }`}
            >
              {FL_TEMPLATE_LABELS[k]}
              {k === suggested && <span className="ml-1 opacity-60">(suggested)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SmartMatchPanel({
  freelancer,
  companies,
  onMatch,
}: {
  freelancer: EnrichedFreelancer;
  companies: CompanyWithEbNeed[];
  onMatch: (companyId: string) => Promise<void>;
}) {
  const matches = useMemo(() => suggestFreelancerMatches(freelancer, companies, 3), [freelancer, companies]);
  const [matching, setMatching] = useState<string | null>(null);
  if (matches.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-navy-700 dark:bg-navy-700/30">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Building2 className="h-3.5 w-3.5" /> Smart match
        </div>
        <p className="mt-1 text-xs text-slate-500">
          No Cohort 3 companies with active MA-ElevateBridge engagements right now.
          Set the company assignment manually in the Tracker tab when ready.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-700">
        <Building2 className="h-3.5 w-3.5" /> Suggested matches
      </div>
      <ul className="mt-2 space-y-2">
        {matches.map(m => (
          <li key={m.company.company_id} className="flex items-start justify-between gap-3 rounded-lg bg-white p-2 dark:bg-navy-700">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-navy-500 dark:text-white">{m.company.company_name}</div>
              <div className="text-2xs text-slate-500">
                {m.company.sector || '—'}{m.company.governorate ? ` · ${m.company.governorate}` : ''} · score {m.score}
              </div>
              <ul className="mt-1 space-y-0.5 text-2xs text-slate-500">
                {m.reasons.map((r, i) => <li key={i}>• {r}</li>)}
              </ul>
            </div>
            <Button
              size="sm"
              disabled={matching === m.company.company_id}
              onClick={async () => {
                setMatching(m.company.company_id);
                try { await onMatch(m.company.company_id); } finally { setMatching(null); }
              }}
            >
              {matching === m.company.company_id ? '…' : 'Match'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProfileTab({ freelancer }: { freelancer: EnrichedFreelancer }) {
  const handleExport = () => {
    const md = freelancerToMarkdown(freelancer);
    const safe = (freelancer.full_name || freelancer.freelancer_id).replace(/[^\w-]+/g, '_');
    downloadMarkdown(`freelancer_${safe}.md`, md);
  };
  const fields: Array<[string, string]> = [
    ['Email', freelancer.email],
    ['Phone', freelancer.phone],
    ['Location', freelancer.location],
    ['Track', freelancer.track],
    ['Role profile', freelancer.role_profile],
    ['Mentor', freelancer.assigned_mentor],
    ['Source', freelancer.source_sheet],
    ['Start date', freelancer.start_date],
    ['Notes', freelancer.notes],
  ];
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5" /> Export profile (.md)
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        {fields.map(([label, value]) =>
          value ? (
            <div key={label} className="border-b border-slate-100 pb-1.5 last:border-0 dark:border-navy-700">
              <dt className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
              <dd className="text-sm text-navy-500 dark:text-slate-100">{value}</dd>
            </div>
          ) : null
        )}
      </dl>
    </>
  );
}

function TrackerTab({
  freelancer,
  canEdit,
  onSave,
  companies,
}: {
  freelancer: EnrichedFreelancer;
  canEdit: boolean;
  onSave: (updates: Partial<EnrichedFreelancer>) => Promise<void>;
  companies: CompanyLite[];
}) {
  const [draft, setDraft] = useState<Partial<EnrichedFreelancer>>({
    status: freelancer.status,
    assignee_email: freelancer.assignee_email,
    ack_sent: freelancer.ack_sent,
    assessment_date: freelancer.assessment_date,
    decision_date: freelancer.decision_date,
    tracker_notes: freelancer.tracker_notes,
    assigned_mentor: freelancer.assigned_mentor,
    company_id: freelancer.company_id,
  });
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <select
            disabled={!canEdit}
            className={inputClass}
            value={draft.status || 'Available'}
            onChange={e => setDraft({ ...draft, status: e.target.value })}
          >
            {Object.values(FL_PIPELINE_LABEL_BY_ID).map(s => <option key={s} value={s}>{s}</option>)}
            <option value="Archived">Archived</option>
          </select>
        </Field>
        <Field label="Assignee email (PM)">
          <input
            disabled={!canEdit}
            className={inputClass}
            value={draft.assignee_email || ''}
            onChange={e => setDraft({ ...draft, assignee_email: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mentor (external)">
          <input
            disabled={!canEdit}
            className={inputClass}
            value={draft.assigned_mentor || ''}
            onChange={e => setDraft({ ...draft, assigned_mentor: e.target.value })}
          />
        </Field>
        <Field label="Matched company">
          <select
            disabled={!canEdit}
            className={inputClass}
            value={draft.company_id || ''}
            onChange={e => setDraft({ ...draft, company_id: e.target.value })}
          >
            <option value="">—</option>
            {companies.map(c => (
              <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Ack sent">
          <select
            disabled={!canEdit}
            className={inputClass}
            value={draft.ack_sent || ''}
            onChange={e => setDraft({ ...draft, ack_sent: e.target.value })}
          >
            <option value="">—</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </Field>
        <Field label="Assessment date">
          <input
            disabled={!canEdit}
            type="date"
            className={inputClass}
            value={draft.assessment_date || ''}
            onChange={e => setDraft({ ...draft, assessment_date: e.target.value })}
          />
        </Field>
        <Field label="Decision date">
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
      <div className="flex justify-end pt-2">
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

function FollowUpsInline({
  freelancer,
  canEdit,
  userEmail,
  onCreate,
  onMarkDone,
}: {
  freelancer: EnrichedFreelancer;
  canEdit: boolean;
  userEmail: string;
  onCreate: (fu: Partial<FreelancerFollowUp>) => Promise<void>;
  onMarkDone: (id: string) => Promise<void>;
}) {
  const [type, setType] = useState('Email');
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(() => [...freelancer.followups_for].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')), [freelancer.followups_for]);
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
                  freelancer_id: freelancer.freelancer_id,
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
        <p className="text-xs text-slate-500">No follow-ups for this freelancer yet.</p>
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
                <Button variant="ghost" onClick={() => void onMarkDone(f.followup_id)}>Mark done</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityInline({ freelancer }: { freelancer: EnrichedFreelancer }) {
  const groups = useMemo(() => {
    const sorted = [...freelancer.activity_for].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const out: Array<{ day: string; rows: typeof sorted }> = [];
    for (const r of sorted) {
      const day = (r.timestamp || '').slice(0, 10) || 'Unknown';
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [freelancer.activity_for]);
  if (groups.length === 0) return <p className="text-xs text-slate-500">No activity recorded yet.</p>;
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.day}>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-navy-500 dark:text-slate-200">{relativeDay(g.day)}</span>
            <span className="text-2xs text-slate-400">{g.day}</span>
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-semibold text-slate-500 dark:bg-navy-700 dark:text-slate-300">
              {g.rows.length} event{g.rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <ol className="relative space-y-2 border-l border-slate-200 pl-4 dark:border-navy-700">
            {g.rows.map(a => (
              <li key={a.activity_id || `${a.timestamp}-${a.field}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-teal" />
                <div className="text-2xs text-slate-500">
                  <span className="font-mono">{(a.timestamp || '').slice(11, 19)}</span>
                  <span className="mx-1">·</span>
                  <span>{(a.user_email || '').split('@')[0].slice(0, 12)}</span>
                  <span className="mx-1">·</span>
                  <Badge tone="neutral">{a.action}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-navy-500 dark:text-slate-200">
                  {a.field && <span className="font-mono text-xs">{a.field}: </span>}
                  {a.old_value && <span className="text-slate-400 line-through">{a.old_value}</span>}
                  {a.old_value && a.new_value && <span className="mx-1">→</span>}
                  <span>{a.new_value}</span>
                </p>
                {a.details && <p className="mt-0.5 text-xs italic text-slate-500">{a.details}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function CommentsInline({
  freelancer,
  canEdit,
  onAdd,
}: {
  freelancer: EnrichedFreelancer;
  canEdit: boolean;
  onAdd: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(
    () => [...freelancer.comments_for].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    [freelancer.comments_for]
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
          <textarea rows={3} className={inputClass} placeholder="Add a comment…" value={body} onChange={e => setBody(e.target.value)} />
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

function relativeDay(iso: string): string {
  if (!iso) return '';
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return 'Today';
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === yesterday) return 'Yesterday';
  const days = Math.floor((Date.parse(today) - Date.parse(iso)) / 86400000);
  if (days < 7 && days > 0) return `${days} days ago`;
  return iso;
}

function pipelineTone(s: string | undefined): Tone {
  switch ((s || 'Available')) {
    case 'Producing':
    case 'Active': return 'green';
    case 'Matched':
    case 'Released': return 'amber';
    case 'Dropped': return 'red';
    case 'On Hold':
    case 'Archived': return 'neutral';
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

// Re-export the inline FollowUpsTab component so the Roster bulk-action
// flow can also create follow-ups quickly. (Not currently wired but the
// type is reused.)
export type { FreelancerFollowUp as _FollowUp };
