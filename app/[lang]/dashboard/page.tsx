import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandCard }       from '@/components/dashboard/BrandCard'
import { AddBrandWizard }  from '@/components/dashboard/AddBrandWizard'
import { RecentScans }     from '@/components/dashboard/RecentScans'
import { maxBrandsForPlan } from '@/lib/tier'
import { BarChart2, Search } from 'lucide-react'
import type { Client, PulseWeeklySummary, Scan } from '@/lib/types'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const t = await getTranslations('dashboard')
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
      {/* Header */}
      <div className="pt-6 px-6 pb-4 border-b border-border">
        <p className="text-lg font-bold text-foreground mb-1">{t('my_brands')}</p>
        <p className="text-2xs text-muted-foreground leading-relaxed">
          {t('brands_intro')}
        </p>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6 max-w-4xl">

        {hasClients ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">{t('tracked_brands')}</p>
              {!atLimit && <AddBrandWizard lang={lang} />}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(clients as Client[]).map((c, i) => (
                <div key={c.id} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                  <BrandCard client={c} lang={lang} sovScore={latestSov[c.id]} />
                </div>
              ))}
            </div>
            {atLimit && (
              <div className="mt-3">
                <AddBrandWizard lang={lang} disabled plan={plan} />
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-3">{t('tracked_brands')}</p>
            <div className="rounded-xl border border-border bg-muted/30 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">{t('add_first_brand')}</p>
              <p className="text-xs text-muted-foreground mb-5 max-w-sm mx-auto leading-relaxed">
                {t('add_first_brand_body')}
              </p>
              <AddBrandWizard lang={lang} />
            </div>
          </div>
        )}

        {hasScans && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-3">{t('recent_scans')}</p>
            <RecentScans scans={scans as Pick<Scan, 'id' | 'domain' | 'score' | 'created_at'>[]} lang={lang} />
          </div>
        )}
      </main>
    </>
  )
}
