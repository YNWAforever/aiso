import Link from 'next/link'
import { OutcomePreview } from '@/components/integrations/OutcomePreview'
import { isFeatureEnabled, isSmeCopilotUiEnabled } from '@/lib/flags'
import {useTranslations} from 'next-intl'
import {ObservedPulseView} from '@/components/pulse/ObservedPulseView'
import {MonitorSignals} from '@/components/pulse/MonitorSignals'
import {VisibilityView} from '@/components/pulse/VisibilityView'
import {AlertsTab} from '@/components/pulse/AlertsTab'
import {LockedFeature} from '@/components/dashboard/LockedFeature'
import {PLAN_CATALOG} from '@/lib/plans/catalog'
import type {PlanFeatures} from '@/lib/types'
import type {PulseView} from '@/lib/view-models/pulse'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
type Props={features:PlanFeatures;lang: string;clientId:string;view:PulseView;now:Date;brandIdentity:{name:string;aliases:string[]}}
export function MonitorStep({features,lang,clientId,view,now,brandIdentity}:Props){
 const t=useTranslations('dashboard');const tp=useTranslations('pulse');const copy=(lang==='zh-HK'?zhHK:en).pulseView
 const sme=isSmeCopilotUiEnabled()
 const recognized=[brandIdentity.name,...brandIdentity.aliases].filter(Boolean).join(lang==='zh-HK'?'、':', ')
 const identity=<section className="rounded-xl border border-border bg-card p-5" aria-labelledby="brand-mention-names">
   <h2 id="brand-mention-names" className="font-semibold text-foreground">{copy.brandNamesTitle}</h2>
   {recognized&&<p className="mt-2 text-sm text-muted-foreground">{copy.brandNamesCurrent.replace('{names}',recognized)}</p>}
   <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.brandNamesBody}</p>
   <Link href={`/${lang}/dashboard/${clientId}/entities`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-accessible underline underline-offset-4">{copy.brandNamesEdit}</Link>
 </section>
 const links=<>
  <nav className="flex flex-wrap gap-3"><Link href={`/${lang}/dashboard/${clientId}/prompts`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{tp('nav_questions')}</Link><Link href={`/${lang}/pulse/${clientId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{copy.full}</Link></nav>
  {isFeatureEnabled('outcome_integrations') && features.outcome_integrations && <OutcomePreview clientId={clientId} lang={lang}/>}
  {isFeatureEnabled('closed_loop_visibility') && <Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}/visibility`}>{(lang==='zh-HK'?zhHK:en).closedLoopVisibility.nav}</Link>}
  {isFeatureEnabled('enterprise_os') && features.enterprise_workflows && <Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}/enterprise`}>{(lang==='zh-HK'?zhHK:en).enterpriseOS.nav}</Link>}
 </>
 const alerts=features.alerts?<section className="rounded-xl border border-border bg-card p-5"><AlertsTab clientId={clientId}/></section>:<LockedFeature feature={t('feature_alerts')} requiredPlan="Pro" price={`$${PLAN_CATALOG.pro.monthlyPriceUsd}/month`}/>
 if(sme)return <div className="min-w-0 space-y-6">
  <VisibilityView view={view} lang={lang} now={now}/>
  {identity}
  <details className="rounded-2xl border border-border bg-card p-5 sm:p-6">
   <summary className="min-h-11 cursor-pointer text-sm font-semibold">{(lang==='zh-HK'?zhHK:en).runProgress.sme.otherTools}</summary>
   <div className="space-y-5 pt-3">{links}{alerts}</div>
  </details>
 </div>
 const secondary=<>{identity}{links}<MonitorSignals view={view} lang={lang} now={now}/><ObservedPulseView view={view} lang={lang}/>{alerts}</>
 return <div className="min-w-0 space-y-5">{secondary}</div>
}
