import { requireAuth } from '@/lib/auth'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
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
  const profile = await requireAuth(lang)
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

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {entitlement.source === 'trial' && trial.isTrial && !trial.isExpired && (
        <TrialBanner daysRemaining={trial.daysRemaining} lang={lang} />
      )}
      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar profile={profile} entitlement={entitlement} />
        <div className="flex-1 flex flex-col overflow-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
