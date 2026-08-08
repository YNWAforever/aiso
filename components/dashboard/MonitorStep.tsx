import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { SovChart } from '@/components/pulse/SovChart'
import { MissedTable } from '@/components/pulse/MissedTable'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { AlertsTab } from '@/components/pulse/AlertsTab'
import { PLAN_CATALOG } from '@/lib/plans/catalog'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

type Props = {
  features: import('@/lib/types').PlanFeatures
  lang: string
  clientId: string
  summary: PulseWeeklySummary[]
  missed: PulseMetric[]
}

export function MonitorStep({ features, lang, clientId, summary, missed }: Props) {
  const t = useTranslations('dashboard')
  const tp = useTranslations('pulse')
  const proPrice = `$${PLAN_CATALOG.pro.monthlyPriceUsd}/month`

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase">{t('sov_trend')}</p>
          {/* What this chart plots is decided entirely by which questions are
              active in the bank, so it is worth reaching from here. The sidebar
              carries the primary entry point. */}
          <Link
            href={`/${lang}/dashboard/${clientId}/prompts`}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {tp('nav_questions')}
          </Link>
        </div>
        <SovChart data={summary} />
      </div>

      {missed.length > 0 && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-dash-danger" />
            <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase">{t('missed_opps')}</p>
          </div>
          <MissedTable rows={missed.slice(0, 3)} platformLabel={tp('missed_platform')} questionLabel={tp('missed_question')} competitorsLabel={tp('missed_competitors')} />
        </div>
      )}

      {features.alerts ? (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <AlertsTab clientId={clientId} />
        </div>
      ) : (
        <LockedFeature feature={t('feature_alerts')} requiredPlan="Pro" price={proPrice} />
      )}
    </div>
  )
}
