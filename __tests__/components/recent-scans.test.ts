import { describe, it, expect } from 'vitest'

function getScanHref(lang: string, scanId: string, clientId?: string) {
  if (clientId) return `/${lang}/dashboard/${clientId}/result/${scanId}`
  return `/${lang}/result/${scanId}`
}

describe('RecentScans href generation', () => {
  it('returns public result URL when no clientId', () => {
    expect(getScanHref('en', 'scan-1')).toBe('/en/result/scan-1')
    expect(getScanHref('zh-HK', 'scan-2')).toBe('/zh-HK/result/scan-2')
  })

  it('returns dashboard result URL when clientId is provided', () => {
    expect(getScanHref('en', 'scan-1', 'client-123')).toBe('/en/dashboard/client-123/result/scan-1')
    expect(getScanHref('zh-HK', 'scan-2', 'client-456')).toBe('/zh-HK/dashboard/client-456/result/scan-2')
  })

  it('handles scan IDs with special characters', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(getScanHref('en', uuid, 'client-abc')).toBe(`/en/dashboard/client-abc/result/${uuid}`)
  })
})
