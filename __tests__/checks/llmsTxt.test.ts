import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkLlmsTxt } from '@/lib/checks/llmsTxt'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkLlmsTxt', () => {
  it('returns pass when llms.txt has content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# About\nThis site sells widgets.',
    }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns warn when llms.txt is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '   ',
    }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when llms.txt not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const result = await checkLlmsTxt('https://example.com')
    expect(result.status).toBe('fail')
  })
})
