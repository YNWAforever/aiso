import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Radar,
  SearchCheck,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ScanForm } from '@/components/home/ScanForm'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'

type HomePageProps = {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { lang } = await params
  return buildLocalizedMetadata(lang)
}

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'home' })
  const otherLang = lang === 'en' ? 'zh-HK' : 'en'
  const otherLabel = lang === 'en' ? '中文' : 'EN'
  const softwareApplicationJsonLd = buildSoftwareApplicationJsonLd(lang)

  const steps = [
    { number: '01', title: t('proof_step1_title'), body: t('proof_step1_body'), icon: Globe2 },
    { number: '02', title: t('proof_step2_title'), body: t('proof_step2_body'), icon: SearchCheck },
    { number: '03', title: t('proof_step3_title'), body: t('proof_step3_body'), icon: FileCheck2 },
  ]

  const capabilities = [
    { title: t('proof_capability_checks_title'), body: t('proof_capability_checks_body'), icon: SearchCheck },
    { title: t('proof_capability_dossier_title'), body: t('proof_capability_dossier_body'), icon: BarChart3 },
    { title: t('proof_capability_fix_title'), body: t('proof_capability_fix_body'), icon: FileCheck2 },
    { title: t('proof_capability_monitor_title'), body: t('proof_capability_monitor_body'), icon: Radar },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={`/${lang}`} className="flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary shadow-sm">
              <Zap aria-hidden="true" className="size-4 text-primary-foreground" />
            </span>
            <span className="font-black tracking-tight">Fimmick <span className="text-primary">AISO</span></span>
          </Link>
          <nav aria-label={t('proof_public_nav')} className="flex items-center gap-1 sm:gap-3">
            <Link href={`/${lang}/pricing`} className="hidden min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">
              {t('footer_pricing')}
            </Link>
            <Link href={`/${lang}/auth/login`} className="hidden min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex">
              {t('footer_sign_in')}
            </Link>
            <Link href={`/${otherLang}`} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
              {otherLabel}
            </Link>
            <a href="#scan" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {t('cta')}
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section id="scan" className="relative overflow-hidden border-b border-border/70">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent dark:from-primary/15 dark:via-primary/5" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                <Bot aria-hidden="true" className="size-3.5" />
                {t('proof_eyebrow')}
              </div>
              <h1 className="max-w-3xl text-4xl font-black leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {t('proof_headline')}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                {t('proof_subheadline', { count: PRODUCT_FACTS.checkCount })}
              </p>

              <div className="mt-8 rounded-2xl border border-border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5 dark:shadow-black/30">
                <ScanForm lang={lang} />
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><LockKeyhole aria-hidden="true" className="size-4 text-success" />{t('proof_no_signup')}</span>
                  <span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="size-4 text-success" />{t('proof_no_card')}</span>
                  <span className="inline-flex items-center gap-1.5"><Bot aria-hidden="true" className="size-4 text-success" />{t('proof_platforms', { count: PRODUCT_FACTS.platforms.length })}</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-slate-950 p-4 text-slate-100 shadow-2xl shadow-slate-950/20 sm:p-6 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">{t('proof_preview_label')}</p>
                  <p className="mt-1 font-bold">fimmick.com</p>
                </div>
                <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300">{t('proof_preview_note')}</span>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-center">
                <div className="rounded-2xl bg-slate-900 p-5 text-center ring-1 ring-slate-700">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('proof_score_label')}</p>
                  <p className="mt-2 text-5xl font-black text-white">74</p>
                  <p className="mt-1 text-sm text-slate-400">/ {PRODUCT_FACTS.scoreMaximum}</p>
                  <span className="mt-3 inline-flex rounded-md bg-cyan-300 px-2.5 py-1 text-sm font-black text-slate-950">B+</span>
                </div>
                <div className="space-y-3">
                  {[
                    [t('proof_signal_access'), '84%', 'bg-cyan-300'],
                    [t('proof_signal_content'), '72%', 'bg-blue-400'],
                    [t('proof_signal_authority'), '61%', 'bg-violet-400'],
                  ].map(([label, width, color]) => (
                    <div key={label}>
                      <div className="mb-1 flex justify-between text-xs"><span className="text-slate-300">{label}</span><span className="font-bold text-white">{width}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${color}`} style={{ width }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                <div className="rounded-xl bg-emerald-400/10 p-3 text-emerald-300"><span className="block text-xl text-white">14</span>{t('proof_passing')}</div>
                <div className="rounded-xl bg-amber-400/10 p-3 text-amber-300"><span className="block text-xl text-white">4</span>{t('proof_warnings')}</div>
                <div className="rounded-xl bg-rose-400/10 p-3 text-rose-300"><span className="block text-xl text-white">2</span>{t('proof_failing')}</div>
              </div>
              <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
                <div className="flex items-start gap-3">
                  <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cyan-300" />
                  <div><p className="text-sm font-bold text-white">{t('proof_priority_title')}</p><p className="mt-1 text-xs leading-relaxed text-slate-400">{t('proof_priority_body')}</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-label={t('proof_platform_section')} className="border-b border-border bg-card py-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm font-semibold text-muted-foreground">{t('proof_platform_section')}</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-3">
              {PRODUCT_FACTS.platforms.map((platform) => <li key={platform} className="text-sm font-black text-foreground">{platform}</li>)}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{t('proof_how_label')}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{t('proof_how_title')}</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('proof_how_body')}</p>
          </div>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map(({ number, title, body, icon: Icon }) => (
              <li key={number} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between"><span className="text-sm font-black text-primary">{number}</span><Icon aria-hidden="true" className="size-5 text-primary" /></div>
                <h3 className="mt-5 text-lg font-black">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-border bg-slate-950 py-16 text-slate-100 sm:py-24 dark:border-slate-700">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">{t('proof_method_label')}</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{t('proof_method_title')}</h2>
              <p className="mt-5 text-base leading-relaxed text-slate-300">{t('proof_method_body', { count: PRODUCT_FACTS.checkCount })}</p>
              <ul className="mt-7 space-y-3">
                {[t('proof_method_point1'), t('proof_method_point2'), t('proof_method_point3')].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-slate-200"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cyan-300" />{item}</li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {capabilities.map(({ title, body, icon: Icon }) => (
                <article key={title} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
                  <Icon aria-hidden="true" className="size-5 text-cyan-300" />
                  <h3 className="mt-4 font-black text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="scan-again" className="px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl rounded-3xl border border-primary/20 bg-card p-5 shadow-xl shadow-primary/5 sm:p-10 dark:shadow-black/30">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{t('proof_bottom_label')}</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{t('proof_bottom_title')}</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('proof_bottom_body')}</p>
            </div>
            <div className="mx-auto mt-8 max-w-xl"><ScanForm lang={lang} /></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2 font-bold text-foreground"><Zap aria-hidden="true" className="size-4 text-primary" />Fimmick AISO</div>
          <nav aria-label={t('proof_footer_nav')} className="flex flex-wrap items-center justify-center gap-5">
            <Link href={`/${lang}/pricing`} className="min-h-11 content-center transition-colors hover:text-foreground">{t('footer_pricing')}</Link>
            <Link href={`/${lang}/auth/login`} className="min-h-11 content-center transition-colors hover:text-foreground">{t('footer_sign_in')}</Link>
            <Link href={`/${otherLang}`} className="min-h-11 content-center transition-colors hover:text-foreground">{otherLabel}</Link>
          </nav>
          <span>{t('footer_copyright')}</span>
        </div>
      </footer>
    </div>
  )
}
