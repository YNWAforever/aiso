import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CompetitorsEditor } from '@/components/dashboard/CompetitorsEditor'
import { WhatAiSaysPage } from '@/components/dashboard/sme/WhatAiSaysPage'
import { requireAuth } from '@/lib/auth'
import { MAX_COMPETITORS } from '@/lib/competitors/schema'
import { listCompetitors } from '@/lib/competitors/store'
import { db } from '@/lib/db'
import { buildCompetitorBars } from '@/lib/view-models/monitor-signals'
import { loadOwnedPulse } from '@/lib/workspace/load-owned-pulse'

export const dynamic = 'force-dynamic'

/**
 * A brand's competitors: the names Pulse looks for next to the brand, their
 * other spellings, and their websites. Until 061 these were set once during
 * onboarding and never editable afterwards.
 *
 * The report above the editor answers the question a member actually arrives
 * with ("are we ahead?") from the same classified answers the visibility tab
 * uses. No plan gate, like the API: every plan sets competitors at onboarding.
 */
export default async function CompetitorsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('competitors')
  const profile = await requireAuth(locale)

  const pulse = await loadOwnedPulse({ clientId, profile, withSignals: true })
  if (!pulse) notFound()
  const sql = db()
  const competitors = await listCompetitors(sql, profile.account_id, clientId)
  if (!competitors) notFound()

  const rows = pulse.competitors?.status === 'ok' ? pulse.competitors.data : undefined
  const bars = buildCompetitorBars(rows)
  const answers = rows?.[0]?.answers ?? 0
  const brandName = pulse.client.brand_name

  return (
    <WhatAiSaysPage title={t('title')} description={t('intro')}>
      <div className="space-y-6">
        <section aria-labelledby="competitor-share-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 id="competitor-share-title" className="text-lg font-bold text-foreground">{t('share_title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{bars ? t('share_note', { answers }) : t('share_empty')}</p>
          {bars && (
            <ul className="mt-5 space-y-3">
              {bars.map(bar => {
                const name = bar.name ?? brandName
                return (
                  <li key={bar.name ?? 'brand'} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm font-medium sm:w-40">{name}</span>
                    <div
                      className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                      role="img"
                      aria-label={t('share_bar_label', { name, share: bar.share })}
                    >
                      <div className="h-full rounded-full bg-primary" style={{ width: `${bar.share <= 0 ? 0 : Math.max(2, Math.min(100, bar.share))}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{bar.share}%</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="competitor-list-title" className="space-y-3">
          <h2 id="competitor-list-title" className="text-lg font-bold text-foreground">{t('list_title')}</h2>
          <CompetitorsEditor clientId={clientId} initialCompetitors={competitors} max={MAX_COMPETITORS} />
        </section>
      </div>
    </WhatAiSaysPage>
  )
}
