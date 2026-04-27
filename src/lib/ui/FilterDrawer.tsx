// FilterDrawer — universal slide-in filter panel that pages compose
// declaratively. Renders search + a list of filter fields (multiselect /
// select / toggle / chip) and surfaces an "Apply" / "Clear all" footer.
//
// Pages mount it with their own `fields` config + bind values; the
// drawer doesn't care what they mean. Trigger it from a single
// "Filters" button in the page header — far less visual chrome than
// inline chips/dropdowns and works the same on every page.

import { useEffect, useMemo, useRef } from 'react';
import { Filter, Search, X } from 'lucide-react';

export type FilterFieldOption = { value: string; label: string; count?: number };

export type FilterFieldDef =
  | { key: string; type: 'multiselect'; label: string; options: FilterFieldOption[]; hint?: string }
  | { key: string; type: 'select'; label: string; options: FilterFieldOption[]; hint?: string; placeholder?: string }
  | { key: string; type: 'toggle'; label: string; hint?: string }
  | { key: string; type: 'chips'; label: string; options: FilterFieldOption[]; hint?: string }; // single-select chip group

export type FilterValues = Record<string, string | string[] | boolean>;

type Props = {
  open: boolean;
  onClose: () => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  fields: FilterFieldDef[];
  values: FilterValues;
  onValuesChange: (v: FilterValues) => void;
  total: number;
  filtered: number;
  resultNoun?: string;
  // Optional content rendered above the search box — e.g. saved-view chips.
  prefix?: React.ReactNode;
};

export function FilterDrawer({
  open,
  onClose,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search…',
  fields,
  values,
  onValuesChange,
  total,
  filtered,
  resultNoun = 'results',
  prefix,
}: Props) {
  // Close on Esc, restore focus on close.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) wasOpenRef.current = true;
    if (!open) wasOpenRef.current = false;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const activeChips = useMemo(() => {
    const chips: Array<{ fieldKey: string; value: string; label: string }> = [];
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'multiselect') {
        const arr = Array.isArray(v) ? v : [];
        for (const value of arr) {
          const opt = f.options.find(o => o.value === value);
          chips.push({ fieldKey: f.key, value, label: `${f.label}: ${opt?.label || value}` });
        }
      } else if (f.type === 'select' || f.type === 'chips') {
        const value = typeof v === 'string' ? v : '';
        if (value) {
          const opt = f.options.find(o => o.value === value);
          chips.push({ fieldKey: f.key, value, label: `${f.label}: ${opt?.label || value}` });
        }
      } else if (f.type === 'toggle') {
        if (v === true) chips.push({ fieldKey: f.key, value: 'true', label: f.label });
      }
    }
    return chips;
  }, [fields, values]);

  const totalActive = activeChips.length + (searchValue ? 1 : 0);

  const removeChip = (fieldKey: string, value: string) => {
    const f = fields.find(x => x.key === fieldKey);
    if (!f) return;
    if (f.type === 'multiselect') {
      const cur = Array.isArray(values[fieldKey]) ? (values[fieldKey] as string[]) : [];
      onValuesChange({ ...values, [fieldKey]: cur.filter(v => v !== value) });
    } else if (f.type === 'toggle') {
      onValuesChange({ ...values, [fieldKey]: false });
    } else {
      onValuesChange({ ...values, [fieldKey]: '' });
    }
  };

  const clearAll = () => {
    onSearchChange?.('');
    const next: FilterValues = {};
    for (const f of fields) {
      if (f.type === 'multiselect') next[f.key] = [];
      else if (f.type === 'toggle') next[f.key] = false;
      else next[f.key] = '';
    }
    onValuesChange(next);
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity"
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-screen w-[360px] max-w-[90vw] transform flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 dark:border-navy-700 dark:bg-navy-900 ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-navy-700">
          <div>
            <h2 className="inline-flex items-center gap-1.5 text-sm font-extrabold text-navy-500 dark:text-white">
              <Filter className="h-4 w-4" /> Filters
              {totalActive > 0 && (
                <span className="rounded-full bg-brand-teal px-2 py-0.5 text-[10px] font-bold text-white">{totalActive}</span>
              )}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Showing {filtered.toLocaleString()} of {total.toLocaleString()} {resultNoun}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-700"
            aria-label="Close filters"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {prefix && <div className="mb-3">{prefix}</div>}

          {onSearchChange && (
            <div className="mb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={e => onSearchChange(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-brand-editable/30 py-1.5 pl-8 pr-2 text-xs dark:border-navy-700 dark:bg-navy-700 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {activeChips.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Active</div>
              <div className="flex flex-wrap gap-1">
                {activeChips.map(c => (
                  <button
                    key={`${c.fieldKey}::${c.value}`}
                    type="button"
                    onClick={() => removeChip(c.fieldKey, c.value)}
                    className="inline-flex items-center gap-1 rounded-full border border-brand-teal/40 bg-brand-teal/5 px-2 py-0.5 text-[11px] font-semibold text-brand-teal hover:bg-brand-teal/15"
                  >
                    {c.label} <X className="h-2.5 w-2.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {fields.map(f => (
              <FilterFieldRow
                key={f.key}
                field={f}
                value={values[f.key]}
                onChange={v => onValuesChange({ ...values, [f.key]: v })}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-navy-700">
          <button
            type="button"
            onClick={clearAll}
            disabled={totalActive === 0}
            className="text-xs font-semibold text-slate-500 hover:text-brand-red disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand-teal px-4 py-1.5 text-xs font-bold text-white hover:bg-brand-teal/90"
          >
            Done
          </button>
        </div>
      </aside>
    </>
  );
}

// One row in the body of the drawer. Renders the right input for the field type.
function FilterFieldRow({
  field,
  value,
  onChange,
}: {
  field: FilterFieldDef;
  value: string | string[] | boolean | undefined;
  onChange: (v: string | string[] | boolean) => void;
}) {
  if (field.type === 'multiselect') {
    const cur = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1 text-xs font-bold text-navy-500 dark:text-slate-100">
          {field.label}
          {cur.length > 0 && <span className="ml-1 text-[10px] font-semibold text-slate-500">({cur.length})</span>}
        </legend>
        {field.hint && <p className="mb-1 text-[10px] text-slate-500">{field.hint}</p>}
        <div className="space-y-0.5 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/40 p-1.5 dark:border-navy-700 dark:bg-navy-800/40">
          {field.options.length === 0 ? (
            <span className="text-[11px] text-slate-400 italic">No options</span>
          ) : field.options.map(o => {
            const checked = cur.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs hover:bg-white dark:hover:bg-navy-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? cur.filter(v => v !== o.value) : [...cur, o.value])}
                  className="h-3 w-3 rounded text-brand-teal focus:ring-brand-teal"
                />
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{o.label}</span>
                {o.count !== undefined && <span className="text-[10px] text-slate-400 tabular">{o.count}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (field.type === 'select') {
    const cur = typeof value === 'string' ? value : '';
    return (
      <fieldset>
        <legend className="mb-1 text-xs font-bold text-navy-500 dark:text-slate-100">{field.label}</legend>
        {field.hint && <p className="mb-1 text-[10px] text-slate-500">{field.hint}</p>}
        <select
          value={cur}
          onChange={e => onChange(e.currentTarget.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-slate-100"
        >
          <option value="">{field.placeholder || 'Any'}</option>
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </fieldset>
    );
  }

  if (field.type === 'chips') {
    const cur = typeof value === 'string' ? value : '';
    return (
      <fieldset>
        <legend className="mb-1 text-xs font-bold text-navy-500 dark:text-slate-100">{field.label}</legend>
        {field.hint && <p className="mb-1 text-[10px] text-slate-500">{field.hint}</p>}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onChange('')}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              !cur ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'
            }`}
          >
            All
          </button>
          {field.options.map(o => {
            const active = cur === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(active ? '' : o.value)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  active ? 'bg-brand-teal text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-navy-700 dark:text-slate-200'
                }`}
              >
                {o.label}{o.count !== undefined && ` (${o.count})`}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  // toggle
  const cur = value === true;
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/40 px-2 py-1.5 dark:border-navy-700 dark:bg-navy-800/40">
      <div>
        <span className="text-xs font-bold text-navy-500 dark:text-slate-100">{field.label}</span>
        {field.hint && <p className="text-[10px] text-slate-500">{field.hint}</p>}
      </div>
      <input
        type="checkbox"
        checked={cur}
        onChange={() => onChange(!cur)}
        className="h-4 w-4 rounded text-brand-teal focus:ring-brand-teal"
      />
    </label>
  );
}

// Compact "Filters" pill button to drop into a page header. Shows a count
// of active filters when > 0.
export function FilterToggleButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
        count > 0
          ? 'border-brand-teal bg-brand-teal/10 text-brand-teal hover:bg-brand-teal/20'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-navy-700 dark:bg-navy-800 dark:text-slate-200 dark:hover:bg-navy-700'
      }`}
    >
      <Filter className="h-3.5 w-3.5" /> Filters
      {count > 0 && (
        <span className="rounded-full bg-brand-teal px-1.5 text-[10px] font-bold text-white">{count}</span>
      )}
    </button>
  );
}
