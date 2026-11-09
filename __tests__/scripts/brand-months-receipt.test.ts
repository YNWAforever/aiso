import { describe, expect, it } from 'vitest'
import { summarize } from '@/scripts/brand-months-receipt.mjs'

/**
 * The receipt's pure half. It exists because a missing tick is silent: the
 * schedule existed for weeks while writing nothing, and the only symptom was
 * absence of rows. This pins what "the rows it should have written" means.
 */
const brands = [{ client_id: 'c1', brand_name: 'Northwind Coffee' }, { client_id: 'c2', brand_name: 'Second Brand' }]
const now = new Date('2026-11-15T05:00:00Z')

describe('brand-months receipt summary', () => {
  it('expects this month opening and last month closing', () => {
    expect(summarize(brands, [], now).map(entry => `${entry.month} ${entry.kind}`))
      .toEqual(['2026-11 opening', '2026-10 closing'])
  })

  it('lists the brands missing each expected row and counts the ones present', () => {
    const snapshots = [{ client_id: 'c1', month: '2026-11', kind: 'opening' }]
    const [opening, closing] = summarize(brands, snapshots, now)
    expect(opening).toMatchObject({ recorded: 1, missingBrands: ['Second Brand'] })
    expect(closing).toMatchObject({ recorded: 0, missingBrands: ['Northwind Coffee', 'Second Brand'] })
  })

  it('matches a full Postgres date month against the expected month key', () => {
    // The first live run reported "0 of 7 brands" for rows that existed because
    // the query returned `2026-11-01`; the receipt must not read a healthy tick as broken.
    const snapshots = [{ client_id: 'c1', month: '2026-11-01', kind: 'opening' }]
    expect(summarize(brands, snapshots, now)[0]).toMatchObject({ recorded: 1, missingBrands: ['Second Brand'] })
  })
  it('treats the Hong Kong month boundary as the expectation, not UTC', () => {
    // 2026-10-31 17:00Z is 2026-11-01 01:00 in Hong Kong: the opening is November's.
    const entries = summarize(brands, [], new Date('2026-10-31T17:00:00Z'))
    expect(entries.map(entry => `${entry.month} ${entry.kind}`)).toEqual(['2026-11 opening', '2026-10 closing'])
  })
})
