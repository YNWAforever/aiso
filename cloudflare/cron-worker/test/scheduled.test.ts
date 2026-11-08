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

  it('T07 daily trigger repairs original runs independently of email and search jobs',async()=>{
    await worker.scheduled(controller('17 4 * * *'),env,ctx)
    expect(fetchMock.mock.calls.map(call=>call[0])).toContain('https://app.example.com/api/cron/pulse?mode=repair')
  })

  it('calls cron/pulse for the pulse schedule', async () => {
    await worker.scheduled(controller('17 4 * * *'), env, ctx)

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

  it('calls trial-emails and search-console on the daily schedule', async () => {
    await worker.scheduled(controller('0 9 * * *'), env, ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/trial-emails',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/api/cron/search-console',
      { headers: { Authorization: 'Bearer secret-123' } },
    )
  })

  it('still calls every route on a schedule when one of them fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/trial-emails') ? { ok: false, status: 500 } : { ok: true, status: 200 })

    await expect(worker.scheduled(controller('0 9 * * *'), env, ctx))
      .rejects.toThrow('[cron-worker] /api/cron/trial-emails responded 500')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('propagates a downstream failure without retrying in this invocation', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })

    await expect(worker.scheduled(controller('17 4 * * *'), env, ctx)).rejects.toThrow(
      '[cron-worker] /api/cron/pulse responded 500',
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an unmapped cron without making a request', async () => {
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

const SCHEDULED_CRONS = ['17 4 * * *', '47 7 * * 1', '17 16 * * *'] as const

describe('ROUTES stays in sync with wrangler.jsonc', () => {
  it('schedules the live baseline plus one brand-months tick and leaves 09:00 unscheduled', () => {
    const template = parseWranglerJsonc(readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8'))
    const deployed = parseWranglerJsonc(readFileSync(join(import.meta.dirname, '..', '..', 'aiso-worker', 'wrangler.jsonc'), 'utf8'))

    expect(template.triggers?.crons).toEqual([...SCHEDULED_CRONS])
    expect(deployed.triggers?.crons).toEqual([...SCHEDULED_CRONS])
    for (const cron of SCHEDULED_CRONS) {
      expect(cron in ROUTES, `${cron} has no ROUTES entry`).toBe(true)
    }

    expect(ROUTES['17 4 * * *']).toEqual(['/api/cron/pulse', '/api/cron/pulse?mode=repair'])
    expect(ROUTES['47 7 * * 1']).toEqual(['/api/cron/evaluate-alerts'])
    expect(ROUTES['17 16 * * *']).toEqual(['/api/cron/brand-months'])
    expect(ROUTES['0 9 * * *']).toEqual(['/api/cron/trial-emails', '/api/cron/search-console'])
    expect(template.triggers?.crons).not.toContain('0 9 * * *')
    expect(deployed.triggers?.crons).not.toContain('0 9 * * *')
    expect(Object.keys(ROUTES).sort()).toEqual([...SCHEDULED_CRONS, '0 9 * * *'].sort())
  })
})

it('00:17 UTC+8 tick fans out only to brand-months', async () => {
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  globalThis.fetch = fetchSpy as never
  await worker.scheduled(controller('17 16 * * *'), env, ctx)
  expect(fetchSpy.mock.calls.map(call => call[0])).toEqual(['https://app.example.com/api/cron/brand-months'])
})

it.each(['http', 'network'])('brand-months %s failure calls noRetry once and fans out to nothing else', async (kind) => {
  const scheduled = controller('17 16 * * *')
  const fetchSpy = vi.fn(async (_url: string) => {
    if (kind === 'network') throw Error('outcome unknown')
    return { ok: false, status: 503 }
  })
  globalThis.fetch = fetchSpy as never
  await expect(worker.scheduled(scheduled, env, ctx)).rejects.toThrow()
  expect(scheduled.noRetry).toHaveBeenCalledOnce()
  expect(scheduled.noRetry.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0])
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(fetchSpy.mock.calls.map(call => call[0])).toEqual(['https://app.example.com/api/cron/brand-months'])
})
