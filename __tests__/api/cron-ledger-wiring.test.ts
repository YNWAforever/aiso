import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron/recordRun', () => ({
  startCronRun: vi.fn(async () => 'test-run-id'),
  finishCronRun: vi.fn(async () => undefined),
}))

// Every scheduled route touches the database and some send email. Neither is
// under test here -- only whether the route records its invocation.
vi.mock('@/lib/db', () => ({ db: () => new Proxy(() => [], { apply: () => [] }) }))

import { startCronRun } from '@/lib/cron/recordRun'

const SECRET = 'test-cron-secret-at-least-16-chars'

const ROUTES = [
  ['/api/cron/pulse', () => import('@/app/api/cron/pulse/route')],
  ['/api/cron/evaluate-alerts', () => import('@/app/api/cron/evaluate-alerts/route')],
  ['/api/cron/trial-emails', () => import('@/app/api/cron/trial-emails/route')],
] as const

describe('every scheduled cron route records its invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = SECRET
  })

  it.each(ROUTES)('%s calls startCronRun', async (route, load) => {
    const mod = await load()
    const req = new Request(`https://example.test${route}`, {
      headers: { authorization: `Bearer ${SECRET}` },
    })

    // The route's own work may fail against the stubbed database. That is fine:
    // the ledger write happens before the work, and a route that throws must
    // still have recorded that it started.
    await (mod as { GET: (r: Request) => Promise<unknown> }).GET(req).catch(() => undefined)

    expect(startCronRun).toHaveBeenCalledWith(route)
  })
})
