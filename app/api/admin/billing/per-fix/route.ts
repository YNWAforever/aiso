import { NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'
import { hongKongMonthKey, periodOf } from '@/lib/brand-month/period'

export const dynamic = 'force-dynamic'

type AccountRow = {
  id: string
  plan: string | null
  status: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  mode: 'included' | 'metered' | null
  owner_email: string | null
}

type UsageRow = { account_id: string; reported: number; pending: number; failed: number }

type FailedRow = {
  id: string
  account_id: string
  fix_pack_id: string
  attempts: number
  last_error_code: string | null
  created_at: string
}

/**
 * Platform-wide per-fix billing overview for the admin console: every account's
 * billing mode, this Hong Kong month's meter counts and the failed events an
 * admin can retry. Gated by requireApiAdmin; deliberately account-blind because
 * the admin console is the one surface that must see every account.
 *
 * Counts are split by state and never summed: `reported` is what Stripe accepted,
 * while `pending`/`failed` is not billed at all.
 */
export async function GET(): Promise<Response> {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const monthKey = hongKongMonthKey(new Date())
  const period = periodOf(monthKey)
  if (!period) return NextResponse.json({ error: 'Invalid month window' }, { status: 500 })

  const sql = db()
  try {
    const accounts = await sql`
      select
        a.id, a.plan, a.status, a.stripe_customer_id, a.stripe_subscription_id,
        b.mode,
        (
          select coalesce(p.display_name, u.email)
          from profiles p
          left join neon_auth."user" u on u.id = p.id
          where p.account_id = a.id
          order by p.created_at
          limit 1
        ) as owner_email
      from accounts a
      left join account_billing b on b.account_id = a.id
      order by a.created_at desc
    ` as AccountRow[]

    const usage = await sql`
      select
        account_id,
        count(*) filter (where state = 'reported')::int as reported,
        count(*) filter (where state = 'pending')::int as pending,
        count(*) filter (where state = 'failed')::int as failed
      from fix_billing_events
      where created_at >= ${period.start}::timestamptz
        and created_at < ${period.end}::timestamptz
      group by account_id
    ` as UsageRow[]

    const failed = await sql`
      select id, account_id, fix_pack_id, attempts, last_error_code, created_at
      from fix_billing_events
      where state = 'failed'
      order by created_at desc
      limit 100
    ` as FailedRow[]

    const usageByAccount = new Map(usage.map(row => [row.account_id, row]))
    const failedByAccount = new Map<string, FailedRow[]>()
    for (const row of failed) {
      const list = failedByAccount.get(row.account_id)
      if (list) list.push(row)
      else failedByAccount.set(row.account_id, [row])
    }

    return NextResponse.json({
      month: monthKey,
      accounts: accounts.map(account => {
        const counts = usageByAccount.get(account.id)
        return {
          accountId: account.id,
          ownerEmail: account.owner_email,
          plan: account.plan,
          status: account.status,
          mode: account.mode,
          hasStripeCustomer: Boolean(account.stripe_customer_id),
          hasSubscription: Boolean(account.stripe_subscription_id),
          usage: {
            reported: counts?.reported ?? 0,
            pending: counts?.pending ?? 0,
            failed: counts?.failed ?? 0,
          },
          failedEvents: (failedByAccount.get(account.id) ?? []).map(event => ({
            eventId: event.id,
            fixPackId: event.fix_pack_id,
            attempts: event.attempts,
            lastErrorCode: event.last_error_code,
            createdAt: event.created_at,
          })),
        }
      }),
    })
  } catch (error) {
    // A failed read must not render as "no metered accounts, nothing to retry".
    console.error(
      '[admin/billing] per-fix overview failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Failed to load per-fix billing' }, { status: 500 })
  }
}
