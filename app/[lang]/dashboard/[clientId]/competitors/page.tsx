import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CompetitorsEditor } from '@/components/dashboard/CompetitorsEditor'
import { requireAuth } from '@/lib/auth'
import { MAX_COMPETITORS } from '@/lib/competitors/schema'
import { listCompetitors } from '@/lib/competitors/store'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * A brand's competitors: the names Pulse looks for next to the brand, their
 * other spellings, and their websites. Until 061 these were set once during
 * onboarding and never editable afterwards.
 *
 * No plan gate, like the API: every plan sets competitors at onboarding.
 */
export default async function CompetitorsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('competitors')
  const profile = await requireAuth(locale)

  const sql = db()
  const [client] = await sql`select brand_name from clients where id = ${clientId} and account_id = ${profile.account_id} limit 1`
  // 404 rather than 403: the id came from the caller.
  if (!client) notFound()
  const competitors = await listCompetitors(sql, profile.account_id, clientId)
  if (!competitors) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href={`/${locale}/dashboard/${clientId}`} className="mb-4 inline-flex min-h-11 items-center text-sm text-primary-accessible underline">
        {t('back')}
      </Link>
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">{String(client.brand_name)}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
      </div>
      <CompetitorsEditor clientId={clientId} initialCompetitors={competitors} max={MAX_COMPETITORS} />
    </main>
  )
}
