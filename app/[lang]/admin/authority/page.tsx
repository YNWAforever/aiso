import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

export default async function AuthorityUnavailablePage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const t = await getTranslations('unavailable')

  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('body')}</p>
      <Link href={`/${lang}/dashboard`} className="mt-8 inline-block underline">
        {t('back')}
      </Link>
    </main>
  )
}
