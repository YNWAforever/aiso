import type { MeasureInput } from '@/lib/delivery/types'
import { MEASURE_PAGES_MAX, type MeasureOptions } from './types'

/**
 * What the delivery form's "what to measure" field currently holds. Pure and
 * client-safe (no server-only import), so the form's submit rule is testable
 * without a DOM.
 */
export type MeasureChoice = { mode: 'none' | 'site' | 'page'; assetIds: string[] }

export const NO_MEASURE: MeasureChoice = { mode: 'none', assetIds: [] }

/** Toggle one page, never growing past MEASURE_PAGES_MAX. Selection order is kept. */
export function toggleAsset(choice: MeasureChoice, assetId: string): MeasureChoice {
  if (choice.assetIds.includes(assetId)) return { ...choice, assetIds: choice.assetIds.filter(id => id !== assetId) }
  if (choice.assetIds.length >= MEASURE_PAGES_MAX) return choice
  return { ...choice, assetIds: [...choice.assetIds, assetId] }
}

/**
 * The `measure` to send with the attestation, or `invalid` when the choice cannot
 * be sent. With no options (attribution off or not entitled) the field is not on
 * screen and no `measure` key is ever produced; "Don't measure" likewise sends
 * none, because absent is how the server reads "nothing measured". Page ids that
 * are no longer on offer are dropped here, and an empty remainder is invalid
 * rather than silently becoming "don't measure". A page that is on offer but not
 * synced by Search Console makes the choice invalid: its checkbox is disabled, so
 * holding one means the choice is stale, and measuring it could never compare.
 */
export function buildMeasure(
  choice: MeasureChoice,
  options: MeasureOptions | null,
): { ok: true; measure?: MeasureInput } | { ok: false } {
  if (!options || choice.mode === 'none') return { ok: true }
  if (choice.mode === 'site') return { ok: true, measure: { scope: 'site' } }
  const offered = new Map(options.pages.map(p => [p.id, p.synced]))
  if (choice.assetIds.some(id => offered.get(id) === false)) return { ok: false }
  const assetIds = choice.assetIds.filter(id => offered.has(id))
  if (assetIds.length < 1 || assetIds.length > MEASURE_PAGES_MAX) return { ok: false }
  return { ok: true, measure: { scope: 'page', assetIds } }
}
