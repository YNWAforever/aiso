import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries: string[] = []
let nextResults: unknown[][] = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  return Promise.resolve(nextResults.shift() ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const invoiceMocks = vi.hoisted(() => ({ listAccountInvoices: vi.fn() }))
vi.mock('@/lib/billing/invoices', () => ({ listAccountInvoices: invoiceMocks.listAccountInvoices }))

import { loadClientBillingView } from '@/lib/billing/client-view'

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-11-11T05:00:00Z')

function lastQueryParams(): unknown[] {
  const [, ...params] = sqlMock.mock.calls.at(-1)!
  return params
}

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  invoiceMocks.listAccountInvoices.mockResolvedValue([])
})

describe('loadClientBillingView', () => {
  it('reports metered mode and splits reported from not-yet-reported packs', async () => {
    nextResults = [
      [{ stripe_customer_id: 'cus_1', mode: 'metered' }],
      [{ reported: 3, not_reported: 2 }],
    ]

    const view = await loadClientBillingView(ACCOUNT_ID, NOW)

    expect(view).toMatchObject({
      monthKey: '2026-11',
      mode: 'metered',
      reportedFixPacks: 3,
      notReportedFixPacks: 2,
      hasStripeCustomer: true,
    })
    // The counts are explicitly split, so a pending/failed row can never be
    // counted as billed.
    expect(queries[1]).toMatch(/state = 'reported'/)
    expect(queries[1]).toMatch(/state in \('pending', 'failed'\)/)
    expect(lastQueryParams()).toEqual([
      ACCOUNT_ID,
      '2026-10-31T16:00:00.000Z',
      '2026-11-30T16:00:00.000Z',
    ])
  })

  it('reports a not-yet-opened account as null mode with zero usage', async () => {
    nextResults = [[{ stripe_customer_id: null, mode: null }], []]

    const view = await loadClientBillingView(ACCOUNT_ID, NOW)

    expect(view).toMatchObject({
      mode: null,
      reportedFixPacks: 0,
      notReportedFixPacks: 0,
      hasStripeCustomer: false,
      invoices: [],
    })
  })

  it('includes the account\'s mirrored invoices', async () => {
    invoiceMocks.listAccountInvoices.mockResolvedValue([
      {
        id: 'bi-1',
        accountId: ACCOUNT_ID,
        stripeInvoiceId: 'in_123',
        description: 'Monthly retainer',
        amountCents: 5000,
        currency: 'usd',
        status: 'open',
        hostedInvoiceUrl: 'https://invoice.stripe.com/in_123',
        createdBy: 'admin-1',
        createdAt: '2026-11-11T00:00:00Z',
        updatedAt: '2026-11-11T00:00:00Z',
      },
    ])
    nextResults = [[{ stripe_customer_id: 'cus_1', mode: 'included' }], [{ reported: 0, not_reported: 0 }]]

    const view = await loadClientBillingView(ACCOUNT_ID, NOW)

    expect(invoiceMocks.listAccountInvoices).toHaveBeenCalledWith(ACCOUNT_ID)
    expect(view.invoices).toHaveLength(1)
    expect(view.invoices[0]!.description).toBe('Monthly retainer')
  })

  it('counts nothing as billed when the usage read returns no row', async () => {
    nextResults = [[{ stripe_customer_id: 'cus_1', mode: 'metered' }], []]

    const view = await loadClientBillingView(ACCOUNT_ID, NOW)

    expect(view.reportedFixPacks).toBe(0)
    expect(view.notReportedFixPacks).toBe(0)
  })
})
