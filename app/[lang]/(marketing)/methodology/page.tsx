import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buildLocalizedMetadata } from '@/lib/seo'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/methodology')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'methodologyPage' })
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t('title')}</h1>
      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{t('summary')}</p>
      <div className="mt-10 space-y-8">
        {(['pillars', 'coverage', 'gates', 'history', 'limits'] as const).map(key => (
          <section key={key} className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold">{t(`${key}.title`)}</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">{t(`${key}.body`)}</p>
          </section>
        ))}
      </div>
      <Link href={`/${lang}/scan`} className="mt-8 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">{t('scan')}</Link>
    </div>
  )
}
