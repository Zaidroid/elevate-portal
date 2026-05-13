// Applicants tab — the full 203 enriched with per-applicant lineage.
// Search + FilterDrawer (stage, track, region, decision, score-bucket).
// Row click opens the per-applicant drawer.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Badge,
  DataTable,
  FilterDrawer,
  FilterToggleButton,
  downloadCsv,
  timestampedFilename,
  Button,
} from '../../lib/ui';
import type { Column, FilterDrawerValues, FilterFieldDef } from '../../lib/ui';
import { Download } from 'lucide-react';
import type {
  EbInterview,
  EbRubric,
  EbStage3Response,
} from '../../types/elevateBridge';
import {
  DECISION_TONE,
  TRACK_LABEL,
  TRACK_TONE,
  matchesApplicantQuery,
  type EnrichedApplicant,
} from './utils';
import { ApplicantDrawer } from './ApplicantDrawer';

type Props = {
  enriched: EnrichedApplicant[];
  responses: EbStage3Response[];
  interviews: EbInterview[];
  rubrics: EbRubric[];
  canEdit: boolean;
  userEmail: string;
  sheetId: string;
  updateApplicant: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  updateDecision: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createDecision: (row: Partial<Record<string, string>>) => Promise<unknown>;
};

export function ApplicantsTab({
  enriched,
  responses,
  interviews,
  rubrics,
  canEdit,
  userEmail,
  sheetId,
  updateApplicant,
  updateDecision,
  createDecision,
}: Props) {
  const [query, setQuery] = useState('');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [values, setValues] = useState<FilterDrawerValues>({
    tracks: [],
    regions: [],
    decision: '',
    stage: '',
  });
  const [openApplicantId, setOpenApplicantId] = useState<string | null>(null);

  const fields = useMemo<FilterFieldDef[]>(() => [
    {
      key: 'tracks',
      type: 'multiselect',
      label: 'Track (assigned)',
      options: [
        { value: 'FL', label: 'Freelance (Upwork)' },
        { value: 'SM', label: 'Social Media / BD' },
        { value: 'FL+SM', label: 'Combined' },
        { value: '', label: 'Unassigned' },
      ],
    },
    {
      key: 'regions',
      type: 'multiselect',
      label: 'Region',
      options: [
        { value: 'West Bank', label: 'West Bank' },
        { value: 'Gaza Strip', label: 'Gaza Strip' },
        { value: 'Outside Palestine', label: 'Outside Palestine' },
      ],
    },
    {
      key: 'decision',
      type: 'chips',
      label: 'Decision',
      options: [
        { value: 'Admitted', label: 'Admitted' },
        { value: 'Waitlisted', label: 'Waitlisted' },
        { value: 'Withdrew', label: 'Withdrew' },
        { value: 'Dropped', label: 'Dropped' },
        { value: 'Disqualified', label: 'Disqualified' },
      ],
    },
    {
      key: 'stage',
      type: 'select',
      label: 'Current stage',
      placeholder: 'All stages',
      options: [
        { value: 'Applied', label: 'Applied' },
        { value: 'S1 Filter', label: 'S1 Filter' },
        { value: 'S2 Sort', label: 'S2 Sort' },
        { value: 'S3 Scoring', label: 'S3 Scoring' },
        { value: 'Interview', label: 'Interview' },
        { value: 'Decision', label: 'Decision' },
      ],
    },
  ], []);

  const filtered = useMemo(() => {
    const tracks  = (Array.isArray(values.tracks)  ? values.tracks  : []) as string[];
    const regions = (Array.isArray(values.regions) ? values.regions : []) as string[];
    const decision = (typeof values.decision === 'string' ? values.decision : '') as string;
    const stage    = (typeof values.stage    === 'string' ? values.stage    : '') as string;

    return enriched.filter(a => {
      if (!matchesApplicantQuery(a, query)) return false;
      if (tracks.length > 0 && !tracks.includes(a.track_assigned || '')) return false;
      if (regions.length > 0 && !regions.includes(a.region)) return false;
      if (decision && a.decision !== decision) return false;
      if (stage && a.current_stage !== stage) return false;
      return true;
    });
  }, [enriched, query, values]);

  const activeCount = useMemo(() => {
    let n = 0;
    if (Array.isArray(values.tracks) && values.tracks.length > 0) n++;
    if (Array.isArray(values.regions) && values.regions.length > 0) n++;
    if (typeof values.decision === 'string' && values.decision) n++;
    if (typeof values.stage === 'string' && values.stage) n++;
    return n;
  }, [values]);

  const columns: Column<EnrichedApplicant>[] = [
    {
      key: 'display_name',
      header: 'Name',
      render: a => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy-500 dark:text-white">{a.display_name}</div>
          <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{a.email}</div>
        </div>
      ),
    },
    {
      key: 'track_assigned',
      header: 'Track',
      render: a => {
        const assigned = a.track_assigned || '';
        if (!assigned) return <span className="text-slate-400">—</span>;
        const tone = TRACK_TONE[assigned] || 'neutral';
        return <Badge tone={tone}>{TRACK_LABEL[assigned] || assigned}</Badge>;
      },
    },
    { key: 'region',   header: 'Region',   render: a => a.region || '—' },
    { key: 'current_stage', header: 'Stage' },
    {
      key: 'total_score',
      header: 'Score',
      render: a => (
        <span className="font-mono text-sm">
          {a.numericTotalScore > 0 ? a.numericTotalScore.toFixed(1) : '—'}
        </span>
      ),
    },
    {
      key: 'decision',
      header: 'Decision',
      render: a => {
        if (!a.decision) return <span className="text-slate-400">—</span>;
        return <Badge tone={DECISION_TONE[a.decision] || 'neutral'}>{a.decision}</Badge>;
      },
    },
  ];

  const exportCsv = () => {
    const rows = filtered.map(a => ({
      applicant_id: a.applicant_id,
      full_name_en: a.full_name_en,
      full_name_ar: a.full_name_ar,
      email: a.email,
      phone: a.phone,
      region: a.region,
      location: a.location,
      track_registered: a.track_registered,
      track_assigned: a.track_assigned,
      current_stage: a.current_stage,
      killing_factor_result: a.killing_factor_result,
      ssi_score: a.ssi_score,
      response_score_fl: a.response_score_fl,
      response_score_sm: a.response_score_sm,
      interview_score_fl: a.interview_score_fl,
      interview_score_sm: a.interview_score_sm,
      total_score: a.total_score,
      decision: a.decision,
    }));
    downloadCsv(timestampedFilename('elevatebridge-applicants'), rows);
  };

  const openApplicant = enriched.find(a => a.applicant_id === openApplicantId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, phone, location, track…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <FilterToggleButton count={activeCount} onClick={() => setFilterDrawerOpen(true)} />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="font-semibold">{filtered.length}</span> of {enriched.length}
        </span>
        <div className="ml-auto">
          <Button variant="ghost" disabled={filtered.length === 0} onClick={exportCsv} title="Export CSV">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <DataTable<EnrichedApplicant>
        columns={columns}
        rows={filtered}
        onRowClick={row => setOpenApplicantId(row.applicant_id)}
        emptyState="No applicants match your filters."
      />

      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        searchValue={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search applicants…"
        fields={fields}
        values={values}
        onValuesChange={setValues}
        total={enriched.length}
        filtered={filtered.length}
        resultNoun="applicants"
      />

      {openApplicant && (
        <ApplicantDrawer
          applicant={openApplicant}
          responseScores={responses.filter(r => r.applicant_id === openApplicant.applicant_id)}
          interviewScores={interviews.filter(r => r.applicant_id === openApplicant.applicant_id)}
          rubrics={rubrics}
          canEdit={canEdit}
          userEmail={userEmail}
          sheetId={sheetId}
          onClose={() => setOpenApplicantId(null)}
          updateApplicant={updateApplicant}
          updateDecision={updateDecision}
          createDecision={createDecision}
        />
      )}
    </div>
  );
}
