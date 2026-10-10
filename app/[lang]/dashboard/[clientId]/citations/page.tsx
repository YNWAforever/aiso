import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CitationExplorer } from '@/components/dashboard/CitationExplorer'
import { requireAuth } from '@/lib/auth'
import { readCitationReport } from '@/lib/citations/report'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Cited sources (GEO parity Step 5): which websites AI answers cite for this
 * brand's questions. Signed-in and owned, no plan gate, like the API it shares
 * a reader with.
 */
export default async function CitationsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations('citations')
  const profile = await requireAuth(locale)

  const sql = db()
  const [client] = await sql`select brand_name from clients where id = ${clientId} and account_id = ${profile.account_id} limit 1`
  // 404 rather than 403: the id came from the caller.
  if (!client) notFound()
  const report = await readCitationReport(sql, profile.account_id, clientId)
  if (!report) notFound()

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <Link href={`/${locale}/dashboard/${clientId}`} className="mb-4 inline-flex min-h-11 items-center text-sm text-primary-accessible underline">
        {t('back')}
      </Link>
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">{String(client.brand_name)}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
      </div>
      <CitationExplorer report={report} clientId={clientId} />
    </main>
  )
}
