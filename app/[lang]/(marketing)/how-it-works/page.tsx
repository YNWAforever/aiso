import { getTranslations } from 'next-intl/server'
import { PublicInformationPage, type PublicPageCopy } from '@/components/marketing/PublicInformationPage'
import { buildLocalizedMetadata } from '@/lib/seo'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/how-it-works')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'publicPages' })
  const nav = await getTranslations({ locale: lang, namespace: 'nav' })
  return <PublicInformationPage lang={lang} copy={t.raw('how_it_works') as PublicPageCopy} related={[{ href: '/platform', label: nav('platform.overview') }, { href: '/pricing', label: nav('pricing') }]} />
}
