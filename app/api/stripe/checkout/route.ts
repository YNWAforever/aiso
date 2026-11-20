import { NextRequest, NextResponse } from 'next/server'
import { openCheckout } from '@/lib/billing/checkout'
import { authLocale } from '@/lib/auth-return-to'
import { getProfile } from '@/lib/auth'
import { getCheckoutPlanId } from '@/lib/plans/catalog'
import { readLimitedJson } from '@/lib/approvals/request'

export const dynamic = 'force-dynamic'

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
  const supportedLang = authLocale(typeof body.lang === 'string' ? body.lang : '')
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!plan) {
    return NextResponse.json(
      { error: 'Invalid plan. Use basic, pro, or enterprise.' },
      { status: 400 },
    )
  }

  try {
    const checkout = await openCheckout(profile.account_id, plan, supportedLang)
    if (checkout.status === 'ok') return NextResponse.json({ url: checkout.url })
    if (checkout.status === 'billing_exists') return NextResponse.json({ error: checkout.status }, { status: 409 })
    return NextResponse.json({ error: checkout.status }, { status: 503, headers: { 'Retry-After': '5' } })
  } catch {
    console.error('[stripe/checkout] session creation or recovery failed')
    return NextResponse.json({ error: 'checkout_unavailable' }, { status: 503, headers: { 'Retry-After': '5' } })
  }
}
