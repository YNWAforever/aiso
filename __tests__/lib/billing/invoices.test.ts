import { beforeEach, describe, expect, it, vi } from 'vitest'

const queries: string[] = []
let nextResults: Array<unknown[] | Error> = []

const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) return Promise.reject(result)
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceItemCreate: vi.fn(),
  invoiceFinalize: vi.fn(),
  invoiceSend: vi.fn(),
  invoiceVoid: vi.fn(),
  invoiceRetrieve: vi.fn(),
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { create: stripeMock.customersCreate },
    invoices: {
      create: stripeMock.invoiceCreate,
      finalizeInvoice: stripeMock.invoiceFinalize,
      sendInvoice: stripeMock.invoiceSend,
      voidInvoice: stripeMock.invoiceVoid,
      retrieve: stripeMock.invoiceRetrieve,
    },
    invoiceItems: { create: stripeMock.invoiceItemCreate },
  },
  invoiceDaysUntilDue: () => 14,
}))

const accountsMock = vi.hoisted(() => ({
  loadBillingAccount: vi.fn(),
  ensureStripeCustomer: vi.fn(),
}))

vi.mock('@/lib/billing/accounts', () => accountsMock)

import {
  issueOneOffInvoice,
  listAccountInvoices,
  mirrorOneOffInvoice,
  updateOneOffInvoiceStatus,
} from '@/lib/billing/invoices'

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

const INVOICE_ROW = {
  id: 'bi-1',
  account_id: ACCOUNT_ID,
  stripe_invoice_id: 'in_123',
  description: 'Monthly retainer',
  amount_cents: 5000,
  currency: 'usd',
  status: 'open',
  hosted_invoice_url: 'https://invoice.stripe.com/in_123',
  created_by: ADMIN_ID,
  created_at: '2026-11-11T00:00:00Z',
  updated_at: '2026-11-11T00:00:00Z',
}

function lastQueryParams(): unknown[] {
  const [, ...params] = sqlMock.mock.calls.at(-1)!
  return params
}

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  nextResults = []
  accountsMock.loadBillingAccount.mockResolvedValue(ACCOUNT)
  accountsMock.ensureStripeCustomer.mockResolvedValue({ status: 'ok', customerId: 'cus_1' })
  stripeMock.invoiceCreate.mockResolvedValue({ id: 'in_123' })
  stripeMock.invoiceItemCreate.mockResolvedValue({ id: 'ii_1' })
  stripeMock.invoiceFinalize.mockResolvedValue({
    id: 'in_123', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/in_123',
  })
  stripeMock.invoiceSend.mockResolvedValue({
    id: 'in_123', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/in_123',
  })
  stripeMock.invoiceVoid.mockResolvedValue({ id: 'in_123', status: 'void' })
})

describe('issueOneOffInvoice', () => {
  it('returns account_not_found without touching Stripe', async () => {
    accountsMock.loadBillingAccount.mockResolvedValue(null)

    const outcome = await issueOneOffInvoice({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })

    expect(outcome).toEqual({ status: 'account_not_found' })
    expect(stripeMock.invoiceCreate).not.toHaveBeenCalled()
  })

  it('creates, finalizes and sends a send-invoice one-off invoice, then mirrors it', async () => {
    nextResults = [[INVOICE_ROW]]

    const outcome = await issueOneOffInvoice({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })

    expect(outcome.status).toBe('ok')
    expect(stripeMock.invoiceCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      description: 'Monthly retainer',
      metadata: {
        account_id: ACCOUNT_ID,
        source: 'aiso_admin_one_off',
        created_by: ADMIN_ID,
      },
    })
    expect(stripeMock.invoiceItemCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      invoice: 'in_123',
      amount: 5000,
      currency: 'usd',
      description: 'Monthly retainer',
    })
    expect(stripeMock.invoiceFinalize).toHaveBeenCalledWith('in_123')
    expect(stripeMock.invoiceSend).toHaveBeenCalledWith('in_123')
    expect(queries[0]).toMatch(/insert into billing_invoices/i)
    expect(lastQueryParams()).toEqual([
      ACCOUNT_ID, 'in_123', 'Monthly retainer', 5000, 'usd', 'open',
      'https://invoice.stripe.com/in_123', ADMIN_ID,
    ])
  })

  it('writes nothing and reports the failure when Stripe rejects the invoice', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stripeMock.invoiceCreate.mockRejectedValue(new Error('stripe down'))

    const outcome = await issueOneOffInvoice({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })

    expect(outcome).toEqual({ status: 'stripe_failed', code: 'INVOICE_CREATE_FAILED' })
    expect(queries).toHaveLength(0)
    expect(stripeMock.invoiceVoid).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('voids the invoice it created when sending fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stripeMock.invoiceSend.mockRejectedValue(new Error('send failed'))

    const outcome = await issueOneOffInvoice({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })

    expect(outcome).toEqual({ status: 'stripe_failed', code: 'INVOICE_CREATE_FAILED' })
    expect(stripeMock.invoiceVoid).toHaveBeenCalledWith('in_123')
    expect(queries).toHaveLength(0)
    consoleError.mockRestore()
  })

  it('reports the Stripe id when the local mirror cannot be written', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    nextResults = [new Error('db unavailable')]

    const outcome = await issueOneOffInvoice({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })

    expect(outcome).toEqual({
      status: 'mirror_failed',
      stripeInvoiceId: 'in_123',
      hostedInvoiceUrl: 'https://invoice.stripe.com/in_123',
    })
    expect(stripeMock.invoiceVoid).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('mirrorOneOffInvoice', () => {
  it('upserts the mirror from the canonical Stripe invoice', async () => {
    stripeMock.invoiceRetrieve.mockResolvedValue({
      id: 'in_123',
      status: 'paid',
      amount_due: 5000,
      currency: 'usd',
      hosted_invoice_url: 'https://invoice.stripe.com/in_123',
      description: 'Monthly retainer',
      metadata: { account_id: ACCOUNT_ID, created_by: ADMIN_ID },
      lines: { data: [{ description: 'Monthly retainer' }] },
    })
    nextResults = [[{ ...INVOICE_ROW, status: 'paid' }]]

    const outcome = await mirrorOneOffInvoice('in_123')

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') expect(outcome.invoice.status).toBe('paid')
    expect(stripeMock.invoiceRetrieve).toHaveBeenCalledWith('in_123', { expand: ['lines'] })
    const upsert = queries[0]!
    expect(upsert).toMatch(/on conflict \(stripe_invoice_id\) do update/i)
    expect(lastQueryParams()).toEqual([
      ACCOUNT_ID, 'in_123', 'Monthly retainer', 5000, 'usd', 'paid',
      'https://invoice.stripe.com/in_123', ADMIN_ID,
    ])
  })

  it('returns not_found for a Stripe invoice that does not exist', async () => {
    stripeMock.invoiceRetrieve.mockRejectedValue(Object.assign(new Error('missing'), { code: 'resource_missing' }))

    await expect(mirrorOneOffInvoice('in_missing')).resolves.toEqual({ status: 'not_found' })
    expect(queries).toHaveLength(0)
  })

  it('refuses to mirror an invoice this app did not create', async () => {
    stripeMock.invoiceRetrieve.mockResolvedValue({
      id: 'in_123', status: 'open', amount_due: 100, currency: 'usd', metadata: {},
    })

    await expect(mirrorOneOffInvoice('in_123')).resolves.toEqual({
      status: 'invalid',
      code: 'INVOICE_METADATA_MISSING',
    })
    expect(queries).toHaveLength(0)
  })

  it('refuses an unsupported currency rather than writing a row the DB would reject', async () => {
    stripeMock.invoiceRetrieve.mockResolvedValue({
      id: 'in_123', status: 'open', amount_due: 100, currency: 'eur',
      metadata: { account_id: ACCOUNT_ID, created_by: ADMIN_ID },
    })

    await expect(mirrorOneOffInvoice('in_123')).resolves.toEqual({
      status: 'invalid',
      code: 'INVOICE_CURRENCY_UNSUPPORTED',
    })
  })
})

describe('updateOneOffInvoiceStatus', () => {
  it('updates only an existing mirrored row and keeps a missing hosted URL', async () => {
    nextResults = [[{ id: 'bi-1' }]]

    await expect(updateOneOffInvoiceStatus({
      stripeInvoiceId: 'in_123',
      status: 'paid',
      hostedInvoiceUrl: null,
    })).resolves.toBe(true)

    expect(queries[0]).toMatch(/update billing_invoices/i)
    expect(queries[0]).toMatch(/where stripe_invoice_id =/i)
    expect(lastQueryParams()).toEqual(['paid', null, 'in_123'])
  })

  it('returns false when no local row matches (a Stripe invoice this app did not issue)', async () => {
    nextResults = [[]]
    await expect(updateOneOffInvoiceStatus({
      stripeInvoiceId: 'in_other', status: 'paid', hostedInvoiceUrl: null,
    })).resolves.toBe(false)
  })
})

describe('listAccountInvoices', () => {
  it('reads the account\'s invoices newest first with a bounded limit', async () => {
    nextResults = [[INVOICE_ROW]]

    const invoices = await listAccountInvoices(ACCOUNT_ID, 500)

    expect(invoices).toHaveLength(1)
    expect(queries[0]).toMatch(/where account_id =/i)
    expect(lastQueryParams()).toEqual([ACCOUNT_ID, 100])
  })
})
