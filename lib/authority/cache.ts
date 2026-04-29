interface CacheEntry<T> { value: T; expiresAt: number }

// In-process LRU-style cache. Replace with Vercel KV in production via
// process.env.KV_REST_API_URL + KV_REST_API_TOKEN for persistence across instances.
const store = new Map<string, CacheEntry<unknown>>()
const MAX_ENTRIES = 10_000

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { store.delete(key); return null }
  return entry.value
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Evict oldest entry
    const first = store.keys().next().value
    if (first) store.delete(first)
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export const CACHE_TTL = {
  AUTHORITY:   7  * 24 * 60 * 60 * 1000,   // 7 days
  SIGNALS:     30 * 24 * 60 * 60 * 1000,   // 30 days
  DYNAMIC:     24 * 60 * 60 * 1000,        // 24 hours
  CLUSTER_MAP: 30 * 24 * 60 * 60 * 1000,  // 30 days
}
