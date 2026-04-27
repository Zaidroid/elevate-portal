// /logframes — multi-year indicator tracker for the Companies team's
// Dutch (97060) and SIDA TechRise (91763) logframes.
//
// Reads from the E3 - Logframes workbook. The Dutch tab has 23/24/25/26/27
// targets + corresponding Reported columns + LoP. SIDA has 26/27/28 + Y1-Y3
// + LoP + Means of Verification + Workstream. Both have Indicator Level
// (Goal / Outcome / Output X.Y) which the page groups by.
//
// Each indicator surfaces: ID, GSG team, indicator text, source of
// calculation, multi-year target stripe with reported values inline, an
// auto-computed actual for 2026 (where the source-of-calculation phrase
// is recognised), variance vs target, and on click-expand the full row
// (note, MoV, every other column the team filled).

import { useMemo, useState } from 'react';
import {
  Activity, BarChart3, ChevronDown, ChevronRight, Globe2,
  Search, Target,
} from 'lucide-react';
import { useSheetDoc } from '../../lib/two-way-sync';
import { getSheetId, getTab } from '../../config/sheets';
import {
  Badge, Card, CardHeader, EmptyState, FilterDrawer, FilterToggleButton, PageHeader, Tabs,
} from '../../lib/ui';
import type {
  FilterDrawerValues, FilterFieldDef, TabItem, Tone,
} from '../../lib/ui';
import { computeIndicator, parseTarget } from '../../lib/logframes/compute';

type Row = Record<string, string>;
type FundView = 'dutch' | 'sida';

// Year columns we surface in the multi-year stripe per fund. The actual
// header strings the team uses are listed; the renderer picks whichever
// matches a row's keys.
const YEAR_COLS_DUTCH: Array<{ year: string; targetKeys: string[]; reportedKeys: string[] }> = [
  { year: '2023', targetKeys: ['2023 Target'], reportedKeys: ['2023 Reported'] },
  { year: '2024', targetKeys: ['2024 Target'], reportedKeys: ['2024 Reported'] },
  { year: '2025', targetKeys: ['2025 Target'], reportedKeys: ['2025 Reported'] },
  { year: '2026', targetKeys: ['2026 Target', '2026 Target (June - July)'], reportedKeys: ['2026 Reported'] },
  { year: '2027', targetKeys: ['2027 Target'], reportedKeys: ['2027 Reported'] },
  { year: 'LoP', targetKeys: ['LoP Dutch Target', 'LOP Dutch Target', 'LOP Target'], reportedKeys: ['LOP Dutch Reported', 'LOP Reported'] },
];
const YEAR_COLS_SIDA: Array<{ year: string; targetKeys: string[]; reportedKeys: string[] }> = [
  { year: '2026', targetKeys: ['2026 Target', 'Y1 Target'], reportedKeys: ['2026 Reported', 'Y1 Reported'] },
  { year: '2027', targetKeys: ['2027 Target', '2027Target', 'Y2 Target'], reportedKeys: ['2027 Reported', 'Y2 Reported'] },
  { year: '2028', targetKeys: ['2028 Target', '2028Target', 'Y3 Target'], reportedKeys: ['2028 Reported', 'Y3 Reported'] },
  { year: 'LoP', targetKeys: ['LOP Target', 'LoP Target'], reportedKeys: ['LOP Reported'] },
];

// Sortable hierarchy ordering. "Goal" sits at the top, then Outcome,
// then Output X.Y by numeric sort, then Activity, with anything else
// sinking to the bottom.
function levelRank(s: string): number {
  if (!s) return 999;
  const low = s.toLowerCase();
  if (low.startsWith('goal')) return 0;
  if (low.startsWith('outcome')) return 100 + numAfter(low, 'outcome');
  if (low.startsWith('output')) return 200 + numAfter(low, 'output');
  if (low.startsWith('activity')) return 300 + numAfter(low, 'activity');
  return 800;
}
function numAfter(s: string, prefix: string): number {
  const tail = s.slice(prefix.length).trim();
  // Convert "2.1" -> 21, "1" -> 10, etc.
  const parts = tail.split('.').map(p => parseInt(p, 10) || 0);
  return parts.reduce((acc, n, i) => acc + n * Math.pow(10, 2 - i), 0);
}

export function LogframesPage() {
  const [tab, setTab] = useState<string>('indicators');
  const [fund, setFund] = useState<FundView>('dutch');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FilterDrawerValues>({
    level: [],
    team: [],
    onlyOurTeam: true,
    search: '',
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const logframesId = getSheetId('logframes');
  const { rows: dutch, loading: dutchLoading, error: dutchError } = useSheetDoc<Row>(
    logframesId || null,
    getTab('logframes', 'dutch'),
    'ID'
  );
  const { rows: sida, loading: sidaLoading } = useSheetDoc<Row>(
    logframesId || null,
    getTab('logframes', 'sida'),
    'ID'
  );

  // Live data we join against for auto-computed actuals.
  const companiesId = getSheetId('companies');
  const paymentsId = getSheetId('payments');
  const { rows: companies } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'companies'), 'company_id');
  const { rows: assignments } = useSheetDoc<Row>(companiesId || null, getTab('companies', 'assignments'), 'assignment_id');
  const { rows: payments } = useSheetDoc<Row>(paymentsId || null, getTab('payments', 'payments'), 'payment_id');

  const inputs = useMemo(() => ({ companies, assignments, payments }), [companies, assignments, payments]);

  if (!logframesId) {
    return (
      <Card>
        <CardHeader title="Logframes" />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_SHEET_LOGFRAMES</code> in your environment.
        </p>
      </Card>
    );
  }

  const fundRows = fund === 'dutch' ? dutch : sida;
  const yearCols = fund === 'dutch' ? YEAR_COLS_DUTCH : YEAR_COLS_SIDA;
  const fundLoading = fund === 'dutch' ? dutchLoading : sidaLoading;

  // Decorate every row with a normalised view + filter dimensions.
  const decorated = useMemo(() => {
    return fundRows
      .filter(r => (r['Output Indicators'] || r.Indicators || '').trim().length > 0)
      .map(r => {
        const id = r.ID || r.id || '';
        const level = (r['Indicator Level'] || r['Indicator level'] || '').trim();
        const team = (r['GSG team'] || r['GSG Team'] || '').trim();
        const workstream = (r.Workstream || r.workstream || '').trim();
        const indicator = (r['Output Indicators'] || r.Indicators || '').trim();
        const source = (r['Exact Source of Calculation'] || r['Source of Calculation'] || '').trim();
        const note = (r.Note || r['Further note on calcualtion'] || r['Further note on calculation'] || '').trim();
        const mov = (r['Means of Verification'] || r['Means of verification'] || '').trim();

        const targets = yearCols.map(yc => ({
          year: yc.year,
          target: parseTarget(pickKey(r, yc.targetKeys)),
          reported: parseTarget(pickKey(r, yc.reportedKeys)),
        }));

        // Auto-compute the current-year (2026) actual. Other years are
        // already historical and we trust the Reported column.
        const target2026 = targets.find(t => t.year === '2026')?.target ?? null;
        const computed2026 = computeIndicator(source, inputs, target2026);

        return { row: r, id, level, team, workstream, indicator, source, note, mov, targets, computed2026 };
      });
  }, [fundRows, yearCols, inputs]);

  // Filter dimensions
  const levelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of decorated) if (d.level) set.add(d.level);
    return Array.from(set).sort((a, b) => levelRank(a) - levelRank(b)).map(v => ({ value: v, label: v }));
  }, [decorated]);
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of decorated) if (d.team) set.add(d.team);
    return Array.from(set).sort().map(v => ({ value: v, label: v }));
  }, [decorated]);

  const filtered = useMemo(() => {
    const onlyOurs = filters.onlyOurTeam === true;
    const levels = (filters.level as string[] | undefined) || [];
    const teams = (filters.team as string[] | undefined) || [];
    const q = ((filters.search as string | undefined) || '').toLowerCase().trim();

    return decorated.filter(d => {
      if (onlyOurs && d.team && !/compan/i.test(d.team)) return false;
      if (levels.length > 0 && !levels.includes(d.level)) return false;
      if (teams.length > 0 && !teams.includes(d.team)) return false;
      if (q && !`${d.indicator} ${d.id} ${d.level} ${d.team} ${d.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [decorated, filters]);

  // Group by level for the indicator view.
  const grouped = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const d of filtered) {
      const k = d.level || 'Unspecified';
      const arr = m.get(k) || [];
      arr.push(d);
      m.set(k, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => levelRank(a) - levelRank(b));
  }, [filtered]);

  const filterFields: FilterFieldDef[] = [
    { key: 'onlyOurTeam', type: 'toggle', label: 'Only Companies team', hint: 'Hide indicators owned by other teams (Advisors / Freelancers / etc.)' },
    { key: 'level', type: 'multiselect', label: 'Level', options: levelOptions },
    { key: 'team', type: 'multiselect', label: 'GSG team', options: teamOptions, hint: 'Some logframes mix indicators across teams.' },
  ];
  const activeFilterCount =
    ((filters.level as string[] | undefined)?.length || 0) +
    ((filters.team as string[] | undefined)?.length || 0) +
    (filters.onlyOurTeam === false ? 1 : 0) +    // toggle off counts as "filter changed"
    ((filters.search as string | undefined) ? 1 : 0);

  const tabs: TabItem[] = [
    { value: 'indicators', label: 'Indicators', icon: <Activity className="h-4 w-4" />, count: filtered.length },
    { value: 'summary', label: 'Summary', icon: <Target className="h-4 w-4" /> },
    { value: 'budget', label: 'Budget', icon: <BarChart3 className="h-4 w-4" /> },
  ];

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Logframes"
        badges={[
          { label: fund === 'dutch' ? 'Dutch · 97060' : 'SIDA · 91763', tone: fund === 'dutch' ? 'red' : 'teal' },
          { label: `${filtered.length} indicators`, tone: 'neutral' },
        ]}
        actions={<FilterToggleButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFund('dutch')}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${fund === 'dutch' ? 'bg-brand-red text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
        >
          <Globe2 className="h-3.5 w-3.5" /> Dutch
        </button>
        <button
          onClick={() => setFund('sida')}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${fund === 'sida' ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'}`}
        >
          <Globe2 className="h-3.5 w-3.5" /> SIDA TechRise
        </button>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search indicators…"
            value={(filters.search as string | undefined) || ''}
            onChange={e => setFilters({ ...filters, search: e.currentTarget.value })}
            className="w-64 rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
          />
        </div>
      </div>

      {dutchError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">Failed to load: {dutchError.message}</p>
        </Card>
      )}

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'indicators' && (
        <IndicatorsView
          grouped={grouped}
          yearCols={yearCols}
          expanded={expanded}
          onToggle={toggleExpanded}
          loading={fundLoading}
        />
      )}
      {tab === 'summary' && (
        <SummaryView decorated={filtered} fund={fund} />
      )}
      {tab === 'budget' && (
        <BudgetView inputs={inputs} fund={fund} />
      )}

      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        searchValue={(filters.search as string | undefined) || ''}
        onSearchChange={v => setFilters({ ...filters, search: v })}
        searchPlaceholder="Search indicators…"
        fields={filterFields}
        values={filters}
        onValuesChange={setFilters}
        total={decorated.length}
        filtered={filtered.length}
        resultNoun="indicators"
      />
    </div>
  );
}

// ─── Indicators view ───────────────────────────────────────────────

type Decorated = ReturnType<typeof useDecorated> extends infer T ? T : never;
function useDecorated() { return [] as Array<{
  row: Row; id: string; level: string; team: string; workstream: string;
  indicator: string; source: string; note: string; mov: string;
  targets: Array<{ year: string; target: number | null; reported: number | null }>;
  computed2026: ReturnType<typeof computeIndicator>;
}>; }

function IndicatorsView({
  grouped,
  yearCols,
  expanded,
  onToggle,
  loading,
}: {
  grouped: Array<[string, Decorated]>;
  yearCols: Array<{ year: string; targetKeys: string[]; reportedKeys: string[] }>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  loading: boolean;
}) {
  if (loading && grouped.length === 0) {
    return <Card><EmptyState icon={<Activity className="h-6 w-6 animate-pulse" />} title="Loading…" description="Reading the logframes sheet." /></Card>;
  }
  if (grouped.length === 0) {
    return <Card><EmptyState icon={<Activity className="h-6 w-6" />} title="No indicators match your filters" /></Card>;
  }

  return (
    <div className="space-y-3">
      {grouped.map(([level, items]) => (
        <Card key={level}>
          <CardHeader
            title={<span className="inline-flex items-center gap-2">{level}<Badge tone="neutral">{items.length}</Badge></span>}
          />
          <div className="overflow-hidden rounded-md border border-slate-200 dark:border-navy-700">
            <div className={`grid grid-cols-[24px_70px_1fr_${yearCols.map(() => '90px').join('_')}_120px] border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-300`} style={{ gridTemplateColumns: `24px 70px 1fr ${yearCols.map(() => '90px').join(' ')} 120px` }}>
              <span />
              <span>ID</span>
              <span>Indicator</span>
              {yearCols.map(yc => (
                <span key={yc.year} className="text-right">{yc.year}</span>
              ))}
              <span>2026 status</span>
            </div>
            <ul>
              {items.map(d => {
                const isOpen = expanded.has(d.id || d.indicator);
                const target26 = d.targets.find(t => t.year === '2026')?.target ?? null;
                const variance = d.computed2026.actual !== null && target26 !== null ? d.computed2026.actual - target26 : null;
                return (
                  <li key={d.id || d.indicator} className="border-b border-slate-100 dark:border-navy-800 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onToggle(d.id || d.indicator)}
                      className="grid w-full items-start gap-2 px-2 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-navy-800"
                      style={{ gridTemplateColumns: `24px 70px 1fr ${yearCols.map(() => '90px').join(' ')} 120px` }}
                    >
                      <span className="pt-0.5 text-slate-400">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{d.id || '—'}</span>
                      <span>
                        <div className="font-bold text-navy-500 dark:text-slate-100 leading-snug">{d.indicator}</div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {d.team && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-navy-700">{d.team}</span>}
                          {d.workstream && <span className="rounded bg-brand-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-teal">{d.workstream}</span>}
                        </div>
                      </span>
                      {yearCols.map(yc => {
                        const yr = d.targets.find(t => t.year === yc.year);
                        const t = yr?.target;
                        const rep = yr?.reported;
                        return (
                          <span key={yc.year} className="text-right font-mono text-[11px]">
                            <div className="font-bold text-slate-700 dark:text-slate-200">{t !== null && t !== undefined ? fmtNumber(t) : '—'}</div>
                            {rep !== null && rep !== undefined && (
                              <div className={`text-[10px] ${(t || 0) > 0 && rep >= (t || 0) ? 'text-emerald-600' : (t || 0) > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {fmtNumber(rep)}
                              </div>
                            )}
                          </span>
                        );
                      })}
                      <span>
                        <Badge tone={statusTone(d.computed2026.status)}>{statusLabel(d.computed2026.status)}</Badge>
                        {d.computed2026.actual !== null && target26 !== null && (
                          <div className={`mt-0.5 text-[10px] font-mono ${variance !== null && variance >= 0 ? 'text-emerald-600' : 'text-brand-red'}`}>
                            {d.computed2026.actual.toLocaleString()} / {target26}
                            {variance !== null && ` (${variance > 0 ? '+' : ''}${variance})`}
                          </div>
                        )}
                      </span>
                    </button>
                    {isOpen && <IndicatorDetail d={d} />}
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  );
}

function IndicatorDetail({ d }: { d: Decorated[number] }) {
  // Render every non-empty raw cell. We surface the curated fields above as
  // their own sections, so the dump skips them.
  const SKIP = new Set([
    'ID', 'id', 'Indicator Level', 'Indicator level', 'GSG team', 'GSG Team',
    'Workstream', 'workstream', 'Output Indicators', 'Indicators',
    'Exact Source of Calculation', 'Source of Calculation',
    'Note', 'Further note on calcualtion', 'Further note on calculation',
    'Means of Verification', 'Means of verification',
  ]);
  // Also skip keys we showed in the year stripe.
  const SKIP_PATTERNS = [/Target/i, /Reported/i, /^LOP/i, /^LoP/i, /^Y\d/];
  const extra = Object.entries(d.row).filter(([k, v]) => {
    if (!v || !v.toString().trim()) return false;
    if (SKIP.has(k)) return false;
    if (SKIP_PATTERNS.some(p => p.test(k))) return false;
    return true;
  });

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-navy-800 dark:bg-navy-800/30">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Source of calculation</h4>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-800 dark:text-slate-200">{d.source || '—'}</p>
          <div className="mt-2 text-[11px] text-slate-500">
            <span className="font-semibold">Hint:</span> {d.computed2026.hint || 'Manual'}
          </div>
        </div>
        {(d.note || d.mov) && (
          <div className="space-y-2">
            {d.note && (
              <div>
                <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Note</h4>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-800 dark:text-slate-200">{d.note}</p>
              </div>
            )}
            {d.mov && (
              <div>
                <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Means of Verification</h4>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-800 dark:text-slate-200">{d.mov}</p>
              </div>
            )}
          </div>
        )}
      </div>
      {extra.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Other fields on this row</h4>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {extra.map(([k, v]) => (
              <div key={k} className="rounded-md border border-slate-100 bg-white p-1.5 dark:border-navy-800 dark:bg-navy-900">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k}</div>
                <div className="whitespace-pre-wrap break-words text-xs text-slate-800 dark:text-slate-200">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary view ──────────────────────────────────────────────────

function SummaryView({ decorated, fund }: { decorated: Decorated; fund: FundView }) {
  const stats = useMemo(() => {
    let auto = 0, manual = 0, onTrack = 0, atRisk = 0, offTrack = 0;
    let target26Sum = 0, actual26Sum = 0;
    const byLevel = new Map<string, { count: number; onTrack: number; atRisk: number; offTrack: number }>();
    for (const d of decorated) {
      const c = d.computed2026;
      if (c.status === 'manual') manual += 1; else auto += 1;
      if (c.status === 'on_track') onTrack += 1;
      if (c.status === 'at_risk') atRisk += 1;
      if (c.status === 'off_track') offTrack += 1;
      const target26 = d.targets.find(t => t.year === '2026')?.target;
      if (target26) target26Sum += target26;
      if (c.actual !== null) actual26Sum += c.actual;
      const lv = d.level || 'Unspecified';
      const e = byLevel.get(lv) || { count: 0, onTrack: 0, atRisk: 0, offTrack: 0 };
      e.count += 1;
      if (c.status === 'on_track') e.onTrack += 1;
      if (c.status === 'at_risk') e.atRisk += 1;
      if (c.status === 'off_track') e.offTrack += 1;
      byLevel.set(lv, e);
    }
    return { auto, manual, onTrack, atRisk, offTrack, target26Sum, actual26Sum, byLevel };
  }, [decorated]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <KPI label="Indicators" value={decorated.length} hint={`${stats.auto} auto · ${stats.manual} manual`} tone="navy" />
        <KPI label="On track" value={stats.onTrack} tone="green" />
        <KPI label="At risk" value={stats.atRisk} tone="amber" />
        <KPI label="Off track" value={stats.offTrack} tone="red" />
        <KPI label="Auto coverage" value={`${pct(stats.auto, decorated.length)}%`} hint={`${stats.manual} need manual entry`} tone="teal" />
      </div>
      <Card>
        <CardHeader title="By indicator level" subtitle={fund === 'dutch' ? 'Dutch logframe' : 'SIDA TechRise logframe'} />
        {Array.from(stats.byLevel.entries()).length === 0 ? (
          <p className="text-sm text-slate-500">No indicators in scope.</p>
        ) : (
          <ul className="space-y-1.5">
            {Array.from(stats.byLevel.entries()).sort(([a], [b]) => levelRank(a) - levelRank(b)).map(([lv, s]) => (
              <li key={lv} className="grid grid-cols-[1fr_60px_60px_60px_60px] items-center gap-2 text-xs">
                <span className="font-semibold text-navy-500 dark:text-slate-100">{lv}</span>
                <span className="text-right font-mono">{s.count}</span>
                <span className="text-right font-mono text-emerald-600">{s.onTrack}</span>
                <span className="text-right font-mono text-amber-600">{s.atRisk}</span>
                <span className="text-right font-mono text-brand-red">{s.offTrack}</span>
              </li>
            ))}
            <li className="grid grid-cols-[1fr_60px_60px_60px_60px] items-center gap-2 border-t border-slate-200 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-navy-700">
              <span>Total</span>
              <span className="text-right">All</span>
              <span className="text-right">On</span>
              <span className="text-right">At risk</span>
              <span className="text-right">Off</span>
            </li>
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Budget view ──────────────────────────────────────────────────

function BudgetView({
  inputs,
  fund,
}: {
  inputs: { companies: Row[]; assignments: Row[]; payments: Row[] };
  fund: FundView;
}) {
  const fundCode = fund === 'dutch' ? '97060' : '91763';
  const stats = useMemo(() => {
    const fundPayments = inputs.payments.filter(p => p.fund_code === fundCode);
    const totalPaid = fundPayments
      .filter(p => p.status === 'Paid')
      .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0);
    const totalPending = fundPayments
      .filter(p => ['Pending Approval', 'Approved', 'Sent to Finance'].includes(p.status || ''))
      .reduce((s, p) => s + (parseFloat(p.amount_usd || '0') || 0), 0);

    const byMonth: Record<string, number> = {};
    for (const p of fundPayments) {
      if (p.status !== 'Paid') continue;
      const m = (p.payment_date || '').slice(0, 7) || 'Unset';
      byMonth[m] = (byMonth[m] || 0) + (parseFloat(p.amount_usd || '0') || 0);
    }

    const byIntervention: Record<string, number> = {};
    for (const p of fundPayments) {
      if (p.status !== 'Paid') continue;
      const it = p.intervention_type || 'Unknown';
      byIntervention[it] = (byIntervention[it] || 0) + (parseFloat(p.amount_usd || '0') || 0);
    }
    const fundAssignments = inputs.assignments.filter(a => a.fund_code === fundCode);
    const plannedFromAssignments = fundAssignments.reduce((s, a) => s + (parseFloat(a.budget_usd || '0') || 0), 0);

    return { totalPaid, totalPending, byMonth, byIntervention, plannedFromAssignments, paymentCount: fundPayments.length, assignmentCount: fundAssignments.length };
  }, [inputs.payments, inputs.assignments, fundCode]);

  const months = Object.entries(stats.byMonth).filter(([k]) => k !== 'Unset').sort();
  const max = Math.max(1, ...months.map(([, v]) => v));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KPI label="Paid YTD" value={`$${stats.totalPaid.toLocaleString()}`} hint={`${stats.paymentCount} payments`} tone="green" />
        <KPI label="Pending" value={`$${stats.totalPending.toLocaleString()}`} tone="amber" />
        <KPI label="Planned (assignments)" value={`$${stats.plannedFromAssignments.toLocaleString()}`} hint={`${stats.assignmentCount} interventions`} tone="navy" />
        <KPI label="Burn this year" value={`${months.length} months`} tone="teal" />
      </div>

      <Card>
        <CardHeader title="By intervention" subtitle={`Paid USD per pillar, fund ${fundCode}`} />
        {Object.keys(stats.byIntervention).length === 0 ? (
          <p className="text-sm text-slate-500">No paid disbursements for this fund yet.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(stats.byIntervention).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
              const maxV = Math.max(...Object.values(stats.byIntervention));
              return (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-navy-500 dark:text-slate-200">{k}</span>
                    <span className="font-mono text-slate-500">${v.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-navy-700">
                    <div className="h-full rounded-full bg-brand-teal" style={{ width: `${(v / maxV) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Monthly burn" subtitle={`Paid USD per month, fund ${fundCode}`} />
        {months.length === 0 ? (
          <p className="text-sm text-slate-500">No monthly data yet.</p>
        ) : (
          <div className="flex h-32 items-end gap-2">
            {months.map(([m, v]) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-brand-orange"
                  style={{ height: `${(v / max) * 100}%` }}
                  title={`${m}: $${v.toLocaleString()}`}
                />
                <div className="text-2xs text-slate-500">{m.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── primitives ────────────────────────────────────────────────────

function KPI({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone: 'navy' | 'teal' | 'green' | 'amber' | 'red' }) {
  const toneCls: Record<string, string> = {
    navy: 'border-slate-200 bg-white text-navy-500 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-100',
    teal: 'border-brand-teal/30 bg-brand-teal/5 text-brand-teal',
    green: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    red: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  };
  return (
    <div className={`rounded-xl border p-2.5 ${toneCls[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[10px] opacity-70">{hint}</div>}
    </div>
  );
}

function statusTone(s: string): Tone {
  switch (s) {
    case 'on_track': return 'green';
    case 'at_risk': return 'amber';
    case 'off_track': return 'red';
    default: return 'neutral';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'on_track': return 'On track';
    case 'at_risk': return 'At risk';
    case 'off_track': return 'Off track';
    default: return 'Manual';
  }
}

function fmtNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (Math.abs(n) >= 1_000) return n.toLocaleString();
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

function pickKey(row: Row, keys: string[]): string {
  for (const k of keys) if (row[k]) return row[k];
  return '';
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return '0';
  return Math.round((num / denom) * 100).toString();
}
