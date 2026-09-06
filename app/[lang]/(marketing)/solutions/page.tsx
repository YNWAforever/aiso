import { getTranslations } from 'next-intl/server'
import { PublicInformationPage, type PublicPageCopy } from '@/components/marketing/PublicInformationPage'
import { buildLocalizedMetadata } from '@/lib/seo'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/solutions')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'publicPages' })
  const nav = await getTranslations({ locale: lang, namespace: 'nav' })
  return <PublicInformationPage lang={lang} copy={t.raw('solutions') as PublicPageCopy} related={[{ href: '/solutions/sme', label: nav('solutions.sme') }, { href: '/solutions/agencies', label: nav('solutions.agencies') }, { href: '/solutions/enterprise', label: nav('solutions.enterprise') }, { href: '/solutions/regulated-industries', label: nav('solutions.regulated_industries') }]} />
}
