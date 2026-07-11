import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type NeonAuthWebhookEvent = {
  type: string
  data?: { id: string; email: string; name?: string | null } | null
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NeonAuthWebhookEvent | null
  // TEMP DIAGNOSTIC: real payload shape was never verified against the actual
  // Neon Auth webhook delivery — production is 400ing on the first two real
  // signups. Log structure only (no PII/values) to confirm the true shape,
  // then remove.
  if (body && typeof body === 'object') {
    console.error('[webhooks/neon] DIAGNOSTIC shape:', JSON.stringify({
      topLevelKeys: Object.keys(body),
      type: (body as Record<string, unknown>).type,
      dataKeys: (body as Record<string, unknown>).data && typeof (body as Record<string, unknown>).data === 'object'
        ? Object.keys((body as Record<string, unknown>).data as object)
        : typeof (body as Record<string, unknown>).data,
      userKeys: (body as Record<string, unknown>).user && typeof (body as Record<string, unknown>).user === 'object'
        ? Object.keys((body as Record<string, unknown>).user as object)
        : typeof (body as Record<string, unknown>).user,
    }))
  } else {
    console.error('[webhooks/neon] DIAGNOSTIC: body is not an object:', typeof body)
  }
  if (!body || typeof body.type !== 'string') {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }

  if (body.type !== 'user.created') {
    return NextResponse.json({ error: 'Unhandled event type' }, { status: 400 })
  }

  // `body.data` may be absent/null on a malformed delivery — fall back to `{}`
  // so this destructure can't throw before we get a chance to return our own
  // graceful 400.
  const { id: userId, email, name } = body.data ?? {}
  if (!userId || !email) {
    return NextResponse.json({ error: 'Missing user id or email' }, { status: 400 })
  }

  const sql = db()
  try {
    // Idempotency guard: webhook providers (Neon Auth included) commonly
    // redeliver events at-least-once, and `user.created` only fires once per
    // signup — so a redelivery must not create a second, orphaned `accounts`
    // row. If a profile already exists for this user, provisioning already
    // happened on an earlier delivery; short-circuit as a no-op success.
    // A small race window between this check and the transaction below is
    // acceptable — this is a low-concurrency, once-per-user event, not a hot
    // path that needs row-locking.
    const existingProfile = await sql`select id from profiles where id = ${userId}`
    if (existingProfile.length > 0) {
      return NextResponse.json({ ok: true })
    }

    // Provision the account + profile atomically. `sql.transaction()` submits
    // a *non-interactive* batch: every query passed to it is built up front,
    // so a later query can't consume a value `returning`ed by an earlier one
    // in the same call. To keep both inserts as independent statements (and
    // avoid the old two-round-trip design, where a failure between them left
    // a permanently orphaned `accounts` row with no linked profile), the
    // account id is generated client-side and reused in both inserts.
    const accountId = crypto.randomUUID()

    await sql.transaction([
      sql`
        insert into accounts (id, plan, status)
        values (${accountId}, 'basic', 'active')
      `,
      sql`
        insert into profiles (id, account_id, display_name)
        values (${userId}, ${accountId}, ${name ?? null})
        on conflict (id) do nothing
      `,
    ])
  } catch (err) {
    console.error(
      `[webhooks/neon] provisioning failed for user ${userId} (${email}):`,
      (err as Error)?.message ?? String(err)
    )
    return NextResponse.json({ error: 'Provisioning failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
