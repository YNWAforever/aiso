import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandCard }       from '@/components/dashboard/BrandCard'
import { TopBar }          from '@/components/dashboard/TopBar'
import { AddBrandWizard }  from '@/components/dashboard/AddBrandWizard'
import { RecentScans }     from '@/components/dashboard/RecentScans'
import { maxBrandsForPlan } from '@/lib/tier'
import { BarChart2 } from 'lucide-react'
import type { Client, PulseWeeklySummary, Scan } from '@/lib/types'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()

  const [{ data: clients }, { data: scans }] = await Promise.all([
    supabase
      .from('clients')
      .select('*')
      .eq('account_id', profile.account_id)
      .eq('status', 'active')
      .order('created_at'),

    supabase
      .from('scans')
      .select('id, domain, score, created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

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

  const plan    = profile.accounts?.plan ?? 'basic'
  const atLimit = (clients?.length ?? 0) >= maxBrandsForPlan(plan)

  const hasClients = clients && clients.length > 0
  const hasScans   = scans && scans.length > 0

  return (
    <>
      <TopBar title="My Brands" />
      <main className="flex-1 px-6 py-8 space-y-8 max-w-4xl">

        {/* ── Brands section ── */}
        {hasClients ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tracked Brands</h2>
              {!atLimit && <AddBrandWizard lang={lang} />}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(clients as Client[]).map(c => (
                <BrandCard
                  key={c.id}
                  client={c}
                  lang={lang}
                  sovScore={latestSov[c.id]}
                />
              ))}
            </div>
            {atLimit && <AddBrandWizard lang={lang} disabled plan={plan} />}
          </div>
        ) : (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Tracked Brands</h2>
            <div className="bg-card rounded-xl border p-8 text-center">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <BarChart2 className="size-5 text-primary" />
              </div>
              <p className="font-semibold text-foreground">Add your first brand</p>
              <p className="text-sm text-muted-foreground mt-1 mb-6">
                Track your Share of Voice across ChatGPT, Perplexity, Claude, and Gemini.
              </p>
              <AddBrandWizard lang={lang} />
            </div>
          </div>
        )}

        {/* ── Recent Scans section ── */}
        {hasScans && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Recent AEO Scans</h2>
            <RecentScans scans={scans as Pick<Scan, 'id' | 'domain' | 'score' | 'created_at'>[]} lang={lang} />
          </div>
        )}

      </main>
    </>
  )
}
