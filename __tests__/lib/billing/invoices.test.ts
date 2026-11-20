import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLaunchBillingDb } from '../../helpers/launch-billing-db'

const h = vi.hoisted(() => ({ db: vi.fn(), create: vi.fn(), item: vi.fn(), retrieve: vi.fn(), finalize: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/stripe', () => ({
  invoiceDaysUntilDue: () => 14,
  stripe: { invoices: { create: h.create, retrieve: h.retrieve, finalizeInvoice: h.finalize, sendInvoice: h.send }, invoiceItems: { create: h.item } },
}))

import { issueOneOffInvoice, listAccountInvoices, listUnfinishedInvoices, mirrorOneOffInvoice } from '@/lib/billing/invoices'

const accountId = '11111111-2222-4333-8444-555555555555'
const createdBy = '99999999-8888-4777-8666-555555555555'
const requestId = '88888888-8888-4888-8888-555555555555'
const base = { accountId, createdBy, requestId, description: 'Retainer draft', amountCents: 5000, currency: 'hkd' as const }
const stripeId = 'in_launch_test'
type Invoice = { id: string; currency: string; total: number; status: string; metadata: Record<string, string>; customer: string; hosted_invoice_url: string | null }
let latest: Invoice
let fixture: Awaited<ReturnType<typeof createLaunchBillingDb>>

beforeAll(async () => { fixture = await createLaunchBillingDb() })
afterAll(async () => { await fixture?.pg.close() })
beforeEach(async () => {
  vi.resetAllMocks()
  h.db.mockReturnValue(fixture.sql)
  await fixture.pg.exec('truncate accounts cascade')
  await fixture.pg.query("insert into accounts(id,stripe_customer_id) values($1,'cus_fixture')", [accountId])
  h.create.mockImplementation(async params => {
    latest = { id: stripeId, currency: params.currency, total: 0, status: 'draft', metadata: params.metadata,
      customer: params.customer, hosted_invoice_url: null }
    return { ...latest }
  })
  h.retrieve.mockImplementation(async () => ({ ...latest }))
  h.item.mockImplementation(async params => { latest.total += params.amount })
  h.finalize.mockImplementation(async () => {
    latest.status = 'open'
    latest.hosted_invoice_url = 'https://invoice.stripe.test/fixture'
    return { ...latest }
  })
  h.send.mockImplementation(async () => ({ ...latest }))
})

describe('one-off invoice issue and reconciliation', () => {
  it.each(['hkd', 'usd'] as const)('records the %s draft before finalizing and replays the original request', async currency => {
    h.finalize.mockImplementationOnce(async () => {
      expect(await listUnfinishedInvoices(accountId)).toMatchObject([{ stripeInvoiceId: stripeId, stage: 2 }])
      const result = await mirrorOneOffInvoice(stripeId, { issued: true })
      expect(result).toEqual({ status: 'pending' })
      latest.status = 'open'
      return { ...latest }
    })
    const input = { ...base, currency }
    const issued = await issueOneOffInvoice(input)
    expect(issued).toMatchObject({ status: 'ok', invoice: { currency, status: 'open', stripeInvoiceId: stripeId } })
    expect(await issueOneOffInvoice(input)).toEqual(issued)
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ currency }), expect.objectContaining({ idempotencyKey: expect.stringMatching(/:draft$/) }))
    expect(h.item).toHaveBeenCalledWith(expect.objectContaining({ currency, amount: 5000 }), expect.objectContaining({ idempotencyKey: expect.stringMatching(/:line$/) }))
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(await issueOneOffInvoice({ ...input, amountCents: 6000 })).toEqual({ status: 'conflict' })
  })

  it('observes payment during issuance and resolves a late event against the canonical paid invoice', async () => {
    h.send.mockImplementationOnce(async () => { latest.status = 'paid'; return { ...latest } })
    expect(await issueOneOffInvoice(base)).toMatchObject({ status: 'ok', invoice: { status: 'paid' } })
    expect(await mirrorOneOffInvoice(stripeId, { issued: true })).toMatchObject({ status: 'ok', invoice: { status: 'paid' } })
    expect(await listAccountInvoices(accountId)).toMatchObject([{ status: 'paid' }])
  })

  it('keeps the same draft idempotency key after a lost Stripe response', async () => {
    const creation = h.create.getMockImplementation()!
    h.create.mockImplementationOnce(async (...args) => { await creation(...args); throw new Error('lost response') })
    h.create.mockImplementationOnce(async () => ({ ...latest }))
    expect(await issueOneOffInvoice(base)).toMatchObject({ status: 'stripe_failed' })
    expect(await issueOneOffInvoice(base)).toMatchObject({ status: 'ok' })
    expect(h.create.mock.calls[0][1]).toEqual(h.create.mock.calls[1][1])
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('detects a currency mismatch before any line or email is created', async () => {
    h.create.mockResolvedValueOnce({ id: stripeId, currency: 'usd', status: 'draft' })
    expect(await issueOneOffInvoice(base)).toMatchObject({ status: 'stripe_failed' })
    expect(h.item).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(await listAccountInvoices(accountId)).toEqual([])
  })

  it('requires reconciliation of a stale unfinished operation', async () => {
    h.create.mockRejectedValueOnce(new Error('uncertain result'))
    await issueOneOffInvoice(base)
    await fixture.pg.exec("update billing_invoices set created_at = now() - interval '25 hours'")
    await expect(issueOneOffInvoice(base)).resolves.toEqual({ status: 'needs_reconciliation' })
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('repairs a legacy mirror but ignores an unrelated invoice event', async () => {
    latest = { id: stripeId, status: 'paid', total: 5000, currency: 'hkd', hosted_invoice_url: null,
      customer: 'cus_fixture', metadata: { account_id: accountId, created_by: createdBy, source: 'aiso_admin_one_off' } }
    await expect(mirrorOneOffInvoice('in_unrelated', { issued: false })).resolves.toEqual({ status: 'not_found' })
    expect(h.retrieve).not.toHaveBeenCalled()
    await expect(mirrorOneOffInvoice(stripeId)).resolves.toMatchObject({ status: 'ok', invoice: { status: 'paid', amountCents: 5000 } })
    expect(await listAccountInvoices(accountId)).toHaveLength(1)
  })
})
