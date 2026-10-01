import { describe, expect, it } from 'vitest'
import { MEASURE_PAGES_MAX } from '@/lib/attribution/types'
import { NO_MEASURE, buildMeasure, toggleAsset } from '@/lib/attribution/measure-choice'
import { deliveryFailureKey } from '@/lib/delivery/failure'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const options = { pages: [0, 1, 2].map(n => ({ id: id(n), url: `https://example.com/${n}`, label: `P${n}` })) }

describe('buildMeasure', () => {
  it('sends no measure at all when there are no options, whatever the choice holds', () => {
    const result = buildMeasure({ mode: 'site', assetIds: [] }, null)
    expect(result).toEqual({ ok: true })
    expect('measure' in result).toBe(false)
  })
  it('sends no measure for Do not measure', () => {
    const result = buildMeasure(NO_MEASURE, options)
    expect(result).toEqual({ ok: true })
    expect('measure' in result).toBe(false)
  })
  it('sends the whole site', () => {
    expect(buildMeasure({ mode: 'site', assetIds: [id(0)] }, options)).toEqual({ ok: true, measure: { scope: 'site' } })
  })
  it('sends the chosen pages in the order chosen', () => {
    expect(buildMeasure({ mode: 'page', assetIds: [id(2), id(0)] }, options)).toEqual({ ok: true, measure: { scope: 'page', assetIds: [id(2), id(0)] } })
  })
  it('refuses Specific pages with nothing chosen rather than quietly measuring nothing', () => {
    expect(buildMeasure({ mode: 'page', assetIds: [] }, options)).toEqual({ ok: false })
  })
  it('drops pages that are no longer on offer, and refuses if none remain', () => {
    expect(buildMeasure({ mode: 'page', assetIds: [id(1), id(9)] }, options)).toEqual({ ok: true, measure: { scope: 'page', assetIds: [id(1)] } })
    expect(buildMeasure({ mode: 'page', assetIds: [id(9)] }, options)).toEqual({ ok: false })
  })
})

describe('toggleAsset', () => {
  it('adds and removes', () => {
    const one = toggleAsset({ mode: 'page', assetIds: [] }, id(1))
    expect(one.assetIds).toEqual([id(1)])
    expect(toggleAsset(one, id(1)).assetIds).toEqual([])
  })
  it(`never exceeds ${MEASURE_PAGES_MAX}, but still lets one be removed`, () => {
    const full = { mode: 'page' as const, assetIds: Array.from({ length: MEASURE_PAGES_MAX }, (_, n) => id(n)) }
    expect(toggleAsset(full, id(99))).toBe(full)
    expect(toggleAsset(full, id(0)).assetIds).toHaveLength(MEASURE_PAGES_MAX - 1)
  })
})

describe('deliveryFailureKey', () => {
  it('gives an unknown measured page its own message', () => {
    expect(deliveryFailureKey(422, 'unknown_page')).toBe('unknownPage')
  })
  it('keeps every other mapping', () => {
    expect(deliveryFailureKey(422)).toBe('invalid')
    expect(deliveryFailureKey(422, 'something_else')).toBe('invalid')
    expect(deliveryFailureKey(400)).toBe('invalid')
    expect(deliveryFailureKey(401)).toBe('unauthenticated')
    expect(deliveryFailureKey(403)).toBe('denied')
    expect(deliveryFailureKey(409)).toBe('conflict')
    expect(deliveryFailureKey(500)).toBe('unavailable')
    expect(deliveryFailureKey(409, 'unknown_page')).toBe('conflict')
  })
})
