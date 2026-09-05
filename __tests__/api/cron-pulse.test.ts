import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const CRON_SECRET = 'test-cron-secret-0123'

const calls: Array<{ text: string; params: unknown[] }> = []
let candidateRows: unknown[]
// Separate from candidateRows because the two queries answer different
// questions: candidateRows is who is still pending this week, configuredCount
// is who was ever set up at all. A finished week has an empty first and a
// nonzero second; an unconfigured feature has both empty.
let configuredCount = 0
let lookupFails = false

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })
  if (lookupFails) return Promise.reject(new Error('boom'))
  if (text.includes('count(*)::int as n')) return Promise.resolve([{ n: configuredCount }])
  return Promise.resolve(candidateRows)
})
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

// The route's own queries are what this file exercises. Ledger recording is
// tested separately in cron-ledger-wiring.test.ts; stub it here so its own
// db() calls don't interleave with (and shift the indices of) the calls
// this file asserts on.
vi.mock('@/lib/cron/recordRun', () => ({
  startCronRun: vi.fn(async () => 'test-run-id'),
  finishCronRun: vi.fn(async () => undefined),
}))

// after() runs the callback immediately here so the chain hop is observable.
const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (cb: () => unknown) => { afterCallbacks.push(cb) },
}))

import { GET } from '@/app/api/cron/pulse/route'

const fetchMock = vi.fn()
const realFetch = globalThis.fetch

function get(secret: string | null = CRON_SECRET, hop?: number) {
  const url = new URL('http://localhost/api/cron/pulse')
  if (hop !== undefined) url.searchParams.set('hop', String(hop))
  return GET(new Request(url, {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  }) as never)
}

function account(plan: string, extra: Record<string, unknown> = {}) {
  return {
    client_id: 'client-1', prompt_count: 24, scanned_prompts: 6,
    plan, status: 'active', stripe_subscription_id: 'sub_1',
    trial_ends_at: null, override_plan: null, override_expires_at: null,
    ...extra,
  }
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  calls.length = 0
  afterCallbacks.length = 0
  lookupFails = false
  candidateRows = [account('pro')]
  configuredCount = 0
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ processed: 3, nextCursor: 9 }),
  })
  globalThis.fetch = fetchMock as never
})

afterEach(() => {
  globalThis.fetch = realFetch
  process.env.CRON_SECRET = CRON_SECRET
})

describe('GET /api/cron/pulse — authentication', () => {
  it('accepts the Authorization: Bearer header Vercel Cron actually sends', async () => {
    // Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET` and no
    // body. The producer wants POST and x-cron-secret. This route exists to
    // bridge exactly that, so the inbound shape must be Vercel's.
    expect((await get()).status).toBe(200)
  })

  it('returns 401 with no header, and touches nothing', async () => {
    const res = await get(null)

    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 401 for a wrong secret', async () => {
    expect((await get('wrong')).status).toBe(401)
  })

  it('refuses to run at all when CRON_SECRET is unset', async () => {
    // The pre-fence trial-emails route compared against `Bearer ${undefined}`,
    // so the literal string "Bearer undefined" would have authenticated.
    delete process.env.CRON_SECRET
    const res = await get('undefined')

    expect(res.status).toBe(500)
    expect(calls).toHaveLength(0)
  })

  it('refuses a secret too short to be worth guessing', async () => {
    process.env.CRON_SECRET = 'short'
    expect((await get('short')).status).toBe(500)
  })
})

describe('GET /api/cron/pulse — driving the producer', () => {
  it('calls the producer with the shape it requires, not the one it received', async () => {
    await get()

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/pulse/run')
    expect(init.method).toBe('POST')
    expect(init.headers['x-cron-secret']).toBe(CRON_SECRET)
    expect(init.headers.authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ clientId: 'client-1', cursor: 6 })
  })

  it('resumes from the derived cursor rather than restarting the client', async () => {
    candidateRows = [account('pro', { scanned_prompts: 12 })]
    await get()

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).cursor).toBe(12)
  })

  it('skips a plan that grants no platforms instead of spending a hop on a 403', async () => {
    candidateRows = [account('free')]
    const res = await get()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ done: true })
  })

  it('skips a cancelled account still carrying plan=pro', async () => {
    candidateRows = [account('pro', { status: 'cancelled' })]
    await get()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports zero configured clients when the feature was never set up', async () => {
    candidateRows = []
    configuredCount = 0
    const res = await get()
    const body = await res.json()

    expect(body).toMatchObject({ done: true, processed: 0 })
    // With an empty prompt_bank, selectPendingClients never returns a client, so
    // {done:true, processed:0} alone was byte-identical to a genuinely finished
    // week -- six weekly cron runs reported success while nothing had ever been
    // scanned. configuredClients makes that distinguishable. Assert it directly
    // rather than folding it into the toMatchObject above: that call only
    // checks the keys it lists, so it would not notice this field disappearing.
    expect(body.configuredClients).toBe(0)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('reports the real client count when the week is already finished, not zero', async () => {
    // selectPendingClients excludes clients already rolled up this week, so a
    // completed week and a never-configured feature both leave pending empty --
    // that ambiguity is exactly what configuredClients exists to resolve. Here
    // clients exist and finished, so the zero-clients alarm must stay silent.
    candidateRows = []
    configuredCount = 3
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await get()
    const body = await res.json()

    expect(body).toMatchObject({ done: true, processed: 0, configuredClients: 3 })
    expect(consoleError).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('returns 503 when the pending lookup fails', async () => {
    lookupFails = true
    expect((await get()).status).toBe(503)
  })
})

describe('GET /api/cron/pulse — selection', () => {
  it('treats the aggregate summary row as the completion marker, not metrics', async () => {
    // pulse/run writes the platform-null row only on the chunk where nextCursor
    // is null. Testing pulse_metrics instead would make a client that finished
    // one chunk look done.
    await get()
    const [query] = calls

    expect(query.text).toMatch(/from pulse_weekly_summary/)
    expect(query.text).toMatch(/s\.platform is null/)
    expect(query.text).toMatch(/not exists/)
  })

  it('derives the cursor from prompts already scanned this week', async () => {
    await get()

    expect(calls[0].text).toMatch(/count\(distinct m\.prompt_id\)/)
    expect(calls[0].text).toMatch(/date_trunc\('week', now\(\)\)::date/)
  })

  it('never excludes a comped account in SQL', async () => {
    // Migration 026 has a SQL translation of the plan rules but predates
    // override_plan, so a copy of it would silently skip comped customers. The
    // prefilter must let every override through to TypeScript.
    await get()

    expect(calls[0].text).toMatch(/a\.override_plan is not null or/)
  })

  it('only considers clients with at least one active prompt', async () => {
    await get()

    expect(calls[0].text).toMatch(/pb\.is_active/)
  })
})

describe('GET /api/cron/pulse — chaining', () => {
  it('chains to a fresh invocation while work remains', async () => {
    // The driver cannot loop a client to completion: its own ceiling is 60s and
    // a chunk costs most of that. Throughput comes from chaining, not from a
    // tighter cron schedule, which Hobby would not allow anyway.
    const res = await get()

    expect((await res.json()).chained).toBe(true)
    expect(afterCallbacks).toHaveLength(1)

    await afterCallbacks[0]()
    const hop = fetchMock.mock.calls.at(-1)
    expect(String(hop?.[0])).toContain('hop=1')
    expect(hop?.[1].headers.authorization).toBe(`Bearer ${CRON_SECRET}`)
  })

  it('increments the hop so the chain cannot run forever', async () => {
    await get(CRON_SECRET, 7)
    await afterCallbacks[0]()

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('hop=8')
  })

  it('stops at the chain limit rather than spinning', async () => {
    const res = await get(CRON_SECRET, 200)

    expect(await res.json()).toMatchObject({ error: 'Chain limit reached' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })

  it('does not chain past a failing producer', async () => {
    // Otherwise the whole budget spins on one broken client. The next scheduled
    // firing retries it from the same derived cursor.
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const res = await get()

    expect(res.status).toBe(502)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('does not chain when the producer is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await get()

    expect(res.status).toBe(502)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('survives a dropped chain hop without failing the response', async () => {
    // A broken link costs throughput, not correctness — progress is in the data.
    const res = await get()
    fetchMock.mockRejectedValueOnce(new Error('gone'))

    await expect(afterCallbacks[0]()).resolves.not.toThrow()
    expect(res.status).toBe(200)
  })
})

describe('Pulse failure ledger classification', () => {
  it.each(['lookup', 'producer-response', 'producer-network'] as const)(
    'records %s as an error with unchanged HTTP failure',
    async failure => {
      const { finishCronRun } = await import('@/lib/cron/recordRun')
      vi.mocked(finishCronRun).mockClear()
      if (failure === 'lookup') lookupFails = true
      if (failure === 'producer-response') fetchMock.mockResolvedValue({ ok: false, status: 503 })
      if (failure === 'producer-network') fetchMock.mockRejectedValue(new Error('synthetic-network-failure'))

      const response = await get()
      const expected = failure === 'lookup'
        ? { error: 'Lookup failed' }
        : failure === 'producer-response'
          ? { error: 'Producer failed', status: 503, clientId: 'client-1' }
          : { error: 'Producer unreachable' }
      expect(response.status).toBe(failure === 'lookup' ? 503 : 502)
      expect(await response.json()).toEqual(expected)
      expect(finishCronRun).toHaveBeenLastCalledWith('test-run-id', 'error', expected)
      expect(afterCallbacks).toHaveLength(0)
    },
  )
})
