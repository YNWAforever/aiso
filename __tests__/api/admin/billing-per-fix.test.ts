import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries: string[] = []
let nextResults: Array<unknown[] | Error> = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result ?? [])
})

const adminMock = vi.hoisted(() => ({ requireApiAdmin: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))
vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: adminMock.requireApiAdmin }))

import { GET } from '@/app/api/admin/billing/per-fix/route'

const ACCOUNT_A = '11111111-2222-4333-8444-555555555555'
const ACCOUNT_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const EVENT_FAILED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  adminMock.requireApiAdmin.mockResolvedValue({ ok: true, profile: { id: 'admin-1', is_admin: true } })
})

describe('GET /api/admin/billing/per-fix', () => {
  it('rejects a non-admin before reading any account', async () => {
    adminMock.requireApiAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('merges accounts, this month\'s counts and failed events without summing states', async () => {
    nextResults = [
      [
        {
          id: ACCOUNT_A, plan: 'pro', status: 'active',
          stripe_customer_id: 'cus_a', stripe_subscription_id: 'sub_a',
          mode: 'metered', owner_email: 'owner-a@example.com',
        },
        {
          id: ACCOUNT_B, plan: 'free', status: 'trialing',
          stripe_customer_id: null, stripe_subscription_id: null,
          mode: null, owner_email: null,
        },
      ],
      [
        { account_id: ACCOUNT_A, reported: 4, pending: 1, failed: 2 },
      ],
      [
        {
          id: EVENT_FAILED, account_id: ACCOUNT_A, fix_pack_id: 'fix-1',
          attempts: 3, last_error_code: 'RATE_LIMITED',
          created_at: '2026-11-11T01:00:00Z',
        },
      ],
    ]

    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.month).toMatch(/^\d{4}-\d{2}$/)
    expect(body.accounts).toHaveLength(2)

    const [first, second] = body.accounts
    expect(first).toMatchObject({
      accountId: ACCOUNT_A,
      ownerEmail: 'owner-a@example.com',
      mode: 'metered',
      hasStripeCustomer: true,
      hasSubscription: true,
      usage: { reported: 4, pending: 1, failed: 2 },
    })
    // Split counts survive: no summed "billable" field exists to confuse.
    expect(first.usage).not.toHaveProperty('billable')
    expect(first.failedEvents).toEqual([{
      eventId: EVENT_FAILED,
      fixPackId: 'fix-1',
      attempts: 3,
      lastErrorCode: 'RATE_LIMITED',
      createdAt: '2026-11-11T01:00:00Z',
    }])

    // An account with no billing row and no usage reads as not opened, zeros.
    expect(second).toMatchObject({
      accountId: ACCOUNT_B,
      mode: null,
      hasStripeCustomer: false,
      hasSubscription: false,
      usage: { reported: 0, pending: 0, failed: 0 },
      failedEvents: [],
    })

    expect(queries[1]).toMatch(/state = 'reported'/)
    expect(queries[1]).toMatch(/state in|state = 'pending'/)
    expect(queries[2]).toMatch(/where state = 'failed'/)
  })

  it('returns 500 rather than an empty overview when the read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    nextResults = [new Error('connection terminated')]

    const response = await GET()

    expect(response.status).toBe(500)
    consoleError.mockRestore()
  })
})
