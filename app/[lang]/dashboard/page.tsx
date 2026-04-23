import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandCard } from '@/components/dashboard/BrandCard'
import { TopBar } from '@/components/dashboard/TopBar'
import type { Client, PulseWeeklySummary } from '@/lib/types'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth()
  const supabase = await createServerSupabaseClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('account_id', profile.account_id)
    .eq('status', 'active')
    .order('created_at')

  // Fetch latest SoV for each client
  const clientIds = (clients ?? []).map((c: Client) => c.id)
  const { data: summaries } = clientIds.length
    ? await supabase
        .from('pulse_weekly_summary')
        .select('client_id, sov_score, scan_week')
        .in('client_id', clientIds)
        .is('platform', null)
        .order('scan_week', { ascending: false })
    : { data: [] }

  const latestSov: Record<string, number> = {}
  for (const s of (summaries ?? []) as PulseWeeklySummary[]) {
    if (!(s.client_id in latestSov)) latestSov[s.client_id] = Number(s.sov_score)
  }

  return (
    <>
      <TopBar title="My Brands" />
      <main className="flex-1 px-6 py-8">
        {(!clients || clients.length === 0) ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-4xl mb-4">🏢</p>
            <p className="font-medium">No brands yet.</p>
            <p className="text-sm mt-1">Contact Fimmick to onboard your first brand.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {(clients as Client[]).map(c => (
              <BrandCard
                key={c.id}
                client={c}
                lang={lang}
                sovScore={latestSov[c.id]}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
