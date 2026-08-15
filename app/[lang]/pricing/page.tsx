'use client'
import { useId, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Zap, Check, Minus, ChevronDown, ChevronRight } from 'lucide-react'
import {
  buildPricingAllowanceProjection,
  CHECKOUT_PLAN_IDS,
  getPlanDefinition,
  type CheckoutPlanId,
  type PricingAllowanceProjection,
  type ReleaseState,
} from '@/lib/plans/catalog'

/* ── Types ──────────────────────────────────────────────────── */
type Col = 'basic' | 'pro' | 'enterprise'

interface FeatureRow {
  label: string
  basic: string | boolean
  pro:     string | boolean
  enterprise: string | boolean
  highlight?: boolean
}

/* ── Small helpers ──────────────────────────────────────────── */
function Cell({
  value,
  includedLabel,
  notIncludedLabel,
}: {
  value: string | boolean
  includedLabel: string
  notIncludedLabel: string
}) {
  if (typeof value === 'boolean') {
    return (
      <span className="inline-flex items-center justify-center">
        {value
          ? <Check aria-hidden="true" className="size-4 text-emerald-500" />
          : <Minus aria-hidden="true" className="size-4 text-slate-300" />}
        <span className="sr-only">{value ? includedLabel : notIncludedLabel}</span>
      </span>
    )
  }
  return <span className="block text-center text-sm text-slate-700">{value}</span>
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(value => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="text-sm font-semibold text-slate-800">{q}</span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p id={contentId} className="pb-4 text-sm leading-relaxed text-slate-600">{a}</p>}
    </div>
  )
}

/* ── Main component ─────────────────────────────────────────── */
export default function PricingPage() {
  const [loading, setLoading]       = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const { lang } = useParams<{ lang: string }>()
  const router = useRouter()
  const t = useTranslations('pricing')

  const startCheckout = async (planName: CheckoutPlanId) => {
    setLoading(true)
    setCheckoutError('')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planName, lang }),
      })
      if (res.status === 401) {
        router.push(`/${lang}/auth/login?next=/${lang}/pricing`)
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setCheckoutError(data.error ?? t('error_generic'))
        setLoading(false)
        return
      }
      if (data.url) window.location.assign(data.url)
    } catch {
      setCheckoutError(t('error_network'))
      setLoading(false)
    }
  }

  const otherLang  = lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = lang === 'en' ? '中文' : 'EN'

  /* Feature comparison rows */
  const pro = getPlanDefinition('pro')
  const enterprise = getPlanDefinition('enterprise')
  const allowances: Record<CheckoutPlanId, PricingAllowanceProjection> = Object.fromEntries(
    CHECKOUT_PLAN_IDS.map(key => [
      key,
      buildPricingAllowanceProjection(key, (message, values) => t(message, values)),
    ]),
  ) as Record<CheckoutPlanId, PricingAllowanceProjection>

  const releaseHighlight = (state: ReleaseState, label: string) =>
    state === 'available' ? label : `${t('coming_soon')}: ${label}`

  const rows: FeatureRow[] = [
    { label: t('row_scans'), basic: allowances.basic.scans, pro: allowances.pro.scans, enterprise: allowances.enterprise.scans },
    {
      label: t('row_monitoring'),
      basic: false,
      pro: pro.release.monitoring === 'available' ? true : t('coming_soon'),
      enterprise: enterprise.release.monitoring === 'available' ? true : t('coming_soon'),
    },
    { label: t('row_checks'), basic: true, pro: true, enterprise: true },
    { label: t('row_fixpack'), basic: true, pro: true, enterprise: true },
    { label: t('row_fixpack_adv'), basic: false, pro: true, enterprise: true, highlight: true },
    { label: t('row_brands'), basic: allowances.basic.brands, pro: allowances.pro.brands, enterprise: allowances.enterprise.brands },
    { label: t('row_history'), basic: allowances.basic.history, pro: allowances.pro.history, enterprise: allowances.enterprise.history },
    // Entitled on Pro/Enterprise; both have since shipped (prompt-bank editor
    // and evaluate-alerts cron are live). These two rows used to render a
    // hardcoded ✓ regardless of release state, which would have sold a paying
    // customer a feature that answered with an error — so they stay derived
    // from release.promptBank / release.sovAlerts rather than a literal.
    {
      label: t('row_prompts'),
      basic: false,
      pro: pro.release.promptBank === 'available' ? true : t('coming_soon'),
      enterprise: enterprise.release.promptBank === 'available' ? true : t('coming_soon'),
    },
    {
      label: t('row_alerts'),
      basic: false,
      pro: pro.release.sovAlerts === 'available' ? true : t('coming_soon'),
      enterprise: enterprise.release.sovAlerts === 'available' ? true : t('coming_soon'),
    },
    {
      label: t('row_competitor'),
      basic: false,
      pro: pro.release.competitorSummary === 'available' ? true : t('coming_soon'),
      enterprise: enterprise.features.agent_competitors,
    },
    { label: t('row_authority'), basic: t('row_authority_s'), pro: t('row_authority_p'), enterprise: t('row_authority_e'), highlight: true },
    {
      label: t('row_client_report'),
      basic: false,
      pro: pro.release.clientReports === 'available' ? true : t('coming_soon'),
      enterprise: enterprise.release.clientReports === 'available' ? true : t('coming_soon'),
    },
    { label: t('row_csv'), basic: false, pro: false, enterprise: enterprise.features.csv_export },
    { label: t('row_api'), basic: false, pro: false, enterprise: false },
    { label: t('row_custom_platforms'), basic: false, pro: false, enterprise: false },
    { label: t('row_support'), basic: false, pro: false, enterprise: t('priority_support') },
  ]

  const plans = CHECKOUT_PLAN_IDS.map(key => {
    const definition = getPlanDefinition(key)
    return {
      key,
      name: key === 'basic' ? t('basic_name') : key === 'pro' ? t('pro_name') : t('enterprise_name'),
      tag: key === 'basic' ? t('basic_tag') : key === 'pro' ? t('pro_tag') : t('enterprise_tag'),
      price: '$' + definition.monthlyPriceUsd,
      priceSub: key === 'enterprise' ? t('starting_price_per_month') : t('per_month'),
      cta: loading
        ? t('cta_loading')
        : key === 'basic' ? t('cta_basic') : key === 'pro' ? t('cta_pro') : t('cta_enterprise'),
      popular: key === 'pro',
      ctaAction: () => startCheckout(key),
    }
  })

  const cardHighlights: Record<CheckoutPlanId, string[]> = {
    basic: [
      allowances.basic.scans,
      allowances.basic.brands,
      allowances.basic.history,
      t('row_checks'),
      t('row_fixpack'),
    ],
    pro: [
      allowances.pro.scans,
      allowances.pro.brands,
      allowances.pro.history,
      t('row_checks'),
      t('row_fixpack_adv'),
      releaseHighlight(pro.release.promptBank, t('row_prompts')),
      releaseHighlight(pro.release.sovAlerts, t('row_alerts')),
      releaseHighlight(pro.release.monitoring, t('row_monitoring')),
      releaseHighlight(pro.release.competitorSummary, t('row_competitor')),
      releaseHighlight(pro.release.clientReports, t('row_client_report')),
    ],
    enterprise: [
      allowances.enterprise.scans,
      allowances.enterprise.brands,
      allowances.enterprise.history,
      t('row_competitor'),
      t('row_csv'),
      t('priority_support'),
      releaseHighlight(enterprise.release.monitoring, t('row_monitoring')),
      releaseHighlight(enterprise.release.clientReports, t('row_client_report')),
    ],
  }
  return (
    <div className="min-h-screen bg-background">

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="bg-white/90 backdrop-blur-md border-b border-border/60 px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <Link href={`/${lang}`} className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Zap aria-hidden="true" className="size-4 text-white" />
          </div>
          <span className="font-black text-foreground tracking-tight">
            Fimmick <span className="text-primary">{t('nav_brand')}</span>
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href={`/${lang}/auth/login`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            {t('signin')}
          </Link>
          <Link href={`/${otherLang}/pricing`} className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors border border-border rounded-md px-2 py-1">
            {otherLabel}
          </Link>
        </div>
      </nav>

      <main>

        {/* ── Hero ────────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
          <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold tracking-widest px-4 py-1.5 rounded-full mb-5 border border-primary/20">
            <Zap aria-hidden="true" className="size-3" />
            {t('badge')}
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground leading-tight mb-4">
            {t('headline')}
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
            {t('subheadline')}
          </p>
        </section>

        {/* ── Pricing Cards ────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="mb-10 flex flex-col items-start gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-3xl">
              <h2 className="text-lg font-bold text-foreground">{t('free_account_title')}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('free_account_body')}</p>
            </div>
            <Link href={`/${lang}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {t('free_account_cta')} <ChevronRight aria-hidden="true" className="ml-1 size-4" />
            </Link>
          </div>
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-black text-foreground">{t('paid_plans_title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('paid_plans_body')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map(plan => {
              const isPro = plan.key === 'pro'
              return (
                <div
                  key={plan.key}
                  className={`relative rounded-2xl p-7 flex flex-col transition-colors transition-shadow duration-200 ${
                    isPro
                      ? 'border-2 border-primary bg-white shadow-2xl shadow-primary/15'
                      : 'border border-border bg-white shadow-sm hover:shadow-md'
                  }`}
                >
                  {isPro && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-white text-[10px] font-black tracking-widest px-4 py-1.5 rounded-full shadow-lg">
                        {t('popular')}
                      </span>
                    </div>
                  )}

                  {/* Plan name + tag */}
                  <p className={`text-xs font-bold tracking-widest uppercase ${isPro ? 'text-primary' : 'text-muted-foreground'}`}>
                    {plan.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-5 leading-snug">{plan.tag}</p>

                  {/* Price */}
                  <div className="mb-6 pb-6 border-b border-border">
                    <span className="text-4xl font-black text-foreground">{plan.price}</span>
                    {plan.key !== 'enterprise' ? (
                      <span className="text-sm text-muted-foreground ml-1">{plan.priceSub}</span>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">{plan.priceSub}</p>
                    )}
                  </div>

                  {/* Feature highlights for card */}
                  <ul className="mb-7 flex-1 space-y-2.5 text-sm">
                    {cardHighlights[plan.key].map(feature => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check
                          aria-hidden="true"
                          className={`mt-0.5 size-3.5 shrink-0 ${plan.key === 'pro' ? 'text-primary' : 'text-emerald-500'}`}
                        />
                        <span className="text-xs text-slate-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {/* CTA */}
                  <button
                    type="button"
                    onClick={plan.ctaAction}
                    disabled={loading}
                    className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isPro
                        ? 'bg-primary text-white hover:bg-primary/90 shadow-primary/20 shadow-md'
                        : 'bg-secondary text-foreground hover:bg-secondary/80 border border-border'
                    } disabled:opacity-60`}
                  >
                    {plan.cta}
                    {!loading && <ChevronRight aria-hidden="true" className="size-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
          <aside className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <h3 className="font-bold text-foreground">{t('enterprise_custom_title')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t('enterprise_custom_body')}
              </p>
            </div>
            <a
              href="mailto:aeo@fimmick.com"
              className="mt-4 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white px-5 text-sm font-semibold text-foreground transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:mt-0"
            >
              {t('enterprise_custom_cta')}
            </a>
          </aside>
          {checkoutError && (
            <p role="alert" className="mt-5 text-center text-sm font-medium text-destructive">{checkoutError}</p>
          )}
        </section>

        {/* ── Comparison Table ─────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <p className="text-xs font-bold text-muted-foreground tracking-widest text-center mb-8 uppercase">
            {t('section_whats_included')}
          </p>

          <div
            role="region"
            aria-label={t('comparison_label')}
            tabIndex={0}
            className="w-full max-w-full overflow-x-auto rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <table className="w-full table-fixed min-w-[400px] overflow-hidden rounded-2xl sm:min-w-[720px] border border-border bg-white shadow-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th scope="col" className="border-b border-border p-4 text-left text-xs font-semibold text-muted-foreground">
                    {t('comparison_feature')}
                  </th>
                  {(['basic', 'pro', 'enterprise'] as Col[]).map(col => (
                    <th
                      key={col}
                      scope="col"
                      className={`border-b border-border p-4 text-center text-xs font-bold tracking-wide ${col === 'pro' ? 'bg-primary/5 text-primary' : 'text-muted-foreground'}`}
                    >
                      {col === 'basic' ? t('col_basic') : col === 'pro' ? t('col_pro') : t('col_enterprise')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const borderClass = i === rows.length - 1 ? '' : 'border-b border-border'
                  const rowClass = row.highlight ? 'bg-primary/3' : i % 2 !== 0 ? 'bg-slate-50/50' : ''
                  const cellProps = {
                    includedLabel: t('included'),
                    notIncludedLabel: t('not_included'),
                  }
                  return (
                    <tr key={row.label} className={rowClass}>
                      <th scope="row" className={`p-3.5 px-4 text-left text-sm font-medium text-slate-700 ${borderClass}`}>
                        {row.label}
                      </th>
                      <td className={`p-3.5 text-center ${borderClass}`}><Cell value={row.basic} {...cellProps} /></td>
                      <td className={`bg-primary/2 p-3.5 text-center ${borderClass}`}><Cell value={row.pro} {...cellProps} /></td>
                      <td className={`p-3.5 text-center ${borderClass}`}><Cell value={row.enterprise} {...cellProps} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="bg-gradient-to-b from-slate-50 to-white border-t border-border/60 py-16">
          <div className="max-w-2xl mx-auto px-6">
            <h2 className="text-2xl font-black text-foreground text-center mb-8">{t('faq_title')}</h2>
            <div className="bg-white border border-border rounded-2xl px-6 shadow-sm">
              <FaqItem
                q={t('faq_1_q')}
                a={t('faq_1_a', {
                  basicScans: allowances.basic.scans,
                  proScans: allowances.pro.scans,
                  enterpriseScans: allowances.enterprise.scans,
                })}
              />
              <FaqItem q={t('faq_2_q')} a={t('faq_2_a')} />
              <FaqItem q={t('faq_3_q')} a={t('faq_3_a')} />
              <FaqItem q={t('faq_4_q')} a={t('faq_4_a')} />
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-600 to-blue-700 py-16">
          <div className="max-w-xl mx-auto px-6 text-center relative">
            <h2 className="text-3xl font-black text-white mb-3">{t('bottom_title')}</h2>
            <p className="text-blue-100 text-sm mb-8 leading-relaxed">{t('bottom_body')}</p>
            <Link
              href={`/${lang}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-8 py-3 text-sm font-semibold text-primary shadow-lg transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              {t('bottom_cta')} <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
            <p className="mt-4 text-xs text-blue-100/80">{t('bottom_note')}</p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="border-t border-border bg-white py-8 px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="size-5 rounded-md bg-primary flex items-center justify-center">
                <Zap aria-hidden="true" className="size-3 text-white" />
              </div>
              <span className="font-bold text-foreground">Fimmick <span className="text-primary">AISO</span></span>
            </div>
            <div className="flex items-center gap-5">
              <Link href={`/${lang}`} className="hover:text-foreground transition-colors">{t('home')}</Link>
              <Link href={`/${lang}/auth/login`} className="hover:text-foreground transition-colors">{t('signin')}</Link>
              <Link href={`/${otherLang}/pricing`} className="hover:text-foreground transition-colors border border-border rounded px-2 py-0.5">{otherLabel}</Link>
            </div>
            <span>© 2026 Fimmick.</span>
          </div>
        </footer>

      </main>
    </div>
  )
}
