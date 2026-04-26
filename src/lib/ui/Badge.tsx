import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'red' | 'teal' | 'orange' | 'green' | 'amber';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-200',
  red: 'bg-brand-red/10 text-brand-red',
  teal: 'bg-brand-teal/10 text-brand-teal',
  orange: 'bg-brand-orange/10 text-brand-orange',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
};

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (['active', 'selected', 'onboarded', 'paid', 'executed', 'completed'].some(k => s.includes(k))) return 'green';
  if (['pending', 'draft', 'planned'].some(k => s.includes(k))) return 'amber';
  if (['rejected', 'cancelled', 'withdrawn', 'dropped'].some(k => s.includes(k))) return 'red';
  if (['in progress', 'under review', 'submitted', 'sent', 'interviewed'].some(k => s.includes(k))) return 'teal';
  return 'neutral';
}
