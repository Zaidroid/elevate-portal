// Scoring tab — sub-tabbed by stage/track. Each grid renders one row per
// applicant + one column per criterion (1-5 dropdowns for admins, plain
// numbers for everyone else). Tooltips on column headers show the rubric
// descriptor for each score. Editing one cell writes via updateRow with
// optimistic update; failure surfaces a toast and the cell reverts.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Card, CardHeader, Tabs, useToast } from '../../lib/ui';
import type { TabItem } from '../../lib/ui';
import type {
  EbApplicant,
  EbInterview,
  EbRubric,
  EbStage3Response,
} from '../../types/elevateBridge';
import { mintInterviewId, mintScoreId } from './utils';
import { appendEbActivity } from './activityLog';

type Props = {
  applicants: EbApplicant[];
  rubrics: EbRubric[];
  responseScores: EbStage3Response[];
  interviewScores: EbInterview[];
  canEdit: boolean;
  userEmail: string;
  sheetId: string;
  updateResponse: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createResponse: (row: Partial<Record<string, string>>) => Promise<unknown>;
  updateInterview: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createInterview: (row: Partial<Record<string, string>>) => Promise<unknown>;
};

type SubTab = 'resp-fl' | 'resp-sm' | 'resp-flsm' | 'int-fl' | 'int-sm' | 'int-flsm' | 'ssi';

const TAB_DEFS: Array<{ value: SubTab; label: string; stage: 'Response' | 'Interview' | 'SSI'; track: string }> = [
  { value: 'resp-fl',   label: 'Response · FL',     stage: 'Response',  track: 'FL' },
  { value: 'resp-sm',   label: 'Response · SM',     stage: 'Response',  track: 'SM' },
  { value: 'resp-flsm', label: 'Response · FL+SM',  stage: 'Response',  track: 'FL+SM' },
  { value: 'int-fl',    label: 'Interview · FL',    stage: 'Interview', track: 'FL' },
  { value: 'int-sm',    label: 'Interview · SM',    stage: 'Interview', track: 'SM' },
  { value: 'int-flsm',  label: 'Interview · FL+SM', stage: 'Interview', track: 'FL+SM' },
];

export function ScoringTab({
  applicants,
  rubrics,
  responseScores,
  interviewScores,
  canEdit,
  userEmail,
  sheetId,
  updateResponse,
  createResponse,
  updateInterview,
  createInterview,
}: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<SubTab>('resp-fl');
  const [query, setQuery] = useState('');

  const def = TAB_DEFS.find(t => t.value === tab)!;
  const isInterview = def.stage === 'Interview';

  const matchedRubric = useMemo(
    () => rubrics.filter(r => r.stage === def.stage && (r.track === def.track || r.track === 'All')),
    [rubrics, def.stage, def.track],
  );

  // Applicants whose assigned track matches this sub-tab's track.
  const matchedApplicants = useMemo(() => {
    const q = query.toLowerCase().trim();
    return applicants
      .filter(a => (a.track_assigned || '') === def.track)
      .filter(a => {
        if (!q) return true;
        return (
          (a.full_name_en || '').toLowerCase().includes(q) ||
          (a.email || '').toLowerCase().includes(q)
        );
      });
  }, [applicants, def.track, query]);

  // Build a (applicant_id, criterion_key) → score row lookup.
  const scoreLookup = useMemo(() => {
    const m = new Map<string, EbStage3Response | EbInterview>();
    if (isInterview) {
      for (const r of interviewScores.filter(s => s.track === def.track)) {
        m.set(`${r.applicant_id}::${r.q_number}`, r);
      }
    } else {
      for (const r of responseScores.filter(s => s.track === def.track)) {
        m.set(`${r.applicant_id}::${r.criterion_key}`, r);
      }
    }
    return m;
  }, [isInterview, def.track, responseScores, interviewScores]);

  const writeScore = async (
    applicantId: string,
    criterion: { key: string; label: string; category: string; weight: string; sub_weight: string; q_number?: string },
    newScore: string,
  ) => {
    try {
      const lookupKey = `${applicantId}::${isInterview ? criterion.q_number : criterion.key}`;
      const existing = scoreLookup.get(lookupKey);
      const applicant = applicants.find(a => a.applicant_id === applicantId);
      const now = new Date().toISOString();
      if (isInterview) {
        const id = existing?.['interview_id' as keyof typeof existing] as string | undefined
          || mintInterviewId(applicantId, def.track, Number(criterion.q_number) || 0);
        const payload: Partial<Record<string, string>> = {
          interview_id: id,
          applicant_id: applicantId,
          full_name: applicant?.full_name_en || '',
          track: def.track,
          q_number: criterion.q_number || '',
          category: criterion.category,
          criterion_label: criterion.label,
          weight: criterion.weight,
          sub_weight: criterion.sub_weight,
          score: newScore,
          scored_by: userEmail,
          scored_at: now,
        };
        if (existing) {
          await updateInterview(id, payload);
        } else {
          await createInterview(payload);
        }
        void appendEbActivity({
          sheetId, tabName: 'ActivityLog', user_email: userEmail,
          entity_type: 'interview', entity_id: id, action: 'interview_scored',
          field: `Q${criterion.q_number}`, old_value: (existing?.score as string) || '', new_value: newScore,
          details: applicant?.full_name_en || '',
        });
      } else {
        const id = existing?.['score_id' as keyof typeof existing] as string | undefined
          || mintScoreId(applicantId, def.track, criterion.key);
        const payload: Partial<Record<string, string>> = {
          score_id: id,
          applicant_id: applicantId,
          full_name: applicant?.full_name_en || '',
          track: def.track,
          category: criterion.category,
          criterion_key: criterion.key,
          criterion_label: criterion.label,
          weight: criterion.weight,
          sub_weight: criterion.sub_weight,
          score: newScore,
          scored_by: userEmail,
          scored_at: now,
        };
        if (existing) {
          await updateResponse(id, payload);
        } else {
          await createResponse(payload);
        }
        void appendEbActivity({
          sheetId, tabName: 'ActivityLog', user_email: userEmail,
          entity_type: 'score', entity_id: id, action: 'score_edited',
          field: criterion.label, old_value: (existing?.score as string) || '', new_value: newScore,
          details: applicant?.full_name_en || '',
        });
      }
    } catch (err) {
      toast.error('Score save failed', (err as Error).message);
    }
  };

  const tabs: TabItem[] = TAB_DEFS.map(t => ({ value: t.value, label: t.label }));

  return (
    <div className="space-y-4">
      <Tabs items={tabs} value={tab} onChange={v => setTab(v as SubTab)} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search applicants…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>
        <span className="text-xs text-slate-500">
          {matchedApplicants.length} applicants · {matchedRubric.length} criteria
        </span>
      </div>

      {matchedRubric.length === 0 ? (
        <Card>
          <CardHeader title="No rubric loaded" subtitle={`Add ${def.stage} criteria for the ${def.track} track to the Scoring Rubrics tab.`} />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-navy-700">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 dark:bg-navy-700">Applicant</th>
                  {matchedRubric.map(r => {
                    const tip = [
                      `5: ${r.score_5}`,
                      `4: ${r.score_4}`,
                      `3: ${r.score_3}`,
                      `2: ${r.score_2}`,
                      `1: ${r.score_1}`,
                    ].filter(line => !line.endsWith(': ')).join('\n');
                    return (
                      <th key={r.rubric_id} className="px-2 py-2 text-center whitespace-nowrap" title={tip}>
                        <div className="text-[9px] uppercase tracking-wider text-slate-400">{r.category}</div>
                        <div className="font-mono">{isInterview ? `Q${rubrics.indexOf(r) + 1}` : r.criterion_label.slice(0, 22)}</div>
                        <div className="text-[9px] text-slate-400">w{r.weight || ''}{r.sub_weight ? `·${r.sub_weight}` : ''}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center bg-navy-500 text-white">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                {matchedApplicants.length === 0 && (
                  <tr><td colSpan={matchedRubric.length + 2} className="px-3 py-6 text-center text-slate-500">No applicants in this track.</td></tr>
                )}
                {matchedApplicants.map(a => {
                  let total = 0;
                  let weightTotal = 0;
                  const cells = matchedRubric.map((r, idx) => {
                    const qNum = (idx + 1).toString();
                    const key = `${a.applicant_id}::${isInterview ? qNum : r.criterion_key}`;
                    const score = scoreLookup.get(key)?.score || '';
                    const num = Number(score) || 0;
                    const weight = Number(r.weight || '0') || 0;
                    const subW = Number(r.sub_weight || '0') || 0;
                    const effW = weight * (subW || 100) / 100;
                    if (num > 0 && effW > 0) {
                      total += num * effW;
                      weightTotal += effW;
                    }
                    return (
                      <td key={r.rubric_id} className="px-1 py-1 text-center">
                        {canEdit ? (
                          <select
                            value={score}
                            onChange={e => writeScore(a.applicant_id, {
                              key: r.criterion_key,
                              label: r.criterion_label,
                              category: r.category,
                              weight: r.weight,
                              sub_weight: r.sub_weight,
                              q_number: isInterview ? qNum : undefined,
                            }, e.target.value)}
                            className={`w-12 rounded-md border px-1 py-0.5 text-xs font-bold ${
                              score ? 'border-brand-teal/40 bg-brand-editable text-navy-500 dark:bg-navy-700 dark:text-white' :
                                'border-slate-200 bg-white text-slate-400 dark:bg-navy-600 dark:border-navy-700'
                            }`}
                          >
                            <option value=""></option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                          </select>
                        ) : (
                          <span className="font-mono">{score || '—'}</span>
                        )}
                      </td>
                    );
                  });
                  const totalScore = weightTotal > 0 ? (total / weightTotal).toFixed(2) : '—';
                  return (
                    <tr key={a.applicant_id} className="hover:bg-slate-50 dark:hover:bg-navy-700">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 dark:bg-navy-600">
                        <div className="text-xs font-semibold text-navy-500 dark:text-white">{a.full_name_en || a.email}</div>
                        <div className="text-[10px] text-slate-400">{a.email}</div>
                      </td>
                      {cells}
                      <td className="px-2 py-1.5 text-center">
                        <Badge tone={totalScore === '—' ? 'neutral' : 'teal'}>{totalScore}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
