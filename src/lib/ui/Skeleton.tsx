type Props = {
  className?: string;
  rows?: number;
};

export function Skeleton({ className = '' }: Props) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-navy-700 ${className}`}
    />
  );
}

export function SkeletonText({ rows = 3, className = '' }: Props) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          {...{ style: { width: `${70 + ((i * 13) % 30)}%` } as React.CSSProperties }}
        />
      ))}
    </div>
  );
}

export function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-slate-100 dark:border-navy-700">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonCard({ className = '' }: Props) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 dark:border-navy-700 dark:bg-navy-600 ${className}`}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="mb-2 h-8 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}
