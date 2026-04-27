// Unified Google Sheets API client for Elevate Portal.
// Pattern extracted from Advisors + selection-tool: Bearer auth from localStorage,
// 429 exponential backoff, session-expired event bus.

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const sessionEvents = new EventTarget();

export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
export type ValueInputOption = 'RAW' | 'USER_ENTERED';

function getAccessToken(silent = false): string | null {
  const token = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('token_expiry');
  if (!token || !expiry || Date.now() >= parseInt(expiry)) {
    if (!silent) sessionEvents.dispatchEvent(new Event('session-expired'));
    return null;
  }
  return token;
}

async function request<T>(url: string, options: RequestInit = {}, retries = 3): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('No valid access token');

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401) {
    sessionEvents.dispatchEvent(new Event('session-expired'));
    throw new Error('Session expired');
  }

  // Retry transient server errors (rate limit, gateway errors, brief
  // unavailability). Sheets returns 500/502/503 occasionally during write
  // bursts even under quota; treating them like 429 with backoff is the
  // recommended pattern.
  if ((res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) && retries > 0) {
    const delay = Math.pow(2, 4 - retries) * 500;
    await new Promise(r => setTimeout(r, delay));
    return request<T>(url, options, retries - 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

function rangeUrl(sheetId: string, range: string): string {
  return `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`;
}

export function getApiStatus() {
  const token = getAccessToken(true);
  return { connected: !!token, authenticated: !!token };
}

export async function fetchRange(
  sheetId: string,
  range: string,
  opts: { valueRender?: ValueRenderOption } = {}
): Promise<string[][]> {
  const render = opts.valueRender || 'FORMATTED_VALUE';
  const url = `${rangeUrl(sheetId, range)}?valueRenderOption=${render}`;
  try {
    const data = await request<{ values?: string[][] }>(url);
    return data.values || [];
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('Unable to parse range') || msg.includes('not found')) {
      console.warn(`[sheets] Tab missing for range "${range}" in ${sheetId} — treating as empty.`);
      return [];
    }
    throw err;
  }
}

export async function appendRows(
  sheetId: string,
  range: string,
  values: (string | number | boolean)[][],
  opts: { valueInput?: ValueInputOption } = {}
): Promise<void> {
  const input = opts.valueInput || 'USER_ENTERED';
  const url =
    rangeUrl(sheetId, range) +
    `:append?valueInputOption=${input}&insertDataOption=INSERT_ROWS`;
  await request(url, { method: 'POST', body: JSON.stringify({ values }) });
}

export async function updateRange(
  sheetId: string,
  range: string,
  values: (string | number | boolean)[][],
  opts: { valueInput?: ValueInputOption } = {}
): Promise<void> {
  const input = opts.valueInput || 'USER_ENTERED';
  const url = `${rangeUrl(sheetId, range)}?valueInputOption=${input}`;
  await request(url, { method: 'PUT', body: JSON.stringify({ values }) });
}

export async function batchUpdate(
  sheetId: string,
  requests: unknown[]
): Promise<unknown> {
  const url = `${SHEETS_API}/${sheetId}:batchUpdate`;
  return request(url, { method: 'POST', body: JSON.stringify({ requests }) });
}

// Delete a single row from a tab. rowNumber is 1-based (header is row 1).
export async function deleteSheetRow(
  sheetId: string,
  tabName: string,
  rowNumber: number
): Promise<void> {
  const meta = await getSpreadsheetMetaCached(sheetId);
  const tab = meta.sheets.find(s => s.title === tabName);
  if (!tab) throw new Error(`Tab not found: ${tabName}`);
  const startIndex = rowNumber - 1;
  await batchUpdate(sheetId, [
    {
      deleteDimension: {
        range: {
          sheetId: tab.sheetId,
          dimension: 'ROWS',
          startIndex,
          endIndex: startIndex + 1,
        },
      },
    },
  ]);
}

export async function batchGet(
  sheetId: string,
  ranges: string[],
  opts: { valueRender?: ValueRenderOption } = {}
): Promise<Array<{ range: string; values?: string[][] }>> {
  const render = opts.valueRender || 'FORMATTED_VALUE';
  const params = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const url = `${SHEETS_API}/${sheetId}/values:batchGet?${params}&valueRenderOption=${render}`;
  const data = await request<{ valueRanges: Array<{ range: string; values?: string[][] }> }>(url);
  return data.valueRanges || [];
}

// Per-sheet metadata cache. Many hooks mount for the same workbook; we only
// want to hit the metadata endpoint once per sheet per session.
const metaCache = new Map<
  string,
  Promise<{ title: string; sheets: { sheetId: number; title: string }[] }>
>();

export function getSpreadsheetMetaCached(sheetId: string) {
  let p = metaCache.get(sheetId);
  if (!p) {
    p = getSpreadsheetMeta(sheetId).catch(err => {
      metaCache.delete(sheetId);
      throw err;
    });
    metaCache.set(sheetId, p);
  }
  return p;
}

export async function tabExists(sheetId: string, tabName: string): Promise<boolean> {
  try {
    const meta = await getSpreadsheetMetaCached(sheetId);
    return meta.sheets.some(s => s.title === tabName);
  } catch {
    // If metadata fails (auth, network), assume the tab exists and let the
    // fetch path surface the real error instead of silently skipping.
    return true;
  }
}

// Metadata: fetch tab list + sheet IDs. Needed for ensureSchema and addSheet calls.
export async function getSpreadsheetMeta(sheetId: string): Promise<{
  title: string;
  sheets: { sheetId: number; title: string }[];
}> {
  const url = `${SHEETS_API}/${sheetId}?fields=properties(title),sheets(properties(sheetId,title))`;
  const data = await request<{
    properties: { title: string };
    sheets: { properties: { sheetId: number; title: string } }[];
  }>(url);
  return {
    title: data.properties.title,
    sheets: data.sheets.map(s => s.properties),
  };
}

// ensureSchema: given a tab name and expected headers, verify the tab exists with
// those headers. If the tab is missing, add it via batchUpdate; if headers differ,
// log a warning (don't mutate — the sheet is authoritative and may have column
// reorderings the team did intentionally).
export async function ensureSchema(
  sheetId: string,
  tabName: string,
  expectedHeaders: string[]
): Promise<{ created: boolean; headersMatch: boolean; actualHeaders: string[] }> {
  const meta = await getSpreadsheetMeta(sheetId);
  const exists = meta.sheets.some(s => s.title === tabName);

  if (!exists) {
    await batchUpdate(sheetId, [
      { addSheet: { properties: { title: tabName } } },
    ]);
    await updateRange(sheetId, `${tabName}!A1`, [expectedHeaders]);
    return { created: true, headersMatch: true, actualHeaders: expectedHeaders };
  }

  const headerRow = await fetchRange(sheetId, `${tabName}!1:1`);
  const actual = headerRow[0] || [];
  const match =
    actual.length === expectedHeaders.length &&
    actual.every((h, i) => h === expectedHeaders[i]);
  if (!match) {
    console.warn(
      `[sheets] Header mismatch in '${tabName}'. Expected:`,
      expectedHeaders,
      'Actual:',
      actual
    );
  }
  return { created: false, headersMatch: match, actualHeaders: actual };
}

// Polling subscription. Returns an unsubscribe function. The callback fires
// once immediately, then every intervalMs while the document is visible.
// When the browser tab is hidden we skip ticks (avoids quota spend on
// background tabs), and when it becomes visible again we fire an
// immediate refresh + resume the cadence. Errors are delivered but do
// not stop the loop (network blips shouldn't kill sync).
export function pollRange(
  sheetId: string,
  range: string,
  intervalMs: number,
  onData: (rows: string[][]) => void,
  onError?: (err: unknown) => void
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const isHidden = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const scheduleNext = () => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, intervalMs);
  };

  const tick = async () => {
    if (cancelled) return;
    if (isHidden()) {
      // Document is hidden — defer the network call until it becomes
      // visible. visibilitychange below kicks the next tick.
      scheduleNext();
      return;
    }
    if (inFlight) {
      scheduleNext();
      return;
    }
    inFlight = true;
    try {
      const rows = await fetchRange(sheetId, range);
      if (!cancelled) onData(rows);
    } catch (err) {
      if (onError) onError(err);
    } finally {
      inFlight = false;
      scheduleNext();
    }
  };

  // visibilitychange handler: when the tab becomes visible, fire a
  // catch-up refresh immediately so the user sees fresh data on focus.
  const onVisibility = () => {
    if (cancelled) return;
    if (!isHidden()) {
      if (timer) clearTimeout(timer);
      void tick();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  tick();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
