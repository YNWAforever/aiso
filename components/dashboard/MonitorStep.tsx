import Link from 'next/link'
import {useTranslations} from 'next-intl'
import {ObservedPulseView} from '@/components/pulse/ObservedPulseView'
import {AlertsTab} from '@/components/pulse/AlertsTab'
import {LockedFeature} from '@/components/dashboard/LockedFeature'
import {PLAN_CATALOG} from '@/lib/plans/catalog'
import type {PlanFeatures} from '@/lib/types'
import type {PulseView} from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
type Props={features:PlanFeatures;lang: string;clientId:string;view:PulseView}
export function MonitorStep({features,lang,clientId,view}:Props){
 const t=useTranslations('dashboard');const tp=useTranslations('pulse');const copy=(lang==='zh-HK'?zhHK:en).pulseView
 return <div className="min-w-0 space-y-5">
  <nav className="flex flex-wrap gap-3"><Link href={`/${lang}/dashboard/${clientId}/prompts`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{tp('nav_questions')}</Link><Link href={`/${lang}/pulse/${clientId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{copy.full}</Link></nav>
  <ObservedPulseView view={view} lang={lang}/>
  {features.alerts?<section className="rounded-xl border border-border bg-card p-5"><AlertsTab clientId={clientId}/></section>:<LockedFeature feature={t('feature_alerts')} requiredPlan="Pro" price={`$${PLAN_CATALOG.pro.monthlyPriceUsd}/month`}/>}
 </div>
}
