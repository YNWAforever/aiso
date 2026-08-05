import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route calls `sql\`...\`` directly (to look the claimed user up in
// `neon_auth.user`, for the idempotency check, and to build each query it
// hands to `sql.transaction()`), plus `sql.transaction()` itself to submit the
// accounts + profiles inserts as one atomic batch.
const transactionMock = vi.fn()
const sqlMock = Object.assign(vi.fn(), { transaction: transactionMock })
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

// Rows the fake `sql` hands back, keyed by which query is being run. Tests
// mutate these rather than relying on call ordering, so the assertions stay
// valid if the route reorders its queries.
let authUserRows: Array<{ id: string; email: string | null }> = []
let profileRows: Array<{ id: string }> = []
let authLookupError: Error | null = null

// Real Neon Auth webhook shape (confirmed from a production delivery):
// `{ event_type, user: { id, email, name, ... } }`.
function userCreatedRequest(user: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/webhooks/neon', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'user.created',
      user: { id: 'user-123', email: 'new@example.com', name: 'New User', ...user },
    }),
    headers: { 'Content-Type': 'application/json' },
  })
}

function queryText(strings: unknown) {
  return Array.isArray(strings) ? (strings as string[]).join('?') : String(strings)
}

describe('POST /api/webhooks/neon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: the claimed user really does exist in the auth DB with the
    // email the payload claims, and has not been provisioned yet.
    authUserRows = [{ id: 'user-123', email: 'new@example.com' }]
    profileRows = []
    authLookupError = null

    sqlMock.mockImplementation((strings: unknown) => {
      const text = queryText(strings)
      if (/neon_auth\.user/i.test(text)) {
        return authLookupError ? Promise.reject(authLookupError) : Promise.resolve(authUserRows)
      }
      // Must exclude the inserts before matching the probe: the accounts insert
      // also mentions `from profiles`, in the `not exists` subquery that makes
      // it idempotent. The route never reads these return values, so routing
      // them to profileRows was harmless but misleading.
      if (/insert into/i.test(text)) return Promise.resolve([])
      if (/select id\s+from profiles/i.test(text)) return Promise.resolve(profileRows)
      // Return value of the insert-building calls is never read by the route.
      return Promise.resolve([])
    })
    transactionMock.mockResolvedValue([[], []])
  })

  it('returns 200 received/handled:false for an event type it does not handle', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'user.updated', user: { id: 'u', email: 'e@x.com' } }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    // 200 (not a 4xx) so Neon doesn't retry-storm an event we intentionally ignore.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, handled: false })
    expect(sqlMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('returns 400 when event_type is missing entirely', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({ user: { id: 'u', email: 'e@x.com' } }), // no event_type
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for user.created with user entirely absent, without throwing', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const req = new NextRequest('http://localhost/api/webhooks/neon', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'user.created' }), // no `user` key at all
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
    // Never reached the DB — the destructure fallback must not throw first.
    expect(sqlMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  // --- Authenticity gate -------------------------------------------------
  // This endpoint is publicly reachable and has no signature to verify, so
  // validating the payload against `neon_auth.user` is its only authentication.

  it('rejects a forged payload whose user id does not exist in neon_auth.user, provisioning nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    authUserRows = [] // attacker-invented user id
    const res = await POST(userCreatedRequest({ id: 'attacker-made-up-id' }))
    expect(res.status).toBe(404)

    // Only the auth-DB lookup ran — no profile probe, no inserts.
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(queryText(sqlMock.mock.calls[0][0])).toMatch(/neon_auth\.user/i)
    expect(sqlMock.mock.calls[0][1]).toBe('attacker-made-up-id')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('rejects a payload that binds a real user id to a different email, provisioning nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    // Real row exists, but Neon Auth has a different email on record than the
    // payload claims — i.e. someone is trying to attach an address they control.
    authUserRows = [{ id: 'user-123', email: 'real-owner@example.com' }]
    const res = await POST(userCreatedRequest({ email: 'attacker@evil.test' }))
    expect(res.status).toBe(404)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('returns the same opaque response for an unknown id and a mismatched email', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')

    authUserRows = []
    const unknownRes = await POST(userCreatedRequest())
    const unknownBody = await unknownRes.json()

    authUserRows = [{ id: 'user-123', email: 'real-owner@example.com' }]
    const mismatchRes = await POST(userCreatedRequest({ email: 'attacker@evil.test' }))
    const mismatchBody = await mismatchRes.json()

    // No existence oracle: the two rejections are indistinguishable.
    expect(mismatchRes.status).toBe(unknownRes.status)
    expect(mismatchBody).toEqual(unknownBody)
  })

  it('accepts an email that differs only by case/whitespace from the auth-DB record', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    authUserRows = [{ id: 'user-123', email: 'New@Example.com' }]
    const res = await POST(userCreatedRequest({ email: ' new@example.com ' }))
    expect(res.status).toBe(200)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('returns 500 (so Neon retries) when the auth-DB lookup itself fails', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    authLookupError = new Error('connection terminated unexpectedly')
    const res = await POST(userCreatedRequest())
    // Fail closed but retryable — a lookup failure is not proof of a forgery,
    // and must not be treated as a successful no-op.
    expect(res.status).toBe(500)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('provisions an account and profile on user.created, linking them via the same account id', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const res = await POST(userCreatedRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    // 1 auth-DB lookup + 1 idempotency check + 3 queries built for the batch.
    expect(sqlMock).toHaveBeenCalledTimes(5)
    expect(transactionMock).toHaveBeenCalledTimes(1)

    const [authStrings, authUserId] = sqlMock.mock.calls[0]
    expect(queryText(authStrings)).toMatch(/neon_auth\.user/i)
    expect(authUserId).toBe('user-123')

    const [, checkedUserId] = sqlMock.mock.calls[1]
    expect(checkedUserId).toBe('user-123')

    // The lock has to come first in the batch; taking it after the accounts
    // insert would leave the very window it exists to close.
    const [lockStrings, lockUserId] = sqlMock.mock.calls[2]
    expect(queryText(lockStrings)).toMatch(/pg_advisory_xact_lock/i)
    expect(lockUserId).toBe('user-123')

    const [accountStrings, accountId] = sqlMock.mock.calls[3]
    expect(queryText(accountStrings)).toMatch(/insert into accounts/i)
    expect(typeof accountId).toBe('string')
    expect((accountId as string).length).toBeGreaterThan(0)

    const [profileStrings, profileUserId, profileAccountId, profileName] = sqlMock.mock.calls[4]
    expect(queryText(profileStrings)).toMatch(/insert into profiles/i)
    expect(profileUserId).toBe('user-123')
    expect(profileName).toBe('New User')
    // The profile must link to the exact account id created alongside it.
    expect(profileAccountId).toBe(accountId)

    // Lock + both inserts submitted together as a single atomic transaction.
    const [txnQueries] = transactionMock.mock.calls[0]
    expect(txnQueries).toHaveLength(3)
  })

  // Shape assertions, not a real race — the mock harness has one shared
  // profileRows array with no per-call sequencing, so it cannot express two
  // interleaved deliveries. __tests__/integration/webhook-provisioning-race
  // proves the actual behaviour against a live branch.
  it('guards the accounts insert on no profile having been provisioned', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    await POST(userCreatedRequest())

    const accountsInsert = queryText(sqlMock.mock.calls[3][0])
    expect(accountsInsert).toMatch(/where not exists/i)
    expect(accountsInsert).toMatch(/from profiles/i)
    expect(accountsInsert).toMatch(/account_id is not null/i)
  })

  it('guards the profiles insert on the account it just created', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    await POST(userCreatedRequest())

    // Without this the FK could see a dangling account_id when the accounts
    // insert was suppressed by the guard above.
    expect(queryText(sqlMock.mock.calls[4][0])).toMatch(/where exists/i)
  })

  it('short-circuits to 200 without provisioning when the profile already exists (redelivered webhook)', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    profileRows = [{ id: 'user-123' }] // idempotency check finds an existing profile
    const res = await POST(userCreatedRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    // Only the auth lookup + idempotency check ran — no second, orphaned accounts row.
    expect(sqlMock).toHaveBeenCalledTimes(2)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('returns 500 without leaking internal error details when provisioning fails', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    // Both inserts are submitted as one atomic transaction, so a failure
    // surfaces as the whole sql.transaction() call rejecting — neither row is
    // persisted.
    transactionMock.mockRejectedValueOnce(
      new Error(
        'insert into profiles violates foreign key constraint "profiles_account_id_fkey" detail: Key (account_id)=(account-abc) is not present in table "accounts".'
      )
    )
    const res = await POST(userCreatedRequest())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Provisioning failed')
    expect(JSON.stringify(json)).not.toMatch(/foreign key|profiles_account_id_fkey|account-abc/i)
  })
})
