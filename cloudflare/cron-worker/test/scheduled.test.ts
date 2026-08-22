import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'

const env: Env = { CRON_SECRET: 'secret-123', APP_BASE_URL: 'https://app.example.com' }
const ctx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} } as never

function controller(cron: string) {
  return { cron, scheduledTime: Date.now(), type: 'scheduled' as const, noRetry: vi.fn() }
}

describe('scheduled', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = fetchMock as never
  })

  it('calls cron/pulse for the pulse schedule', async () => {
    await worker.scheduled(controller('17 4 * * 1'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/pulse',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('calls cron/evaluate-alerts for the alerts schedule', async () => {
    await worker.scheduled(controller('47 7 * * 1'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/evaluate-alerts',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('calls cron/trial-emails for the trial-emails schedule', async () => {
    await worker.scheduled(controller('0 9 * * *'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/trial-emails',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('throws when the downstream route fails, so Cloudflare retries', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    await expect(worker.scheduled(controller('17 4 * * 1'), env, ctx)).rejects.toThrow()
  })

  it('does nothing for an unmapped cron string', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await worker.scheduled(controller('* * * * *'), env, ctx)

    expect(fetchMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
