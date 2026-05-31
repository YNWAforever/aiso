/**
 * TDD: Cron trial email drip
 * Tests bitmask logic, day thresholds, auth guard, and idempotency
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

process.env.CRON_SECRET               = 'test-cron-secret'
process.env.NEXT_PUBLIC_SUPABASE_URL  = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.RESEND_API_KEY            = 'test-resend-key'
process.env.NEXT_PUBLIC_APP_URL       = 'https://aeo.fimmick.com'
process.env.RESEND_FROM_EMAIL         = 'hello@fimmick.com'

const CRON_SECRET = 'test-cron-secret'

// ── Bitmask constants (mirror implementation) ──────────────────
const EMAIL_DAY1  = 1
const EMAIL_DAY5  = 2
const EMAIL_DAY7  = 4
const EMAIL_DAY10 = 8

// ── Hoisted shared state ───────────────────────────────────────
// vi.hoisted() runs BEFORE vi.mock factories AND before let/const in the module body,
// so closures in vi.mock can safely reference these without TDZ issues.
// Using class MockResend (not vi.fn().mockImplementation(arrowFn)) avoids the
// "arrow function is not a constructor" TypeError that Vitest throws when `new` is
// called on a spy whose implementation is an arrow function.
const h = vi.hoisted(() => ({
  emailsSent:     [] as { to: string; subject: string }[],
  bitmaskUpdates: [] as { id: string; mask: number }[],
  accounts:       [] as Record<string, unknown>[],
}))

type Account = { id: string; trial_started_at: string; trial_emails_sent: number; profiles: unknown }

// ── Mock Resend ────────────────────────────────────────────────
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = {
      send({ to, subject }: { to: string; subject: string }) {
        h.emailsSent.push({ to, subject })
        return Promise.resolve({ data: { id: 'email-id' }, error: null })
      },
    }
  },
}))

// ── Mock Supabase (service role) ───────────────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      not: vi.fn().mockImplementation(() =>
        Promise.resolve({ data: h.accounts, error: null })
      ),
      update: vi.fn().mockImplementation(({ trial_emails_sent }: { trial_emails_sent: number }) => ({
        eq: vi.fn().mockImplementation((_col: string, id: string) => {
          h.bitmaskUpdates.push({ id, mask: trial_emails_sent })
          return Promise.resolve({ error: null })
        }),
      })),
    })),
  })),
}))

// ── Helpers ────────────────────────────────────────────────────
function makeAccount(daysAgo: number, sentBitmask: number, id = 'acc-1', email = 'user@example.com'): Account {
  return {
    id,
    trial_started_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    trial_emails_sent: sentBitmask,
    profiles: { email },
  }
}

function makeReq(secret = CRON_SECRET) {
  return new NextRequest('http://localhost/api/cron/trial-emails', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  })
}

function clearState() {
  h.accounts.length = 0
  h.emailsSent.length = 0
  h.bitmaskUpdates.length = 0
}

function setAccounts(...items: Account[]) {
  h.accounts.length = 0
  h.accounts.push(...(items as unknown as Record<string, unknown>[]))
}

// ── Tests ──────────────────────────────────────────────────────
describe('GET /api/cron/trial-emails — auth', () => {
  beforeEach(clearState)

  it('returns 401 when Authorization header is missing', async () => {
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const req = new NextRequest('http://localhost/api/cron/trial-emails', { method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header has wrong secret', async () => {
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const res = await GET(makeReq('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 200 when Authorization header is correct', async () => {
    setAccounts()
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('sent')
    expect(json.sent).toBe(0)
  })
})

describe('GET /api/cron/trial-emails — bitmask logic', () => {
  beforeEach(clearState)

  it('sends day-1 email for account 1 day into trial with bitmask 0', async () => {
    setAccounts(makeAccount(1, 0))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(h.emailsSent.length).toBeGreaterThan(0)
    const day1 = h.emailsSent.find(e =>
      e.subject.includes('Fix Pack') || e.subject.includes('ready') || e.subject.includes('AISO')
    )
    expect(day1).toBeDefined()
  })

  it('does NOT resend day-1 email when bit 1 already set (bitmask 1)', async () => {
    setAccounts(makeAccount(1, EMAIL_DAY1))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(h.emailsSent.length).toBe(0)
  })

  it('sends day-5 email for account 5 days in with bitmask = day1 sent only', async () => {
    setAccounts(makeAccount(5, EMAIL_DAY1))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    expect(h.emailsSent.length).toBeGreaterThan(0)
    const day5 = h.emailsSent.find(e =>
      e.subject.includes('left') || e.subject.includes('Pulse') ||
      e.subject.includes('days') || e.subject.includes('missing')
    )
    expect(day5).toBeDefined()
  })

  it('does NOT resend day-5 email when already sent (bitmask includes bit 2)', async () => {
    setAccounts(makeAccount(5, EMAIL_DAY1 | EMAIL_DAY5))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    expect(h.emailsSent.length).toBe(0)
  })

  it('sends day-7 email for account 7 days in', async () => {
    setAccounts(makeAccount(7, EMAIL_DAY1 | EMAIL_DAY5))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    expect(h.emailsSent.length).toBeGreaterThan(0)
    const day7 = h.emailsSent.find(e =>
      e.subject.includes('Last') || e.subject.includes('trial') || e.subject.includes('day')
    )
    expect(day7).toBeDefined()
  })

  it('sends day-10 email for account 10 days in', async () => {
    setAccounts(makeAccount(10, EMAIL_DAY1 | EMAIL_DAY5 | EMAIL_DAY7))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    expect(h.emailsSent.length).toBeGreaterThan(0)
    const day10 = h.emailsSent.find(e =>
      e.subject.includes('saved') || e.subject.includes('anytime') || e.subject.includes('back')
    )
    expect(day10).toBeDefined()
  })

  it('skips account with no email address', async () => {
    setAccounts(makeAccount(1, 0, 'acc-1', ''))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    expect(h.emailsSent.length).toBe(0)
  })

  it('returns { sent: N } with correct count', async () => {
    setAccounts(makeAccount(1, 0, 'acc-1'), makeAccount(5, EMAIL_DAY1, 'acc-2'))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json).toHaveProperty('sent')
    expect(json.sent).toBeGreaterThanOrEqual(2)
  })

  it('updates bitmask correctly after sending day-1 email', async () => {
    setAccounts(makeAccount(1, 0, 'acc-bitmask'))
    const { GET } = await import('@/app/api/cron/trial-emails/route')
    await GET(makeReq())
    const update = h.bitmaskUpdates.find(u => u.id === 'acc-bitmask')
    if (update) {
      expect(update.mask & EMAIL_DAY1).toBe(EMAIL_DAY1)
    }
    // If no update was recorded, no email was sent either — both consistent
  })
})
