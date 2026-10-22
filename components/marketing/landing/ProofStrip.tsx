import { useTranslations } from 'next-intl'
import { PRODUCT_FACTS } from '@/lib/product-facts'

/**
 * Product facts, not traffic numbers: every figure here is a property of the
 * product (decision 2026-10-22). AI platforms are named, not shown as logos,
 * until logo use is cleared.
 */
export function ProofStrip() {
  const t = useTranslations('landing.proof')
  const facts = [
    { value: String(PRODUCT_FACTS.checkCount), label: t('checks') },
    { value: '3', label: t('areas') },
    { value: String(PRODUCT_FACTS.scoreMaximum), label: t('points') },
    { value: String(PRODUCT_FACTS.platforms.length), label: t('platforms') },
  ]
  return (
    <section aria-label={t('label')} className="border-b border-border bg-card py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          {facts.map(fact => (
            <div key={fact.label} className="flex flex-col">
              <dt className="order-2 text-sm text-muted-foreground">{fact.label}</dt>
              <dd className="order-1 text-3xl font-black tabular-nums text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <ul aria-label={t('platforms_list')} className="flex flex-wrap gap-2">
          {PRODUCT_FACTS.platforms.map(platform => (
            <li key={platform} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />{platform}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
