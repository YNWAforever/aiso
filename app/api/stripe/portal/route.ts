import { NextResponse } from 'next/server'
import { stripe, APP_URL } from '@/lib/stripe'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const profile = await requireAuth()
  const stripeCustomerId = profile.accounts?.stripe_customer_id

  if (!stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${APP_URL}/en/dashboard/settings`,
  })

  return NextResponse.redirect(session.url)
}
