import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkStructuredData } from '@/lib/checks/structuredData'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkStructuredData', () => {
  it('returns pass when JSON-LD found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<script type="application/ld+json">{"@type":"WebSite"}</script>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when only microdata found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<div itemtype="https://schema.org/Product" itemscope>test</div>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when no structured data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><p>Hello</p></body></html>',
    }))
    const result = await checkStructuredData('https://example.com')
    expect(result.status).toBe('fail')
  })
})
