import { getTranslations } from 'next-intl/server'
import { PublicInformationPage, type PublicPageCopy } from '@/components/marketing/PublicInformationPage'
import { buildLocalizedMetadata } from '@/lib/seo'

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props) {
  const { lang } = await params
  return buildLocalizedMetadata(lang, '/resources')
}

export default async function Page({ params }: Props) {
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'publicPages' })
  const nav = await getTranslations({ locale: lang, namespace: 'nav' })
  return <PublicInformationPage lang={lang} copy={t.raw('resources') as PublicPageCopy} related={[{ href: '/platform/site-health', label: nav('platform.site_health') }, { href: '/platform/ai-visibility', label: nav('platform.ai_visibility') }, { href: '/platform/action-studio', label: nav('platform.action_studio') }, { href: '/how-it-works', label: nav('company.how_it_works') }]} />
}
