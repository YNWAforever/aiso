import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: vi.fn(),
  sendTrialEmail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/resend', () => ({ sendTrialEmail: h.sendTrialEmail }))

async function importRoute() {
  vi.resetModules()
  return import('@/app/api/cron/trial-emails/route')
}

function request(bearer?: string) {
  return new Request('https://app.example/api/cron/trial-emails', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    trial_started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 - 60_000),
    trial_emails_sent: 0,
    email: 'owner@example.com',
    ...overrides,
  }
}

describe('GET /api/cron/trial-emails', () => {
  const originalCronSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let rows: unknown[]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    rows = [accountRow()]
    mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = strings.join('?')
      if (text.includes('UPDATE accounts')) return Promise.resolve([])
      void params
      return Promise.resolve(rows)
    })
    h.db.mockReturnValue(mockSql)
    h.sendTrialEmail.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await importRoute()

    const res = await GET(request('anything'))

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong secret', async () => {
    const { GET } = await importRoute()

    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('wrong'))).status).toBe(401)
  })

  it('accepts the Authorization: Bearer header and sends every due email for a fresh account', async () => {
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 4, failed: 0 })
    expect(h.sendTrialEmail).toHaveBeenCalledTimes(4)
  })

  it('skips an account with no resolvable email', async () => {
    rows = [accountRow({ email: null })]
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    expect(h.sendTrialEmail).not.toHaveBeenCalled()
  })

  it('does not resend an email whose bit is already set', async () => {
    rows = [accountRow({ trial_emails_sent: 1 | 2 | 4 | 8 })]
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(await res.json()).toEqual({ sent: 0, failed: 0 })
    expect(h.sendTrialEmail).not.toHaveBeenCalled()
  })

  it('does not touch the bitmask when nothing is due yet', async () => {
    rows = [accountRow({ trial_started_at: new Date(Date.now() - 60_000) })] // day 0
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    const updateCalls = mockSql.mock.calls.filter(([strings]) =>
      (strings as TemplateStringsArray).join('?').includes('UPDATE accounts'),
    )
    expect(updateCalls).toHaveLength(0)
  })

  it('updates the bitmask incrementally, one bit per successful send', async () => {
    rows = [accountRow({ trial_emails_sent: 0 })] // fresh, day 10 -> all 4 due
    const { GET } = await importRoute()

    await GET(request('test-cron-secret-0123'))

    const updateMasks = mockSql.mock.calls
      .filter(([strings]) => (strings as TemplateStringsArray).join('?').includes('UPDATE accounts'))
      .map(([, mask]) => mask)
    // EMAIL_DAY1=1, DAY5=2, DAY7=4, DAY10=8 — each send ORs in its own bit
    // on top of the running mask, so the sequence is 1, 3, 7, 15, not four
    // separate single-bit writes.
    expect(updateMasks).toEqual([1, 3, 7, 15])
  })

  it('continues past one failed send, and still sends the rest — exactly one short', async () => {
    // Both accounts are fresh (day 10, mask 0), so 4 emails are due each: 8
    // attempts total. Only the very first attempt (account-1's day-1 email)
    // is made to fail.
    rows = [accountRow({ id: 'account-1' }), accountRow({ id: 'account-2' })]
    h.sendTrialEmail
      .mockRejectedValueOnce(new Error('Resend down'))
      .mockResolvedValue(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(h.sendTrialEmail).toHaveBeenCalledTimes(8)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ sent: 7, failed: 1 })
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('account-1'),
      expect.any(Error),
    )

    consoleError.mockRestore()
  })

  it('all attempts fail — returns 502 with failed count', async () => {
    rows = [accountRow({ id: 'account-1' }), accountRow({ id: 'account-2' })]
    h.sendTrialEmail.mockRejectedValue(new Error('Resend permanently down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ sent: 0, failed: 8 })
    expect(h.sendTrialEmail).toHaveBeenCalledTimes(8)

    consoleError.mockRestore()
  })

  it('happy path (no failures) returns status 200', async () => {
    const { GET } = await importRoute()

    const res = await GET(request('test-cron-secret-0123'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBeGreaterThan(0)
    expect(body.failed).toBe(0)
  })

  it('never selects both accounts.id and profiles.id unaliased', async () => {
    const { GET } = await importRoute()
    await GET(request('test-cron-secret-0123'))

    const [selectCall] = mockSql.mock.calls
    const text = (selectCall[0] as TemplateStringsArray).join('?')
    expect(text).toMatch(/select distinct on \(a\.id\)/i)

    // Only the SELECT list matters here — p.id legitimately appears later, in
    // ORDER BY, to break ties deterministically. A regex over the whole query
    // would false-positive on that, so isolate the clause between SELECT and
    // FROM before checking it for a bare p.id.
    const selectClause = text.slice(text.search(/select/i), text.search(/from/i))
    expect(selectClause).not.toMatch(/\bp\.id\b/i)
  })

  it('filters out accounts with stripe_subscription_id (converted customers)', async () => {
    const { GET } = await importRoute()
    await GET(request('test-cron-secret-0123'))

    const [selectCall] = mockSql.mock.calls
    const text = (selectCall[0] as TemplateStringsArray).join('?')
    // Should have the filter in the WHERE clause
    expect(text).toMatch(/stripe_subscription_id/i)
    expect(text).toMatch(/WHERE.*stripe_subscription_id/is)
  })
})
