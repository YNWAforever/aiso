import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkBotAccess } from '@/lib/checks/botAccess'

beforeEach(() => { vi.restoreAllMocks() })

describe('checkBotAccess', () => {
  it('returns pass when all bots succeed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('pass')
  })

  it('returns fail when all bots are blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('fail')
  })

  it('returns warn when some bots are blocked', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++
      return Promise.resolve({ ok: call === 1, status: call === 1 ? 200 : 403 })
    }))
    const result = await checkBotAccess('https://example.com')
    expect(result.status).toBe('warn')
  })
})
