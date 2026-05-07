// Reverse-mapping panel: shows the advisors assigned to this company.
//
// The Advisors page is the master for advisor data and writes; this
// tab is read-only on the company side, with deep-links into
// /advisors?focus=<id> so the team can open the rich detail drawer
// where edits, comments, follow-ups, and outreach all live.

import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap } from 'lucide-react';
import { Badge, Card, CardHeader, DataTable, EmptyState } from '../../lib/ui';
import type { Column, Tone } from '../../lib/ui';
import type { Advisor } from '../../types/advisor';

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

function daysSince(iso: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export function AssignedAdvisorsTab({ rows }: { rows: Advisor[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="No advisors assigned yet"
          description="Match an approved advisor to this company from the Advisors page. They'll appear here with status, intervention type, and last outreach."
        />
      </Card>
    );
  }

  const columns: Column<Advisor>[] = [
    {
      key: 'full_name',
      header: 'Name',
      render: a => (
        <div>
          <Link to={`/advisors?focus=${encodeURIComponent(a.advisor_id)}`} className="font-semibold text-navy-500 hover:text-brand-teal hover:underline dark:text-white">
            {a.full_name || a.email || a.advisor_id}
          </Link>
          {a.email && (
            <div className="text-xs text-slate-500">{a.email}</div>
          )}
        </div>
      ),
    },
    {
      key: 'pipeline_status',
      header: 'Status',
      render: a => <Badge tone={pipelineTone(a.pipeline_status)}>{a.pipeline_status || 'New'}</Badge>,
    },
    {
      key: 'assignment_intervention_type',
      header: 'Intervention',
      render: a => a.assignment_intervention_type || '—',
    },
    {
      key: 'assignment_status',
      header: 'Engagement',
      render: a => a.assignment_status || 'Planned',
    },
    {
      key: 'days_assigned',
      header: 'Assigned',
      render: a => daysSince(a.intro_done_date || a.decision_date || a.assessment_date || ''),
    },
    {
      key: 'last_outreach_at',
      header: 'Last outreach',
      render: a => a.last_outreach_at ? (
        <span className="text-xs text-slate-600 dark:text-slate-300">
          {a.last_outreach_at.slice(0, 10)}
          {a.last_outreach_template && (
            <span className="ml-1 text-2xs text-slate-400">· {a.last_outreach_template}</span>
          )}
        </span>
      ) : <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: 'open',
      header: '',
      render: a => (
        <Link
          to={`/advisors?focus=${encodeURIComponent(a.advisor_id)}`}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-2xs font-bold uppercase tracking-wider text-brand-teal hover:bg-teal-50 dark:border-navy-700 dark:hover:bg-teal-900/30"
        >
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={`Assigned advisors · ${rows.length}`}
        subtitle="Read-only view. Open in Advisors to edit, comment, log outreach, or move pipeline status."
      />
      <DataTable columns={columns} rows={rows as unknown as Record<string, unknown>[] as Advisor[]} />
    </Card>
  );
}
