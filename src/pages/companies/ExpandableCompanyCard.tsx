// ExpandableCompanyCard — replaces the small kanban-card body with a click-
// to-expand panel. Compact mode shows the essentials (name, fund, PM, pillar
// dots, review consensus, status). Expanded mode shows contact + recent
// comments + quick actions: change PM, add intervention, post comment, jump
// to detail. All actions delegate up via callbacks so the parent can route
// the writes through useSheetDoc / lib/sheets/client.

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, MessageCircle, Plus, UserCircle2 } from 'lucide-react';
import { Badge } from '../../lib/ui';
import { displayName } from '../../config/team';
import type { ReviewSummary } from './reviewTypes';

export type CardCompany = {
  route_id: string;
  company_id: string;
  company_name: string;
  sector: string;
  city: string;
  governorate: string;
  fund_code: string;
  status: string;
  profile_manager_email: string;
  contact_email: string;
  intervention_count: number;
  intervention_pillars: string[];
};

const PILLAR_DOT_COLOR: Record<string, string> = {
  TTH: 'bg-brand-teal',
  Upskilling: 'bg-brand-orange',
  MKG: 'bg-brand-red',
  MA: 'bg-brand-navy',
  ElevateBridge: 'bg-amber-500',
  'C-Suite': 'bg-brand-teal',
  Conferences: 'bg-brand-orange',
};

export function ExpandableCompanyCard({
  row,
  reviewSummary,
  onOpen,
  onChangePM,
  onAddIntervention,
  onAddComment,
}: {
  row: CardCompany;
  reviewSummary?: ReviewSummary;
  onOpen: (route_id: string) => void;
  onChangePM?: () => void;
  onAddIntervention?: () => void;
  onAddComment?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const pmName = row.profile_manager_email ? displayName(row.profile_manager_email).split(' ')[0] : '';

  return (
    <div className="space-y-1.5">
      {/* Compact header */}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-navy-500 dark:text-white">{row.company_name || '—'}</div>
          <div className="truncate text-2xs text-slate-500">
            {[row.sector, row.governorate].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(s => !s); }}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-navy-700"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {row.fund_code && (
          <Badge tone={row.fund_code === '97060' ? 'teal' : 'amber'}>
            {row.fund_code === '97060' ? 'Dutch' : 'SIDA'}
          </Badge>
        )}
        {pmName && (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200">
            <UserCircle2 className="h-2.5 w-2.5" /> {pmName}
          </span>
        )}
        {row.intervention_count > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200"
            title={row.intervention_pillars.join(', ')}
          >
            {row.intervention_pillars.map(p => (
              <span key={p} className={`inline-block h-1.5 w-1.5 rounded-full ${PILLAR_DOT_COLOR[p] || 'bg-slate-400'}`} />
            ))}
            {row.intervention_count}× int
          </span>
        ) : (
          <span className="text-[10px] font-medium text-slate-400 italic">no interventions</span>
        )}
        {reviewSummary && reviewSummary.total > 0 && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
              reviewSummary.consensus === 'Recommend'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : reviewSummary.consensus === 'Reject'
                ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                : reviewSummary.consensus === 'Hold'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
                : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200'
            }`}
            title={`${reviewSummary.total} review${reviewSummary.total === 1 ? '' : 's'}${reviewSummary.divergence ? ' (divergent)' : ''}`}
          >
            {reviewSummary.total}× {reviewSummary.consensus}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-2xs dark:border-navy-700 dark:bg-navy-800">
          {row.contact_email && (
            <div>
              <span className="font-semibold text-slate-500">Contact:</span>{' '}
              <a
                href={`mailto:${row.contact_email}`}
                onClick={e => e.stopPropagation()}
                className="text-brand-teal hover:underline"
              >
                {row.contact_email}
              </a>
            </div>
          )}
          {row.city && <div><span className="font-semibold text-slate-500">City:</span> {row.city}</div>}
          {reviewSummary && reviewSummary.total > 0 && (
            <div>
              <span className="font-semibold text-slate-500">Reviews:</span>{' '}
              <span className="text-emerald-700 dark:text-emerald-300">{reviewSummary.recommend} rec</span>
              {' · '}
              <span className="text-amber-700 dark:text-amber-300">{reviewSummary.hold} hold</span>
              {' · '}
              <span className="text-red-700 dark:text-red-300">{reviewSummary.reject} rej</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1 pt-1">
            <ActionBtn icon={<ExternalLink className="h-3 w-3" />} label="Open" onClick={() => onOpen(row.route_id)} />
            {onChangePM && <ActionBtn icon={<UserCircle2 className="h-3 w-3" />} label="PM" onClick={onChangePM} />}
            {onAddIntervention && <ActionBtn icon={<Plus className="h-3 w-3" />} label="Intervention" onClick={onAddIntervention} />}
            {onAddComment && <ActionBtn icon={<MessageCircle className="h-3 w-3" />} label="Comment" onClick={onAddComment} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-navy-700 dark:bg-navy-900 dark:text-slate-200 dark:hover:bg-navy-700"
    >
      {icon} {label}
    </button>
  );
}
