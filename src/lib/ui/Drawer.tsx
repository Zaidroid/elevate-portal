import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative flex h-screen max-h-screen w-full ${width} flex-col overflow-hidden bg-white shadow-2xl dark:bg-navy-500`}
      >
        <header className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-navy-700">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-navy-500 dark:text-white">{title}</h2>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-navy-700 dark:bg-navy-600">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
