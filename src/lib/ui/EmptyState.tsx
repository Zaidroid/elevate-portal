import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, action, className = '' }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/40 px-6 py-12 text-center dark:border-navy-700 dark:bg-navy-700/40 ${className}`}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-navy-700 dark:text-slate-300">
        {icon || <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold text-navy-500 dark:text-white">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
