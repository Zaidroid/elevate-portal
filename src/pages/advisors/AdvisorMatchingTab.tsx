// Advisor Matching tab — company-first view.
//
// Per Cohort 3 Playbook Phase 2/3: an admin / AM picks a company that
// needs an advisor and sees the top-ranked advisors from the pool
// (Approved / Acknowledged / Allocated, not Rejected) scored by
// suggestMatches() — the same reverse function the advisor drawer
// already uses.
//
// "Match" writes TWO rows in one go:
//   1. companies::assignments: a fresh row with intervention_type
//      resolved through resolveIntervention() so it canonicalises
//      to the right pillar/sub (e.g. C-Suite -> MA/C-Suite).
//   2. The advisor row: pipeline_status='Matched',
//      assignment_company_id=<cid>, assignment_intervention_type=<sub>,
//      assignment_status='Proposed'.
// Both writes use the central canonical-key dedupe pre-check so
// assigning the same advisor twice is a no-op.

import { useMemo, useState } from 'react';
import {
  Check,
  Handshake,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '../../lib/ui';
import type { Tone } from '../../lib/ui';
import { canonicalAssignmentKey, resolveIntervention, CORE_PILLARS } from '../../config/interventions';
import { mintAssignmentId } from '../../lib/ids/assignments';
import { displayName } from '../../config/team';
import type { Advisor } from '../../types/advisor';
import { suggestMatches, type MatchScore } from './smartMatch';
import type { CompanyLite, EnrichedAdvisor } from './utils';

type AssignmentRowLite = {
  assignment_id?: string;
  company_id?: string;
  intervention_type?: string;
  sub_intervention?: string;
  owner_email?: string;
  status?: string;
  [k: string]: string | undefined;
};

type Props = {
  // The advisor pool: every advisor not Rejected / Archived. Allows the
  // user to match before fully approving — strong Inbox passes can be
  // moved straight into a match.
  pool: EnrichedAdvisor[];
  // Cohort companies (CompanyLite already carries the pillar / sub set
  // each company is engaged in, via the AdvisorsPage memo).
  companies: CompanyLite[];
  // Current assignments — used for canonical-key dedupe pre-check.
  assignments: AssignmentRowLite[];
  canEdit: boolean;
  userEmail: string;
  // Creates a match: writes companies::assignments + updates advisor.
  // Returns success/failure for toast.
  onCreateMatch: (input: {
    advisor: EnrichedAdvisor;
    company: CompanyLite;
    subIntervention: string;
  }) => Promise<void>;
  onOpenAdvisor: (advisor: EnrichedAdvisor) => void;
};

// Sub-interventions the advisor module pairs with most often. Per the
// Playbook section 9, advisors plug into the MA pillar (C-Suite is the
// canonical sub) plus marketing-side support.
const SUB_OPTIONS = [
  'C-Suite',
  'Marketing Agency',
  'Marketing Resources',
  'Legal Assessment',
  'Conferences',
] as const;

export function AdvisorMatchingTab({
  pool,
  companies,
  assignments,
  canEdit,
  onCreateMatch,
  onOpenAdvisor,
}: Props) {
  const toast = useToast();
  const [companyId, setCompanyId] = useState<string>('');
  const [subFilter, setSubFilter] = useState<string>('C-Suite');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find(c => c.company_id === companyId),
    [companies, companyId],
  );

  // Existing matches for the selected company — used to (a) gray out
  // advisors already matched and (b) show "X advisors already matched"
  // up top.
  const existingMatches = useMemo(() => {
    if (!selectedCompany) return [];
    const cid = selectedCompany.company_id;
    return pool.filter(a => (a.assignment_company_id || '').trim() === cid);
  }, [pool, selectedCompany]);

  const existingMatchIds = useMemo(
    () => new Set(existingMatches.map(a => a.advisor_id)),
    [existingMatches],
  );

  // Run smart match for the selected company against every approved
  // advisor. The smartMatch fn is advisor-first, so we invert: for each
  // approved advisor, score against THIS one company, then sort.
  const ranked = useMemo<Array<{ advisor: EnrichedAdvisor; match: MatchScore }>>(() => {
    if (!selectedCompany) return [];
    const q = query.trim().toLowerCase();
    return pool
      .filter(a => {
        const s = (a.pipeline_status || '').toLowerCase();
        if (['rejected', 'archived'].includes(s)) return false;
        if (existingMatchIds.has(a.advisor_id)) return false;
        if (q && !`${a.full_name} ${a.email} ${a.country} ${a.position}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .map(a => {
        // suggestMatches expects an array of companies; pass just the
        // one we care about and take the top result if any.
        const matches = suggestMatches(a, [selectedCompany], 1);
        return { advisor: a, match: matches[0] };
      })
      .filter(x => x.match && x.match.score > 0)
      .sort((a, b) => b.match.score - a.match.score);
  }, [selectedCompany, pool, existingMatchIds, query]);

  const handleMatch = async (advisor: EnrichedAdvisor) => {
    if (!selectedCompany) return;
    // Canonical-key dedupe: refuse if the company already has an
    // assignment with this canonical sub (avoid duplicate intervention
    // rows the dedupe admin tool would have to clean up later).
    const targetKey = canonicalAssignmentKey({
      intervention_type: 'MA',
      sub_intervention: subFilter,
    });
    const collision = assignments.some(
      a => a.company_id === selectedCompany.company_id
        && canonicalAssignmentKey({
          intervention_type: a.intervention_type,
          sub_intervention: a.sub_intervention,
        }) === targetKey,
    );
    if (collision && !window.confirm(
      `${selectedCompany.company_name} already has a ${subFilter} assignment. Add another advisor to the same engagement?`,
    )) return;

    setBusy(advisor.advisor_id);
    try {
      await onCreateMatch({ advisor, company: selectedCompany, subIntervention: subFilter });
      toast.success(
        'Matched',
        `${advisor.full_name} → ${selectedCompany.company_name} (${subFilter}).`,
      );
    } catch (err) {
      toast.error('Match failed', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Companies needing the selected sub-intervention bubble up first in
  // the picker. Helps the admin find work-needing companies fast.
  const sortedCompanies = useMemo(() => {
    const needsSub = (c: CompanyLite): boolean => {
      const subs = c.subs;
      if (!subs || subs.length === 0) return false;
      const lc = subFilter.toLowerCase();
      return subs.some(s => (s || '').toLowerCase() === lc);
    };
    return [...companies].sort((a, b) => {
      const an = needsSub(a) ? 0 : 1;
      const bn = needsSub(b) ? 0 : 1;
      if (an !== bn) return an - bn;
      return (a.company_name || '').localeCompare(b.company_name || '');
    });
  }, [companies, subFilter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Match an advisor to a company"
          subtitle="Phase 2/3 of the Cohort 3 advisor workflow. The list ranks advisors by sub-intervention overlap, pillar focus, sector hint, and geography."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_240px]">
          <label className="block">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-slate-500">Company</span>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            >
              <option value="">— Select a company —</option>
              {sortedCompanies.map(c => (
                <option key={c.company_id} value={c.company_id}>
                  {c.company_name}
                  {c.subs && c.subs.map(s => (s || '').toLowerCase()).includes(subFilter.toLowerCase())
                    ? '  ★ needs ' + subFilter
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-slate-500">Sub-intervention</span>
            <select
              value={subFilter}
              onChange={e => setSubFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-600 dark:text-white"
            >
              {SUB_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {!selectedCompany ? (
        <Card>
          <EmptyState
            icon={<Handshake className="h-6 w-6" />}
            title="Pick a company"
            description="Choose a Cohort 3 company that needs an advisor; the top candidates will rank below."
          />
        </Card>
      ) : (
        <>
          {existingMatches.length > 0 && (
            <Card accent="teal">
              <div className="text-sm">
                <strong>{existingMatches.length}</strong> advisor{existingMatches.length === 1 ? '' : 's'} already matched to {selectedCompany.company_name}:
                <span className="ml-2 text-slate-500 dark:text-slate-300">
                  {existingMatches.map(a => a.full_name).join(', ')}
                </span>
              </div>
            </Card>
          )}

          <div className="flex items-center gap-2">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter advisors by name, country, position…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
              />
            </div>
            <span className="text-xs text-slate-500">
              {ranked.length} candidate{ranked.length === 1 ? '' : 's'}
            </span>
          </div>

          {ranked.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title="No matching advisors"
                description="The pool has no advisor with sub-intervention / pillar overlap for this company. Either approve more advisors via the Inbox or adjust the sub-intervention filter."
              />
            </Card>
          ) : (
            <div className="space-y-2">
              {ranked.map(({ advisor, match }) => (
                <MatchCard
                  key={advisor.advisor_id}
                  advisor={advisor}
                  match={match}
                  busy={busy === advisor.advisor_id}
                  canEdit={canEdit}
                  onMatch={() => handleMatch(advisor)}
                  onOpen={() => onOpenAdvisor(advisor)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MatchCard({
  advisor,
  match,
  busy,
  canEdit,
  onMatch,
  onOpen,
}: {
  advisor: EnrichedAdvisor;
  match: MatchScore;
  busy: boolean;
  canEdit: boolean;
  onMatch: () => void;
  onOpen: () => void;
}) {
  const scoreTone: Tone =
    match.score >= 60 ? 'green' :
    match.score >= 30 ? 'amber' :
    'neutral';

  const s2 = advisor.stage2_category;
  const status = advisor.pipeline_status || 'New';

  return (
    <Card padded={false} interactive>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1" role="button" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold text-navy-500 dark:text-white">{advisor.full_name || advisor.email}</div>
            {s2 && s2 !== 'Unqualified' && <Badge tone="teal">{s2}</Badge>}
            <Badge tone={status.toLowerCase() === 'approved' ? 'green' : status.toLowerCase() === 'matched' ? 'teal' : 'neutral'}>{status}</Badge>
            <Badge tone={scoreTone}>
              <Sparkles className="-mt-0.5 mr-1 inline h-3 w-3" />
              match {match.score}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {advisor.position && <span>{advisor.position}{advisor.employer && <span className="text-slate-400"> @ {advisor.employer}</span>}</span>}
            {advisor.country && <span>· {advisor.country}</span>}
            {advisor.assignee_email && <span>· AM: {displayName(advisor.assignee_email)}</span>}
          </div>
          {match.reasons.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {match.reasons.join(' · ')}
            </div>
          )}
        </div>
        {canEdit && (
          <Button variant="primary" onClick={onMatch} disabled={busy}>
            {busy ? '…' : <><Check className="mr-1 h-4 w-4" /> Match</>}
          </Button>
        )}
      </div>
    </Card>
  );
}

// Helper exposed for AdvisorsPage so the parent can build the
// onCreateMatch handler with the right column shape. Resolved here so
// callers don't duplicate the canonical-sub mapping.
export function buildAssignmentRowForMatch(input: {
  advisor: Advisor;
  company: CompanyLite;
  subIntervention: string;
  ownerEmail: string;
}): AssignmentRowLite {
  const r = resolveIntervention(input.subIntervention);
  const pillarCode = r?.pillar || CORE_PILLARS.find(p => p.subInterventions.includes(input.subIntervention))?.code || 'MA';
  const subCanonical = r?.sub || input.subIntervention;
  return {
    assignment_id: mintAssignmentId({
      companyId: input.company.company_id,
      intervention_type: pillarCode,
      sub_intervention: subCanonical,
    }),
    company_id: input.company.company_id,
    intervention_type: pillarCode,
    sub_intervention: subCanonical,
    owner_email: input.ownerEmail || input.advisor.email || '',
    status: 'Proposed',
    notes: `Advisor: ${input.advisor.full_name} (${input.advisor.email})`,
  };
}
