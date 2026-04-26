import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
};

type ToastContextValue = {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>((toast) => {
    const id = ++idRef.current;
    setToasts(ts => [...ts, { ...toast, id }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const value: ToastContextValue = {
    push,
    success: (title, detail) => push({ tone: 'success', title, detail }),
    error: (title, detail) => push({ tone: 'error', title, detail }),
    info: (title, detail) => push({ tone: 'info', title, detail }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 10);
    return () => clearTimeout(t);
  }, []);

  const tones: Record<ToastTone, { border: string; icon: ReactNode; title: string }> = {
    success: {
      border: 'border-emerald-200 bg-white dark:border-emerald-900 dark:bg-navy-600',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
      title: 'text-navy-500 dark:text-white',
    },
    error: {
      border: 'border-red-200 bg-white dark:border-red-900 dark:bg-navy-600',
      icon: <AlertTriangle className="h-5 w-5 text-brand-red" />,
      title: 'text-navy-500 dark:text-white',
    },
    info: {
      border: 'border-slate-200 bg-white dark:border-navy-700 dark:bg-navy-600',
      icon: <Info className="h-5 w-5 text-brand-teal" />,
      title: 'text-navy-500 dark:text-white',
    },
  };
  const t = tones[toast.tone];

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg transition-all duration-200 ${
        entering ? 'translate-x-4 opacity-0' : 'translate-x-0 opacity-100'
      } ${t.border}`}
    >
      {t.icon}
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${t.title}`}>{toast.title}</div>
        {toast.detail && (
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">{toast.detail}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-500 dark:hover:bg-navy-700"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
