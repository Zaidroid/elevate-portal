// Read-only side panel showing the team's source procurement plan
// (1nKoKiJL0p8pfhLlkgIv-fyPUhg8e5cOP) next to our E3 output, with a
// match column so the team can see at a glance what's been migrated
// over and what hasn't.
//
// The portal NEVER writes to the source sheet. This is purely a
// read-and-compare surface.

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Eye, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, downloadCsv, timestampedFilename } from '../../lib/ui';
import type { Column } from '../../lib/ui';
import { getSheetId } from '../../config/sheets';
import { fetchProcurementSource, findE3Match, type SourceProcurementRow, type E3Row } from '../../lib/procurement/sourceParser';

export function SourceComparisonView({ e3Rows }: { e3Rows: E3Row[] }) {
  const sourceId = getSheetId('procurementSource');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SourceProcurementRow[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'unmatched' | 'matched'>('all');

  const reload = async () => {
    if (!sourceId) {
      setErrors(['VITE_SHEET_PROCUREMENT_SOURCE is not configured.']);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchProcurementSource(sourceId);
      setRows(r.rows);
      setTabs(r.tabs);
      setErrors(r.errors);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sourceId]);

  const annotated = useMemo(() => rows.map(src => {
    const match = findE3Match(src, e3Rows);
    return { src, match };
  }), [rows, e3Rows]);

  const filtered = useMemo(() => {
    if (filter === 'all') return annotated;
    if (filter === 'matched') return annotated.filter(a => a.match);
    return annotated.filter(a => !a.match);
  }, [annotated, filter]);

  const counts = useMemo(() => ({
    total: annotated.length,
    matched: annotated.filter(a => a.match).length,
    unmatched: annotated.filter(a => !a.match).length,
  }), [annotated]);

  const columns: Column<typeof annotated[number]>[] = [
    {
      key: 'source_tab',
      header: 'Month',
      width: '100px',
      render: a => <span className="font-mono text-xs text-slate-500">{a.src.source_tab}</span>,
    },
    {
      key: 'pr_id',
      header: 'Source PR',
      width: '120px',
      render: a => <span className="font-mono text-xs">{a.src.pr_id || '—'}</span>,
    },
    {
      key: 'activity',
      header: 'Activity',
      render: a => <span className="text-sm">{a.src.activity || a.src.item_description || '—'}</span>,
    },
    {
      key: 'total_cost_usd',
      header: 'Total USD',
      width: '110px',
      render: a => <span className="font-mono text-xs">${a.src.total_cost_usd || '—'}</span>,
    },
    {
      key: 'fund_code',
      header: 'Fund',
      width: '80px',
      render: a => <span className="font-mono text-xs">{a.src.fund_code || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Source status',
      width: '130px',
      render: a => a.src.status ? <Badge tone="neutral">{a.src.status}</Badge> : <span className="text-xs text-slate-400">—</span>,
    },
    {
      key: 'match',
      header: 'In E3 plan?',
      width: '180px',
      render: a => a.match ? (
        <span className="inline-flex items-center gap-1 text-xs">
          <Badge tone="green">Matched</Badge>
          <span className="font-mono text-slate-500">{a.match.pr_id || ''}</span>
          {a.match.status && <Badge tone="neutral">{a.match.status}</Badge>}
        </span>
      ) : (
        <Badge tone="amber">Not in E3 yet</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Team source vs E3 output"
          subtitle="Read-only view of the GSG team's procurement plan, compared against what's in our E3 quarterly tabs."
          action={
            <div className="flex items-center gap-2">
              {sourceId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${sourceId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal hover:underline"
                >
                  Open source <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={filtered.length === 0}
                onClick={() => downloadCsv(
                  timestampedFilename('procurement_source_diff'),
                  filtered.map(a => ({
                    month: a.src.source_tab,
                    source_pr: a.src.pr_id,
                    activity: a.src.activity,
                    total_usd: a.src.total_cost_usd,
                    fund: a.src.fund_code,
                    source_status: a.src.status,
                    matched: a.match ? 'yes' : 'no',
                    e3_pr: a.match?.pr_id || '',
                    e3_status: a.match?.status || '',
                  }))
                )}
              >
                Export
              </Button>
            </div>
          }
        />
        <div className="grid grid-cols-3 gap-3">
          <Stat tone="navy" label="Source rows" value={counts.total} sub={`${tabs.length} monthly tab${tabs.length === 1 ? '' : 's'} parsed`} />
          <Stat tone="green" label="Matched in E3" value={counts.matched} sub={pct(counts.matched, counts.total) + '% of source'} />
          <Stat tone="amber" label="Not in E3 yet" value={counts.unmatched} sub="Waiting to be migrated" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-slate-500">Show:</span>
          <Chip label={`All (${counts.total})`} active={filter === 'all'} onClick={() => setFilter('all')} />
          <Chip label={`Unmatched (${counts.unmatched})`} active={filter === 'unmatched'} onClick={() => setFilter('unmatched')} tone="amber" />
          <Chip label={`Matched (${counts.matched})`} active={filter === 'matched'} onClick={() => setFilter('matched')} tone="green" />
        </div>
        {errors.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            {errors[0]}
          </div>
        )}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Eye className="h-6 w-6" />}
            title={loading ? 'Reading source sheet…' : 'Nothing to show'}
            description={loading
              ? 'Pulling monthly tabs from the team source.'
              : 'No rows match the current filter — try switching to All.'}
          />
        </Card>
      ) : (
        <DataTable columns={columns} rows={filtered} />
      )}
    </div>
  );
}

function Stat({ tone, label, value, sub }: { tone: 'navy' | 'green' | 'amber'; label: string; value: number | string; sub?: string }) {
  const tones: Record<string, string> = {
    navy: 'bg-navy-500/5 text-navy-500 dark:text-white',
    green: 'bg-emerald-500/10 text-emerald-700',
    amber: 'bg-amber-500/10 text-amber-700',
  };
  return (
    <div className={`rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-2xs font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-2xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-2xs opacity-70">{sub}</div>}
    </div>
  );
}

function Chip({ label, active, onClick, tone = 'navy' }: { label: string; active: boolean; onClick: () => void; tone?: 'navy' | 'amber' | 'green' }) {
  const activeBg = tone === 'amber' ? 'bg-amber-500 text-white' : tone === 'green' ? 'bg-emerald-500 text-white' : 'bg-navy-500 text-white';
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

function pct(num: number, denom: number): string {
  if (denom <= 0) return '0';
  return Math.round((num / denom) * 100).toString();
}
