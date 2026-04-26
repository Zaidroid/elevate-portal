import { Card, CardHeader } from '../lib/ui';

export function Placeholder({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Card>
        <CardHeader title={title} />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This module is scaffolded but not yet implemented. The underlying Google Sheet is already
          built (see <code>sheet-builders/out/</code>).
        </p>
        {hint && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
        )}
      </Card>
    </div>
  );
}
