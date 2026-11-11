import { db } from '@/lib/db'
import { invoiceDaysUntilDue, stripe } from '@/lib/stripe'
import { ensureStripeCustomer, loadBillingAccount } from '@/lib/billing/accounts'

/**
 * Model C: one-off invoices the super admin issues against an account.
 * Design: docs/superpowers/specs/2026-11-11-per-fix-billing-design.md.
 *
 * Stripe is the source of truth for payment; `billing_invoices` is the local
 * mirror that lets the admin and client views render without a Stripe round
 * trip and lets a Stripe outage not erase what was issued. Because a Stripe
 * success followed by a local write failure is possible, the mirror is written
 * with an upsert keyed on `stripe_invoice_id` and can be repaired from Stripe
 * (`mirrorOneOffInvoice`) instead of issuing a second invoice.
 */

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
  | { status: 'mirror_failed'; stripeInvoiceId: string; hostedInvoiceUrl: string | null }

export type MirrorInvoiceOutcome =
  | { status: 'ok'; invoice: BillingInvoiceRow }
  | { status: 'stripe_failed'; code: string }
  | { status: 'not_found' }
  | { status: 'invalid'; code: string }

type StripeInvoiceShape = {
  id: string
  status: string
  hosted_invoice_url?: string | null
  amount_due?: number | null
  amount_total?: number | null
  currency?: string | null
  description?: string | null
  metadata?: Record<string, string> | null
  lines?: { data?: Array<{ description?: string | null }> }
}

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

async function voidInvoiceQuietly(stripeInvoiceId: string): Promise<void> {
  try {
    await stripe.invoices.voidInvoice(stripeInvoiceId)
  } catch (error) {
    // The invoice may already be paid or voided; the failure is logged rather
    // than masking the outcome the caller is about to receive.
    console.error(
      '[billing] failed to void invoice after a failed issue:',
      stripeInvoiceId,
      error instanceof Error ? error.message : 'unknown error',
    )
  }
}

async function writeInvoiceMirror(args: {
  accountId: string
  stripeInvoiceId: string
  description: string
  amountCents: number
  currency: InvoiceCurrency
  status: InvoiceStatus
  hostedInvoiceUrl: string | null
  createdBy: string
}): Promise<BillingInvoiceRow | null> {
  const rows = await db()`
    insert into billing_invoices (
      account_id, stripe_invoice_id, description, amount_cents,
      currency, status, hosted_invoice_url, created_by
    )
    values (
      ${args.accountId}::uuid, ${args.stripeInvoiceId}, ${args.description},
      ${args.amountCents}, ${args.currency}, ${args.status},
      ${args.hostedInvoiceUrl}, ${args.createdBy}::uuid
    )
    on conflict (stripe_invoice_id) do update
      set status = excluded.status,
          hosted_invoice_url = excluded.hosted_invoice_url,
          updated_at = now()
    returning id, account_id, stripe_invoice_id, description, amount_cents,
              currency, status, hosted_invoice_url, created_by, created_at, updated_at
  `
  return mapInvoiceRow(rows[0] as Record<string, unknown> | undefined)
}

/**
 * Issue a one-off invoice and email it through Stripe. Writes nothing when
 * Stripe fails; if Stripe succeeded but the local mirror cannot be written the
 * outcome carries the Stripe id and hosted URL, and the route tells the admin to
 * re-run the mirror instead of re-issuing.
 */
export async function issueOneOffInvoice(input: {
  accountId: string
  description: string
  amountCents: number
  currency: InvoiceCurrency
  createdBy: string
}): Promise<IssueInvoiceOutcome> {
  const account = await loadBillingAccount(input.accountId)
  if (!account) return { status: 'account_not_found' }

  const customer = await ensureStripeCustomer(account)
  if (customer.status !== 'ok') return customer

  let stripeInvoiceId: string | null = null
  let hostedInvoiceUrl: string | null = null
  try {
    const invoice = await stripe.invoices.create({
      customer: customer.customerId,
      collection_method: 'send_invoice',
      days_until_due: invoiceDaysUntilDue(),
      auto_advance: false,
      description: input.description,
      metadata: {
        account_id: account.id,
        source: 'aiso_admin_one_off',
        created_by: input.createdBy,
      },
    }) as unknown as StripeInvoiceShape
    stripeInvoiceId = invoice.id

    await stripe.invoiceItems.create({
      customer: customer.customerId,
      invoice: invoice.id,
      amount: input.amountCents,
      currency: input.currency,
      description: input.description,
    })

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id) as unknown as StripeInvoiceShape
    const sent = await stripe.invoices.sendInvoice(invoice.id) as unknown as StripeInvoiceShape
    hostedInvoiceUrl = sent.hosted_invoice_url ?? finalized.hosted_invoice_url ?? null
  } catch (error) {
    console.error(
      '[billing] one-off invoice issue failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    if (stripeInvoiceId) await voidInvoiceQuietly(stripeInvoiceId)
    return { status: 'stripe_failed', code: 'INVOICE_CREATE_FAILED' }
  }
  if (!stripeInvoiceId) return { status: 'stripe_failed', code: 'INVOICE_CREATE_FAILED' }

  try {
    const mirrored = await writeInvoiceMirror({
      accountId: account.id,
      stripeInvoiceId,
      description: input.description,
      amountCents: input.amountCents,
      currency: input.currency,
      status: 'open',
      hostedInvoiceUrl,
      createdBy: input.createdBy,
    })
    if (!mirrored) return { status: 'mirror_failed', stripeInvoiceId, hostedInvoiceUrl }
    return { status: 'ok', invoice: mirrored }
  } catch (error) {
    console.error(
      '[billing] invoice mirror write failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return { status: 'mirror_failed', stripeInvoiceId, hostedInvoiceUrl }
  }
}

function invoiceDescription(invoice: StripeInvoiceShape): string {
  const candidates = [
    invoice.description,
    invoice.lines?.data?.[0]?.description,
    'AISO one-off invoice',
  ]
  for (const candidate of candidates) {
    const text = typeof candidate === 'string' ? candidate.trim() : ''
    if (text.length >= 3) return text.slice(0, 500)
  }
  return 'AISO one-off invoice'
}

/**
 * Re-read an invoice from Stripe and upsert the local mirror. This is the repair
 * path for a mirror write that failed after Stripe accepted the invoice, and the
 * same shape the webhook uses to keep statuses current.
 */
export async function mirrorOneOffInvoice(stripeInvoiceId: string): Promise<MirrorInvoiceOutcome> {
  let invoice: StripeInvoiceShape
  try {
    const retrieved = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ['lines'] })
    invoice = retrieved as unknown as StripeInvoiceShape
  } catch (error) {
    if (isResourceMissing(error)) return { status: 'not_found' }
    console.error(
      '[billing] invoice retrieve failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return { status: 'stripe_failed', code: 'INVOICE_LOOKUP_FAILED' }
  }

  const metadata = invoice.metadata ?? {}
  const accountId = metadata.account_id
  const createdBy = metadata.created_by
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
    return { status: 'invalid', code: 'INVOICE_METADATA_MISSING' }
  }
  if (typeof createdBy !== 'string' || !UUID_RE.test(createdBy)) {
    return { status: 'invalid', code: 'INVOICE_METADATA_MISSING' }
  }

  const account = await loadBillingAccount(accountId)
  if (!account) return { status: 'not_found' }

  if (!isInvoiceStatus(invoice.status)) {
    return { status: 'invalid', code: 'INVOICE_STATUS_UNSUPPORTED' }
  }
  const currency = invoice.currency
  if (!isInvoiceCurrency(currency)) {
    return { status: 'invalid', code: 'INVOICE_CURRENCY_UNSUPPORTED' }
  }
  const amountCents = invoice.amount_due ?? invoice.amount_total ?? 0
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { status: 'invalid', code: 'INVOICE_AMOUNT_MISSING' }
  }

  try {
    const mirrored = await writeInvoiceMirror({
      accountId,
      stripeInvoiceId: invoice.id,
      description: invoiceDescription(invoice),
      amountCents,
      currency,
      status: invoice.status,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      createdBy,
    })
    if (!mirrored) return { status: 'stripe_failed', code: 'INVOICE_MIRROR_FAILED' }
    return { status: 'ok', invoice: mirrored }
  } catch (error) {
    console.error(
      '[billing] invoice mirror upsert failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return { status: 'stripe_failed', code: 'INVOICE_MIRROR_FAILED' }
  }
}

/**
 * Webhook path: update an existing mirrored one-off invoice's status. Never
 * creates a row — an invoice this app did not issue is not ours to mirror.
 * Returns false when there is no local row (or when the update failed).
 */
export async function updateOneOffInvoiceStatus(args: {
  stripeInvoiceId: string
  status: InvoiceStatus
  hostedInvoiceUrl: string | null
}): Promise<boolean> {
  try {
    const rows = await db()`
      update billing_invoices
         set status = ${args.status},
             hosted_invoice_url = coalesce(${args.hostedInvoiceUrl}, hosted_invoice_url),
             updated_at = now()
       where stripe_invoice_id = ${args.stripeInvoiceId}
      returning id
    `
    return rows.length > 0
  } catch (error) {
    console.error(
      '[billing] invoice status update failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return false
  }
}

/** Invoices for one account, newest first. Account-scoped by construction. */
export async function listAccountInvoices(accountId: string, limit = 50): Promise<BillingInvoiceRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100)
  const rows = await db()`
    select id, account_id, stripe_invoice_id, description, amount_cents,
           currency, status, hosted_invoice_url, created_by, created_at, updated_at
    from billing_invoices
    where account_id = ${accountId}::uuid
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
