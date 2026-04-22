import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRobots } from '@/lib/checks/robots'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkRobots', () => {
  it('returns pass when AI bot explicitly allowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: GPTBot\nAllow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns fail when AI bot is disallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: GPTBot\nDisallow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('fail')
  })

  it('returns warn when no AI rules found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: *\nAllow: /\n',
    }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('warn')
  })

  it('returns fail when robots.txt not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }))
    const result = await checkRobots('https://example.com')
    expect(result.status).toBe('fail')
  })
})
