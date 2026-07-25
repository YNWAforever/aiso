import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Real Neon Auth webhook payload shape, confirmed from an actual production
// delivery: `{ event_id, event_type, timestamp, context, user, event_data }`,
// where `user` carries `{ id, email, name, image, role, ... }`. (The earlier
// assumed `{ type, data }` shape was a planning guess that 400'd every real
// delivery.)
type NeonAuthWebhookEvent = {
  event_type?: string
  user?: { id?: string; email?: string; name?: string | null } | null
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NeonAuthWebhookEvent | null
  if (!body || typeof body.event_type !== 'string') {
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }

  if (body.event_type !== 'user.created') {
    // The endpoint is configured (Neon Auth `enabled_events`) to receive only
    // `user.created`, so this path shouldn't normally hit. If it ever does,
    // log the actual value and return 200 so Neon doesn't retry an event we
    // intentionally ignore.
    console.warn(`[webhooks/neon] ignoring unhandled event_type: ${body.event_type}`)
    return NextResponse.json({ received: true, handled: false })
  }

  // `body.user` may be absent/null on a malformed delivery — fall back to `{}`
  // so this destructure can't throw before we get a chance to return our own
  // graceful 400.
  const { id: userId, email, name } = body.user ?? {}
  if (!userId || !email) {
    return NextResponse.json({ error: 'Missing user id or email' }, { status: 400 })
  }

  const sql = db()

  // ---------------------------------------------------------------------
  // Authenticity gate — DO NOT REMOVE.
  //
  // This route is publicly reachable: `proxy.ts`'s matcher excludes `/api`
  // entirely and layouts never run for route handlers, so nothing else stands
  // between an anonymous POST and the provisioning below. Without this gate,
  // anyone can mint real `accounts` + `profiles` rows by POSTing a made-up
  // `user.created` payload.
  //
  // `@neondatabase/auth` ships NO webhook signing support — no svix, no
  // signing secret, no verify helper — so HMAC signature verification is not
  // available to us. Instead we validate the payload against the auth database
  // itself, which is the one thing an attacker cannot forge: only Neon Auth
  // writes to `neon_auth.user`. A payload naming a user id that does not exist
  // there, or one that binds a real user id to a different email than Neon Auth
  // has on record, is rejected and provisions nothing.
  //
  // If you are tempted to "simplify" this away because it looks like a
  // redundant round-trip: it is the *only* authentication this endpoint has.
  // ---------------------------------------------------------------------
  let authUser: { id: string; email: string | null } | undefined
  try {
    const rows = (await sql`
      select id, email from neon_auth.user where id = ${userId}
    `) as Array<{ id: string; email: string | null }>
    authUser = rows[0]
  } catch (err) {
    // A lookup failure is not proof of a forgery — fail closed with a 500 so
    // Neon retries a legitimate event rather than silently dropping it.
    console.error(
      `[webhooks/neon] auth-user lookup failed for user ${userId}:`,
      (err as Error)?.message ?? String(err)
    )
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }

  // One shared response for "no such user" and "email mismatch" so the
  // endpoint does not double as an oracle for which user ids/emails are real.
  const claimedEmail = email.trim().toLowerCase()
  const knownEmail = (authUser?.email ?? '').trim().toLowerCase()
  if (!authUser || !knownEmail || knownEmail !== claimedEmail) {
    console.warn(
      `[webhooks/neon] rejecting unverifiable user.created payload for user ${userId} — ` +
        (authUser ? 'email does not match neon_auth.user' : 'no such row in neon_auth.user')
    )
    return NextResponse.json({ error: 'Unknown user' }, { status: 404 })
  }

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
