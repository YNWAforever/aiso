import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'
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

  const headersList = await headers()
  const pathname = headersList.get('x-invoke-path') ?? ''
  const clientIdMatch = pathname.match(/\/dashboard\/([^/]+)/)
  const clientId = clientIdMatch?.[1] ?? undefined

  // Fetch brand name if viewing a specific client
  let brandName: string | undefined
  if (clientId) {
    const supabase = await createServerSupabaseClient()
    const { data: client } = await supabase
      .from('clients').select('brand_name')
      .eq('id', clientId).eq('account_id', profile.account_id).single()
    brandName = client?.brand_name ?? undefined
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <DashboardSidebar profile={profile} brandName={brandName} brandId={clientId} />
      <div className="flex-1 flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  )
}
