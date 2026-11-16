import {parseCitationQuery} from '@/lib/citations/query'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CitationExplorer } from '@/components/dashboard/CitationExplorer'
import { WhatAiSaysPage } from '@/components/dashboard/sme/WhatAiSaysPage'
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
  params,searchParams,
}: {
  searchParams:Promise<Record<string,string|string[]|undefined>>
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
  const raw=await searchParams
  let query;try{query=parseCitationQuery(new URLSearchParams(Object.entries(raw??{}).filter(([,v])=>typeof v==='string') as [string,string][]))}catch{return <WhatAiSaysPage title={t('title')} description={t('intro')}><p role="alert" className="rounded-xl border border-tone-danger/40 bg-tone-danger-soft p-4 text-sm text-tone-danger-fg">{t('invalid_filters')}</p></WhatAiSaysPage>}
  let report;try{report=await readCitationReport(sql, profile.account_id, clientId,query)}catch{return <WhatAiSaysPage title={t('title')} description={t('intro')}><p role="alert" className="rounded-xl border border-tone-danger/40 bg-tone-danger-soft p-4 text-sm text-tone-danger-fg">{t('read_unavailable')}</p></WhatAiSaysPage>}
  if (!report) notFound()

  return (
    <WhatAiSaysPage title={t('title')} description={t('intro')}>
      <CitationExplorer report={report} clientId={clientId} />
    </WhatAiSaysPage>
  )
}
