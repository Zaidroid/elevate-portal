// Browser-side .xlsx / .csv parsing for the /import wizard.
//
// Returns rows as string[] in source-column order plus a header[] from row 1.
// Date cells are normalized to YYYY-MM-DD; numbers/booleans are stringified so
// the rest of the pipeline can treat everything as strings (the Sheets API
// USER_ENTERED input option will re-parse numeric strings on the server).

import * as XLSX from 'xlsx';

export type ParsedSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

export type ParsedWorkbook = {
  sheets: ParsedSheet[];
};

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const yyyy = v.getUTCFullYear();
    const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(v.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}

function parseSheet(ws: XLSX.WorkSheet, name: string): ParsedSheet {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
    rawNumbers: false,
  });
  if (aoa.length === 0) return { name, headers: [], rows: [] };

  const rawHeaders = aoa[0].map(cellToString);
  // Trim trailing empty header columns so column count matches reality.
  let lastNonEmpty = rawHeaders.length - 1;
  while (lastNonEmpty >= 0 && rawHeaders[lastNonEmpty] === '') lastNonEmpty--;
  const headers = rawHeaders.slice(0, lastNonEmpty + 1);

  const rows: string[][] = [];
  for (let i = 1; i < aoa.length; i++) {
    const raw = aoa[i] as unknown[];
    if (!raw) continue;
    const row = headers.map((_, c) => cellToString(raw[c]));
    if (row.every(v => v === '')) continue;
    rows.push(row);
  }
  return { name, headers, rows };
}

export async function parseFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true, cellNF: false });
  const sheets = wb.SheetNames.map(n => parseSheet(wb.Sheets[n], n));
  return { sheets };
}

// Match a target header against source headers. Case- and whitespace-insensitive,
// also collapses underscores so "company name" matches "company_name".
export function autoMatch(
  targetHeader: string,
  sourceHeaders: string[]
): string | '' {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\s_-]+/g, '').trim();
  const target = norm(targetHeader);
  const exact = sourceHeaders.find(h => norm(h) === target);
  if (exact) return exact;
  // soft match: target is a substring of source or vice versa
  const soft = sourceHeaders.find(h => {
    const n = norm(h);
    return n && (n.includes(target) || target.includes(n));
  });
  return soft || '';
}
