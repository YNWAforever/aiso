import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'

export default async function StudioPage({ params }: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const profile = await requireAuth(lang)
  if (!isFeatureEnabled('conversation_studio')) redirect(`/${lang}/dashboard/${encodeURIComponent(clientId)}?step=home`)
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) notFound()

  let brands
  try {
    // Only establish brand ownership. No scans, analysis or conversation store.
    brands = await db()`select id, brand_name from clients where id = ${clientId} and account_id = ${profile.account_id}`
  } catch {
    const t = await getTranslations('conversationStudio')
    return <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p role="alert">{t('loadError')}</p>
      <a href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/studio`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 underline">{t('retry')}</a>
    </main>
  }
  const brand = brands[0]
  if (!brand) notFound()
  // Brand changes remount the demo, clearing all page-local conversation state.
  return <ConversationStudio key={clientId} brandName={brand.brand_name} />
}
