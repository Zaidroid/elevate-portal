import type { ReactNode } from 'react';

export type Column<T> = {
  key: keyof T & string;
  header: string;
  width?: string;
  render?: (row: T) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  loading?: boolean;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  onRowClick,
  emptyState,
  loading,
}: Props<T>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-navy-700 dark:bg-navy-600">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-navy-500 text-white dark:bg-navy-700">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                  {emptyState || 'No rows yet.'}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${
                    onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-navy-700' : ''
                  }`}
                >
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-3 text-navy-500 dark:text-slate-100">
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
