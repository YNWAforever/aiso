import { notFound } from 'next/navigation'
import { SourcePackWorkspace } from '@/components/sources/SourcePackWorkspace'
import { requireAuth } from '@/lib/auth'
import { listSourcePage,type SourcePage } from '@/lib/sources/pagination'
import { loadOwnedDraftClient } from '@/lib/work-items/store'
import { buildSourcePack, type SourcePack } from '@/lib/view-models/source-pack'
import { readSource } from '@/lib/sources/store'
import type { SourceDto } from '@/lib/sources/schema'

/**
 * Ownership is decided BEFORE the list is read, and separately from it.
 *
 * `listSources` scopes every statement by account, so another account's client
 * id returns an empty array rather than a leak — but rendering that as "no facts
 * imported yet" would answer a question the caller was not entitled to ask. A
 * client id that is not this account's is 404, the same as one that does not
 * exist, so the two are indistinguishable from outside.
 *
 * A failed ownership *lookup* is not a 404: a database incident must not read as
 * "not yours". It falls through to the error surface, which states plainly that
 * nothing was changed. Likewise a failed list read renders `loadFailed` and not
 * an empty pack — "you have imported nothing" is a different, false statement.
 *
 * Nothing here builds JSX inside a try: a rendering error would escape the catch
 * anyway, so catching around the render would only look like a safety net.
 */
export default async function SourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams?: Promise<Record<string,string|string[]|undefined>>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(lang)
  const query=await searchParams??{}
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const sourceId=typeof query.source==='string'&&uuid.test(query.source)?query.source:null
  const versionId=typeof query.version==='string'&&uuid.test(query.version)?query.version:null
  let initialReview:SourceDto|null=null,initialReviewStale=Boolean(query.source||query.version)

  let owned: { id: string } | null | undefined
  let loadFailed = false
  try {
    owned = await loadOwnedDraftClient(profile.account_id, clientId)
  } catch {
    loadFailed = true
  }
  if (!loadFailed && owned === null) notFound()
  if(!loadFailed&&sourceId&&versionId){
    try{const source=await readSource({accountId:profile.account_id,clientId,actorId:profile.id},sourceId)
      if(source?.current?.id===versionId&&!source.revokedAt){initialReview=source;initialReviewStale=false}
    }catch{/* The requested review stays unavailable; never substitute a newer version. */}
  }

  let pack: SourcePack | null = null
  let page:SourcePage|null=null
  if (!loadFailed) {
    try {
      page=await listSourcePage({ accountId: profile.account_id, clientId, actorId: profile.id },{filter:'all',limit:50,cursor:null})
      if(!page)throw new Error('Source ownership changed')
      pack = buildSourcePack(page.items)
    } catch {
      loadFailed = true
    }
  }

  return <SourcePackWorkspace key={`${clientId}:${sourceId??''}:${versionId??''}`} clientId={clientId} pack={pack} page={page} loadFailed={loadFailed} initialReview={initialReview} initialReviewStale={initialReviewStale} />
}
