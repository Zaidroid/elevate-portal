// In-memory TTL cache shared across all portal data keys.
// Keyed by DataKey ("module::tab"). Entries expire after DEFAULT_TTL.
// Writes (updateRow / createRow) must call invalidate() so the next
// poll gets fresh data.

const DEFAULT_TTL = 120_000; // 2 minutes — matches the poll interval

interface CacheEntry {
  rows: string[][];
  headers: string[];
  fetchedAt: number;
}

const store = new Map<string, CacheEntry>();

/** Returns the cached entry for `key`, or null if missing / stale. */
export function getCached(key: string): CacheEntry | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > DEFAULT_TTL) {
    store.delete(key);
    return null;
  }
  return entry;
}

/** Stores rows + headers in the cache for `key`. */
export function setCache(key: string, rows: string[][], headers: string[]) {
  store.set(key, { rows, headers, fetchedAt: Date.now() });
}

/** Invalidates a single key so the next poll fetches fresh data. */
export function invalidate(key: string) {
  store.delete(key);
}

/** Invalidates ALL cached entries (e.g., after a sign-in). */
export function invalidateAll() {
  store.clear();
}
