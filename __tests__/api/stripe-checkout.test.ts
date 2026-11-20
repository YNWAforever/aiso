import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createLaunchBillingDb } from '../helpers/launch-billing-db'

const h = vi.hoisted(() => ({
  db: vi.fn(), create: vi.fn(), expire: vi.fn(), list: vi.fn(), retrieve: vi.fn(), price: vi.fn(),
  profile: vi.fn(), createSubscription: vi.fn(), subscriptionList: vi.fn(), retrieveSubscription: vi.fn(),
}))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: h.create, expire: h.expire, list: h.list, retrieve: h.retrieve } },
    prices: { retrieve: h.price },
    subscriptions: { create: h.createSubscription, list: h.subscriptionList, retrieve: h.retrieveSubscription },
  },
  STRIPE_PRICES: { basic: 'price_basic', pro: 'price_pro', enterprise: 'price_enterprise' },
  APP_URL: 'https://app.example.com',
  fixPackMeterConfig: () => ({ priceId: 'price_metered', eventName: 'pack' }),
  invoiceDaysUntilDue: () => 14,
}))
vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))

import { POST } from '@/app/api/stripe/checkout/route'
import { openAccountBilling } from '@/lib/billing/accounts'

const account = 'a1000000-0000-4000-8000-000000000001'
const admin = 'a1000000-0000-4000-8000-000000000002'
const url = 'https://checkout.stripe.test/session'
let fixture: Awaited<ReturnType<typeof createLaunchBillingDb>>

function postCheckout(body: unknown, raw = false) {
  return POST(new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body),
  }))
}

beforeAll(async () => { fixture = await createLaunchBillingDb() })
afterAll(async () => { await fixture?.pg.close() })
beforeEach(async () => {
  vi.resetAllMocks()
  await fixture.pg.exec('truncate accounts cascade')
  await fixture.pg.query("insert into accounts(id,stripe_customer_id) values($1,'cus_fixture')", [account])
  h.db.mockReturnValue(fixture.sql)
  h.profile.mockResolvedValue({ account_id: account })
  h.create.mockResolvedValue({ id: 'cs_fixture', status: 'open', url })
  h.retrieve.mockResolvedValue({ id: 'cs_fixture', status: 'open', url })
  h.expire.mockResolvedValue({ id: 'cs_fixture', status: 'expired' })
  h.list.mockResolvedValue({ data: [], has_more: false })
  h.subscriptionList.mockResolvedValue({ data: [], has_more: false })
  h.price.mockImplementation(async id => ({ active: true, currency: 'usd', unit_amount: ({ price_basic: 19900, price_pro: 59900, price_enterprise: 99900 })[id as string], recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }))
})

describe('POST /api/stripe/checkout', () => {
  it('preserves Hong Kong Chinese in checkout and restores the canceled selection', async () => {
    const response = await postCheckout({ plan: 'pro', lang: 'zh-HK' })
    expect(response.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_pro', quantity: 1 }], customer: 'cus_fixture', locale: 'zh-HK',
      success_url: 'https://app.example.com/zh-HK/dashboard',
      cancel_url: 'https://app.example.com/zh-HK/pricing?plan=pro',
    }), { idempotencyKey: expect.stringMatching(/^aiso:checkout:/) })
  })

  it.each([null, [], 'pro', 1, { plan: {} }, { plan: null }, { plan: 1 }, { plan: 'pro', lang: [] }, { plan: 'pro', lang: null }, { plan: 'free' }])('rejects invalid input %j before Stripe work', async body => {
    expect((await postCheckout(body)).status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })

  it.each(['{', ' '.repeat(1025) + '{"plan":"pro"}'])('rejects malformed or oversized input', async body => {
    expect((await postCheckout(body, true)).status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a configured price that disagrees with the catalog', async () => {
    h.price.mockResolvedValue({ active: true, currency: 'hkd', unit_amount: 19900 })
    expect((await postCheckout({ plan: 'basic' })).status).toBe(503)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('reuses a session and expires it before opening a replacement for another plan', async () => {
    expect((await postCheckout({ plan: 'basic' })).status).toBe(200)
    expect((await postCheckout({ plan: 'basic' })).status).toBe(200)
    expect(h.create).toHaveBeenCalledTimes(1)
    h.create.mockResolvedValueOnce({ id: 'cs_replacement', status: 'open', url })
    expect((await postCheckout({ plan: 'pro' })).status).toBe(200)
    expect(h.expire).toHaveBeenCalledTimes(1)
    expect(h.expire.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[1])
  })

  it('uses the original idempotency key after an ambiguous create', async () => {
    h.create.mockRejectedValueOnce(new Error('lost response'))
    expect((await postCheckout({ plan: 'basic' })).status).toBe(503)
    expect((await postCheckout({ plan: 'basic' })).status).toBe(200)
    expect(h.create.mock.calls[0]).toEqual(h.create.mock.calls[1])
  })

  it('blocks a simultaneous admin subscription and a second checkout', async () => {
    let created!: () => void
    const entered = new Promise<void>(resolve => { created = resolve })
    let settle!: (value: { id: string; status: string; url: string }) => void
    h.create.mockImplementationOnce(async () => {
      created()
      return new Promise(resolve => { settle = resolve })
    })
    const first = postCheckout({ plan: 'basic' })
    await entered
    const adminResult = await openAccountBilling({ accountId: account, mode: 'metered', createSubscription: true, openedBy: admin })
    expect(adminResult).toMatchObject({ status: 'stripe_failed', code: 'BILLING_OPERATION_PENDING' })
    expect((await postCheckout({ plan: 'pro' })).status).toBe(503)
    settle({ id: 'cs_fixture', status: 'open', url })
    expect((await first).status).toBe(200)
    expect(h.createSubscription).not.toHaveBeenCalled()
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('blocks completed checkout while linkage is pending and lets a canceled customer subscribe again', async () => {
    expect((await postCheckout({ plan: 'basic' })).status).toBe(200)
    h.retrieve.mockResolvedValue({ id: 'cs_fixture', status: 'complete', subscription: 'sub_old' })
    h.retrieveSubscription.mockResolvedValueOnce({ status: 'active' })
    expect((await postCheckout({ plan: 'basic' })).status).toBe(503)
    await fixture.pg.exec("update accounts set stripe_subscription_id = 'sub_old'")
    h.retrieveSubscription.mockResolvedValue({ status: 'canceled' })
    expect((await postCheckout({ plan: 'pro' })).status).toBe(200)
  })
})
