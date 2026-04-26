import type { ReactNode } from 'react';

export type TabItem = {
  value: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
};

type Props = {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function Tabs({ items, value, onChange, className = '' }: Props) {
  return (
    <div className={`border-b border-slate-200 dark:border-navy-700 ${className}`}>
      <div className="flex flex-wrap gap-1">
        {items.map(item => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              disabled={item.disabled}
              onClick={() => onChange(item.value)}
              className={`group relative flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'border-brand-red text-navy-500 dark:text-white'
                  : 'border-transparent text-slate-500 hover:text-navy-500 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {item.icon && <span className="opacity-80">{item.icon}</span>}
              {item.label}
              {typeof item.count === 'number' && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    active
                      ? 'bg-brand-red/10 text-brand-red'
                      : 'bg-slate-100 text-slate-500 dark:bg-navy-700 dark:text-slate-300'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
