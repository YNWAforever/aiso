import { SessionRefresh } from '@/components/auth/SessionRefresh'
import { requireAuth } from '@/lib/auth'
import { headers } from 'next/headers'
import { AUTH_RETURN_TO_HEADER } from '@/lib/auth-return-to'
import { db } from '@/lib/db'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { TopBar } from '@/components/dashboard/shell/TopBar'
import { listOwnedBrands, type OwnedBrand } from '@/lib/workspace/list-owned-brands'
import { getTrialStatus } from '@/lib/trial'
import { resolveCommercialEntitlement } from '@/lib/tier'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth(lang, (await headers()).get(AUTH_RETURN_TO_HEADER) ?? undefined)
  const trial = getTrialStatus(profile.accounts)
  const entitlement = resolveCommercialEntitlement(profile.accounts)

  // The brand is deliberately NOT resolved here. This layout sits at
  // `dashboard/`, so it cannot see the `[clientId]` segment's params — a Next
  // limitation, not an oversight. It used to reach for an `x-invoke-path`
  // header instead, which Next 13 set and Next 16 does not; nothing in the app
  // or the framework sets it, so the match never fired, brandName was always
  // undefined, and the brand chip never rendered once. DashboardSidebar reads
  // the id from useParams instead, which works because it renders inside the
  // route rather than above it.

  let unreadCount: number | null = null
  try {
    const rows = await db()`
      select count(*)::int as n from notifications
      where account_id = ${profile.account_id} and read = false
    `
    unreadCount = rows[0]?.n ?? null
  } catch (error) {
    // Keep a failed lookup distinct from a confirmed zero unread count.
    console.error('[dashboard] unread notification count failed:', error)
  }

  // The brand list for the switcher and ⌘K. The current brand itself is read
  // from the route by the top bar, for the same reason as above.
  let brands: OwnedBrand[] | null = null
  try {
    brands = await listOwnedBrands(profile.account_id)
  } catch (error) {
    console.error('[dashboard] brand list failed:', error)
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <SessionRefresh />
      {entitlement.source === 'trial' && trial.isTrial && !trial.isExpired && (
        <TrialBanner daysRemaining={trial.daysRemaining} lang={lang} />
      )}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        <DashboardSidebar profile={profile} entitlement={entitlement} />
        <div className="flex-1 min-w-0 w-full flex flex-col overflow-auto">
          <TopBar lang={lang} brands={brands} unreadCount={unreadCount} features={entitlement.features} />
          {children}
        </div>
      </div>
    </div>
  )
}
