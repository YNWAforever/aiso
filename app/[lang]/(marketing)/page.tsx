import type { Metadata } from 'next'
import {
  ArrowRight,
  BarChart3,
  Bot,
  ChevronDown,
  CheckCircle2,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Radar,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ScanForm } from '@/components/home/ScanForm'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade } from '@/lib/scoring'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'

/** The hero's example score. Its grade is derived, never typed, so the preview can't show a grade the scorer would never assign. */
const PREVIEW_SCORE = 74
/** Lower bound of each grade band, highest first; labels come from assignGrade itself. */
const GRADE_FLOORS = [90, 80, 70, 60, 50, 0]

const sumPoints = (weights: Record<string, number>) => Object.values(weights).reduce((sum, pts) => sum + pts, 0)

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
  const softwareApplicationJsonLd = buildSoftwareApplicationJsonLd(lang)
  const platformList = new Intl.ListFormat(lang === 'zh-HK' ? 'zh-HK' : 'en', { style: 'long', type: 'conjunction' }).format(PRODUCT_FACTS.platforms)

  const buckets = [
    { key: 'core', title: t('score_core_title'), body: t('score_core_body'), weights: CORE_PTS, bar: 'bg-primary' },
    { key: 'extended', title: t('score_extended_title'), body: t('score_extended_body'), weights: EXT_PTS, bar: 'bg-[var(--dash-purple)]' },
    { key: 'geo', title: t('score_geo_title'), body: t('score_geo_body'), weights: GEO_PTS, bar: 'bg-[var(--success)]' },
  ].map(bucket => ({ ...bucket, points: sumPoints(bucket.weights), checks: Object.keys(bucket.weights).length }))

  const faqs = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3', { count: PRODUCT_FACTS.checkCount }) },
    { q: t('faq_q4'), a: t('faq_a4', { platforms: platformList }) },
  ]
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: lang,
    mainEntity: faqs.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }

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
    <div className="bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }}
      />

        <section id="scan" className="relative overflow-hidden border-b border-border/70">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent dark:from-primary/15 dark:via-primary/5" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_9%,transparent)_1px,transparent_1.5px)] bg-[length:22px_22px] [mask-image:radial-gradient(ellipse_at_top_right,black_5%,transparent_60%)]" />
          <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-primary-accessible">
                <Bot aria-hidden="true" className="size-3.5" />
                {t('proof_eyebrow')}
              </div>
              <h1 className="max-w-3xl text-balance text-4xl font-black leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {t('proof_headline')}
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
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
              <Link href={`/${lang}/sample-report`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary-accessible underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {t('proof_sample_link')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
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
                  <p className="mt-2 text-5xl font-black text-white">{PREVIEW_SCORE}</p>
                  <p className="mt-1 text-sm text-slate-400">/ {PRODUCT_FACTS.scoreMaximum}</p>
                  <span className="mt-3 inline-flex rounded-md bg-cyan-300 px-2.5 py-1 text-sm font-black text-slate-950">{assignGrade(PREVIEW_SCORE)}</span>
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
            <ul className="flex flex-wrap gap-2">
              {PRODUCT_FACTS.platforms.map((platform) => (
                <li key={platform} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-bold text-foreground">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                  {platform}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{t('proof_how_label')}</p>
            <h2 className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{t('proof_how_title')}</h2>
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
              <h2 className="mt-3 text-balance text-3xl font-black tracking-tight text-white sm:text-4xl">{t('proof_method_title')}</h2>
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

        <section aria-labelledby="score-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div className="max-w-xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-accessible">{t('score_label')}</p>
              <h2 id="score-title" className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{t('score_title')}</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('score_body')}</p>
            </div>
            <div>
              <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-muted">
                {buckets.map(bucket => <div key={bucket.key} className={`${bucket.bar} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${bucket.points}%` }} />)}
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('score_grades_label')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {GRADE_FLOORS.map((floor, index) => (
                  <li key={floor} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                    <span className="font-black text-foreground">{assignGrade(floor)}</span>
                    {index === 0 ? `≥ ${floor}` : floor === 0 ? `< ${GRADE_FLOORS[index - 1]}` : `${floor}–${GRADE_FLOORS[index - 1] - 1}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {buckets.map(bucket => (
              <li key={bucket.key} className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${bucket.bar}`} />
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-3xl font-black tabular-nums text-foreground">{t('score_points', { points: bucket.points })}</span>
                  <span className="whitespace-nowrap text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('score_checks', { count: bucket.checks })}</span>
                </p>
                <h3 className="mt-3 text-lg font-black">{bucket.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{bucket.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-title" className="border-t border-border bg-card py-16 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary-accessible">{t('faq_label')}</p>
              <h2 id="faq-title" className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{t('faq_title')}</h2>
            </div>
            <div className="divide-y divide-border rounded-2xl border border-border bg-background">
              {faqs.map(({ q, a }) => (
                <details key={q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    {q}
                    <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="scan-again" className="px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl rounded-3xl border border-primary/20 bg-card p-5 shadow-xl shadow-primary/5 sm:px-10 sm:pb-6 sm:pt-10 dark:shadow-black/30">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">{t('proof_bottom_label')}</p>
              <h2 className="mt-3 text-balance text-3xl font-black tracking-tight sm:text-4xl">{t('proof_bottom_title')}</h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t('proof_bottom_body')}</p>
            </div>
            <div className="mx-auto mt-8 max-w-xl"><ScanForm lang={lang} /></div>
          </div>
        </section>
    </div>
  )
}
