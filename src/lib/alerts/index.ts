// Alert aggregator. Pure function: given module data, returns the list of
// time-sensitive items the team needs to act on. Used by /alerts and by the
// header bell badge.

export type AlertSeverity = 'red' | 'amber';
export type AlertKind =
  | 'pr_overdue'
  | 'pr_due_soon'
  | 'payment_pending_approval'
  | 'followup_overdue'
  | 'agreement_unsigned'
  | 'conf_visa_pending'
  | 'advisor_mention'
  | 'advisor_stuck';

export type Alert = {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  due?: string;
  href: string;
};

type Row = Record<string, string>;

export type AlertInputs = {
  prs: Row[];                  // combined Q1..Q4
  payments: Row[];
  agreements: Row[];
  followups: Row[];
  confTracker: Row[];
  advisorComments?: Row[];     // for @-mention alerts
  advisors?: Row[];            // for @-mentions display + stuck alerts
  advisorActivity?: Row[];     // for stuck alerts (latest status_change ts)
  userEmail?: string;          // for filtering @-mentions to current user
  isAdmin: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(a + 'T00:00:00Z').getTime();
  const bd = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((bd - ad) / DAY_MS);
}

export function computeAlerts(inputs: AlertInputs): Alert[] {
  const today = isoToday();
  const horizon7 = addDays(today, 7);
  const horizon30 = addDays(today, 30);
  const out: Alert[] = [];

  // Procurement deadlines (Draft / Submitted / Under Review only).
  for (const pr of inputs.prs) {
    const deadline = pr.pr_deadline || '';
    const status = pr.status || '';
    if (!deadline) continue;
    if (status !== 'Draft' && status !== 'Submitted' && status !== 'Under Review') continue;
    if (deadline < today) {
      out.push({
        id: `pr-${pr.pr_id || deadline}`,
        kind: 'pr_overdue',
        severity: 'red',
        title: `PR overdue: ${pr.activity || pr.pr_id || ''}`,
        detail: `${pr.pr_id || ''} · ${pr.threshold_class || ''} · status ${status}`,
        due: deadline,
        href: '/procurement',
      });
    } else if (deadline <= horizon7) {
      out.push({
        id: `pr-${pr.pr_id || deadline}`,
        kind: 'pr_due_soon',
        severity: 'amber',
        title: `PR due in ${daysBetween(today, deadline)} day(s)`,
        detail: `${pr.pr_id || ''} · ${pr.activity || ''}`,
        due: deadline,
        href: '/procurement',
      });
    }
  }

  // Payments pending approval (admin only — non-admins do not own approvals).
  if (inputs.isAdmin) {
    for (const p of inputs.payments) {
      if (p.status !== 'Pending Approval') continue;
      out.push({
        id: `pay-${p.payment_id || p.payee_name}`,
        kind: 'payment_pending_approval',
        severity: 'amber',
        title: `Payment pending approval: ${p.payee_name || p.payment_id || ''}`,
        detail: `$${p.amount_usd || '0'} ${p.currency || 'USD'} · ${p.intervention_type || ''}`,
        href: '/payments',
      });
    }
  }

  // Follow-ups overdue
  for (const f of inputs.followups) {
    if (f.status !== 'Open') continue;
    if (!f.due_date) continue;
    if (f.due_date < today) {
      out.push({
        id: `fu-${f.followup_id || f.due_date}`,
        kind: 'followup_overdue',
        severity: 'red',
        title: `Follow-up overdue (${f.type || 'task'})`,
        detail: `Advisor ${f.advisor_id || ''} · assignee ${f.assignee_email || '—'}`,
        due: f.due_date,
        href: '/advisors',
      });
    }
  }

  // Agreements: status === 'Sent' for >14 days without signed_date.
  for (const a of inputs.agreements) {
    if (a.status !== 'Sent') continue;
    if (a.signed_date) continue;
    const updated = a.updated_at?.slice(0, 10) || '';
    if (!updated) continue;
    const elapsed = daysBetween(updated, today);
    if (elapsed > 14) {
      out.push({
        id: `agr-${a.agreement_id || a.company_name}`,
        kind: 'agreement_unsigned',
        severity: 'amber',
        title: `Agreement sent ${elapsed} days ago, still unsigned`,
        detail: `${a.company_name || ''} · ${a.agreement_type || ''}`,
        due: updated,
        href: '/docs',
      });
    }
  }

  // Advisor @-mentions in comments → alert the mentioned user.
  if (inputs.advisorComments && inputs.userEmail) {
    const me = inputs.userEmail.toLowerCase();
    const advisorById = new Map<string, Row>();
    for (const a of inputs.advisors || []) {
      if (a.advisor_id) advisorById.set(a.advisor_id, a);
    }
    for (const c of inputs.advisorComments) {
      const body = c.body || '';
      const re = /@([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
      let m: RegExpExecArray | null;
      const mentioned: string[] = [];
      while ((m = re.exec(body)) !== null) mentioned.push(m[1].toLowerCase());
      if (!mentioned.includes(me)) continue;
      const adv = advisorById.get(c.advisor_id || '');
      const advName = adv?.full_name || adv?.email || c.advisor_id || 'an advisor';
      out.push({
        id: `adv-mention-${c.comment_id || `${c.advisor_id}-${c.created_at}`}`,
        kind: 'advisor_mention',
        severity: 'amber',
        title: `${c.author_email || 'Someone'} mentioned you on ${advName}`,
        detail: body.slice(0, 120),
        due: (c.created_at || '').slice(0, 10),
        href: '/advisors',
      });
    }
  }

  // Stuck advisors (>14 days past status SLA) — only for the user who owns
  // them (assignee_email match). Avoids spamming everyone.
  if (inputs.advisors && inputs.userEmail && inputs.advisorActivity) {
    const me = inputs.userEmail.toLowerCase();
    const lastChangeByAdv = new Map<string, string>();
    for (const a of inputs.advisorActivity) {
      if (a.action !== 'status_change') continue;
      const cur = lastChangeByAdv.get(a.advisor_id || '');
      if (!cur || (a.timestamp || '') > cur) lastChangeByAdv.set(a.advisor_id || '', a.timestamp || '');
    }
    const SLA: Record<string, number> = {
      New: 3, Acknowledged: 7, Allocated: 14, 'Intro Scheduled': 14,
      'Intro Done': 14, Assessment: 14, Approved: 30, 'On Hold': 14,
    };
    for (const adv of inputs.advisors) {
      if ((adv.assignee_email || '').toLowerCase() !== me) continue;
      const status = adv.pipeline_status || 'New';
      if (status === 'Archived' || status === 'Rejected' || status === 'Matched') continue;
      const sla = SLA[status] ?? 9999;
      const lc = lastChangeByAdv.get(adv.advisor_id || '') || adv.updated_at || '';
      const t = Date.parse(lc);
      if (!Number.isFinite(t)) continue;
      const days = Math.floor((Date.now() - t) / DAY_MS);
      if (days > sla + 7) { // only alert when notably past SLA
        out.push({
          id: `adv-stuck-${adv.advisor_id}`,
          kind: 'advisor_stuck',
          severity: 'amber',
          title: `${adv.full_name || adv.email || adv.advisor_id} stuck ${days}d in ${status}`,
          detail: `Past SLA (${sla}d). Advance, reassign, or move to On Hold.`,
          due: lc.slice(0, 10),
          href: '/advisors',
        });
      }
    }
  }

  // Conference travel: travel_dates within 30 days, visa_status incomplete.
  for (const c of inputs.confTracker) {
    if (c.decision !== 'Committed') continue;
    if (!c.travel_dates) continue;
    const travelStart = c.travel_dates.split('-')[0]?.trim() || c.travel_dates;
    if (travelStart < today || travelStart > horizon30) continue;
    const visa = (c.visa_status || '').toLowerCase();
    if (visa === 'approved' || visa === 'not required') continue;
    out.push({
      id: `conf-${c.tracking_id || c.company_name}-${c.conference_name || ''}`,
      kind: 'conf_visa_pending',
      severity: 'amber',
      title: `Visa ${c.visa_status || 'pending'} for ${c.company_name || 'company'}`,
      detail: `${c.conference_name || ''} · travel ${c.travel_dates}`,
      due: travelStart,
      href: '/conferences',
    });
  }

  // Sort: red first, then by due date ascending.
  out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'red' ? -1 : 1;
    return (a.due || '').localeCompare(b.due || '');
  });
  return out;
}

export function alertCounts(alerts: Alert[]): { red: number; amber: number; total: number } {
  const red = alerts.filter(a => a.severity === 'red').length;
  return { red, amber: alerts.length - red, total: alerts.length };
}
