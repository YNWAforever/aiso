import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES, APP_URL } from '@/lib/stripe'
import { getProfile } from '@/lib/auth'
import { getCheckoutPlanId } from '@/lib/plans/catalog'
import { readLimitedJson } from '@/lib/approvals/request'

export const dynamic = 'force-dynamic'

const VALID_LANGS = ['en', 'zh-HK'] as const

function getSupportedLang(lang: unknown): (typeof VALID_LANGS)[number] {
  return typeof lang === 'string' && VALID_LANGS.includes(lang as (typeof VALID_LANGS)[number])
    ? lang as (typeof VALID_LANGS)[number]
    : 'en'
}

export async function POST(req: NextRequest) {
  let body: { plan?: unknown; lang?: unknown }
  try {
    const raw = await readLimitedJson(req, 1024)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
    body = raw
    if (typeof body.plan !== 'string' || (body.lang !== undefined && typeof body.lang !== 'string')) throw new Error('invalid')
  } catch {
    return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 })
  }
  const plan = getCheckoutPlanId(body.plan)
  const supportedLang = getSupportedLang(body.lang)
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!plan) {
    return NextResponse.json(
      { error: 'Invalid plan. Use basic, pro, or enterprise.' },
      { status: 400 },
    )
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
      metadata: { account_id: profile.account_id, plan },
      success_url: `${APP_URL}/${supportedLang}/dashboard`,
      cancel_url:  `${APP_URL}/${supportedLang}/pricing`,
    })
    return NextResponse.json({ url: session.url })
  } catch {
    console.error('[stripe/checkout] session creation failed')
    return NextResponse.json({ error: 'Checkout temporarily unavailable' }, { status: 500 })
  }
}
