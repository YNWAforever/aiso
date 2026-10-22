import Link from 'next/link'
import { Check, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CHECKOUT_PLAN_IDS } from '@/lib/plans/catalog'
import { landingPricingRows, planPriceUsd, type PricingCell } from '@/lib/marketing/landing'
import { SectionHeading } from '@/components/marketing/landing/SectionHeading'

/**
 * Plans as a ✓ / – table, every cell read from lib/plans/catalog.ts. Desktop
 * gets a table; phones get one card per plan. Checkout stays on /pricing.
 */
export function PricingTable({ lang }: { lang: string }) {
  const t = useTranslations('landing.pricing')
  const p = useTranslations('pricing')
  const rows = landingPricingRows()
  const money = new Intl.NumberFormat(lang === 'zh-HK' ? 'zh-HK' : 'en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const planName = { basic: p('basic_name'), pro: p('pro_name'), enterprise: p('enterprise_name') } as const
  const rowLabel = (key: string) => p(`row_${key}`)

  const cell = (value: PricingCell) => {
    if (value === true) return <><Check aria-hidden="true" className="mx-auto size-4 text-tone-success-fg" /><span className="sr-only">{t('included')}</span></>
    if (value === false) return <><Minus aria-hidden="true" className="mx-auto size-4 text-neutral-8" /><span className="sr-only">{t('not_included')}</span></>
    if (value.kind === 'scans') return value.count === null ? p('allowance_scans_fair_use') : p('allowance_scans_monthly', { count: value.count })
    return p('allowance_brands', { count: value.count ?? 0 })
  }

  return (
    <section aria-labelledby="pricing-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading id="pricing-title" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />

      <div role="region" aria-labelledby="pricing-title" tabIndex={0} className="relative mt-10 hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-e1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-5 py-4 text-left font-semibold text-muted-foreground"><span className="sr-only">{t('feature')}</span></th>
              {CHECKOUT_PLAN_IDS.map(plan => (
                <th key={plan} scope="col" className="px-5 py-4 text-center">
                  <span className="block text-base font-black text-foreground">{planName[plan]}</span>
                  <span className="block text-sm font-semibold text-muted-foreground">{money.format(planPriceUsd(plan))}{p('per_month')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-b border-border last:border-0">
                <th scope="row" className="px-5 py-3 text-left font-medium text-foreground">{rowLabel(row.key)}</th>
                {CHECKOUT_PLAN_IDS.map(plan => <td key={plan} className="px-5 py-3 text-center text-muted-foreground">{cell(row.cells[plan])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-10 grid gap-4 md:hidden">
        {CHECKOUT_PLAN_IDS.map(plan => (
          <li key={plan} className="rounded-2xl border border-border bg-card p-5 shadow-e1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="text-lg font-black text-foreground">{planName[plan]}</span>
              <span className="text-sm font-semibold text-muted-foreground">{money.format(planPriceUsd(plan))}{p('per_month')}</span>
            </p>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              {rows.map(row => (
                <div key={row.key} className="contents">
                  <dt className="text-muted-foreground">{rowLabel(row.key)}</dt>
                  <dd className="text-right text-foreground">{cell(row.cells[plan])}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-muted-foreground">{t('free_note')}</p>
      <Link href={`/${lang}/pricing`} className="mt-2 inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-primary-accessible underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {t('link')}
      </Link>
    </section>
  )
}
