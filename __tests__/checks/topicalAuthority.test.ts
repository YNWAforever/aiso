import { describe, it, expect } from 'vitest'
import { checkTopicalAuthority } from '@/lib/checks/topicalAuthority'

describe('checkTopicalAuthority', () => {
  it('returns warn for empty sitemap', async () => {
    const r = await checkTopicalAuthority([], 'client-123', 'technology')
    expect(['warn', 'fail']).toContain(r.status)
  })

  it('returns result with detectedClusters array', async () => {
    const urls = ['https://example.com/seo-guide','https://example.com/seo-tools','https://example.com/about']
    const r = await checkTopicalAuthority(urls, 'client-123', 'technology')
    expect(r).toHaveProperty('geoDetails')
    expect(r.geoDetails).toHaveProperty('detectedClusters')
  }, 20_000)
})
