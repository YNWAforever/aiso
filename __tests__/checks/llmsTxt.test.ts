import { describe, it, expect, vi, beforeEach } from 'vitest'
import { forbidGlobalFetch } from '../helpers/forbid-global-fetch'
import { checkLlmsTxt } from '@/lib/checks/llmsTxt'

beforeEach(() => {
  vi.restoreAllMocks()
  forbidGlobalFetch()
})

describe('checkLlmsTxt', () => {
  it('returns pass when llms.txt has content', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# About\nThis site sells widgets.',
    })
    const result = await checkLlmsTxt('https://example.com', fetcher)
    expect(result.status).toBe('pass')
  })

  it('returns warn when llms.txt is empty', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '   ',
    })
    const result = await checkLlmsTxt('https://example.com', fetcher)
    expect(result.status).toBe('warn')
  })

  it('returns fail when llms.txt not found', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false })
    const result = await checkLlmsTxt('https://example.com', fetcher)
    expect(result.status).toBe('fail')
  })
})
