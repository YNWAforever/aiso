import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type NeonAuthWebhookEvent = {
  type: string
  data: { id: string; email: string; name?: string | null }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NeonAuthWebhookEvent | null
  if (!body || typeof body.type !== 'string') {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }

  if (body.type !== 'user.created') {
    return NextResponse.json({ error: 'Unhandled event type' }, { status: 400 })
  }

  const { id: userId, email } = body.data
  if (!userId || !email) {
    return NextResponse.json({ error: 'Missing user id or email' }, { status: 400 })
  }

  const sql = db()
  try {
    const accountRows = await sql`
      insert into accounts (plan, status)
      values ('basic', 'active')
      returning id
    `
    const accountId = (accountRows[0] as { id: string }).id

    await sql`
      insert into profiles (id, account_id, display_name)
      values (${userId}, ${accountId}, ${body.data.name ?? null})
      on conflict (id) do nothing
    `
  } catch (err) {
    console.error('[webhooks/neon] provisioning failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Provisioning failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
