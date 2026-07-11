import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES, APP_URL } from '@/lib/stripe'
import { getProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const VALID_PLANS = ['basic', 'pro', 'enterprise'] as const

export async function POST(req: NextRequest) {
  const { plan } = await req.json()
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan. Use basic, pro, or enterprise.' }, { status: 400 })
  }

  const priceId = STRIPE_PRICES[plan]
  if (!priceId) {
    return NextResponse.json({ error: `Price not configured for plan: ${plan}` }, { status: 500 })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: profile.email ?? undefined,
      metadata: { account_id: profile.account_id },
      success_url: `${APP_URL}/en/dashboard`,
      cancel_url:  `${APP_URL}/en/pricing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    console.error('[stripe/checkout]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
