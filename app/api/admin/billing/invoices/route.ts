import { NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import {
  MAX_INVOICE_AMOUNT_CENTS,
  isInvoiceCurrency,
  issueOneOffInvoice,
  listAccountInvoices,
  listUnfinishedInvoices,
  mirrorOneOffInvoice,
} from '@/lib/billing/invoices'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STRIPE_ID_RE = /^in_[A-Za-z0-9_]+$/

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

/** Issue or resume an invoice by request ID, or reconcile its Stripe mirror by invoice ID. */
export async function POST(request: Request): Promise<Response> {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return badRequest('Invalid JSON')

  const { accountId, description, amountCents, currency, stripeInvoiceId, requestId } = body as {
    accountId?: unknown
    description?: unknown
    amountCents?: unknown
    currency?: unknown
    stripeInvoiceId?: unknown
    requestId?: unknown
  }

  if (stripeInvoiceId !== undefined) {
    if (typeof stripeInvoiceId !== 'string' || !STRIPE_ID_RE.test(stripeInvoiceId)) {
      return badRequest('stripeInvoiceId must be a Stripe invoice id')
    }
    try {
      const outcome = await mirrorOneOffInvoice(stripeInvoiceId)
      if (outcome.status === 'ok') {
        return NextResponse.json({ ok: true, invoice: outcome.invoice })
      }
      if (outcome.status === 'not_found') {
        return NextResponse.json({ error: 'INVOICE_NOT_FOUND' }, { status: 404 })
      }
      if (outcome.status === 'invalid') {
        return NextResponse.json({ error: outcome.code }, { status: 400 })
      }
      if (outcome.status === 'pending') return NextResponse.json({ error: 'INVOICE_BUSY' }, { status: 503 })
      return NextResponse.json({ error: outcome.status === 'stripe_failed' ? outcome.code : 'INVOICE_MIRROR_FAILED' }, { status: 502 })
    } catch (error) {
      console.error(
        '[admin/billing] invoice mirror failed:',
        error instanceof Error ? error.message : 'unknown error',
      )
      return NextResponse.json({ error: 'Invoice mirror failed' }, { status: 500 })
    }
  }

  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
    return badRequest('accountId must be a uuid')
  }
  const trimmedDescription = typeof description === 'string' ? description.trim() : ''
  if (trimmedDescription.length < 3 || trimmedDescription.length > 500) {
    return badRequest('description must be between 3 and 500 characters')
  }
  if (
    typeof amountCents !== 'number'
    || !Number.isInteger(amountCents)
    || amountCents <= 0
    || amountCents > MAX_INVOICE_AMOUNT_CENTS
  ) {
    return badRequest(`amountCents must be an integer between 1 and ${MAX_INVOICE_AMOUNT_CENTS}`)
  }
  if (!isInvoiceCurrency(currency)) {
    return badRequest('currency must be usd or hkd')
  }

  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    return badRequest('requestId must be a uuid')
  }

  let outcome
  try {
    outcome = await issueOneOffInvoice({
      accountId,
      requestId,
      description: trimmedDescription,
      amountCents,
      currency,
      createdBy: admin.profile.id,
    })
  } catch (error) {
    // A thrown failure means the issue did not complete; never report 201.
    console.error(
      '[admin/billing] one-off invoice failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Invoice issue failed' }, { status: 500 })
  }

  switch (outcome.status) {
    case 'ok':
      return NextResponse.json({ ok: true, invoice: outcome.invoice }, { status: 201 })
    case 'account_not_found':
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    case 'stripe_failed':
      return NextResponse.json({ error: outcome.code }, { status: 502 })
    case 'pending':
      return NextResponse.json({ error: 'INVOICE_BUSY' }, { status: 503, headers: { 'Retry-After': '5' } })
    case 'conflict':
      return NextResponse.json({ error: 'INVOICE_REQUEST_CONFLICT' }, { status: 409 })
    case 'needs_reconciliation':
      return NextResponse.json({ error: 'INVOICE_RECONCILIATION_REQUIRED' }, { status: 409 })
  }
}

/** List one account's mirrored invoices, newest first. */
export async function GET(request: Request): Promise<Response> {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const accountId = new URL(request.url).searchParams.get('accountId')
  if (!accountId || !UUID_RE.test(accountId)) {
    return badRequest('accountId must be a uuid')
  }

  try {
    const [invoices, unfinished] = await Promise.all([listAccountInvoices(accountId), listUnfinishedInvoices(accountId)])
    return NextResponse.json({ invoices, unfinished })
  } catch (error) {
    console.error(
      '[admin/billing] invoice list failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Failed to list invoices' }, { status: 500 })
  }
}
