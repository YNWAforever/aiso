import { notFound } from 'next/navigation'
import { SourcePackWorkspace } from '@/components/sources/SourcePackWorkspace'
import { requireAuth } from '@/lib/auth'
import { listSources } from '@/lib/sources/store'
import { loadOwnedDraftClient } from '@/lib/work-items/store'
import { buildSourcePack, type SourcePack } from '@/lib/view-models/source-pack'

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
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(lang)

  let owned: { id: string } | null | undefined
  let loadFailed = false
  try {
    owned = await loadOwnedDraftClient(profile.account_id, clientId)
  } catch {
    loadFailed = true
  }
  if (!loadFailed && owned === null) notFound()

  let pack: SourcePack | null = null
  if (!loadFailed) {
    try {
      pack = buildSourcePack(
        await listSources({ accountId: profile.account_id, clientId, actorId: profile.id }),
      )
    } catch {
      loadFailed = true
    }
  }

  return <SourcePackWorkspace clientId={clientId} pack={pack} loadFailed={loadFailed} />
}
