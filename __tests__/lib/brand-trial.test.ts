import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { text: string; values: unknown[] }[] = []
let nextResult: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  if (nextResult instanceof Error) throw nextResult
  return Promise.resolve(nextResult)
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

import { ensureTrialForAccount } from '@/lib/brands/trial'

const ACCOUNT = 'acc-1'

describe('ensureTrialForAccount', () => {
  beforeEach(() => {
    calls.length = 0
    nextResult = []
  })

  it('returns the expiry the database reports', async () => {
    const ends = new Date('2026-08-05T00:00:00.000Z')
    nextResult = [{ trial_ends_at: ends }]
    await expect(ensureTrialForAccount(ACCOUNT)).resolves.toEqual(ends)
  })

  it('scopes the update to the given account', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].values).toContain(ACCOUNT)
  })

  it('only starts a trial that has not started', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].text).toContain('coalesce(trial_started_at, now())')
  })

  it('repairs a missing expiry without restarting the trial', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].text).toContain('coalesce(trial_ends_at')
  })

  it('pins the tier to basic only when granting, and only without a subscription', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    const sqlText = calls[0].text
    expect(sqlText).toContain('when trial_started_at is null')
    expect(sqlText).toContain("coalesce(stripe_subscription_id, '') = ''")
    expect(sqlText).toContain("then 'basic'")
    expect(sqlText).toContain('else plan')
  })

  it('coerces an ISO string expiry to a Date', async () => {
    nextResult = [{ trial_ends_at: '2026-08-05T00:00:00.000Z' }]
    const result = await ensureTrialForAccount(ACCOUNT)
    expect(result).toBeInstanceOf(Date)
    expect(result.toISOString()).toBe('2026-08-05T00:00:00.000Z')
  })

  it('throws when the account does not exist', async () => {
    nextResult = []
    await expect(ensureTrialForAccount(ACCOUNT)).rejects.toThrow(/account/i)
  })

  it('propagates a database failure rather than returning a value', async () => {
    nextResult = new Error('connection terminated') as never
    await expect(ensureTrialForAccount(ACCOUNT)).rejects.toThrow('connection terminated')
  })
})
