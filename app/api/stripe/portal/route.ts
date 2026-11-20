import { type NextRequest, NextResponse } from 'next/server'
import { authLocale } from '@/lib/auth-return-to'
import { stripe, APP_URL } from '@/lib/stripe'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req?: NextRequest) {
  const lang = authLocale(req?.nextUrl.searchParams.get('lang') ?? '')
  const profile = await requireAuth(lang)
  const stripeCustomerId = profile.accounts?.stripe_customer_id

  if (!stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    locale: lang,
    return_url: `${APP_URL}/${lang}/dashboard/settings`,
  })

  return NextResponse.redirect(session.url)
}
