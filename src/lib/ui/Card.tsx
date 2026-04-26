import type { ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
  accent?: 'red' | 'teal' | 'orange' | 'none';
};

export function Card({
  children,
  className = '',
  padded = true,
  interactive = false,
  accent = 'none',
}: CardProps) {
  const accentStyle =
    accent === 'red'
      ? 'bg-[linear-gradient(180deg,rgba(222,99,54,0.05),transparent)] dark:bg-[linear-gradient(180deg,rgba(222,99,54,0.08),transparent)] border-brand-red/30'
      : accent === 'teal'
      ? 'bg-[linear-gradient(180deg,rgba(48,157,196,0.05),transparent)] border-brand-teal/30'
      : accent === 'orange'
      ? 'bg-[linear-gradient(180deg,rgba(231,139,63,0.05),transparent)] border-brand-orange/30'
      : '';
  const interactiveStyle = interactive
    ? 'cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-lg hover:border-brand-red/40'
    : '';
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-card dark:border-navy-700 dark:bg-navy-600 ${
        padded ? 'p-5 md:p-6' : ''
      } ${accentStyle} ${interactiveStyle} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  overline,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  overline?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {overline && (
          <div className="mb-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
            {overline}
          </div>
        )}
        <h3 className="text-lg font-bold tracking-tight text-navy-500 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
