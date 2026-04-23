import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

function getPlan(priceId: string): 'starter' | 'pro' | 'enterprise' {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  return 'starter'
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceSupabaseClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { metadata?: { account_id?: string }; customer?: string; subscription?: string }
    const accountId = session.metadata?.account_id
    if (!accountId) return NextResponse.json({ ok: true })

    await supabase.from('accounts').upsert({
      id: accountId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      plan: 'pro',
      status: 'active',
    })
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as { id: string; status: string; items: { data: { price: { id: string } }[] } }
    const priceId = sub.items.data[0]?.price?.id ?? ''
    await supabase
      .from('accounts')
      .update({ plan: getPlan(priceId), status: sub.status })
      .eq('stripe_subscription_id', sub.id)
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string }
    await supabase
      .from('accounts')
      .update({ plan: 'starter', status: 'cancelled' })
      .eq('stripe_subscription_id', sub.id)
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as { subscription: string }
    await supabase
      .from('accounts')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', inv.subscription)
  }

  return NextResponse.json({ ok: true })
}
