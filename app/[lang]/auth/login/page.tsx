import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LoginForm } from '@/components/auth/LoginForm'
import { ArrowLeft, Gauge, ListChecks, Radar, ShieldCheck, Zap } from 'lucide-react'
import { Wordmark } from '@/components/brand/Wordmark'

const POINTS = [
  { key: 'checks', Icon: ListChecks },
  { key: 'fixes', Icon: Gauge },
  { key: 'pulse', Icon: Radar },
] as const

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { lang } = await params
  const { next } = await searchParams
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations({ locale, namespace: 'authFlow.loginPage' })
  const tNav = await getTranslations({ locale, namespace: 'nav' })

  return (
    <>
      <a href="#main-content" className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg focus:not-sr-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {tNav('skip_to_main')}
      </a>
      <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-primary/[0.06] blur-3xl" />
          <div className="absolute -bottom-48 -right-32 size-[38rem] rounded-full bg-[var(--dash-purple)]/[0.05] blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_10%,transparent)_1px,transparent_1.5px)] bg-[length:20px_20px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_55%)]" />
        </div>

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href={`/${lang}`} className="flex min-h-11 items-center gap-2 rounded-lg font-black tracking-tight text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Zap aria-hidden="true" className="size-4 text-primary-foreground" />
            </span>
            <Wordmark />
          </Link>
          <Link href={`/${lang}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('back')}
          </Link>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
          <section aria-labelledby="login-pitch" className="hidden lg:block">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary-accessible">{t('eyebrow')}</p>
            <h2 id="login-pitch" className="mt-4 text-5xl font-black leading-[1.05] tracking-tight text-foreground">
              <span className="block">{t('headlineLead')}</span>
              <span className="text-primary underline decoration-primary/25 decoration-[0.12em] underline-offset-[0.18em] [box-decoration-break:clone]">
                {t('headlineHighlight')}
              </span>
            </h2>
            <p className="mt-6 max-w-md text-lg leading-8 text-muted-foreground">{t('lede')}</p>
            <ul className="mt-10 space-y-6">
              {POINTS.map(({ key, Icon }) => (
                <li key={key} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-sm">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span>
                    <span className="block font-semibold text-foreground">{t(`points.${key}.title`)}</span>
                    <span className="mt-1 block max-w-sm text-sm leading-6 text-muted-foreground">{t(`points.${key}.body`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="mx-auto w-full max-w-md">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)] sm:p-10">
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-black tracking-tight text-foreground">{t('signIn')}</h1>
                <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">{t('subtitle')}</p>
              </div>
              <LoginForm next={next} />
            </div>
            <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--success)]" />
              {t('trust')}
            </p>
          </div>
        </main>
      </div>
    </>
  )
}
