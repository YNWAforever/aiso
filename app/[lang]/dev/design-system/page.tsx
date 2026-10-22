import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { DesignSystemGallery } from '@/components/dev/DesignSystemGallery'

type Props = { params: Promise<{ lang: string }> }

/**
 * Internal component gallery. Hidden on the production deployment only, so it
 * stays reviewable on Vercel previews, locally, and in the CI e2e server (none
 * of which set VERCEL_ENV=production). Never indexed.
 */
function hidden(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (hidden()) return {}
  const { lang } = await params
  const t = await getTranslations({ locale: lang, namespace: 'designSystem' })
  return { title: t('title'), robots: { index: false, follow: false } }
}

export default async function DesignSystemPage({ params }: Props) {
  if (hidden()) notFound()
  const { lang } = await params
  setRequestLocale(lang)
  return <DesignSystemGallery />
}
