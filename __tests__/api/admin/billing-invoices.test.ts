import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  issueOneOffInvoice: vi.fn(),
  mirrorOneOffInvoice: vi.fn(),
  listAccountInvoices: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: mocks.requireApiAdmin }))
vi.mock('@/lib/billing/invoices', () => ({
  MAX_INVOICE_AMOUNT_CENTS: 10_000_000,
  isInvoiceCurrency: (value: unknown) => value === 'usd' || value === 'hkd',
  issueOneOffInvoice: mocks.issueOneOffInvoice,
  mirrorOneOffInvoice: mocks.mirrorOneOffInvoice,
  listAccountInvoices: mocks.listAccountInvoices,
}))

import { GET, POST } from '@/app/api/admin/billing/invoices/route'

const ACCOUNT_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_ID = '99999999-8888-4777-8666-555555555555'

const INVOICE = {
  id: 'bi-1',
  accountId: ACCOUNT_ID,
  stripeInvoiceId: 'in_123',
  description: 'Monthly retainer',
  amountCents: 5000,
  currency: 'usd',
  status: 'open',
  hostedInvoiceUrl: 'https://invoice.stripe.com/in_123',
  createdBy: ADMIN_ID,
  createdAt: '2026-11-11T00:00:00Z',
  updatedAt: '2026-11-11T00:00:00Z',
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/admin/billing/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireApiAdmin.mockResolvedValue({ ok: true, profile: { id: ADMIN_ID, is_admin: true } })
  mocks.issueOneOffInvoice.mockResolvedValue({ status: 'ok', invoice: INVOICE })
  mocks.mirrorOneOffInvoice.mockResolvedValue({ status: 'ok', invoice: INVOICE })
  mocks.listAccountInvoices.mockResolvedValue([INVOICE])
})

describe('POST /api/admin/billing/invoices', () => {
  it('rejects a non-admin before touching invoices', async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    })

    const response = await POST(request({ stripeInvoiceId: 'in_123' }))

    expect(response.status).toBe(403)
    expect(mocks.mirrorOneOffInvoice).not.toHaveBeenCalled()
  })

  it.each([
    ['missing account id', { description: 'Retainer', amountCents: 100, currency: 'usd' }],
    ['non-uuid account id', { accountId: 'brand-1', description: 'Retainer', amountCents: 100, currency: 'usd' }],
    ['short description', { accountId: ACCOUNT_ID, description: ' ab ', amountCents: 100, currency: 'usd' }],
    ['non-integer amount', { accountId: ACCOUNT_ID, description: 'Retainer', amountCents: 10.5, currency: 'usd' }],
    ['zero amount', { accountId: ACCOUNT_ID, description: 'Retainer', amountCents: 0, currency: 'usd' }],
    ['unsupported currency', { accountId: ACCOUNT_ID, description: 'Retainer', amountCents: 100, currency: 'eur' }],
  ])('rejects %s without calling Stripe', async (_label, body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(mocks.issueOneOffInvoice).not.toHaveBeenCalled()
  })

  it('issues an invoice as the session admin', async () => {
    const response = await POST(request({
      accountId: ACCOUNT_ID,
      description: '  Monthly retainer  ',
      amountCents: 5000,
      currency: 'usd',
    }))

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(mocks.issueOneOffInvoice).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      description: 'Monthly retainer',
      amountCents: 5000,
      currency: 'usd',
      createdBy: ADMIN_ID,
    })
  })

  it.each([
    [{ status: 'account_not_found' }, 404],
    [{ status: 'stripe_failed', code: 'INVOICE_CREATE_FAILED' }, 502],
  ])('maps issue outcome %o to %i', async (outcome, expected) => {
    mocks.issueOneOffInvoice.mockResolvedValue(outcome)

    const response = await POST(request({
      accountId: ACCOUNT_ID, description: 'Retainer', amountCents: 100, currency: 'usd',
    }))

    expect(response.status).toBe(expected)
  })

  it('surfaces the Stripe id and hosted URL when only the mirror failed', async () => {
    mocks.issueOneOffInvoice.mockResolvedValue({
      status: 'mirror_failed',
      stripeInvoiceId: 'in_123',
      hostedInvoiceUrl: 'https://invoice.stripe.com/in_123',
    })

    const response = await POST(request({
      accountId: ACCOUNT_ID, description: 'Retainer', amountCents: 100, currency: 'usd',
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'INVOICE_MIRROR_FAILED',
      stripeInvoiceId: 'in_123',
      hostedInvoiceUrl: 'https://invoice.stripe.com/in_123',
    })
  })

  it('repairs the mirror from a Stripe invoice id without issuing another invoice', async () => {
    const response = await POST(request({ stripeInvoiceId: 'in_123' }))

    expect(response.status).toBe(200)
    expect(mocks.mirrorOneOffInvoice).toHaveBeenCalledWith('in_123')
    expect(mocks.issueOneOffInvoice).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'not_found' }, 404],
    [{ status: 'invalid', code: 'INVOICE_METADATA_MISSING' }, 400],
    [{ status: 'stripe_failed', code: 'INVOICE_MIRROR_FAILED' }, 502],
  ])('maps mirror outcome %o to %i', async (outcome, expected) => {
    mocks.mirrorOneOffInvoice.mockResolvedValue(outcome)

    const response = await POST(request({ stripeInvoiceId: 'in_123' }))

    expect(response.status).toBe(expected)
  })

  it('rejects a non-invoice Stripe id for the mirror path', async () => {
    const response = await POST(request({ stripeInvoiceId: 'sub_123' }))
    expect(response.status).toBe(400)
    expect(mocks.mirrorOneOffInvoice).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/billing/invoices', () => {
  it('lists an account\'s invoices', async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/billing/invoices?accountId=${ACCOUNT_ID}`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ invoices: [INVOICE] })
    expect(mocks.listAccountInvoices).toHaveBeenCalledWith(ACCOUNT_ID)
  })

  it('rejects a missing or malformed account id', async () => {
    await expect(GET(new Request('http://localhost/api/admin/billing/invoices')))
      .resolves.toMatchObject({ status: 400 })
    await expect(GET(new Request('http://localhost/api/admin/billing/invoices?accountId=nope')))
      .resolves.toMatchObject({ status: 400 })
  })
})
