// PageHeader — the canonical one-row page header pattern. Title on the
// left with inline badges. Action buttons aligned right. Subtitle (if any)
// renders as a one-line muted strip BELOW the row, never wrapping action
// buttons. Use this on every top-level page so the chrome stays
// consistent and tight.

import type { ReactNode } from 'react';
import type { Tone } from './Badge';
import { Badge } from './Badge';

export type PageHeaderBadge =
  | { label: string; tone?: Tone; title?: string }
  | { label: ReactNode; tone?: Tone; title?: string; key: string }; // for custom-rendered badges (e.g. clickable)

type Props = {
  title: ReactNode;
  badges?: PageHeaderBadge[];
  actions?: ReactNode;
  // Optional one-line subtitle. Drops onto its own row when present;
  // pages that don't need one should omit it entirely so the header is
  // a single line.
  subtitle?: ReactNode;
  // Custom slot rendered between the title row and the subtitle (e.g.,
  // a single inline alert chip the team should see immediately).
  inlineNotice?: ReactNode;
};

export function PageHeader({ title, badges, actions, subtitle, inlineNotice }: Props) {
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-navy-500 dark:text-white">
            {title}
          </h1>
          {badges?.map((b, i) => {
            const key = 'key' in b ? b.key : `${i}-${typeof b.label === 'string' ? b.label : ''}`;
            const badge = (
              <Badge key={key} tone={b.tone || 'neutral'}>
                {b.label}
              </Badge>
            );
            return b.title
              ? <span key={key} title={b.title}>{badge}</span>
              : badge;
          })}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-1.5">
            {actions}
          </div>
        )}
      </div>
      {inlineNotice}
      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      )}
    </header>
  );
}
