// Top Performers tab — pre-computed rankings (Top Freelancers.xlsx in
// the source directory). One table per track, ordered by overall_rank.
// CSV export for the entire combined set.

import { useMemo } from 'react';
import { Download, ExternalLink, Trophy } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  downloadCsv,
  timestampedFilename,
} from '../../lib/ui';
import type { Column } from '../../lib/ui';
import type { EbTopPerformer } from '../../types/elevateBridge';
import { TRACK_LABEL, TRACK_TONE, groupTopPerformers } from './utils';

type Props = { rows: EbTopPerformer[] };

export function TopPerformersTab({ rows }: Props) {
  const groups = useMemo(() => groupTopPerformers(rows), [rows]);
  const ordered = useMemo(
    () => [...rows].sort((a, b) => (Number(a.overall_rank) || 9999) - (Number(b.overall_rank) || 9999)),
    [rows],
  );

  const exportAll = () => {
    const out = ordered.map(p => ({
      overall_rank: p.overall_rank,
      city_rank: p.city_rank,
      area: p.area,
      track: p.track,
      full_name_en: p.full_name_en,
      full_name_ar: p.full_name_ar,
      email: p.email,
      phone: p.phone,
      gender: p.gender,
      dob: p.dob,
      location: p.location,
      specialization: p.specialization,
      education_level: p.education_level,
      total_earnings: p.total_earnings,
      performance_score: p.performance_score,
      profile_url: p.profile_url,
      withdrew: p.withdrew,
    }));
    downloadCsv(timestampedFilename('elevatebridge-top-performers'), out);
  };

  const columns: Column<EbTopPerformer>[] = [
    {
      key: 'overall_rank',
      header: '#',
      width: '60px',
      render: r => (
        <div className="flex items-center gap-1">
          <Trophy className={`h-3 w-3 ${
            Number(r.overall_rank) === 1 ? 'text-amber-500' :
            Number(r.overall_rank) === 2 ? 'text-slate-400' :
            Number(r.overall_rank) === 3 ? 'text-amber-700' :
            'text-slate-300'
          }`} />
          <span className="font-bold">{r.overall_rank || '—'}</span>
        </div>
      ),
    },
    {
      key: 'full_name_en',
      header: 'Name',
      render: r => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy-500 dark:text-white">{r.full_name_en || r.full_name_ar}</div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{r.full_name_ar}</div>
        </div>
      ),
    },
    {
      key: 'area',
      header: 'Area',
      render: r => (
        <div>
          <div>{r.area}</div>
          <div className="text-[10px] text-slate-400">City rank #{r.city_rank}</div>
        </div>
      ),
    },
    { key: 'specialization', header: 'Specialization' },
    {
      key: 'performance_score',
      header: 'Score',
      render: r => <span className="font-mono font-bold">{r.performance_score || r.total_earnings || '—'}</span>,
    },
    {
      key: 'profile_url',
      header: 'Profile',
      render: r => r.profile_url ? (
        <a
          href={r.profile_url}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-brand-teal hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Open
        </a>
      ) : <span className="text-slate-400">—</span>,
    },
    {
      key: 'withdrew',
      header: 'Status',
      render: r => r.withdrew === 'Yes'
        ? <Badge tone="red">Withdrew</Badge>
        : <Badge tone="teal">Active</Badge>,
    },
  ];

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title="Top Performers" subtitle="Ranked finalists (FL / SM / Combined)" />
        <p className="text-sm text-slate-500">No top performers loaded. Populate the Top Performers tab in the workbook.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-300">
          {rows.length} ranked finalists across FL, SM, and Combined tracks.
        </p>
        <Button variant="ghost" onClick={exportAll}>
          <Download className="mr-1 h-4 w-4" /> Export all
        </Button>
      </div>

      {(['FL', 'SM', 'FL+SM'] as const).map(track => {
        const list = groups[track] || [];
        if (list.length === 0) return null;
        return (
          <Card key={track}>
            <CardHeader
              title={TRACK_LABEL[track]}
              subtitle={`${list.length} finalists`}
              action={<Badge tone={TRACK_TONE[track]}>{track}</Badge>}
            />
            <DataTable<EbTopPerformer> columns={columns} rows={list} emptyState="No finalists in this track." />
          </Card>
        );
      })}
    </div>
  );
}
