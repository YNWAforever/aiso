import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { buildLocalizedMetadata } from '@/lib/seo'

type PricingLayoutProps = {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PricingLayoutProps): Promise<Metadata> {
  const { lang } = await params
  if (!(routing.locales as readonly string[]).includes(lang)) notFound()

  return buildLocalizedMetadata(lang, 'pricing')
}

export default function PricingLayout({ children }: PricingLayoutProps) {
  return <>{children}</>
}
