import { describe, expect, it } from 'vitest'
import { attributeOutcomeClusters } from '@/lib/outcome-integrations/attribution'
describe('explicit heuristic query/page attribution', () => {
  it('matches both the declared page and query keywords without implying conversion causation', () => {
    const clusters = [{ id: 'a', name: 'A', target_url: 'https://example.com/a', keywords: ['service'] }]
    const queries = [{ page_url: 'https://example.com/a', query: 'Service help', clicks: 3, impressions: 10, position: 2 }, { page_url: 'https://example.com/b', query: 'service', clicks: 99, impressions: 99, position: 9 }]
    expect(attributeOutcomeClusters(clusters, queries, [{ page_url: 'https://example.com/a', currency: 'HKD', conversions: '2' }])[0]).toMatchObject({ clicks: 3, impressions: 10, position: 2, queryCount: 1, attribution: 'fimmick-page-keyword.v1', queryConversionAttribution: false, analytics: [{ currency: 'HKD' }] })
  })
  it('keeps unobserved position unknown and does not sum different currencies', () => {
    expect(attributeOutcomeClusters([{ id: 'a', name: 'A', target_url: 'https://example.com/a', keywords: ['x'] }], [], [])[0]).toMatchObject({ position: null, queryCount: 0, analytics: [] })
  })
})
