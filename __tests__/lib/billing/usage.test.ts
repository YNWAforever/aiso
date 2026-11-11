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
  create: vi.fn(),
}))
const meterConfig = vi.hoisted(() => ({ priceId: 'price_metered', eventName: 'fix_pack_generated' }))

vi.mock('@/lib/stripe', () => ({
  stripe: { v2: { billing: { meterEvents: { create: stripeMock.create } } } },
  fixPackMeterConfig: () => meterConfig,
}))

import {
  FIX_METER_IDENTIFIER_PREFIX,
  enqueueFixPackUsage,
  fixMeterIdentifier,
  reportFixPackUsage,
  retryFixPackUsage,
} from '@/lib/billing/usage'

const REF = { fixPackId: 'fp-1', accountId: 'acc-1', clientId: 'client-1' }

const LEDGER_ROW = {
  id: 'ev-1',
  state: 'pending',
  attempts: 0,
  identifier: `${FIX_METER_IDENTIFIER_PREFIX}fp-1`,
  customer_id: 'cus_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  meterConfig.priceId = 'price_metered'
  meterConfig.eventName = 'fix_pack_generated'
  stripeMock.create.mockResolvedValue({ identifier: 'stripe-evt' })
})

describe('fixMeterIdentifier', () => {
  it('mints a stable identifier from the fix pack id', () => {
    expect(fixMeterIdentifier('fp-1')).toBe('fixbilling:fp-1')
    expect(fixMeterIdentifier('fp-1')).toBe(fixMeterIdentifier('fp-1'))
  })
})

describe('enqueueFixPackUsage', () => {
  it('only writes a ledger row when the account is on metered billing', async () => {
    nextResults = [[{ id: 'ev-1' }]]
    await enqueueFixPackUsage(REF)

    const query = queries[0]!
    expect(query).toMatch(/insert into fix_billing_events/i)
    expect(query).toMatch(/from account_billing b/i)
    expect(query).toMatch(/b\.mode = 'metered'/i)
    expect(query).toMatch(/on conflict \(fix_pack_id\) do nothing/i)
    const [, ...params] = sqlMock.mock.calls[0]!
    expect(params).toEqual(['acc-1', 'client-1', 'fp-1', 'fixbilling:fp-1', 'acc-1'])
  })

  it('returns null when the account is not metered or the pack was already recorded', async () => {
    nextResults = [[]]
    await expect(enqueueFixPackUsage(REF)).resolves.toBeNull()
  })

  it('returns the ledger row id when the insert succeeded', async () => {
    nextResults = [[{ id: 'ev-1' }]]
    await expect(enqueueFixPackUsage(REF)).resolves.toBe('ev-1')
  })
})

describe('reportFixPackUsage', () => {
  it('sends the meter event and marks the row reported', async () => {
    nextResults = [[LEDGER_ROW], [{ id: 'ev-1' }]]
    await expect(reportFixPackUsage('ev-1')).resolves.toBe('reported')

    expect(stripeMock.create).toHaveBeenCalledWith({
      event_name: 'fix_pack_generated',
      identifier: 'fixbilling:fp-1',
      payload: { stripe_customer_id: 'cus_1', value: '1' },
    })
    const update = queries[1]!
    expect(update).toMatch(/update fix_billing_events/i)
    expect(update).toMatch(/state = 'reported'/i)
  })

  it('fails closed when the Stripe meter is not configured, without charging', async () => {
    meterConfig.priceId = ''
    nextResults = [[LEDGER_ROW], []]
    await expect(reportFixPackUsage('ev-1')).resolves.toBe('failed')

    expect(stripeMock.create).not.toHaveBeenCalled()
    const [, ...params] = sqlMock.mock.calls[1]!
    expect(params).toContain('STRIPE_CONFIG_MISSING')
  })

  it('records a failed meter event instead of throwing at the caller', async () => {
    stripeMock.create.mockRejectedValue(new Error('network down'))
    nextResults = [[LEDGER_ROW], []]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(reportFixPackUsage('ev-1')).resolves.toBe('failed')
    expect(stripeMock.create).toHaveBeenCalledTimes(1)
    expect(queries[1]).toMatch(/state = 'failed'/i)
    consoleError.mockRestore()
  })

  it('is idempotent: a reported row is never sent again', async () => {
    nextResults = [[{ ...LEDGER_ROW, state: 'reported' }]]
    await expect(reportFixPackUsage('ev-1')).resolves.toBe('skipped')
    expect(stripeMock.create).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
  })

  it('skips a missing row rather than inventing a charge', async () => {
    nextResults = [[]]
    await expect(reportFixPackUsage('ev-missing')).resolves.toBe('skipped')
    expect(stripeMock.create).not.toHaveBeenCalled()
  })
})

describe('retryFixPackUsage', () => {
  it('returns not_found for an unknown row', async () => {
    nextResults = [[]]
    await expect(retryFixPackUsage('ev-missing')).resolves.toEqual({ status: 'not_found' })
  })

  it('refuses a row that already reached Stripe', async () => {
    nextResults = [[{ id: 'ev-1', state: 'reported', attempts: 1, created_at: new Date().toISOString() }]]
    await expect(retryFixPackUsage('ev-1')).resolves.toEqual({ status: 'not_retryable' })
    expect(stripeMock.create).not.toHaveBeenCalled()
  })

  it('refuses a row older than the 24-hour identifier window', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    nextResults = [[{ id: 'ev-1', state: 'failed', attempts: 1, created_at: old }]]
    await expect(retryFixPackUsage('ev-1')).resolves.toEqual({ status: 'retry_window_elapsed' })
    expect(stripeMock.create).not.toHaveBeenCalled()
  })

  it('refuses a row that exhausted its attempts', async () => {
    nextResults = [[{ id: 'ev-1', state: 'failed', attempts: 10, created_at: new Date().toISOString() }]]
    await expect(retryFixPackUsage('ev-1')).resolves.toEqual({ status: 'attempts_exhausted' })
  })

  it('retries a failed row within the window and reports success', async () => {
    nextResults = [
      [{ id: 'ev-1', state: 'failed', attempts: 1, created_at: new Date().toISOString() }],
      [LEDGER_ROW],
      [{ id: 'ev-1' }],
    ]
    await expect(retryFixPackUsage('ev-1')).resolves.toEqual({ status: 'reported' })
    expect(stripeMock.create).toHaveBeenCalledTimes(1)
  })
})
