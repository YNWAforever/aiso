import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The route calls `sql\`...\`` directly (for the idempotency check, and to
// build each query it hands to `sql.transaction()`), plus `sql.transaction()`
// itself to submit the accounts + profiles inserts as one atomic batch.
const transactionMock = vi.fn()
const sqlMock = Object.assign(vi.fn(), { transaction: transactionMock })
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

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

describe('POST /api/webhooks/neon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No existing profile by default (idempotency check "misses"); the
    // return value of the two insert-building calls inside the transaction
    // array is never read by the route, so an empty array is a safe default.
    sqlMock.mockResolvedValue([])
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

  it('provisions an account and profile on user.created, linking them via the same account id', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    const res = await POST(userCreatedRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    // 1 idempotency check + 2 queries built for the transaction batch.
    expect(sqlMock).toHaveBeenCalledTimes(3)
    expect(transactionMock).toHaveBeenCalledTimes(1)

    const [, checkedUserId] = sqlMock.mock.calls[0]
    expect(checkedUserId).toBe('user-123')

    const [accountStrings, accountId] = sqlMock.mock.calls[1]
    expect((accountStrings as string[]).join('?')).toMatch(/insert into accounts/i)
    expect(typeof accountId).toBe('string')
    expect((accountId as string).length).toBeGreaterThan(0)

    const [profileStrings, profileUserId, profileAccountId, profileName] = sqlMock.mock.calls[2]
    expect((profileStrings as string[]).join('?')).toMatch(/insert into profiles/i)
    expect(profileUserId).toBe('user-123')
    expect(profileName).toBe('New User')
    // The profile must link to the exact account id created alongside it.
    expect(profileAccountId).toBe(accountId)

    // Both inserts were submitted together as a single atomic transaction.
    const [txnQueries] = transactionMock.mock.calls[0]
    expect(txnQueries).toHaveLength(2)
  })

  it('short-circuits to 200 without provisioning when the profile already exists (redelivered webhook)', async () => {
    const { POST } = await import('@/app/api/webhooks/neon/route')
    sqlMock.mockResolvedValueOnce([{ id: 'user-123' }]) // idempotency check finds an existing profile
    const res = await POST(userCreatedRequest())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    // Only the idempotency check ran — no second, orphaned accounts row.
    expect(sqlMock).toHaveBeenCalledTimes(1)
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
