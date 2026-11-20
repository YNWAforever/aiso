import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { invoiceDaysUntilDue, stripe } from '@/lib/stripe'
import { ensureStripeCustomer, loadBillingAccount } from '@/lib/billing/accounts'
import { canRetryStripeCreate } from './stripe-attempts'

export type InvoiceCurrency = 'usd' | 'hkd'
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export type BillingInvoiceRow = {
  id: string
  accountId: string
  stripeInvoiceId: string | null
  description: string
  amountCents: number
  currency: InvoiceCurrency
  status: InvoiceStatus
  hostedInvoiceUrl: string | null
  createdBy: string
  createdAt: string | Date
  updatedAt: string | Date
}

export type IssueInvoiceOutcome =
  | { status: 'ok'; invoice: BillingInvoiceRow }
  | { status: 'account_not_found' }
  | { status: 'stripe_failed'; code: string }
  | { status: 'pending' | 'conflict' | 'needs_reconciliation' }

export type MirrorInvoiceOutcome =
  | { status: 'ok'; invoice: BillingInvoiceRow }
  | { status: 'stripe_failed'; code: string }
  | { status: 'not_found' | 'pending' }
  | { status: 'invalid'; code: string }

const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'draft', 'open', 'paid', 'void', 'uncollectible',
]

export function isInvoiceCurrency(value: unknown): value is InvoiceCurrency {
  return value === 'usd' || value === 'hkd'
}

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value)
}

export const MAX_INVOICE_AMOUNT_CENTS = 10_000_000

function mapInvoiceRow(row: Record<string, unknown> | undefined): BillingInvoiceRow | null {
  if (!row) return null
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    stripeInvoiceId: (row.stripe_invoice_id as string | null) ?? null,
    description: row.description as string,
    amountCents: Number(row.amount_cents),
    currency: row.currency as InvoiceCurrency,
    status: row.status as InvoiceStatus,
    hostedInvoiceUrl: (row.hosted_invoice_url as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string | Date,
    updatedAt: row.updated_at as string | Date,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INVOICE_SOURCE = 'aiso_admin_one_off'
const DRAFT_CREATED = 1
const ITEM_ADDED = 2
const FINALIZED = 3
const ISSUED = 4

type InvoiceRow = Record<string, unknown> & {
  id: string; account_id: string; request_id: string | null; issue_stage: number; issue_days_until_due: number | null;
  created_by: string; created_at: string | Date; stripe_invoice_id: string | null;
  currency: InvoiceCurrency; description: string; amount_cents: number;
}

async function withInvoiceLease<T>(accountId: string, id: string, run: (owner: string, row: InvoiceRow) => Promise<T>): Promise<T | null> {
  const sql = db()
  const owner = randomUUID()
  const [row] = await sql`
    update billing_invoices set issue_lease_owner = ${owner}::uuid, issue_lease_until = clock_timestamp() + interval '5 minutes'
    where account_id = ${accountId}::uuid and id = ${id}::uuid
      and (issue_lease_until is null or issue_lease_until <= clock_timestamp())
    returning *
  `
  if (!row) return null
  try {
    return await run(owner, row as InvoiceRow)
  } finally {
    try {
      await sql`update billing_invoices set issue_lease_owner = null, issue_lease_until = null
        where account_id = ${accountId}::uuid and id = ${id}::uuid and issue_lease_owner = ${owner}::uuid`
    } catch {
      console.error('[billing] invoice lease release failed')
    }
  }
}

async function saveInvoiceStage(row: InvoiceRow, owner: string, stage: number, invoice: Stripe.Invoice | null) {
  if (invoice && (invoice.currency !== row.currency || !isInvoiceStatus(invoice.status)
    || (invoice.status !== 'draft' && invoice.total !== Number(row.amount_cents)))) {
    throw new Error('Stripe invoice details mismatch')
  }
  const [updated] = await db()`
    update billing_invoices set issue_stage = greatest(issue_stage, ${stage}),
      stripe_invoice_id = coalesce(stripe_invoice_id, ${invoice?.id ?? null}),
      status = coalesce(${invoice?.status ?? null}, status),
      hosted_invoice_url = coalesce(${invoice?.hosted_invoice_url ?? null}, hosted_invoice_url), updated_at = now()
    where account_id = ${row.account_id}::uuid and id = ${row.id}::uuid
      and issue_lease_owner = ${owner}::uuid and issue_lease_until > clock_timestamp()
      and (${invoice?.id ?? null}::text is null or stripe_invoice_id is null or stripe_invoice_id = ${invoice?.id ?? null})
    returning *
  `
  if (!updated) throw new Error('Invoice lease or Stripe linkage changed')
  return updated as InvoiceRow
}

export async function issueOneOffInvoice(input: {
  accountId: string
  requestId: string
  description: string
  amountCents: number
  currency: InvoiceCurrency
  createdBy: string
}): Promise<IssueInvoiceOutcome> {
  const account = await loadBillingAccount(input.accountId)
  if (!account) return { status: 'account_not_found' }
  const sql = db()
  const [, [entry]] = await sql.transaction([
    sql`insert into billing_invoices (account_id, request_id, description, amount_cents, currency, created_by, issue_days_until_due)
        values (${input.accountId}::uuid, ${input.requestId}::uuid, ${input.description}, ${input.amountCents},
          ${input.currency}, ${input.createdBy}::uuid, ${invoiceDaysUntilDue()})
        on conflict (account_id, request_id) do nothing`,
    sql`select * from billing_invoices where account_id = ${input.accountId}::uuid and request_id = ${input.requestId}::uuid`,
  ])
  if (!entry) throw new Error('Invoice request was not stored')
  if (entry.description !== input.description || Number(entry.amount_cents) !== input.amountCents || entry.currency !== input.currency) {
    return { status: 'conflict' }
  }
  if (entry.issue_stage === ISSUED) return { status: 'ok', invoice: mapInvoiceRow(entry)! }

  try {
    const result = await withInvoiceLease<IssueInvoiceOutcome>(input.accountId, entry.id, async (owner, initial) => {
      let row = initial
      if (row.issue_stage === ISSUED) return { status: 'ok', invoice: mapInvoiceRow(row)! }
      if (!canRetryStripeCreate(row.created_at)) return { status: 'needs_reconciliation' }
      const customer = await ensureStripeCustomer(account)
      if (customer.status !== 'ok') return customer
      const stripeKey = (stage: string) => ({ idempotencyKey: `aiso:invoice:${row.id}:${stage}` })
      if (!row.stripe_invoice_id) {
        const invoice = await stripe.invoices.create({
          customer: customer.customerId,
          currency: row.currency,
          collection_method: 'send_invoice',
          days_until_due: row.issue_days_until_due!,
          auto_advance: false,
          pending_invoice_items_behavior: 'exclude',
          description: row.description,
          metadata: { account_id: row.account_id, created_by: row.created_by, source: INVOICE_SOURCE, aiso_operation: row.id },
        }, stripeKey('draft'))
        row = await saveInvoiceStage(row, owner, DRAFT_CREATED, invoice)
      }
      const invoiceId = row.stripe_invoice_id!
      if (row.issue_stage < ITEM_ADDED) {
        await stripe.invoiceItems.create({
          customer: customer.customerId, invoice: invoiceId, amount: Number(row.amount_cents),
          currency: row.currency, description: row.description,
        }, stripeKey('line'))
        row = await saveInvoiceStage(row, owner, ITEM_ADDED, null)
      }
      let canonical = await stripe.invoices.retrieve(invoiceId)
      if (canonical.currency !== row.currency || canonical.total !== Number(row.amount_cents)) {
        return { status: 'needs_reconciliation' }
      }
      if (canonical.status === 'draft') {
        canonical = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false }, stripeKey('finalize'))
      }
      if (canonical.currency !== row.currency || canonical.total !== Number(row.amount_cents)
        || canonical.id !== invoiceId || canonical.status === 'draft') return { status: 'needs_reconciliation' }
      row = await saveInvoiceStage(row, owner, FINALIZED, canonical)
      if (canonical.status === 'open') {
        await stripe.invoices.sendInvoice(invoiceId, {}, stripeKey('send'))
        canonical = await stripe.invoices.retrieve(invoiceId)
      }
      row = await saveInvoiceStage(row, owner, ISSUED, canonical)
      return { status: 'ok', invoice: mapInvoiceRow(row)! }
    })
    return result ?? { status: 'pending' }
  } catch {
    console.error('[billing] invoice issue step could not be confirmed')
    return { status: 'stripe_failed', code: 'INVOICE_ISSUE_RETRY' }
  }
}

function invoiceDescription(invoice: Stripe.Invoice): string {
  const text = (invoice.description ?? invoice.lines?.data[0]?.description ?? '').trim()
  return text.length >= 3 ? text.slice(0, 500) : 'AISO one-off invoice'
}

/** Locate the row from a Stripe ID and resolve the latest state under its lease. */
export async function mirrorOneOffInvoice(stripeInvoiceId: string, webhookHint?: { issued: boolean }): Promise<MirrorInvoiceOutcome> {
  const sql = db()
  let [row] = await sql`select id, account_id from billing_invoices where stripe_invoice_id = ${stripeInvoiceId}`
  if (!row && webhookHint && !webhookHint.issued) return { status: 'not_found' }

  try {
    if (!row) {
      const invoice = await stripe.invoices.retrieve(stripeInvoiceId)
      const metadata = invoice.metadata ?? {}
      const accountId = metadata.account_id
      const createdBy = metadata.created_by
      const operationId = metadata.aiso_operation
      if (metadata.source !== INVOICE_SOURCE || !UUID_RE.test(accountId ?? '') || !UUID_RE.test(createdBy ?? '')) {
        return { status: 'invalid', code: 'INVOICE_METADATA_MISSING' }
      }
      const account = await loadBillingAccount(accountId)
      if (!account) return { status: 'not_found' }
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
      if (customerId !== account.stripe_customer_id) return { status: 'invalid', code: 'INVOICE_CUSTOMER_MISMATCH' }
      if (operationId) {
        if (!UUID_RE.test(operationId)) return { status: 'invalid', code: 'INVOICE_METADATA_MISSING' }
        const [reserved] = await sql`select id, account_id from billing_invoices
          where account_id = ${accountId}::uuid and id = ${operationId}::uuid and request_id is not null`
        row = reserved
        if (!row) return { status: 'pending' }
      } else {
        const amount = invoice.total
        if (!isInvoiceCurrency(invoice.currency) || !isInvoiceStatus(invoice.status) || !Number.isInteger(amount) || amount <= 0) {
          return { status: 'invalid', code: 'INVOICE_DETAILS_UNSUPPORTED' }
        }
        const [, [inserted]] = await sql.transaction([
          sql`insert into billing_invoices (account_id, stripe_invoice_id, description, amount_cents,
                currency, status, hosted_invoice_url, created_by)
              values (${accountId}::uuid, ${stripeInvoiceId}, ${invoiceDescription(invoice)}, ${amount}, ${invoice.currency},
                ${invoice.status}, ${invoice.hosted_invoice_url}, ${createdBy}::uuid)
              on conflict (stripe_invoice_id) do nothing`,
          sql`select id, account_id from billing_invoices where stripe_invoice_id = ${stripeInvoiceId} and account_id = ${accountId}::uuid`,
        ])
        row = inserted
        if (!row) return { status: 'stripe_failed', code: 'INVOICE_LINK_FAILED' }
      }
    }

    const result = await withInvoiceLease<MirrorInvoiceOutcome>(row.account_id, row.id, async (owner, current) => {
      const invoice = await stripe.invoices.retrieve(stripeInvoiceId)
      const settled = invoice.status === 'paid' || invoice.status === 'void' || invoice.status === 'uncollectible'
      const stage = current.request_id ? (settled ? ISSUED : DRAFT_CREATED) : 0
      const linked = await saveInvoiceStage(current, owner, stage, invoice)
      return { status: 'ok', invoice: mapInvoiceRow(linked)! }
    })
    return result ?? { status: 'pending' }
  } catch (error) {
    if (!row && !webhookHint && isResourceMissing(error)) return { status: 'not_found' }
    console.error('[billing] invoice reconciliation failed')
    return { status: 'stripe_failed', code: 'INVOICE_MIRROR_FAILED' }
  }
}

export async function listUnfinishedInvoices(accountId: string) {
  const rows = await db()`select id, account_id, request_id, stripe_invoice_id, description, amount_cents, currency,
    issue_stage, created_at from billing_invoices
    where account_id = ${accountId}::uuid and request_id is not null and issue_stage < ${ISSUED}
    order by created_at desc limit 100`
  return (rows as InvoiceRow[]).map(row => ({
    id: row.id, requestId: row.request_id, stripeInvoiceId: row.stripe_invoice_id, description: row.description,
    amountCents: Number(row.amount_cents), currency: row.currency, stage: row.issue_stage, createdAt: row.created_at,
    needsReconciliation: !canRetryStripeCreate(row.created_at),
  }))
}

/** Invoices for one account, newest first. Account-scoped by construction. */
export async function listAccountInvoices(accountId: string, limit = 50): Promise<BillingInvoiceRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100)
  const rows = await db()`
    select id, account_id, stripe_invoice_id, description, amount_cents,
           currency, status, hosted_invoice_url, created_by, created_at, updated_at
    from billing_invoices
    where account_id = ${accountId}::uuid and (request_id is null or status <> 'draft')
    order by created_at desc
    limit ${bounded}
  `
  return (rows as Record<string, unknown>[])
    .map(row => mapInvoiceRow(row))
    .filter((row): row is BillingInvoiceRow => row !== null)
}

function isResourceMissing(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'resource_missing'
  )
}
