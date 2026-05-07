// Stage 3 · Distribution dashboard.
//
// Reads the live Companies + Intervention Assignments tabs (the 41-company
// cohort seeded from the allocation xlsx). Renders:
//   - KPI strip
//   - Per-AM cards with company / intervention / budget rollups
//   - Sub-intervention spread (with the C-Suite / Technical flavor split)
//   - Cohort table with reassign action
//   - Lock toggle (admin-only when locked)
//
// Side effects:
//   - On every reassign + lock toggle, debounces a write to the
//     human-friendly `Stage3 Distribution` mirror tab in the selection
//     workbook.
//   - Appends `distribution_reassigned` / `distribution_locked` rows to
//     the company Activity Log.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Lock, Pencil, RefreshCw, Trophy } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  useToast,
} from '../../lib/ui';
import type { Column } from '../../lib/ui';
import type { Company, Assignment } from '../../data/types';
import { ACCOUNT_MANAGERS, displayName, isAdmin } from '../../config/team';
import { useDistribution } from './useDistribution';
import type { AmBucket } from './useDistribution';
import { Stage3EditCompanyDrawer } from './Stage3EditCompanyDrawer';
import type { EditPayload } from './Stage3EditCompanyDrawer';
import { writeStage3DistributionTab } from './Stage3DistributionWriter';
import { appendActivity } from '../companies/activityLog';
import { getSheetId, getTab } from '../../config/sheets';
import { useModuleData } from '../../data/useModuleData';

const FUND_LABELS: Record<string, string> = {
  '97060': 'Dutch',
  Dutch:    'Dutch',
  '91763': 'SIDA',
  SIDA:     'SIDA',
};

function fundLabel(code: string): string {
  return FUND_LABELS[code?.trim()] || code || '';
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

type Props = {
  companies: Company[];
  assignments: Assignment[];
  currentUserEmail: string;
  /** Handles AM/donor changes + per-assignment add/edit/remove for one company. */
  onEditCompany: (payload: EditPayload) => Promise<void>;
};

export function Stage3DistributionTab({
  companies,
  assignments,
  currentUserEmail,
  onEditCompany,
}: Props) {
  const toast = useToast();
  const admin = isAdmin(currentUserEmail);
  const { amBuckets, subCounts, fundTotals, companiesInCohort, totalAssignments, totalBudget } =
    useDistribution(companies, assignments);

  // Lock state lives in a row of the stage3Distribution mirror tab. We
  // read it via the live data layer so multi-user updates propagate.
  const stage3Mirror = useModuleData<Record<string, string>>('selection', 'stage3Distribution');
  const lock = useMemo(() => {
    // Convention: any row with distribution_id === '_meta' carries lock state.
    const meta = stage3Mirror.rows.find(r => (r.distribution_id || '').toLowerCase() === '_meta');
    return {
      locked: (meta?.['Status'] || meta?.locked || '').toLowerCase() === 'true',
      locked_by: meta?.['Account Manager'] || meta?.locked_by || '',
      locked_at: meta?.['City'] || meta?.locked_at || '',
    };
  }, [stage3Mirror.rows]);

  const [drawerCompany, setDrawerCompany] = useState<Company | null>(null);
  const [expandedAm, setExpandedAm] = useState<string | null>(null);
  const writeBusy = useRef(false);

  const sortedCohort = useMemo(() => {
    const inCohort = new Set<string>();
    for (const a of assignments) if (a.company_id) inCohort.add(a.company_id);
    return companies
      .filter(c => inCohort.has(c.company_id))
      .sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));
  }, [companies, assignments]);

  const asgByCompany = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!a.company_id) continue;
      const arr = m.get(a.company_id) ?? [];
      arr.push(a);
      m.set(a.company_id, arr);
    }
    return m;
  }, [assignments]);

  const syncMirror = useCallback(async () => {
    if (writeBusy.current) return;
    writeBusy.current = true;
    try {
      await writeStage3DistributionTab({
        companies: sortedCohort,
        assignments,
        generatedBy: currentUserEmail,
        lock,
      });
    } catch (err) {
      console.warn('[stage3] mirror write failed', err);
    } finally {
      writeBusy.current = false;
    }
  }, [sortedCohort, assignments, currentUserEmail, lock]);

  const handleEditSubmit = useCallback(
    async (payload: EditPayload) => {
      await onEditCompany(payload);
      toast.success('Saved');
      void syncMirror();
    },
    [onEditCompany, toast, syncMirror],
  );

  const toggleLock = useCallback(async () => {
    const next = !lock.locked;
    const sheetId = getSheetId('selection');
    if (!sheetId) return;
    // The lock row is part of the mirror tab. We update the meta entry
    // by re-running the writer; the writer reads the current lock and
    // writes it into row 2 (subtitle). A dedicated "lock" toggle is a
    // small write that only changes that row.
    // Simpler: write the mirror with the new lock embedded.
    try {
      await writeStage3DistributionTab({
        companies: sortedCohort,
        assignments,
        generatedBy: currentUserEmail,
        lock: { locked: next, locked_by: currentUserEmail, locked_at: new Date().toISOString() },
      });
      const companiesSheetId = getSheetId('companies');
      if (companiesSheetId) {
        await appendActivity({
          sheetId: companiesSheetId,
          tabName: getTab('companies', 'activity'),
          user_email: currentUserEmail,
          action: next ? 'distribution_locked' : 'distribution_unlocked',
          details: `${sortedCohort.length} companies, ${totalAssignments} interventions`,
        });
      }
      toast.success(next ? 'Distribution locked' : 'Distribution unlocked');
      stage3Mirror.refresh();
    } catch (err) {
      toast.error(`Lock failed: ${(err as Error).message}`);
    }
  }, [lock.locked, sortedCohort, assignments, currentUserEmail, totalAssignments, toast, stage3Mirror]);

  const reassignDisabled = lock.locked && !admin;

  if (sortedCohort.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Trophy className="h-8 w-8" />}
          title="No cohort yet"
          description="Once Stage 2 locks decisions or the Cohort 3 allocation is seeded via /import, the 41-company distribution will populate here."
        />
      </Card>
    );
  }

  // Columns for the cohort table.
  const columns: Column<Company>[] = [
    { key: 'company_name', header: 'Company', render: c => c.company_name || c.company_id },
    { key: 'city', header: 'City', render: c => c.city || '—' },
    {
      key: 'profile_manager_email',
      header: 'Account Manager',
      render: c => c.profile_manager_email ? displayName(c.profile_manager_email) : '(unassigned)',
    },
    {
      key: 'pillars',
      header: 'Pillars',
      render: c => {
        const asg = asgByCompany.get(c.company_id) ?? [];
        const set = new Set<string>();
        for (const a of asg) if (a.intervention_type) set.add(a.intervention_type);
        return Array.from(set).join(' · ') || '—';
      },
    },
    {
      key: 'subs',
      header: 'Sub-Interventions',
      render: c => {
        const asg = asgByCompany.get(c.company_id) ?? [];
        return asg.map(a => {
          const sub = a.sub_intervention || a.intervention_type || '';
          const flavor = (a.notes || '').match(/(?:^|\|\s*)(Technical)(?:\s*\||$)/)?.[1];
          return flavor ? `${sub} (${flavor})` : sub;
        }).filter(Boolean).join(', ') || '—';
      },
    },
    {
      key: 'donor',
      header: 'Donor',
      render: c => {
        const asg = asgByCompany.get(c.company_id) ?? [];
        const fund = c.fund_code || asg.find(a => a.fund_code)?.fund_code || '';
        return fundLabel(fund) || '—';
      },
    },
    {
      key: 'budget',
      header: 'Budget',
      render: c => {
        const asg = asgByCompany.get(c.company_id) ?? [];
        const sum = asg.reduce((s, a) => s + (parseFloat(String(a.budget_usd || '').replace(/[^0-9.\-]/g, '')) || 0), 0);
        return fmtUsd(sum);
      },
    },
    {
      key: 'edit',
      header: '',
      render: c => (
        <Button
          variant="ghost"
          onClick={() => setDrawerCompany(c)}
          disabled={reassignDisabled}
          title={reassignDisabled ? 'Distribution locked — admin only' : 'Edit AM, donor, interventions, budget'}
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      ),
    },
  ];

  const stage3SheetId = getSheetId('selection');
  const stage3SheetUrl = stage3SheetId
    ? `https://docs.google.com/spreadsheets/d/${stage3SheetId}/edit#gid=0`
    : '';

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-navy-700 dark:bg-navy-900">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="teal">{companiesInCohort} companies</Badge>
          <Badge tone="teal">{totalAssignments} interventions</Badge>
          <Badge tone="amber">{ACCOUNT_MANAGERS.length} account managers</Badge>
          <Badge tone="amber">{fmtUsd(totalBudget)} committed</Badge>
          {lock.locked && <Badge tone="red">🔒 Locked by {displayName(lock.locked_by)}</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => { void syncMirror(); }} title="Sync mirror tab">
            <RefreshCw className="h-3.5 w-3.5" /> Sync sheet
          </Button>
          {stage3SheetUrl && (
            <a
              href={stage3SheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-navy-700 dark:text-slate-300"
            >
              <ExternalLink className="h-3 w-3" /> Open in Sheets
            </a>
          )}
          <Button
            variant={lock.locked ? 'ghost' : 'primary'}
            onClick={toggleLock}
            disabled={lock.locked && !admin}
            title={lock.locked && !admin ? 'Only admins can unlock' : (lock.locked ? 'Unlock distribution' : 'Lock distribution')}
          >
            <Lock className="h-3.5 w-3.5" /> {lock.locked ? 'Unlock' : 'Lock distribution'}
          </Button>
        </div>
      </div>

      {/* Per-AM cards — click to expand */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {amBuckets.filter(b => b.companies.length > 0 || b.email !== '').map(b => (
          <AmCard
            key={b.email || 'unassigned'}
            bucket={b}
            expanded={expandedAm === (b.email || 'unassigned')}
            onToggle={() => setExpandedAm(prev => prev === (b.email || 'unassigned') ? null : (b.email || 'unassigned'))}
            maxLoadAcrossAms={Math.max(1, ...amBuckets.map(x => x.loadScore))}
          />
        ))}
      </div>

      {/* Sub-intervention spread + Fund split */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sub-intervention spread" subtitle="C-Suite breaks out into Technical vs Standard flavors." />
          <ul className="space-y-1.5 text-sm">
            {subCounts.map(s => (
              <li key={s.sub} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="w-44 truncate font-semibold">{s.sub}</span>
                  <div className="flex-1 rounded bg-slate-100 dark:bg-navy-700">
                    <div
                      className="h-2 rounded bg-brand-teal"
                      style={{ width: `${Math.min(100, s.total * 4)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-xs text-slate-500">{s.total}</span>
                </div>
                {s.flavors.length > 0 && (
                  <div className="ml-44 flex flex-wrap gap-1.5 text-xs text-slate-500">
                    {s.flavors.map(f => (
                      <span key={f.label} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-navy-700">
                        {f.label}: {f.count}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Fund split" subtitle="Total committed budget per donor." />
          <ul className="space-y-1.5 text-sm">
            {fundTotals.map(f => (
              <li key={f.fund} className="flex items-center gap-2">
                <span className="w-32 truncate font-semibold">{fundLabel(f.fund) || f.fund}</span>
                <div className="flex-1 rounded bg-slate-100 dark:bg-navy-700">
                  <div
                    className="h-2 rounded bg-brand-orange"
                    style={{ width: `${totalBudget > 0 ? (f.total / totalBudget) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-24 text-right font-mono text-xs text-slate-500">{fmtUsd(f.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Cohort table */}
      <Card>
        <CardHeader
          title={`Cohort table — ${sortedCohort.length} compan${sortedCohort.length === 1 ? 'y' : 'ies'}`}
          subtitle="Click Edit on any row to change AM, donor, pillars, sub-interventions, or budget. Changes propagate to Companies + Intervention Assignments + the Stage3 Distribution mirror tab."
        />
        <DataTable
          columns={columns}
          rows={sortedCohort as unknown as Record<string, unknown>[] as Company[]}
          emptyState={<EmptyState title="No cohort companies" description="Companies appear here once they have an Intervention Assignment." />}
        />
      </Card>

      <Stage3EditCompanyDrawer
        open={!!drawerCompany}
        onClose={() => setDrawerCompany(null)}
        company={drawerCompany}
        assignments={assignments}
        onSave={handleEditSubmit}
        disabled={reassignDisabled}
        disabledReason={reassignDisabled ? 'Distribution is locked. Ask an admin to unlock before editing.' : undefined}
      />
    </div>
  );
}

// ─── AmCard ──────────────────────────────────────────────────────────
//
// Per-AM summary card with click-to-expand. Collapsed view shows
// company / intervention / budget rollup. Expanded view shows the
// per-sub-intervention breakdown for that AM, weighted load score,
// and a load bar comparing this AM against the most-loaded AM.

function AmCard({
  bucket,
  expanded,
  onToggle,
  maxLoadAcrossAms,
}: {
  bucket: AmBucket;
  expanded: boolean;
  onToggle: () => void;
  maxLoadAcrossAms: number;
}) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        className="-m-4 mb-2 flex w-[calc(100%+2rem)] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-navy-700"
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {bucket.email ? 'Account Manager' : 'Unassigned'}
          </div>
          <div className="mt-0.5 truncate text-base font-bold text-navy-500 dark:text-white">
            {bucket.label}
          </div>
        </div>
        <Badge tone={bucket.companies.length === 0 ? 'neutral' : 'teal'}>
          {bucket.companies.length} co
        </Badge>
      </button>

      <div className="grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
        <div>
          <div className="font-semibold text-navy-500 dark:text-white">{bucket.assignments.length}</div>
          <div className="uppercase tracking-wider text-slate-400">interventions</div>
        </div>
        <div>
          <div className="font-semibold text-navy-500 dark:text-white">{fmtUsd(bucket.totalBudget)}</div>
          <div className="uppercase tracking-wider text-slate-400">budget</div>
        </div>
        <div>
          <div className="font-semibold text-navy-500 dark:text-white">{bucket.loadScore}</div>
          <div className="uppercase tracking-wider text-slate-400">load score</div>
        </div>
      </div>

      {/* Load bar — comparative across AMs. */}
      <div className="mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-navy-700">
          <div
            className={`h-full rounded-full ${bucket.loadScore >= maxLoadAcrossAms ? 'bg-brand-red' : 'bg-brand-teal'}`}
            style={{ width: `${Math.min(100, (bucket.loadScore / maxLoadAcrossAms) * 100)}%` }}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-navy-700">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Per sub-intervention
          </div>
          {bucket.perSub.length === 0 ? (
            <p className="text-xs text-slate-500">No interventions yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {bucket.perSub.map(s => (
                <li key={s.sub} className="flex items-center gap-2">
                  <span className="w-32 truncate font-semibold">{s.sub}</span>
                  <div className="flex-1 rounded bg-slate-100 dark:bg-navy-700">
                    <div
                      className="h-1.5 rounded bg-brand-orange"
                      style={{ width: `${Math.min(100, (s.load / Math.max(1, bucket.loadScore)) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono text-slate-500">{s.count}×</span>
                  <span className="w-10 text-right font-mono text-2xs text-slate-400">L{s.load}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-2xs italic text-slate-400">
            Load weights: TTH 5 · Upskilling/MKG Agency 3 · MKG Resources/C-Suite/Bridge/Legal 2 · Conferences 1.
            Tunable in <code>src/config/interventions.ts</code>.
          </div>
        </div>
      )}
    </Card>
  );
}
