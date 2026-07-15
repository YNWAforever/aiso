import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { getTrialStatus } from '@/lib/trial'
import { headers } from 'next/headers'

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

  const headersList = await headers()
  const pathname = headersList.get('x-invoke-path') ?? ''
  const clientIdMatch = pathname.match(/\/dashboard\/([^/]+)/)
  const clientId = clientIdMatch?.[1] ?? undefined

  // Fetch brand name if viewing a specific client
  let brandName: string | undefined
  if (clientId) {
    const sql = db()
    const rows = await sql`
      select brand_name from clients
      where id = ${clientId} and account_id = ${profile.account_id}
      limit 1
    `
    brandName = (rows[0] as { brand_name: string } | undefined)?.brand_name
  }

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {trial.isTrial && !trial.isExpired && (
        <TrialBanner daysRemaining={trial.daysRemaining} lang={lang} />
      )}
      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar profile={profile} brandName={brandName} brandId={clientId} />
        <div className="flex-1 flex flex-col overflow-auto">
          {children}
        </div>
      </div>
    </div>
  )
}
