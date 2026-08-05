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

type Sql = ReturnType<typeof db>

/**
 * Provision the `accounts` + `profiles` pair for a newly created auth user.
 *
 * Exported so the concurrency behaviour can be exercised directly against a
 * real branch, without having to satisfy the authenticity gate in POST.
 *
 * Concurrency: the caller's profile probe is racy by construction — two
 * `user.created` deliveries in flight together both observe no profile. The old
 * code then had both insert an `accounts` row with its own freshly generated
 * uuid; only one `profiles` insert could win (`on conflict (id) do nothing`),
 * so the loser's account row survived with nothing pointing at it. `accounts`
 * has no column derived from the user, so there is no arbiter an ON CONFLICT
 * could use to dedupe — hence the advisory lock, the same tool
 * check_brand_limit() uses in 028_account_plan_overrides.sql.
 *
 * Why three separate statements and not one CTE: `sql.transaction()` submits a
 * *non-interactive* batch, so no statement can consume an earlier one's
 * RETURNING — but each is still its own statement, and under READ COMMITTED
 * each takes a fresh snapshot. Statement 1 blocks until the delivery we raced
 * commits; statement 2 then *sees* that commit and inserts nothing. Folding
 * these into a single CTE would break exactly that: one statement means one
 * snapshot, taken before pg_advisory_xact_lock inside it acquires, so it would
 * be blind to the winner and insert the duplicate anyway.
 */
export async function provisionAccountForUser(
  sql: Sql,
  { userId, name }: { userId: string; name: string | null },
): Promise<void> {
  const accountId = crypto.randomUUID()

  await sql.transaction([
    // Serializes provisioning for this user id. Released at COMMIT of the batch.
    sql`
      select pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('webhooks/neon:user.created:' || ${userId}, 0)
      )
    `,
    sql`
      insert into accounts (id, plan, status)
      select ${accountId}, 'basic', 'active'
      where not exists (
        select 1 from profiles where id = ${userId} and account_id is not null
      )
    `,
    // Guarded on the account above actually having been inserted, so the FK can
    // never see a dangling account_id: either both rows land or neither does.
    // The DO UPDATE heals a profile the legacy trigger left with a null account.
    sql`
      insert into profiles (id, account_id, display_name)
      select ${userId}, ${accountId}, ${name}
      where exists (select 1 from accounts where id = ${accountId})
      on conflict (id) do update
        set account_id = excluded.account_id
        where profiles.account_id is null
    `,
  ])
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
    // Fast path for the common case: webhook providers (Neon Auth included)
    // redeliver at-least-once, and `user.created` fires once per signup, so a
    // redelivery must not provision again. This is an optimisation, not the
    // correctness guarantee — two deliveries in flight at once both see no
    // profile here. The advisory lock below is what actually makes it safe.
    //
    // `account_id is not null` matters: a profile left behind by the legacy
    // handle_new_user() trigger can have a null account_id, and short-circuiting
    // on that would strand the user with no account forever. Falling through
    // lets the provisioning batch heal it.
    const existingProfile = await sql`
      select id from profiles where id = ${userId} and account_id is not null
    `
    if (existingProfile.length > 0) {
      return NextResponse.json({ ok: true })
    }

    await provisionAccountForUser(sql, { userId, name: name ?? null })
  } catch (err) {
    console.error(
      `[webhooks/neon] provisioning failed for user ${userId} (${email}):`,
      (err as Error)?.message ?? String(err)
    )
    return NextResponse.json({ error: 'Provisioning failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
