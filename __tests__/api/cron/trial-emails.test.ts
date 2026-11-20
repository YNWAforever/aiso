import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLaunchBillingDb } from '../../helpers/launch-billing-db'

const h = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), finish: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/resend', () => ({ sendTrialEmail: h.send, trialEmailSender: () => 'sender@example.test' }))
vi.mock('@/lib/cron/recordRun', () => ({ startCronRun: async () => 'run-fixture', finishCronRun: h.finish }))
vi.mock('@/lib/app-origin', () => ({ appOrigin: () => 'https://app.example.test' }))

import { GET } from '@/app/api/cron/trial-emails/route'

const secret = 'synthetic-trial-cron-fixture-secret'
const account = 'a1000000-0000-4000-8000-000000000001'
const user = 'a1000000-0000-4000-8000-000000000002'
let fixture: Awaited<ReturnType<typeof createLaunchBillingDb>>

function request(token = secret) {
  return new Request('https://app.example.test/api/cron/trial-emails', { headers: { authorization: `Bearer ${token}` } })
}

beforeAll(async () => { fixture = await createLaunchBillingDb() })
afterAll(async () => { await fixture?.pg.close() })
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('CRON_SECRET', secret)
  h.db.mockReturnValue(fixture.sql)
  h.send.mockResolvedValue('email_fixture')
  await fixture.pg.exec('truncate accounts cascade; truncate neon_auth."user"')
  await fixture.pg.query(`insert into accounts (id, trial_started_at, trial_ends_at, trial_email_locale)
    values ($1, now() - interval '6 days', now() + interval '8 hours', 'zh-HK')`, [account])
  await fixture.pg.query('insert into neon_auth."user" (id,email) values ($1,\'owner@example.test\')', [user])
  await fixture.pg.query('insert into profiles (id,account_id) values ($1,$2)', [user, account])
})
afterEach(() => vi.unstubAllEnvs())

describe('trial email delivery', () => {
  it('requires the configured cron secret and keeps recipient data out of responses', async () => {
    expect((await GET(request('wrong'))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request())).status).toBe(500)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('sends only the applicable localized reminder and preserves the legacy mask', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sent: 1, failed: 0, deferred: 0, needsReview: 0 })
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.test', text: expect.stringContaining('https://app.example.test/zh-HK/pricing'),
      idempotencyKey: expect.stringMatching(/^aiso:trial:/),
    }))
    expect(h.send.mock.calls[0][0].text).toContain('199 美元')
    expect(await fixture.pg.query('select trial_emails_sent from accounts')).toMatchObject({ rows: [{ trial_emails_sent: 4 }] })
    await GET(request())
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('sends only the follow-up when the missed trial ended four days ago', async () => {
    await fixture.pg.exec("update accounts set trial_started_at=now()-interval '11 days', trial_ends_at=now()-interval '4 days', trial_email_locale=null")
    await GET(request())
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0].subject).toBe('Your AISO trial has ended')
  })

  it.each([
    "trial_ends_at = now() - interval '9 days', trial_started_at = now() - interval '16 days'",
    "stripe_subscription_id = 'sub_converted'",
    "override_plan = 'pro'",
    'trial_emails_sent = 4',
  ])('skips an ineligible account (%s)', async change => {
    await fixture.pg.exec(`update accounts set ${change}`)
    await GET(request())
    expect(h.send).not.toHaveBeenCalled()
  })

  it('uses the extended expiry instead of elapsed days', async () => {
    await fixture.pg.exec("update accounts set trial_started_at=now()-interval '12 days', trial_ends_at=now()+interval '3 days', trial_email_locale=null")
    await GET(request())
    expect(h.send.mock.calls[0][0].subject).toBe('Your AISO trial is active')
  })

  it('reuses the frozen provider request when delivery was accepted but the write failed', async () => {
    h.send.mockImplementationOnce(async () => {
      await fixture.pg.exec('alter table trial_email_deliveries add constraint fixture_failure check (sent_at is null)')
      return 'email_accepted'
    })
    expect((await GET(request())).status).toBe(502)
    await fixture.pg.exec("alter table trial_email_deliveries drop constraint fixture_failure; update trial_email_deliveries set lease_until=now()-interval '1 minute'")
    expect((await GET(request())).status).toBe(200)
    expect(h.send.mock.calls[0][0]).toEqual(h.send.mock.calls[1][0])
    expect(await fixture.pg.query('select payload, provider_email_id from trial_email_deliveries')).toMatchObject({ rows: [{ payload: null, provider_email_id: 'email_fixture' }] })
  })

  it('flags an ambiguous request beyond the idempotency window', async () => {
    h.send.mockRejectedValueOnce(new Error('ambiguous network failure'))
    await GET(request())
    await fixture.pg.exec("update trial_email_deliveries set started_at=now()-interval '25 hours', lease_until=now()-interval '1 minute'")
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ sent: 0, needsReview: 1 })
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})
