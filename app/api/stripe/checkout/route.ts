import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES, APP_URL } from '@/lib/stripe'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { plan } = await req.json()
  const profile = await requireAuth()

  if (plan !== 'pro') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: STRIPE_PRICES.pro, quantity: 1 }],
    customer_email: profile.display_name ?? undefined,
    metadata: { account_id: profile.account_id },
    success_url: `${APP_URL}/auth/callback?next=/en/dashboard/settings`,
    cancel_url:  `${APP_URL}/en/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
