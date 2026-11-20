import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLaunchBillingDb } from '../../helpers/launch-billing-db'

const queries: string[] = []
let nextResults: unknown[][] = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result ?? [])
})

const getDb = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ db: getDb }))

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
  storeFixPack,
  fixMeterIdentifier,
  reportFixPackUsage,
  retryFixPackUsage,
} from '@/lib/billing/usage'

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
  getDb.mockReturnValue(sqlMock)
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

describe('storeFixPack', () => {
  const account = 'f0000000-0000-4000-8000-000000000001'
  const client = 'f0000000-0000-4000-8000-000000000002'
  const scan = 'f0000000-0000-4000-8000-000000000003'
  const pack = { llms_txt: 'llms', robots_patch: 'robots', faq_schema: 'faq' }
  let fixture: Awaited<ReturnType<typeof createLaunchBillingDb>>
  beforeAll(async () => { fixture = await createLaunchBillingDb() })
  afterAll(async () => { await fixture?.pg.close() })
  beforeEach(async () => {
    getDb.mockReturnValue(fixture.sql)
    await fixture.pg.exec('truncate accounts cascade')
    await fixture.pg.query('insert into accounts(id) values($1)', [account])
    await fixture.pg.query('insert into clients(id,account_id) values($1,$2)', [client, account])
    await fixture.pg.query('insert into scans(id,account_id,client_id) values($1,$2,$3)', [scan, account, client])
    await fixture.pg.query(`insert into account_billing(account_id, stripe_customer_id, stripe_subscription_id, stripe_metered_item_id, mode, opened_by)
      values($1,'cus_fixture','sub_fixture','si_meter','metered',$1)`, [account])
  })

  it('records one linked event for concurrent equivalent requests', async () => {
    const results = await Promise.all([storeFixPack(account, scan, pack), storeFixPack(account, scan, pack)])
    expect(results.filter(result => result.usageId)).toHaveLength(1)
    const { rows } = await fixture.pg.query('select f.id, e.stripe_meter_event_identifier from fix_packs f join fix_billing_events e on e.fix_pack_id=f.id')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ stripe_meter_event_identifier: fixMeterIdentifier((rows[0] as { id: string }).id) })
  })

  it('rolls the pack back if the ledger insert fails', async () => {
    await fixture.pg.exec('alter table fix_billing_events add constraint fixture_failure check (false)')
    try {
      await expect(storeFixPack(account, scan, pack)).rejects.toThrow()
      expect((await fixture.pg.query('select id from fix_packs')).rows).toEqual([])
      expect((await fixture.pg.query('select id from fix_billing_events')).rows).toEqual([])
    } finally {
      await fixture.pg.exec('alter table fix_billing_events drop constraint fixture_failure')
    }
  })

  it('stores included drafts without a ledger row and rejects another account', async () => {
    await fixture.pg.exec("update account_billing set mode='included'")
    expect(await storeFixPack(account, scan, pack)).toEqual({ available: true, usageId: null })
    expect(await storeFixPack(client, scan, pack)).toEqual({ available: false, usageId: null })
    expect((await fixture.pg.query('select id from fix_packs')).rows).toHaveLength(1)
    expect((await fixture.pg.query('select id from fix_billing_events')).rows).toEqual([])
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
