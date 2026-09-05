import { getTranslations } from 'next-intl/server'
import { PublicInformationPage, type PublicPageCopy } from '@/components/marketing/PublicInformationPage'
import { buildLocalizedMetadata } from '@/lib/seo'
import { NAV } from '@/lib/navigation'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/platform')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'publicPages' })
  const nav = await getTranslations({ locale: lang, namespace: 'nav' })
  const related = NAV
    .filter(entry => entry.available && entry.section === 'platform' && entry.href !== '/platform')
    .map(entry => ({ href: entry.href, label: nav(entry.labelKey.replace(/^nav\./, '')) }))
  return <PublicInformationPage lang={lang} copy={t.raw('platform') as PublicPageCopy} related={related} />
}
