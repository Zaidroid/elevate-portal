import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export type Crumb = {
  label: string;
  to?: string;
};

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
      {items.map((crumb, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {crumb.to && !last ? (
              <Link
                to={crumb.to}
                className="uppercase tracking-wider hover:text-brand-red"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={last ? 'uppercase tracking-wider text-navy-500 dark:text-white' : 'uppercase tracking-wider'}>
                {crumb.label}
              </span>
            )}
            {!last && <ChevronRight className="h-3 w-3 opacity-60" />}
          </span>
        );
      })}
    </nav>
  );
}
