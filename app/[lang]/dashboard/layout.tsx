import { requireAuth } from '@/lib/auth'
import { Sidebar } from '@/components/dashboard/Sidebar'
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

  // Extract clientId from URL for sidebar active state
  const headersList = await headers()
  const pathname = headersList.get('x-invoke-path') ?? ''
  const clientIdMatch = pathname.match(/\/dashboard\/([^/]+)/)
  const clientId = clientIdMatch?.[1]

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar profile={profile} lang={lang} clientId={clientId} />
      <div className="flex-1 flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  )
}
