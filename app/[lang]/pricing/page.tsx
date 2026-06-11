'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Zap, Check, Minus, ChevronDown, ChevronRight } from 'lucide-react'

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
function Cell({ value }: { value: string | boolean }) {
  if (value === true)  return <Check className="size-4 text-emerald-500 mx-auto" />
  if (value === false) return <Minus className="size-4 text-slate-300 mx-auto" />
  return <span className="text-sm text-slate-700 text-center block">{value}</span>
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-4 text-left gap-4"
      >
        <span className="text-sm font-semibold text-slate-800">{q}</span>
        <ChevronDown className={`size-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="text-sm text-slate-600 leading-relaxed pb-4">{a}</p>}
    </div>
  )
}

/* ── Main component ─────────────────────────────────────────── */
export default function PricingPage() {
  const [annual, setAnnual]         = useState(false)
  const [loading, setLoading]       = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const { lang } = useParams<{ lang: string }>()
  const t = useTranslations('pricing')

  const basicMonthly = 29
  const basicAnnual  = 23 // ~20% off
  const proMonthly = 79
  const proAnnual  = 63 // ~20% off
  const enterpriseMonthly = 199
  const enterpriseAnnual  = 159 // ~20% off

  const startCheckout = async (planName: string) => {
    setLoading(true)
    setCheckoutError('')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planName, annual }),
      })
      if (res.status === 401) {
        window.location.href = `/${lang}/auth/login?next=/${lang}/pricing`
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setCheckoutError(data.error ?? t('error_generic'))
        setLoading(false)
        return
      }
      if (data.url) window.location.href = data.url
    } catch {
      setCheckoutError(t('error_network'))
      setLoading(false)
    }
  }

  const otherLang  = lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = lang === 'en' ? '中文' : 'EN'

  /* Feature comparison rows */
  const rows: FeatureRow[] = [
    { label: t('row_scans'),         basic: t('row_scans_s'),      pro: t('row_scans_p'),      enterprise: t('row_scans_e') },
    { label: t('row_checks'),        basic: true,                   pro: true,                   enterprise: true },
    { label: t('row_fixpack'),       basic: true,                   pro: true,                   enterprise: true },
    { label: t('row_fixpack_adv'),   basic: false,                  pro: true,                   enterprise: true, highlight: true },
    { label: t('row_brands'),        basic: t('row_brands_s'),      pro: t('row_brands_p'),      enterprise: t('row_brands_e') },
    { label: t('row_history'),       basic: t('row_history_s'),     pro: t('row_history_p'),     enterprise: t('row_history_e') },
    { label: t('row_prompts'),       basic: false,                  pro: true,                   enterprise: true },
    { label: t('row_alerts'),        basic: false,                  pro: true,                   enterprise: true },
    { label: t('row_competitor'),    basic: false,                  pro: true,                   enterprise: true },
    { label: t('row_authority'),     basic: t('row_authority_s'),   pro: t('row_authority_p'),   enterprise: t('row_authority_e'), highlight: true },
    { label: t('row_csv'),           basic: false,                  pro: false,                  enterprise: true },
    { label: t('row_pdf'),           basic: false,                  pro: false,                  enterprise: true },
    { label: t('row_api'),           basic: false,                  pro: false,                  enterprise: true },
    { label: t('row_custom_platforms'), basic: false,               pro: false,                  enterprise: true },
    { label: t('row_support'),       basic: false,                  pro: false,                  enterprise: true },
  ]

  const plans: { key: Col; name: string; tag: string; price: string; priceSub: string; cta: string; popular?: boolean; ctaAction: () => void }[] = [
    {
      key: 'basic',
      name: t('basic_name'),
      tag:  t('basic_tag'),
      price: `$${annual ? basicAnnual : basicMonthly}`,
      priceSub: annual ? t('per_month_annual') : t('per_month'),
      cta: loading ? t('cta_loading') : t('cta_basic'),
      ctaAction: () => startCheckout('basic'),
    },
    {
      key: 'pro',
      name: t('pro_name'),
      tag:  t('pro_tag'),
      price: `$${annual ? proAnnual : proMonthly}`,
      priceSub: annual ? t('per_month_annual') : t('per_month'),
      cta: loading ? t('cta_loading') : t('cta_pro'),
      popular: true,
      ctaAction: () => startCheckout('pro'),
    },
    {
      key: 'enterprise',
      name: t('enterprise_name'),
      tag:  t('enterprise_tag'),
      price: `$${annual ? enterpriseAnnual : enterpriseMonthly}`,
      priceSub: annual ? t('per_month_annual') : t('per_month'),
      cta: loading ? t('cta_loading') : t('cta_enterprise'),
      ctaAction: () => startCheckout('enterprise'),
    },
  ]

  return (
    <div className="min-h-screen bg-background">

      {/* ── Nav ─────────────────────────────────────────────── */}
      <nav className="bg-white/90 backdrop-blur-md border-b border-border/60 px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <Link href={`/${lang}`} className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Zap className="size-4 text-white" />
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
            <Zap className="size-3" />
            {t('badge')}
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground leading-tight mb-4">
            {t('headline')}
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto leading-relaxed">
            {t('subheadline')}
          </p>

          {/* Monthly / Annual toggle */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={`text-sm font-semibold ${!annual ? 'text-foreground' : 'text-muted-foreground'}`}>
              {t('toggle_monthly')}
            </span>
            <button
              onClick={() => setAnnual(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner ${annual ? 'bg-primary' : 'bg-slate-200'}`}
            >
              <span className={`inline-block size-4 transform rounded-full bg-white shadow-md transition-transform ${annual ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-semibold ${annual ? 'text-foreground' : 'text-muted-foreground'}`}>
              {t('toggle_annual')}
            </span>
            {annual && (
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                {t('annual_discount')}
              </span>
            )}
          </div>
        </section>

        {/* ── Pricing Cards ────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map(plan => {
              const isPro = plan.key === 'pro'
              return (
                <div
                  key={plan.key}
                  className={`relative rounded-2xl p-7 flex flex-col transition-all duration-200 ${
                    isPro
                      ? 'border-2 border-primary bg-white shadow-2xl shadow-primary/15 scale-[1.02]'
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
                  <ul className="space-y-2.5 text-sm flex-1 mb-7">
                    {plan.key === 'basic' && [
                      t('row_scans_s') + ' ' + t('row_scans'),
                      t('row_checks'),
                      t('row_fixpack'),
                      t('row_brands_s') + ' ' + t('row_brands').toLowerCase(),
                      t('row_history_s') + ' ' + t('row_history').toLowerCase(),
                    ].map(f => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="size-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span className="text-slate-600 text-xs">{f}</span>
                      </li>
                    ))}
                    {plan.key === 'pro' && [
                      t('row_scans_p') + ' ' + t('row_scans'),
                      t('row_checks'),
                      t('row_fixpack'),
                      t('row_fixpack_adv'),
                      t('row_brands_p') + ' ' + t('row_brands').toLowerCase(),
                      t('row_history_p') + ' ' + t('row_history').toLowerCase(),
                      t('row_prompts'),
                      t('row_alerts'),
                      t('row_competitor'),
                    ].map(f => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="size-3.5 text-primary mt-0.5 shrink-0" />
                        <span className="text-slate-700 text-xs">{f}</span>
                      </li>
                    ))}
                    {plan.key === 'enterprise' && [
                      t('row_scans_e') + ' ' + t('row_scans'),
                      t('row_brands_e') + ' ' + t('row_brands').toLowerCase(),
                      t('row_history_e') + ' ' + t('row_history').toLowerCase(),
                      t('row_csv'),
                      t('row_pdf'),
                      t('row_api'),
                      t('row_support'),
                    ].map(f => (
                      <li key={f} className="flex items-start gap-2.5">
                        <Check className="size-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span className="text-slate-600 text-xs">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={plan.ctaAction}
                    disabled={loading}
                    className={`w-full py-3 rounded-xl text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-1.5 shadow-sm ${
                      isPro
                        ? 'bg-primary text-white hover:bg-primary/90 shadow-primary/20 shadow-md'
                        : 'bg-secondary text-foreground hover:bg-secondary/80 border border-border'
                    } disabled:opacity-60`}
                  >
                    {plan.cta}
                    {!loading && <ChevronRight className="size-3.5" />}
                  </button>

                  {plan.key === 'pro' && checkoutError && (
                    <p className="mt-2 text-destructive text-xs text-center">{checkoutError}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Comparison Table ─────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
          <p className="text-xs font-bold text-muted-foreground tracking-widest text-center mb-8 uppercase">
            {t('section_whats_included')}
          </p>

          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            {/* Header */}
            <div className="grid grid-cols-4 bg-slate-50 border-b border-border">
              <div className="p-4 text-xs font-semibold text-muted-foreground" />
              {(['basic', 'pro', 'enterprise'] as Col[]).map(col => (
                <div key={col} className={`p-4 text-center text-xs font-bold tracking-wide ${col === 'pro' ? 'text-primary bg-primary/5' : 'text-muted-foreground'}`}>
                  {col === 'basic' ? t('col_basic') : col === 'pro' ? t('col_pro') : t('col_enterprise')}
                </div>
              ))}
            </div>

            {/* Rows */}
            {rows.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-4 border-b border-border last:border-0 ${i % 2 !== 0 ? 'bg-slate-50/50' : ''} ${row.highlight ? 'bg-primary/3' : ''}`}
              >
                <div className="p-3.5 px-4 text-sm text-slate-700 font-medium">{row.label}</div>
                <div className="p-3.5 flex items-center justify-center"><Cell value={row.basic} /></div>
                <div className="p-3.5 flex items-center justify-center bg-primary/2"><Cell value={row.pro} /></div>
                <div className="p-3.5 flex items-center justify-center"><Cell value={row.enterprise} /></div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────── */}
        <section className="bg-gradient-to-b from-slate-50 to-white border-t border-border/60 py-16">
          <div className="max-w-2xl mx-auto px-6">
            <h2 className="text-2xl font-black text-foreground text-center mb-8">{t('faq_title')}</h2>
            <div className="bg-white border border-border rounded-2xl px-6 shadow-sm">
              <FaqItem q={t('faq_1_q')} a={t('faq_1_a')} />
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
              className="inline-flex items-center gap-2 bg-white text-primary font-semibold px-8 py-3 rounded-xl hover:bg-white/90 transition-colors text-sm shadow-lg"
            >
              {t('bottom_cta')} <ChevronRight className="size-4" />
            </Link>
            <p className="text-blue-200/60 text-xs mt-4">Free scan · No credit card required</p>
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <footer className="border-t border-border bg-white py-8 px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="size-5 rounded-md bg-primary flex items-center justify-center">
                <Zap className="size-3 text-white" />
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
