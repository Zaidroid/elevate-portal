import { useMemo, useState } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';

export type FilterOption = { value: string; label: string; count?: number };

export type FilterGroup = {
  key: string;
  label: string;
  options: FilterOption[];
};

export type FilterValues = Record<string, string[]>;

type Props = {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  groups: FilterGroup[];
  values: FilterValues;
  onValuesChange: (v: FilterValues) => void;
  total: number;
  filtered: number;
  resultNoun?: string;
  rightSlot?: React.ReactNode;
};

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  groups,
  values,
  onValuesChange,
  total,
  filtered,
  resultNoun = 'results',
  rightSlot,
}: Props) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const activePills = useMemo(() => {
    const pills: { groupKey: string; groupLabel: string; value: string; label: string }[] = [];
    for (const g of groups) {
      const selected = values[g.key] || [];
      for (const v of selected) {
        const opt = g.options.find(o => o.value === v);
        pills.push({ groupKey: g.key, groupLabel: g.label, value: v, label: opt?.label || v });
      }
    }
    return pills;
  }, [groups, values]);

  const anyActive = activePills.length > 0 || searchValue.length > 0;

  function toggle(groupKey: string, value: string) {
    const cur = values[groupKey] || [];
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    onValuesChange({ ...values, [groupKey]: next });
  }

  function removePill(groupKey: string, value: string) {
    const cur = values[groupKey] || [];
    onValuesChange({ ...values, [groupKey]: cur.filter(v => v !== value) });
  }

  function clearAll() {
    onSearchChange('');
    const cleared: FilterValues = {};
    for (const g of groups) cleared[g.key] = [];
    onValuesChange(cleared);
    setOpenGroup(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchValue}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-600 dark:text-white"
          />
        </div>

        {groups.map(g => {
          const selected = values[g.key] || [];
          const isOpen = openGroup === g.key;
          return (
            <div key={g.key} className="relative">
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? null : g.key)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  selected.length > 0
                    ? 'border-brand-teal bg-brand-teal/10 text-brand-teal-dark dark:text-brand-teal'
                    : 'border-slate-200 bg-white text-navy-500 hover:border-slate-300 dark:border-navy-700 dark:bg-navy-600 dark:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>{g.label}</span>
                {selected.length > 0 && (
                  <span className="rounded-full bg-brand-teal px-2 py-0.5 text-xs font-semibold text-white">
                    {selected.length}
                  </span>
                )}
              </button>

              {isOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setOpenGroup(null)}
                    aria-hidden
                  />
                  <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-navy-700 dark:bg-navy-600">
                    {g.options.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-slate-500">No options</p>
                    )}
                    {g.options.map(opt => {
                      const checked = selected.includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-navy-700"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(g.key, opt.value)}
                            className="h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-brand-teal"
                          />
                          <span className="flex-1 text-navy-500 dark:text-slate-200">{opt.label}</span>
                          {typeof opt.count === 'number' && (
                            <span className="text-xs text-slate-400">{opt.count}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {rightSlot}
      </div>

      {(activePills.length > 0 || anyActive) && (
        <div className="flex flex-wrap items-center gap-2">
          {activePills.map(p => (
            <button
              key={`${p.groupKey}:${p.value}`}
              onClick={() => removePill(p.groupKey, p.value)}
              className="flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-medium text-brand-teal-dark hover:bg-brand-teal/20 dark:text-brand-teal"
            >
              <span className="text-slate-500">{p.groupLabel}:</span>
              <span>{p.label}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
          {anyActive && (
            <button
              onClick={clearAll}
              className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-brand-red hover:underline"
            >
              Clear all
            </button>
          )}
          <span className="ml-auto text-xs text-slate-500">
            Showing <b className="text-navy-500 dark:text-white">{filtered}</b> of <b>{total}</b> {resultNoun}
          </span>
        </div>
      )}

      {activePills.length === 0 && !searchValue && (
        <div className="text-xs text-slate-500">
          Showing <b className="text-navy-500 dark:text-white">{filtered}</b> of <b>{total}</b> {resultNoun}
        </div>
      )}
    </div>
  );
}
