// CSV export helpers. Keep it dependency-free: RFC 4180 escaping, BOM for Excel.

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns && columns.length ? columns : Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(cols.map(escape).join(','));
  for (const r of rows) {
    lines.push(cols.map(c => escape(formatCell(r[c]))).join(','));
  }
  return lines.join('\r\n');
}

function formatCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function escape(v: string): string {
  const needs = /[",\r\n]/.test(v);
  return needs ? `"${v.replace(/"/g, '""')}"` : v;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  const csv = toCsv(rows, columns);
  // UTF-8 BOM so Excel opens accented text correctly
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

export function timestampedFilename(base: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${base}_${stamp}.csv`;
}
