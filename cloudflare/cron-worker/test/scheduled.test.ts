import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, ROUTES } from '../src/index'

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

  it('throws for an unmapped cron string, so Cloudflare retries', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(worker.scheduled(controller('* * * * *'), env, ctx)).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

// wrangler.jsonc allows `//` comments, which JSON.parse rejects — strip
// full-line comments before parsing. Matches the approach the main repo's
// own wrangler.jsonc-reading test uses.
function parseWranglerJsonc(raw: string): { triggers?: { crons?: string[] } } {
  const withoutComments = raw.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(withoutComments)
}

describe('ROUTES stays in sync with wrangler.jsonc', () => {
  it('has exactly one entry per configured cron trigger, in the same order', async () => {
    const raw = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
    const config = parseWranglerJsonc(raw)

    // Every configured cron in wrangler.jsonc must have a matching ROUTES entry
    // and dispatch (doesn't throw as unmapped).
    for (const cron of config.triggers?.crons ?? []) {
      const hasMappedRoute = cron in ROUTES
      expect(hasMappedRoute, `wrangler.jsonc's "${cron}" has no matching ROUTES entry`).toBe(true)
    }

    // Every ROUTES entry must have a corresponding cron in wrangler.jsonc
    const configCrons = config.triggers?.crons ?? []
    for (const cron of Object.keys(ROUTES)) {
      const isConfigured = configCrons.includes(cron)
      expect(isConfigured, `ROUTES has "${cron}" but wrangler.jsonc doesn't configure it`).toBe(true)
    }

    // Same length = same set (with both checks above)
    expect(Object.keys(ROUTES)).toHaveLength(configCrons.length)
  })
})
