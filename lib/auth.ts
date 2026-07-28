import { redirect } from 'next/navigation'
import { auth } from '@/lib/neon-auth'
import { db } from '@/lib/db'
import type { ProfileWithAccount } from '@/lib/types'
import { isAllowlistedAdminEmail } from '@/lib/admin/allowlist'

export async function getProfile(): Promise<ProfileWithAccount | null> {
  const { data, error } = await auth().getSession()
  if (error) throw error
  if (!data?.user) return null

  const sql = db()
  const rows = await sql`
    select
      p.id, p.account_id, p.display_name, p.is_admin, p.created_at,
      a.id as account_id_2, a.plan, a.status, a.stripe_customer_id,
      a.stripe_subscription_id, a.trial_started_at, a.trial_ends_at,
      a.trial_emails_sent, a.created_at as account_created_at,
      a.override_plan, a.override_expires_at
    from profiles p
    join accounts a on a.id = p.account_id
    where p.id = ${data.user.id}
    limit 1
  `
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return null

  // Attach the auth email so callers (e.g. Stripe checkout) can use it
  return {
    id: row.id,
    account_id: row.account_id,
    display_name: row.display_name,
    // Derived, not persisted: removing an address from ADMIN_EMAILS revokes on
    // the next request. The column remains the durable record for grants made
    // by other means.
    is_admin: Boolean(row.is_admin) || isAllowlistedAdminEmail(
      data.user.email,
      Boolean(data.user.emailVerified),
      process.env.ADMIN_EMAILS,
    ),
    created_at: row.created_at,
    email: data.user.email ?? null,
    accounts: {
      id: row.account_id_2,
      plan: row.plan,
      status: row.status,
      stripe_customer_id: row.stripe_customer_id,
      stripe_subscription_id: row.stripe_subscription_id,
      trial_started_at: row.trial_started_at,
      trial_ends_at: row.trial_ends_at,
      trial_emails_sent: row.trial_emails_sent,
      created_at: row.account_created_at,
      override_plan: row.override_plan,
      override_expires_at: row.override_expires_at,
    },
  } as unknown as ProfileWithAccount
}

export async function requireAuth(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await getProfile()
  if (!profile) redirect(`/${lang}/auth/login`)
  return profile
}

export async function requireAdmin(lang = 'en'): Promise<ProfileWithAccount> {
  const profile = await requireAuth(lang)
  if (!profile.is_admin) redirect(`/${lang}/dashboard`)
  return profile
}
