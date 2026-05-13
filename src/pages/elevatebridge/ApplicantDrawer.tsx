// Applicant detail drawer — per-applicant lineage and admin-only
// decision controls. Reads the joined data (S1/S2/S3/SSI/scores)
// from the EnrichedApplicant; writes decisions via updateDecision.

import { useState } from 'react';
import { Badge, Button, Drawer } from '../../lib/ui';
import type { EbInterview, EbStage3Response, EbRubric } from '../../types/elevateBridge';
import {
  DECISION_TONE,
  TRACK_LABEL,
  type EnrichedApplicant,
} from './utils';
import { appendEbActivity } from './activityLog';

type Props = {
  applicant: EnrichedApplicant;
  responseScores: EbStage3Response[];
  interviewScores: EbInterview[];
  rubrics: EbRubric[];
  canEdit: boolean;
  userEmail: string;
  sheetId: string;
  onClose: () => void;
  updateApplicant: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  updateDecision: (id: string, updates: Partial<Record<string, string>>) => Promise<unknown>;
  createDecision: (row: Partial<Record<string, string>>) => Promise<unknown>;
};

const DECISIONS = ['Admitted', 'Waitlisted', 'Withdrew', 'Dropped', 'Disqualified'] as const;

function LineageRow({ label, value, tone }: { label: string; value: string; tone?: 'teal' | 'orange' | 'red' | 'neutral' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0 dark:border-navy-700">
      <span className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-sm text-navy-500 dark:text-white">
        {tone ? <Badge tone={tone}>{value || '—'}</Badge> : (value || '—')}
      </span>
    </div>
  );
}

export function ApplicantDrawer({
  applicant,
  responseScores,
  interviewScores,
  rubrics,
  canEdit,
  userEmail,
  sheetId,
  onClose,
  updateDecision,
  createDecision,
}: Props) {
  const [decisionValue, setDecisionValue] = useState(applicant.decision || '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const saveDecision = async () => {
    if (decisionValue === (applicant.decision || '')) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updates = {
        applicant_id: applicant.applicant_id,
        full_name: applicant.display_name,
        email: applicant.email,
        track: applicant.track_assigned,
        decision: decisionValue,
        decision_date: new Date().toISOString().slice(0, 10),
        decision_by: userEmail,
      };
      if (applicant.decisionRow) {
        await updateDecision(applicant.applicant_id, updates);
      } else {
        await createDecision(updates);
      }
      void appendEbActivity({
        sheetId,
        tabName: 'ActivityLog',
        user_email: userEmail,
        entity_type: 'applicant',
        entity_id: applicant.applicant_id,
        action: 'decision_changed',
        field: 'decision',
        old_value: applicant.decision || '',
        new_value: decisionValue,
        details: applicant.display_name,
      });
      setSaveMsg('Saved');
    } catch (err) {
      setSaveMsg(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Group response/interview scores by category for compact display.
  const groupedResponses = new Map<string, EbStage3Response[]>();
  for (const r of responseScores) {
    const arr = groupedResponses.get(r.category) || [];
    arr.push(r);
    groupedResponses.set(r.category, arr);
  }
  const groupedInterviews = new Map<string, EbInterview[]>();
  for (const r of interviewScores) {
    const arr = groupedInterviews.get(r.category) || [];
    arr.push(r);
    groupedInterviews.set(r.category, arr);
  }

  // Rubric lookup for tooltip support.
  const rubricMap = new Map<string, EbRubric>();
  for (const r of rubrics) rubricMap.set(r.criterion_key, r);

  return (
    <Drawer
      open
      onClose={onClose}
      title={applicant.display_name}
      subtitle={`${applicant.email}  ·  ${applicant.region || '—'}  ·  ${TRACK_LABEL[applicant.track_assigned || ''] || applicant.track_assigned || 'No track assigned'}`}
      width="max-w-2xl"
      footer={
        canEdit ? (
          <>
            <select
              value={decisionValue}
              onChange={e => setDecisionValue(e.target.value)}
              className="rounded-lg border border-slate-200 bg-brand-editable px-3 py-1.5 text-sm dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            >
              <option value="">— No decision —</option>
              {DECISIONS.map(d => (<option key={d} value={d}>{d}</option>))}
            </select>
            <Button variant="primary" onClick={saveDecision} disabled={saving || decisionValue === (applicant.decision || '')}>
              {saving ? 'Saving…' : 'Save decision'}
            </Button>
            {saveMsg && <span className="ml-2 text-xs text-slate-500 dark:text-slate-300">{saveMsg}</span>}
          </>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">View-only. Admin-only edit.</span>
        )
      }
    >
      <div className="space-y-5">
        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Contact</h4>
          <LineageRow label="Phone"        value={applicant.phone} />
          <LineageRow label="Location"     value={applicant.location} />
          <LineageRow label="Gender"       value={applicant.gender} />
          <LineageRow label="DOB"          value={applicant.dob} />
          <LineageRow label="Education"    value={`${applicant.education_level || ''} · ${applicant.university_name || ''}`.trim()} />
          <LineageRow label="Specialization" value={applicant.specialization} />
        </section>

        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">S1 · Killing Factor</h4>
          <LineageRow
            label="Result"
            value={applicant.killing_factor_result || (applicant.stage1?.killing_factor_result || '—')}
            tone={(applicant.killing_factor_result || '').toLowerCase().startsWith('pass') ? 'teal' : 'red'}
          />
          <LineageRow label="Reason" value={applicant.killing_factor_reason || (applicant.stage1?.reason || '')} />
          <LineageRow label="Upwork income (Individual)" value={applicant.stage1?.total_upwork_income_i || ''} />
          <LineageRow label="Upwork income (JH)"         value={applicant.stage1?.upwork_income_jh || ''} />
          <LineageRow label="Upwork income (Agency)"     value={applicant.stage1?.upwork_income_agency || ''} />
          <LineageRow label="SM income (Individual)"     value={applicant.stage1?.sm_income_i || ''} />
          <LineageRow label="SM income (Agency)"         value={applicant.stage1?.sm_income_agency || ''} />
        </section>

        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">S2 · Track Sorting</h4>
          <LineageRow label="Track (registered)" value={applicant.track_registered} />
          <LineageRow label="Track (assigned)"   value={TRACK_LABEL[applicant.track_assigned || ''] || applicant.track_assigned || ''} />
          <LineageRow label="Skills category"    value={applicant.stage2?.skills_category || ''} />
          <LineageRow label="Sector (Upwork)"    value={applicant.stage2?.jh_sector_upwork || ''} />
          <LineageRow label="Sector (SM)"        value={applicant.stage2?.jh_sector_sm || ''} />
        </section>

        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">S3 · Scoring</h4>
          <LineageRow label="SSI score"          value={applicant.ssi_score || applicant.ssi?.ssi_score || ''} />
          <LineageRow label="Response — FL"      value={applicant.response_score_fl} />
          <LineageRow label="Response — SM"      value={applicant.response_score_sm} />
          <LineageRow label="Interview — FL"     value={applicant.interview_score_fl} />
          <LineageRow label="Interview — SM"     value={applicant.interview_score_sm} />
          <LineageRow label="Total score"        value={applicant.total_score} />
        </section>

        {groupedResponses.size > 0 && (
          <section>
            <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Response Scoring Breakdown</h4>
            {Array.from(groupedResponses.entries()).map(([cat, items]) => (
              <div key={cat} className="mb-3">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{cat}</div>
                {items.map(r => {
                  const rubric = rubricMap.get(r.criterion_key);
                  return (
                    <div key={r.score_id} className="flex items-center justify-between border-b border-slate-100 py-1 text-xs dark:border-navy-700">
                      <span title={rubric?.notes || r.criterion_label} className="text-slate-500 dark:text-slate-300">{r.criterion_label}</span>
                      <span className="font-mono font-bold text-navy-500 dark:text-white">{r.score} / 5</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        )}

        {groupedInterviews.size > 0 && (
          <section>
            <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Interview Breakdown</h4>
            {Array.from(groupedInterviews.entries()).map(([cat, items]) => (
              <div key={cat} className="mb-3">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{cat}</div>
                {items.map(r => (
                  <div key={r.interview_id} className="flex items-center justify-between border-b border-slate-100 py-1 text-xs dark:border-navy-700">
                    <span className="text-slate-500 dark:text-slate-300">Q{r.q_number} · {r.criterion_label}</span>
                    <span className="font-mono font-bold text-navy-500 dark:text-white">{r.score}</span>
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        <section>
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-slate-500">Decision</h4>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-300">Current</span>
            {applicant.decision ? (
              <Badge tone={DECISION_TONE[applicant.decision] || 'neutral'}>{applicant.decision}</Badge>
            ) : (
              <span className="text-sm text-slate-400">No decision</span>
            )}
          </div>
          {applicant.decisionRow?.decision_date && (
            <div className="mt-1 text-[11px] text-slate-400">
              Decided {applicant.decisionRow.decision_date} by {applicant.decisionRow.decision_by || 'unknown'}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
