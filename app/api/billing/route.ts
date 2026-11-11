import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadClientBillingView } from '@/lib/billing/client-view'

export const dynamic = 'force-dynamic'

/**
 * The signed-in member's own account billing view. No account parameter: the
 * account comes from the session profile, and the entitlement plan is resolved
 * server-side with resolveCommercialEntitlement (never getPlanFeatures).
 */
export async function GET(): Promise<Response> {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = resolveCommercialEntitlement(profile.accounts)

  try {
    const view = await loadClientBillingView(profile.account_id)
    return NextResponse.json({ ...view, plan: entitlement.plan })
  } catch (error) {
    // A failed read must not render as an empty (zero-bill) account.
    console.error(
      '[billing] client view failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Failed to load billing' }, { status: 500 })
  }
}
