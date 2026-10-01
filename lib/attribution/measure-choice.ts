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
 * rather than silently becoming "don't measure".
 */
export function buildMeasure(
  choice: MeasureChoice,
  options: MeasureOptions | null,
): { ok: true; measure?: MeasureInput } | { ok: false } {
  if (!options || choice.mode === 'none') return { ok: true }
  if (choice.mode === 'site') return { ok: true, measure: { scope: 'site' } }
  const offered = new Set(options.pages.map(p => p.id))
  const assetIds = choice.assetIds.filter(id => offered.has(id))
  if (assetIds.length < 1 || assetIds.length > MEASURE_PAGES_MAX) return { ok: false }
  return { ok: true, measure: { scope: 'page', assetIds } }
}
