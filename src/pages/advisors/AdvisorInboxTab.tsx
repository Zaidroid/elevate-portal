// Advisor Inbox — the headline admin surface.
//
// Every advisor with pipeline_status='new' surfaces here, sorted by Stage 1
// score (highest first). Per the Cohort 3 Playbook section 9.2.1, this is
// Phase 1: application review + filtration. The admin sees enough preview
// to act in one click. Strong passes (>=80) get a pre-filled
// "Approve + assign to <lowest-load AM>" button; clear fails (<60) get a
// pre-filled "Decline (low score)" button. Borderline middle band needs an
// explicit choice.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Check,
  Globe,
  Inbox,
  MoreHorizontal,
  Search,
  Star,
  X as XIcon,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';
import type { Advisor } from '../../types/advisor';
import type { EnrichedAdvisor } from './utils';
import { scoreFields } from './utils';

type Props = {
  // All advisors with pipeline_status='new' that we should review.
  advisors: EnrichedAdvisor[];
  // For "AM workload": how many active advisors each AM currently owns.
  amLoadByEmail: Map<string, number>;
  canEdit: boolean;
  userEmail: string;
  onApprove: (advisor: EnrichedAdvisor, amEmail: string, sendWelcomeEmail: boolean) => Promise<void>;
  onDecline: (advisor: EnrichedAdvisor, reason: string, sendDeclineLetter: boolean) => Promise<void>;
  onOpenDetail: (advisor: EnrichedAdvisor) => void;
};

const STRONG_PASS_THRESHOLD = 80;
const CLEAR_FAIL_THRESHOLD = 60;

const DECLINE_REASONS = [
  'Low Stage 1 score',
  'Wrong fit / sector mismatch',
  'Duplicate of existing advisor',
  'Withdrew',
  'Insufficient experience',
  'Availability incompatible',
];

export function AdvisorInboxTab({
  advisors,
  amLoadByEmail,
  canEdit,
  onApprove,
  onDecline,
  onOpenDetail,
}: Props) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [openApprove, setOpenApprove] = useState<EnrichedAdvisor | null>(null);
  const [openDecline, setOpenDecline] = useState<EnrichedAdvisor | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  // Sorted highest-score-first. Stronger advisors at the top so the
  // admin can rip through the strong passes quickly.
  const sorted = useMemo(() => {
    const filtered = query.trim()
      ? advisors.filter(a => {
          const q = query.trim().toLowerCase();
          return (
            (a.full_name || '').toLowerCase().includes(q) ||
            (a.email || '').toLowerCase().includes(q) ||
            (a.country || '').toLowerCase().includes(q) ||
            (a.position || '').toLowerCase().includes(q) ||
            (a.employer || '').toLowerCase().includes(q)
          );
        })
      : advisors;
    return [...filtered].sort((a, b) => {
      const sa = parseFloat(a.stage1_score || '0') || 0;
      const sb = parseFloat(b.stage1_score || '0') || 0;
      return sb - sa;
    });
  }, [advisors, query]);

  // Suggested AM = lowest current load. Surfaces in the Approve picker.
  const suggestedAm = useMemo(() => {
    let best = ACCOUNT_MANAGERS[0]?.email || '';
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const am of ACCOUNT_MANAGERS) {
      const load = amLoadByEmail.get(am.email.toLowerCase()) || 0;
      if (load < bestLoad) {
        best = am.email;
        bestLoad = load;
      }
    }
    return best;
  }, [amLoadByEmail]);

  if (advisors.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="Inbox is empty"
          description="New form submissions land here for review. The auto-sync polls every 5 minutes."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, email, country, position…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {sorted.length} new submission{sorted.length === 1 ? '' : 's'} pending review.
          Suggested AM: <strong className="text-navy-500 dark:text-white">{displayName(suggestedAm)}</strong> ({amLoadByEmail.get(suggestedAm.toLowerCase()) || 0} active).
        </span>
      </div>

      <div className="space-y-2.5">
        {sorted.map(adv => (
          <InboxCard
            key={adv.advisor_id}
            advisor={adv}
            canEdit={canEdit}
            running={running === adv.advisor_id}
            onApproveClick={() => setOpenApprove(adv)}
            onDeclineClick={() => setOpenDecline(adv)}
            onOpenDetail={() => onOpenDetail(adv)}
          />
        ))}
      </div>

      {openApprove && (
        <ApprovePicker
          advisor={openApprove}
          amLoadByEmail={amLoadByEmail}
          suggestedAm={suggestedAm}
          onCancel={() => setOpenApprove(null)}
          onConfirm={async (amEmail, sendWelcome) => {
            setRunning(openApprove.advisor_id);
            try {
              await onApprove(openApprove, amEmail, sendWelcome);
              toast.success('Advisor approved', `${openApprove.full_name} assigned to ${displayName(amEmail)}.`);
              setOpenApprove(null);
            } catch (err) {
              toast.error('Approve failed', (err as Error).message);
            } finally {
              setRunning(null);
            }
          }}
        />
      )}

      {openDecline && (
        <DeclinePicker
          advisor={openDecline}
          onCancel={() => setOpenDecline(null)}
          onConfirm={async (reason, sendLetter) => {
            setRunning(openDecline.advisor_id);
            try {
              await onDecline(openDecline, reason, sendLetter);
              toast.success('Advisor declined', `${openDecline.full_name} marked rejected.`);
              setOpenDecline(null);
            } catch (err) {
              toast.error('Decline failed', (err as Error).message);
            } finally {
              setRunning(null);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────

function InboxCard({
  advisor,
  canEdit,
  running,
  onApproveClick,
  onDeclineClick,
  onOpenDetail,
}: {
  advisor: EnrichedAdvisor;
  canEdit: boolean;
  running: boolean;
  onApproveClick: () => void;
  onDeclineClick: () => void;
  onOpenDetail: () => void;
}) {
  // Refresh Stage 1 / 2 from raw fields so the badge reflects the live
  // form values even if the row in the sheet has stale stamped scores.
  const live = useMemo(() => scoreFields(advisor as Advisor), [advisor]);
  const s1 = live.stage1_score ?? advisor.stage1_score;
  const s1pass = (live.stage1_pass ?? advisor.stage1_pass) === 'true' || (live.stage1_pass ?? advisor.stage1_pass) === 'Yes';
  const s1num = parseFloat(s1 || '0') || 0;
  const s2cat = live.stage2_category ?? advisor.stage2_category;

  const scoreTone: Tone =
    s1num >= STRONG_PASS_THRESHOLD ? 'green' :
    s1num >= CLEAR_FAIL_THRESHOLD ? 'amber' :
    'red';

  const strong = s1num >= STRONG_PASS_THRESHOLD;
  const clearFail = s1num < CLEAR_FAIL_THRESHOLD;

  const submitted = advisor.timestamp ? relativeTime(advisor.timestamp) : '';

  return (
    <Card padded={false} interactive>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1" onClick={onOpenDetail} role="button">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold text-navy-500 dark:text-white">{advisor.full_name || advisor.email}</div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{advisor.email}</span>
            {submitted && <span className="text-[11px] text-slate-400">· submitted {submitted}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={scoreTone}>
              <Star className="-mt-0.5 mr-1 inline h-3 w-3" />
              Stage 1: {s1num.toFixed(0)}{s1pass ? ' · pass' : ' · fail'}
            </Badge>
            {s2cat && s2cat !== 'Unqualified' && (
              <Badge tone="teal">{s2cat}</Badge>
            )}
            {advisor.c_level && advisor.c_level.toLowerCase().startsWith('y') && (
              <Badge tone="orange">C-Level</Badge>
            )}
            {advisor.country && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Globe className="h-3 w-3" />{advisor.country}
              </span>
            )}
            {advisor.years && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">· {advisor.years}</span>
            )}
            {advisor.position && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Briefcase className="h-3 w-3" />{advisor.position}
                {advisor.employer && <span className="text-slate-400">@ {advisor.employer}</span>}
              </span>
            )}
            {advisor.paid_or_vol && (
              <Badge tone="neutral">{advisor.paid_or_vol}</Badge>
            )}
          </div>
          {advisor.sub_interventions && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Interested in: <span className="font-semibold text-navy-500 dark:text-white">{advisor.sub_interventions}</span>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
            <Button
              variant={strong ? 'primary' : 'ghost'}
              onClick={onApproveClick}
              disabled={running}
              title={strong ? 'Stage 1 strong pass — recommended' : 'Approve to advisor pool'}
            >
              <Check className="mr-1 h-4 w-4" /> Approve
            </Button>
            <Button
              variant={clearFail ? 'primary' : 'ghost'}
              onClick={onDeclineClick}
              disabled={running}
              title={clearFail ? 'Stage 1 below threshold — recommended' : 'Decline'}
            >
              <XIcon className="mr-1 h-4 w-4" /> Decline
            </Button>
            <Button variant="ghost" onClick={onOpenDetail} title="Open full detail">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {!s1pass && !clearFail && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="-mt-0.5 mr-1 inline h-3 w-3" />
          Borderline pass — review the Score tab in the drawer before deciding.
        </div>
      )}
    </Card>
  );
}

// ─── Approve picker ───────────────────────────────────────────────────────

function ApprovePicker({
  advisor,
  amLoadByEmail,
  suggestedAm,
  onCancel,
  onConfirm,
}: {
  advisor: EnrichedAdvisor;
  amLoadByEmail: Map<string, number>;
  suggestedAm: string;
  onCancel: () => void;
  onConfirm: (amEmail: string, sendWelcomeEmail: boolean) => Promise<void>;
}) {
  const [amEmail, setAmEmail] = useState(suggestedAm);
  const [sendWelcome, setSendWelcome] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-navy-700 dark:bg-navy-600">
        <div className="text-sm font-bold text-navy-500 dark:text-white">Approve {advisor.full_name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
          Advances status New → Acknowledged → Allocated and assigns the chosen AM.
        </div>

        <div className="mb-3 text-2xs font-bold uppercase tracking-wider text-slate-500">Account Manager</div>
        <div className="space-y-1.5">
          {ACCOUNT_MANAGERS.map(am => {
            const load = amLoadByEmail.get(am.email.toLowerCase()) || 0;
            const isSuggested = am.email === suggestedAm;
            return (
              <label
                key={am.email}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 cursor-pointer ${
                  amEmail === am.email
                    ? 'border-brand-teal bg-brand-teal/5'
                    : 'border-slate-200 hover:border-slate-300 dark:border-navy-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="am"
                    checked={amEmail === am.email}
                    onChange={() => setAmEmail(am.email)}
                    className="accent-brand-teal"
                  />
                  <span className="text-sm font-semibold text-navy-500 dark:text-white">{am.name}</span>
                  {isSuggested && <Badge tone="teal">suggested · lowest load</Badge>}
                </div>
                <span className="text-[11px] text-slate-500">{load} active</span>
              </label>
            );
          })}
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendWelcome} onChange={e => setSendWelcome(e.target.checked)} className="accent-brand-teal" />
          <span>Send welcome email (acknowledged template)</span>
        </label>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!amEmail || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(amEmail, sendWelcome);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check className="mr-1 h-4 w-4" /> Approve & assign
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Decline picker ───────────────────────────────────────────────────────

function DeclinePicker({
  advisor,
  onCancel,
  onConfirm,
}: {
  advisor: EnrichedAdvisor;
  onCancel: () => void;
  onConfirm: (reason: string, sendLetter: boolean) => Promise<void>;
}) {
  const live = useMemo(() => scoreFields(advisor as Advisor), [advisor]);
  const s1num = parseFloat(live.stage1_score || advisor.stage1_score || '0') || 0;
  const defaultReason = s1num < CLEAR_FAIL_THRESHOLD ? DECLINE_REASONS[0] : DECLINE_REASONS[1];

  const [reason, setReason] = useState(defaultReason);
  const [other, setOther] = useState('');
  const [sendLetter, setSendLetter] = useState(true);
  const [busy, setBusy] = useState(false);

  const finalReason = reason === 'Other' ? other.trim() : reason;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-navy-700 dark:bg-navy-600">
        <div className="text-sm font-bold text-navy-500 dark:text-white">Decline {advisor.full_name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
          Sets pipeline_status to Rejected and stamps decision_date. Reason is logged to the activity feed.
        </div>

        <div className="mb-3 text-2xs font-bold uppercase tracking-wider text-slate-500">Reason</div>
        <div className="space-y-1">
          {[...DECLINE_REASONS, 'Other'].map(r => (
            <label key={r} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-navy-700">
              <input
                type="radio"
                name="decline-reason"
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-brand-red"
              />
              <span>{r}</span>
            </label>
          ))}
        </div>
        {reason === 'Other' && (
          <input
            value={other}
            onChange={e => setOther(e.target.value)}
            placeholder="Reason…"
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-700 dark:text-white"
          />
        )}

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendLetter} onChange={e => setSendLetter(e.target.checked)} className="accent-brand-teal" />
          <span>Send decline letter (template)</span>
        </label>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!finalReason || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(finalReason, sendLetter);
              } finally {
                setBusy(false);
              }
            }}
          >
            <XIcon className="mr-1 h-4 w-4" /> Decline
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
