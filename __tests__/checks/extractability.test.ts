import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkExtractability } from '@/lib/checks/extractability'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkExtractability', () => {
  it('returns pass when 200+ words present', async () => {
    const words = Array(250).fill('word').join(' ')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><body><p>${words}</p></body></html>`,
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when 50–199 words', async () => {
    const words = Array(80).fill('word').join(' ')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<html><body><p>${words}</p></body></html>`,
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when fewer than 50 words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body><p>hello</p></body></html>',
    }))
    const result = await checkExtractability('https://example.com')
    expect(result.status).toBe('fail')
  })
})
