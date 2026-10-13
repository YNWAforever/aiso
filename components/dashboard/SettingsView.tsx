import Link from 'next/link'
import type { ReactNode } from 'react'
import { getPlanDefinition, type PlanId } from '@/lib/plans/catalog'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

export type SettingsStatus = 'active'|'trialing'|'past_due'|'cancelled'|'unknown'

/** Status reads by colour as well as text; every pair clears 4.5:1 in both themes. */
const STATUS_TONE: Record<SettingsStatus,string> = {
  active: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800/60',
  trialing: 'bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-800/60',
  past_due: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800/60',
  cancelled: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-800/60',
  unknown: 'bg-muted text-muted-foreground ring-border',
}
export function normalizeSettingsStatus(value: unknown): SettingsStatus {
  return value === 'active' || value === 'trialing' || value === 'past_due' || value === 'cancelled' ? value : 'unknown'
}
/** Pure localized billing presentation; the server page retains report-branding access. */
export function SettingsView({lang,plan,status,hasStripe,children}: {
  lang:string;plan:PlanId;status:SettingsStatus;hasStripe:boolean;children?:ReactNode
}) {
  const copy=(lang==='zh-HK'?zhHK:en).settings
  const label=plan==='free'?copy.free:plan.charAt(0).toUpperCase()+plan.slice(1)
  const price=getPlanDefinition(plan).monthlyPriceUsd
  return <main className="mx-auto w-full min-w-0 max-w-5xl space-y-8 break-words px-4 py-8 sm:px-6">
    <header><h1 className="text-2xl font-bold text-foreground">{copy.title}</h1><p className="mt-3 text-sm text-muted-foreground">{copy.intro}</p></header>
    <section className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="settings-plan">
      <div><h2 id="settings-plan" className="text-lg font-bold text-foreground">{copy.currentPlan}</h2><p className="mt-2 text-2xl font-black tracking-tight text-foreground">{label}</p>
        {plan!=='free'&&<p className="mt-2 text-sm text-muted-foreground">{copy.cataloguePrice}: USD {price} / {copy.perMonth}</p>}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground">{copy.status}: <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_TONE[status]}`}>{copy.statusLabels[status]}</span></p>
      </div>
      <div className="border-t border-border pt-5"><h2 className="text-lg font-bold text-foreground">{copy.billing}</h2>
        {hasStripe?<>
          {/* Ordinary navigation to the existing API redirect; never prefetch Stripe. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/stripe/portal" className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">{copy.manageBilling}</a>
          <p className="mt-3 text-sm text-muted-foreground">{copy.billingBody}</p>
        </>:<p className="mt-3 text-sm text-muted-foreground">{copy.billingUnavailable}</p>}
      </div>
      <div className="border-t border-border pt-4"><Link href={`/${lang}/pricing`} className="inline-flex min-h-11 items-center font-semibold text-primary-accessible underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">{copy.pricing}</Link><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.pricingNote}</p></div>
    </section>
    {children}
  </main>
}
