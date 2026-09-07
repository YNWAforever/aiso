import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buildLocalizedMetadata } from '@/lib/seo'
import { ScanForm } from '@/components/home/ScanForm'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/scan')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'scanPage' })
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t('title')}</h1>
      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{t('summary')}</p>
      <section aria-label={t('formLabel')} className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <ScanForm lang={lang} />
      </section>
      <p className="mt-6 leading-relaxed text-muted-foreground">{t('limitations')}</p>
      <Link href={`/${lang}/methodology`} className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">{t('methodology')}</Link>
    </div>
  )
}
