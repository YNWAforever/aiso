import { NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { openAccountBilling, type BillingMode } from '@/lib/billing/accounts'
import { getCheckoutPlanId } from '@/lib/plans/catalog'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isBillingMode(value: unknown): value is BillingMode {
  return value === 'included' || value === 'metered'
}

/**
 * Open or change an account's billing control. Gated by requireApiAdmin: the
 * account id in the body is the admin's choice, never a caller-supplied tenant
 * scope — the route itself is platform-wide.
 *
 * A metered account needs a subscription to attach the metered price to. When
 * the account has none, the admin must explicitly ask for one
 * (`createSubscription: true`) because that is a real Stripe subscription with
 * a real invoice, not a toggle.
 */
export async function POST(request: Request): Promise<Response> {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { accountId, mode, plan, createSubscription } = body as {
    accountId?: unknown
    mode?: unknown
    plan?: unknown
    createSubscription?: unknown
  }

  if (typeof accountId !== 'string' || !accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  if (!UUID_RE.test(accountId)) {
    return NextResponse.json({ error: 'accountId must be a uuid' }, { status: 400 })
  }
  if (!isBillingMode(mode)) {
    return NextResponse.json(
      { error: "mode must be 'included' or 'metered'" }, { status: 400 },
    )
  }
  if (createSubscription !== undefined && typeof createSubscription !== 'boolean') {
    return NextResponse.json({ error: 'createSubscription must be a boolean' }, { status: 400 })
  }

  let resolvedPlan = undefined
  if (plan !== undefined) {
    const candidate = getCheckoutPlanId(plan)
    if (!candidate) {
      return NextResponse.json({ error: 'plan must be basic, pro or enterprise' }, { status: 400 })
    }
    resolvedPlan = candidate
  }

  let outcome
  try {
    outcome = await openAccountBilling({
      accountId,
      mode,
      plan: resolvedPlan,
      createSubscription: createSubscription === true,
      openedBy: admin.profile.id,
    })
  } catch (error) {
    // A failure to even attempt the operation must not read as success: the
    // caller retries, and idempotency lives in lib/billing/accounts.ts.
    console.error(
      '[admin/billing] open account billing failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Billing control failed' }, { status: 500 })
  }

  switch (outcome.status) {
    case 'ok':
      return NextResponse.json({
        ok: true,
        billing: {
          accountId: outcome.billing.accountId,
          mode: outcome.billing.mode,
          stripeCustomerId: outcome.billing.stripeCustomerId,
          stripeSubscriptionId: outcome.billing.stripeSubscriptionId,
          stripeMeteredItemId: outcome.billing.stripeMeteredItemId,
          openedAt: outcome.billing.openedAt,
          updatedAt: outcome.billing.updatedAt,
        },
      })
    case 'account_not_found':
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    case 'metered_not_configured':
      // Honest failure: without the metered price/event there is nothing to
      // attach, and pretending otherwise would attach a free line.
      return NextResponse.json(
        {
          error: 'METERED_NOT_CONFIGURED',
          message: 'STRIPE_PRICE_FIX_METERED and STRIPE_FIX_METER_EVENT_NAME must be set before metered billing can be opened.',
        },
        { status: 503 },
      )
    case 'subscription_required':
      return NextResponse.json(
        {
          error: 'SUBSCRIPTION_REQUIRED',
          message: 'This account has no Stripe subscription. Set createSubscription to create one, or subscribe the brand first.',
        },
        { status: 409 },
      )
    case 'account_link_failed':
      return NextResponse.json(
        { error: 'ACCOUNT_LINK_FAILED', message: 'The subscription could not be linked to the account and was cancelled.' },
        { status: 503 },
      )
    case 'stripe_failed':
      return NextResponse.json({ error: outcome.code }, { status: 502 })
  }
}
