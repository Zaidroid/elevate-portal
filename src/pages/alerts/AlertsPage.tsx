// /alerts — central inbox of time-sensitive items across modules. Aggregates
// PR deadlines, pending payments, overdue follow-ups, unsigned agreements,
// pending visas. Clicking an alert deep-links to the source module.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Bell,
  Clock,
  ClipboardList,
  FileText,
  ListChecks,
  Plane,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import { Badge, Card, CardHeader, EmptyState } from '../../lib/ui';
import { alertCounts, computeAlerts, type Alert, type AlertKind } from '../../lib/alerts';

type Row = Record<string, string>;

const KIND_ICON: Record<AlertKind, React.ReactNode> = {
  pr_overdue: <ClipboardList className="h-4 w-4" />,
  pr_due_soon: <ClipboardList className="h-4 w-4" />,
  payment_pending_approval: <Wallet className="h-4 w-4" />,
  followup_overdue: <ListChecks className="h-4 w-4" />,
  agreement_unsigned: <FileText className="h-4 w-4" />,
  conf_visa_pending: <Plane className="h-4 w-4" />,
  advisor_mention: <AtSign className="h-4 w-4" />,
  advisor_stuck: <Clock className="h-4 w-4" />,
};

export function AlertsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.email || '');

  const procurementId = getSheetId('procurement');
  const paymentsId = getSheetId('payments');
  const docsId = getSheetId('docs');
  const advisorsId = getSheetId('advisors');
  const conferencesId = getSheetId('conferences');

  const { rows: q1 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q1'), 'pr_id');
  const { rows: q2 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q2'), 'pr_id');
  const { rows: q3 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q3'), 'pr_id');
  const { rows: q4 } = useSheetDoc<Row>(procurementId || null, getTab('procurement', 'q4'), 'pr_id');
  const { rows: payments } = useSheetDoc<Row>(paymentsId || null, getTab('payments', 'payments'), 'payment_id');
  const { rows: agreements } = useSheetDoc<Row>(docsId || null, getTab('docs', 'agreements'), 'agreement_id');
  const { rows: followups } = useSheetDoc<Row>(advisorsId || null, getTab('advisors', 'followups'), 'followup_id');
  const { rows: advisorRows } = useSheetDoc<Row>(advisorsId || null, getTab('advisors', 'advisors'), 'advisor_id');
  const { rows: advisorComments } = useSheetDoc<Row>(advisorsId || null, getTab('advisors', 'comments'), 'comment_id');
  const { rows: advisorActivity } = useSheetDoc<Row>(advisorsId || null, getTab('advisors', 'activity'), 'activity_id');
  const { rows: confTracker } = useSheetDoc<Row>(conferencesId || null, getTab('conferences', 'tracker'), 'tracker_id');

  const alerts = useMemo(
    () => computeAlerts({
      prs: [...q1, ...q2, ...q3, ...q4],
      payments,
      agreements,
      followups,
      confTracker,
      advisorComments,
      advisors: advisorRows,
      advisorActivity,
      userEmail: user?.email,
      isAdmin: admin,
    }),
    [q1, q2, q3, q4, payments, agreements, followups, confTracker, advisorComments, advisorRows, advisorActivity, user?.email, admin]
  );

  const counts = alertCounts(alerts);
  const grouped = useMemo(() => {
    const m: Record<AlertKind, Alert[]> = {
      pr_overdue: [],
      pr_due_soon: [],
      payment_pending_approval: [],
      followup_overdue: [],
      agreement_unsigned: [],
      conf_visa_pending: [],
      advisor_mention: [],
      advisor_stuck: [],
    };
    for (const a of alerts) m[a.kind].push(a);
    return m;
  }, [alerts]);

  const sections: Array<{ kind: AlertKind; title: string; subtitle: string }> = [
    { kind: 'advisor_mention', title: 'Comments mentioning you', subtitle: 'Recent advisor comments where you were @-mentioned' },
    { kind: 'pr_overdue', title: 'Past-due PRs', subtitle: 'Procurement deadlines that have already slipped' },
    { kind: 'followup_overdue', title: 'Overdue follow-ups', subtitle: 'Advisor follow-ups that should have been handled' },
    { kind: 'advisor_stuck', title: 'Your advisors stuck past SLA', subtitle: 'Advisors assigned to you that have not moved in over a week past expected time' },
    { kind: 'pr_due_soon', title: 'PRs due this week', subtitle: 'Submit before the SLA window closes' },
    { kind: 'payment_pending_approval', title: 'Payments pending approval', subtitle: admin ? 'Awaiting your approval' : '' },
    { kind: 'agreement_unsigned', title: 'Agreements stuck in "Sent"', subtitle: 'Sent more than 14 days ago, no signature on file yet' },
    { kind: 'conf_visa_pending', title: 'Conference travel — visa pending', subtitle: 'Within next 30 days' },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6 text-brand-red" />
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Alerts</h1>
          <Badge tone="red">{counts.red}</Badge>
          <Badge tone="amber">{counts.amber}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Cross-module inbox of items that need action. Pulled live from every Cohort 3 sheet.
        </p>
      </header>

      {alerts.length === 0 && (
        <Card>
          <EmptyState
            icon={<Bell className="h-7 w-7" />}
            title="Nothing needs your attention"
            description="No overdue PRs, no pending approvals, no overdue follow-ups, no unsigned agreements, no visa gaps."
          />
        </Card>
      )}

      {sections.map(s => {
        const list = grouped[s.kind];
        if (list.length === 0) return null;
        return (
          <Card key={s.kind}>
            <CardHeader title={`${s.title} (${list.length})`} subtitle={s.subtitle} />
            <ul className="space-y-1.5">
              {list.map(a => <AlertRow key={a.id} alert={a} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const tone = alert.severity === 'red' ? 'red' : 'amber';
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-navy-700">
      <div className={`mt-0.5 flex-shrink-0 rounded-full p-1 ${alert.severity === 'red' ? 'bg-brand-red/10 text-brand-red' : 'bg-amber-500/10 text-amber-700'}`}>
        {alert.severity === 'red' ? <AlertTriangle className="h-3.5 w-3.5" /> : KIND_ICON[alert.kind]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-navy-500 dark:text-white">{alert.title}</span>
          <Badge tone={tone}>{alert.severity === 'red' ? 'Action' : 'Soon'}</Badge>
        </div>
        <div className="text-xs text-slate-500">{alert.detail}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        {alert.due && <span className="font-mono text-xs text-slate-500">{alert.due}</span>}
        <Link to={alert.href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal hover:underline">
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </li>
  );
}
