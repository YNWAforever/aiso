import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { BillingView } from '@/components/dashboard/BillingView'

export const dynamic = 'force-dynamic'

/** Account-level (not brand-level) billing: fix-pack usage and one-off invoices. */
export default async function BillingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  await requireAuth(locale)
  const t = await getTranslations('billing')

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-black text-foreground">{t('title')}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      <BillingView lang={locale} />
    </main>
  )
}
