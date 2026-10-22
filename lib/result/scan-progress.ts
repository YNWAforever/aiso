import { CHECK_SLOTS } from '@/lib/result/view-model'

/**
 * What the live checklist shows while POST /api/scan runs.
 *
 * The scan answers once, with every verdict at the end, so the checklist only
 * shows what the engine is doing, never a result it does not have: checks go
 * pending → running in the engine's real order (page fetch, then Core and
 * Extended together, then GEO after the sitemap fetch). Verdicts appear on the
 * result page. The timings are estimates of that order, not measurements.
 */

/** The page is fetched before any check starts. */
export const PAGE_FETCH_MS = 800
/** Core and Extended start together; the stagger only keeps the row readable. */
export const STAGGER_MS = 70
/** GEO waits for batch 1 and a sitemap fetch; a typical scan reaches it about here. */
export const GEO_START_MS = 9000

export type ProgressStatus = 'pending' | 'running'

export function progressStatus(key: string, elapsedMs: number): ProgressStatus {
  const batchOne = CHECK_SLOTS.filter(slot => slot.bucket !== 'geo')
  const geo = CHECK_SLOTS.filter(slot => slot.bucket === 'geo')
  const first = batchOne.findIndex(slot => slot.key === key)
  if (first >= 0) return elapsedMs >= PAGE_FETCH_MS + first * STAGGER_MS ? 'running' : 'pending'
  const second = geo.findIndex(slot => slot.key === key)
  if (second >= 0) return elapsedMs >= GEO_START_MS + second * STAGGER_MS ? 'running' : 'pending'
  return 'pending'
}
