import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries: string[] = []
let nextResults: unknown[][] = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsCreate: vi.fn(),
  subscriptionsCancel: vi.fn(),
  subscriptionItemsCreate: vi.fn(),
  subscriptionItemsDel: vi.fn(),
}))

const meterConfig = vi.hoisted(() => ({
  priceId: 'price_metered',
  eventName: 'fix_pack_generated',
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { create: stripeMock.customersCreate },
    subscriptions: {
      retrieve: stripeMock.subscriptionsRetrieve,
      create: stripeMock.subscriptionsCreate,
      cancel: stripeMock.subscriptionsCancel,
    },
    subscriptionItems: {
      create: stripeMock.subscriptionItemsCreate,
      del: stripeMock.subscriptionItemsDel,
    },
  },
  fixPackMeterConfig: () => meterConfig,
  invoiceDaysUntilDue: () => 14,
  STRIPE_PRICES: { basic: 'price_basic', pro: 'price_pro', enterprise: 'price_enterprise' },
}))

import { openAccountBilling } from '@/lib/billing/accounts'

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_ID = '99999999-8888-4777-8666-555555555555'

const ACCOUNT = {
  id: ACCOUNT_ID,
  plan: 'pro',
  status: 'active',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  owner_email: 'owner@example.com',
}

const BILLING_ROW = {
  account_id: ACCOUNT_ID,
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  stripe_metered_item_id: 'si_meter',
  mode: 'metered',
  opened_by: ADMIN_ID,
  opened_at: '2026-11-11T00:00:00Z',
  updated_at: '2026-11-11T00:00:00Z',
}

const SUBSCRIPTION = {
  id: 'sub_1',
  status: 'active',
  items: { data: [{ id: 'si_plan', price: { id: 'price_pro' } }] },
}

const SUBSCRIPTION_WITH_METER = {
  id: 'sub_1',
  status: 'active',
  items: {
    data: [
      { id: 'si_plan', price: { id: 'price_pro' } },
      { id: 'si_meter', price: { id: 'price_metered' } },
    ],
  },
}

function lastQueryParams(): unknown[] {
  const [, ...params] = sqlMock.mock.calls.at(-1)!
  return params
}

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  meterConfig.priceId = 'price_metered'
  meterConfig.eventName = 'fix_pack_generated'
  stripeMock.subscriptionsRetrieve.mockResolvedValue(SUBSCRIPTION)
  stripeMock.subscriptionItemsCreate.mockResolvedValue({ id: 'si_meter' })
  stripeMock.subscriptionItemsDel.mockResolvedValue({ id: 'si_meter', deleted: true })
  stripeMock.subscriptionsCancel.mockResolvedValue({ id: 'sub_new', status: 'canceled' })
})

describe('openAccountBilling', () => {
  it('returns account_not_found without touching Stripe', async () => {
    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'account_not_found' })
    expect(stripeMock.subscriptionsRetrieve).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
  })

  it('attaches the metered item to the existing plan subscription and records the mode', async () => {
    nextResults = [[ACCOUNT], [BILLING_ROW]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.billing.mode).toBe('metered')
    expect(stripeMock.subscriptionItemsCreate).toHaveBeenCalledWith({
      subscription: 'sub_1',
      price: 'price_metered',
      quantity: 1,
    })
    expect(queries.some(query => /insert into account_billing/i.test(query))).toBe(true)
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 'cus_1', 'sub_1', 'si_meter', 'metered', ADMIN_ID])
  })

  it('reuses a metered item that is already attached (idempotent reopen)', async () => {
    stripeMock.subscriptionsRetrieve.mockResolvedValue(SUBSCRIPTION_WITH_METER)
    nextResults = [[ACCOUNT], [BILLING_ROW]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome.status).toBe('ok')
    expect(stripeMock.subscriptionItemsCreate).not.toHaveBeenCalled()
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 'cus_1', 'sub_1', 'si_meter', 'metered', ADMIN_ID])
  })

  it('refuses metered billing without a subscription unless asked to create one', async () => {
    nextResults = [[{ ...ACCOUNT, stripe_subscription_id: null }]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'subscription_required' })
    expect(stripeMock.subscriptionsCreate).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
  })

  it('fails closed when the metered price is not configured', async () => {
    meterConfig.priceId = ''
    nextResults = [[ACCOUNT]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'metered_not_configured' })
    expect(stripeMock.subscriptionItemsCreate).not.toHaveBeenCalled()
  })

  it('keeps included mode on a subscription-less account and records the control row', async () => {
    nextResults = [
      [{ ...ACCOUNT, stripe_subscription_id: null }],
      [],
      [{ ...BILLING_ROW, stripe_subscription_id: null, stripe_metered_item_id: null, mode: 'included' }],
    ]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'included', openedBy: ADMIN_ID })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.billing.mode).toBe('included')
    expect(stripeMock.subscriptionItemsDel).not.toHaveBeenCalled()
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 'cus_1', null, null, 'included', ADMIN_ID])
  })

  it('switching back to included detaches the stored metered item', async () => {
    nextResults = [
      [ACCOUNT],
      [BILLING_ROW],
      [{ ...BILLING_ROW, stripe_metered_item_id: null, mode: 'included' }],
    ]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'included', openedBy: ADMIN_ID })

    expect(outcome.status).toBe('ok')
    expect(stripeMock.subscriptionItemsDel).toHaveBeenCalledWith('si_meter')
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 'cus_1', 'sub_1', null, 'included', ADMIN_ID])
  })

  it('creates and links a Stripe customer when the account has none', async () => {
    stripeMock.customersCreate.mockResolvedValue({ id: 'cus_new' })
    nextResults = [
      [{ ...ACCOUNT, stripe_customer_id: null, stripe_subscription_id: null }],
      [{ stripe_customer_id: 'cus_new' }],
      [],
      [{ ...BILLING_ROW, stripe_customer_id: 'cus_new', stripe_subscription_id: null, stripe_metered_item_id: null, mode: 'included' }],
    ]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'included', openedBy: ADMIN_ID })

    expect(outcome.status).toBe('ok')
    expect(stripeMock.customersCreate).toHaveBeenCalledWith({
      email: 'owner@example.com',
      metadata: { account_id: ACCOUNT_ID, source: 'aiso_admin_billing' },
    })
    const update = queries.find(query => /update accounts/i.test(query))!
    expect(update).toMatch(/stripe_customer_id is null/i)
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 'cus_new', null, null, 'included', ADMIN_ID])
  })

  it('returns a stripe failure rather than a success when the customer cannot be created', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stripeMock.customersCreate.mockRejectedValue(new Error('stripe down'))
    nextResults = [[{ ...ACCOUNT, stripe_customer_id: null }]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'included', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'stripe_failed', code: 'CUSTOMER_CREATE_FAILED' })
    expect(queries).toHaveLength(1)
    consoleError.mockRestore()
  })

  it('rejects a subscription with lines it did not create', async () => {
    stripeMock.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      items: {
        data: [
          { id: 'si_plan', price: { id: 'price_pro' } },
          { id: 'si_other', price: { id: 'price_unknown' } },
        ],
      },
    })
    nextResults = [[ACCOUNT]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'stripe_failed', code: 'SUBSCRIPTION_ITEMS_UNSUPPORTED' })
    expect(stripeMock.subscriptionItemsCreate).not.toHaveBeenCalled()
  })

  it('refuses an inactive subscription instead of attaching a meter to it', async () => {
    stripeMock.subscriptionsRetrieve.mockResolvedValue({ ...SUBSCRIPTION, status: 'canceled' })
    nextResults = [[ACCOUNT]]

    const outcome = await openAccountBilling({ accountId: ACCOUNT_ID, mode: 'metered', openedBy: ADMIN_ID })

    expect(outcome).toEqual({ status: 'stripe_failed', code: 'SUBSCRIPTION_INACTIVE' })
  })

  it('creates a send-invoice subscription and links it through the guarded event path', async () => {
    stripeMock.subscriptionsCreate.mockResolvedValue({
      id: 'sub_new',
      status: 'active',
      items: {
        data: [
          { id: 'si_plan', price: { id: 'price_basic' } },
          { id: 'si_meter_new', price: { id: 'price_metered' } },
        ],
      },
    })
    nextResults = [
      [{ ...ACCOUNT, plan: 'basic', stripe_customer_id: 'cus_1', stripe_subscription_id: null }],
      [{ acquired: true }],
      [{ result: 'applied' }],
      [],
      [{ ...BILLING_ROW, stripe_subscription_id: 'sub_new', stripe_metered_item_id: 'si_meter_new' }],
    ]

    const outcome = await openAccountBilling({
      accountId: ACCOUNT_ID,
      mode: 'metered',
      plan: 'basic',
      createSubscription: true,
      openedBy: ADMIN_ID,
    })

    expect(outcome.status).toBe('ok')
    expect(stripeMock.subscriptionsCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      items: [{ price: 'price_basic' }, { price: 'price_metered' }],
      collection_method: 'send_invoice',
      days_until_due: 14,
      metadata: { account_id: ACCOUNT_ID, source: 'aiso_admin_billing_open' },
    })
    const applyCall = sqlMock.mock.calls.find(([strings]) =>
      strings.join('?').includes('apply_stripe_account_event'),
    )!
    const params = applyCall.slice(1)
    expect(params[0]).toBe(ACCOUNT_ID)
    expect(params[1]).toBe('sub_new')
    expect(params[2]).toBe('cus_1')
    expect(params[3]).toBe('basic')
    expect(params[4]).toBe('active')
    expect(params[6]).toMatch(/^adminbilling:/)
    expect(queries.some(query => /acquire_stripe_subscription_lease/i.test(query))).toBe(true)
    expect(queries.some(query => /release_stripe_subscription_lease/i.test(query))).toBe(true)
    expect(stripeMock.subscriptionsCancel).not.toHaveBeenCalled()
  })

  it('cancels an unlinked subscription and reports the failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stripeMock.subscriptionsCreate.mockResolvedValue({
      id: 'sub_new',
      status: 'active',
      items: {
        data: [
          { id: 'si_plan', price: { id: 'price_basic' } },
          { id: 'si_meter_new', price: { id: 'price_metered' } },
        ],
      },
    })
    nextResults = [
      [{ ...ACCOUNT, plan: 'basic', stripe_subscription_id: null }],
      [{ acquired: true }],
      [{ result: 'not_found' }],
      [],
    ]

    const outcome = await openAccountBilling({
      accountId: ACCOUNT_ID,
      mode: 'metered',
      plan: 'basic',
      createSubscription: true,
      openedBy: ADMIN_ID,
    })

    expect(outcome).toEqual({ status: 'account_link_failed' })
    expect(stripeMock.subscriptionsCancel).toHaveBeenCalledWith('sub_new')
    expect(queries.some(query => /insert into account_billing/i.test(query))).toBe(false)
    consoleError.mockRestore()
  })
})
