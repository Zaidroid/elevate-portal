import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-red text-white shadow-brand-red hover:bg-brand-red-dark hover:shadow-brand-red-lg focus-visible:ring-2 focus-visible:ring-brand-red/30 active:scale-[0.98]',
  secondary:
    'bg-brand-teal text-white shadow-card hover:bg-brand-teal-dark focus-visible:ring-2 focus-visible:ring-brand-teal/30 active:scale-[0.98]',
  outline:
    'border border-slate-200 bg-white text-navy-500 hover:border-brand-red/40 hover:text-brand-red dark:border-navy-600 dark:bg-navy-700 dark:text-slate-100 dark:hover:border-brand-red/50',
  ghost:
    'bg-transparent text-navy-500 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-navy-700',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 rounded-lg',
  md: 'text-sm px-4 py-2 rounded-xl',
  lg: 'text-base px-5 py-2.5 rounded-xl',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 ease-out focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
