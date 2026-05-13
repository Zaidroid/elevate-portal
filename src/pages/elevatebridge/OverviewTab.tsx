// Overview tab — funnel cards, track and region distribution, mentor
// cards, training progress, and the canonical programme timeline. All
// reads, no writes. The numbers are computed live from the workbook;
// when they drift from the report's official numbers, the card colour
// hints at the discrepancy so the team notices.

import { Calendar, MapPin, ScrollText, TrendingUp, Trophy, Users } from 'lucide-react';
import { Badge, Card, CardHeader } from '../../lib/ui';
import type {
  EbApplicant,
  EbDecisionRow,
  EbMentor,
  EbSession,
  EbTopPerformer,
} from '../../types/elevateBridge';
import {
  FUNNEL_TARGET,
  TRACK_LABEL,
  TRACK_TONE,
  capacitySummary,
  computeFunnel,
  regionDistribution,
  trackDistribution,
} from './utils';

type Props = {
  applicants: EbApplicant[];
  decisions: EbDecisionRow[];
  mentors: EbMentor[];
  sessions: EbSession[];
  topPerformers: EbTopPerformer[];
};

const TIMELINE = [
  { phase: 'Open Call',     dates: 'Oct 13 – Oct 31, 2025', detail: 'GSG digital channels · SM + FL tracks' },
  { phase: 'S1 Filtering',  dates: 'Nov 2025',              detail: 'Income ≤ $1k or outside Palestine → Waitlist' },
  { phase: 'S2 Sorting',    dates: 'Nov 2025',              detail: 'Reassign to FL / SM / Combined by achievable income' },
  { phase: 'S3 Evaluation', dates: 'Dec 2025 – Jan 2026',   detail: 'SSI + Response Scoring + Interview Scoring' },
  { phase: 'Capacity',      dates: 'Feb 2 – Apr 5, 2026',   detail: '3 tracks · 50+ mentored hours' },
];

function FunnelCard({
  label,
  live,
  target,
  accent,
}: {
  label: string;
  live: number;
  target: number;
  accent: 'red' | 'teal' | 'orange' | 'none';
}) {
  const drift = live - target;
  return (
    <Card accent={accent} className="text-center">
      <div className="text-2xs font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-4xl font-extrabold tracking-tight text-navy-500 dark:text-white">
        {live}
      </div>
      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Report target: <span className="font-semibold">{target}</span>
        {drift !== 0 && (
          <span className={`ml-1 ${drift > 0 ? 'text-brand-teal' : 'text-brand-red'}`}>
            ({drift > 0 ? '+' : ''}{drift})
          </span>
        )}
      </div>
    </Card>
  );
}

export function OverviewTab({ applicants, decisions, mentors, sessions, topPerformers }: Props) {
  const funnel = computeFunnel(applicants);
  const tracks = trackDistribution(applicants);
  const regions = regionDistribution(applicants);
  const capacity = capacitySummary(mentors, sessions);
  const totalAdmitted = decisions.filter(d => d.decision === 'Admitted').length;

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <TrendingUp className="h-4 w-4" />
          Selection funnel
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <FunnelCard label="Total applications" live={funnel.total} target={FUNNEL_TARGET.totalApplications} accent="none" />
          <FunnelCard label="Waitlisted" live={funnel.waitlisted} target={FUNNEL_TARGET.waitlisted} accent="orange" />
          <FunnelCard label="Qualified S2" live={funnel.qualifiedStage2} target={FUNNEL_TARGET.qualifiedStage2} accent="teal" />
          <FunnelCard label="Final admitted" live={totalAdmitted || funnel.admitted} target={FUNNEL_TARGET.finalAdmitted} accent="red" />
          <FunnelCard label="Active (net)" live={funnel.netCapacity} target={FUNNEL_TARGET.capacityNet} accent="red" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Track distribution"
            subtitle="Assigned track after S2 (Track Sorting)"
            overline={<><Users className="-mt-0.5 mr-1 inline h-3 w-3" /> Cohort split</>}
          />
          <div className="space-y-2.5">
            {Object.entries(tracks).map(([track, count]) => {
              const label = TRACK_LABEL[track] || track;
              const tone = TRACK_TONE[track] || 'neutral';
              const pct = funnel.total > 0 ? Math.round((count / funnel.total) * 100) : 0;
              return (
                <div key={track}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-navy-500 dark:text-white">{label}</span>
                    <span className="text-slate-500 dark:text-slate-400">{count} · {pct}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                    <div
                      className={
                        tone === 'teal' ? 'h-full bg-brand-teal' :
                        tone === 'orange' ? 'h-full bg-brand-orange' :
                        tone === 'red' ? 'h-full bg-brand-red' :
                        'h-full bg-slate-400'
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Region distribution"
            subtitle="Self-reported location at application"
            overline={<><MapPin className="-mt-0.5 mr-1 inline h-3 w-3" /> Geography</>}
          />
          <div className="space-y-2.5">
            {Object.entries(regions).map(([region, count]) => {
              const pct = funnel.total > 0 ? Math.round((count / funnel.total) * 100) : 0;
              return (
                <div key={region}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-navy-500 dark:text-white">{region}</span>
                    <span className="text-slate-500 dark:text-slate-400">{count} · {pct}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                    <div className="h-full bg-navy-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Capacity building"
          subtitle={`Feb 2 – Apr 5, 2026  ·  ${capacity.sessionsCompleted}/${capacity.sessionsScheduled} sessions completed  ·  ${capacity.completedHours} mentored hours delivered`}
          overline={<><ScrollText className="-mt-0.5 mr-1 inline h-3 w-3" /> Upskilling programme</>}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {mentors.length === 0 ? (
            <p className="col-span-3 text-sm text-slate-500">No mentors loaded. Populate the Mentors tab to see them here.</p>
          ) : (
            mentors.map(m => {
              const trackSessions = sessions.filter(s => s.track === m.track);
              const done = trackSessions.filter(s => (s.status || '').toLowerCase() === 'completed').length;
              const budget = Number(m.budget_total || '0') || 0;
              const rate = Number(m.hourly_rate || '0') || 0;
              const hours = trackSessions
                .filter(s => (s.status || '').toLowerCase() === 'completed')
                .reduce((acc, s) => acc + (Number(s.hours || '0') || 0), 0);
              const spent = hours * rate;
              const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
              return (
                <div key={m.mentor_id} className="rounded-xl border border-slate-200 p-4 dark:border-navy-700">
                  <div className="text-2xs font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                    {m.track || 'Untitled track'}
                  </div>
                  <div className="mt-1 text-sm font-bold text-navy-500 dark:text-white">{m.full_name || 'TBA'}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <div className="text-slate-400">Sessions</div>
                      <div className="font-semibold text-navy-500 dark:text-white">{done} / {trackSessions.length}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Hours done</div>
                      <div className="font-semibold text-navy-500 dark:text-white">{hours}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Rate</div>
                      <div className="font-semibold text-navy-500 dark:text-white">${rate}/hr</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Budget</div>
                      <div className="font-semibold text-navy-500 dark:text-white">${budget}</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
                    <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">${Math.round(spent)} spent · {pct}% of budget</div>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-navy-700/40">
          <div className="text-xs text-slate-500 dark:text-slate-300">
            Programme budget · <span className="font-semibold text-navy-500 dark:text-white">${capacity.totalBudget}</span> committed
          </div>
          <Badge tone={capacity.spent > capacity.totalBudget ? 'red' : 'teal'}>
            ${Math.round(capacity.spent)} spent · ${Math.max(0, capacity.totalBudget - capacity.spent)} remaining
          </Badge>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Programme timeline"
          subtitle="October 2025 – April 2026"
          overline={<><Calendar className="-mt-0.5 mr-1 inline h-3 w-3" /> Phases</>}
        />
        <ol className="space-y-3">
          {TIMELINE.map(t => (
            <li key={t.phase} className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-brand-red" />
              <div>
                <div className="text-sm font-bold text-navy-500 dark:text-white">{t.phase}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{t.dates}</div>
                <div className="text-xs text-slate-500 dark:text-slate-300">{t.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Top performers preview"
          subtitle="Final-stage ranked freelancers (see the Top Performers tab for the full list and CSV export)"
          overline={<><Trophy className="-mt-0.5 mr-1 inline h-3 w-3" /> Spotlight</>}
        />
        {topPerformers.length === 0 ? (
          <p className="text-sm text-slate-500">No top performers loaded yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {topPerformers.slice(0, 6).map(p => (
              <div key={p.applicant_id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-navy-700">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-navy-500 dark:text-white">{p.full_name_en || p.full_name_ar}</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">{p.area} · {TRACK_LABEL[p.track] || p.track}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-lg font-extrabold text-navy-500 dark:text-white">{p.performance_score || p.total_earnings || '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Rank #{p.overall_rank}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
