import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { isSmeCopilotUiEnabled } from '@/lib/flags'
import { readAuthenticatedDraft, WorkItemServiceError } from '@/lib/work-items/service'
import { listAuthenticatedVersions, readAuthenticatedVersion } from '@/lib/change-sets/service'
import { parseVersionDetail, parseVersionPage } from '@/lib/change-sets/read-view'
import type { VersionDetail } from '@/lib/change-sets/types'
import { VersionWorkspace, type VersionPageDTO } from '@/components/change-sets/VersionWorkspace'
export default async function VersionsPage({ params }: {
  params: Promise<{ lang: string; clientId: string; workItemId: string }>
}) {
  const { lang: requested, clientId: requestedClientId, workItemId: requestedWorkItemId } = await params,
    lang = requested === 'zh-HK' ? 'zh-HK' : 'en',
    // The existing owned-draft service validates UUIDs case-insensitively;
    // PostgreSQL returns their canonical lowercase representation.
    clientId = requestedClientId.toLowerCase(), workItemId = requestedWorkItemId.toLowerCase()
  await requireAuth(lang)
  const smeCopilot = isSmeCopilotUiEnabled()
  const t = await getTranslations({ locale: lang, namespace: 'changeSets' })
  let draft
  try {
    draft = (await readAuthenticatedDraft(clientId, workItemId)).item
    if (!draft || draft.id !== workItemId || draft.clientId !== clientId) throw Error()
  } catch (error) {
    if (error instanceof WorkItemServiceError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/${lang}/auth/login`)
      if (['WORK_ITEM_NOT_FOUND', 'CLIENT_NOT_FOUND', 'INVALID_WORK_ITEM_INPUT'].includes(error.code)) notFound()
    }
    return <main className="space-y-4 p-8"><h1>{t('title')}</h1><p role="alert">{t('unavailable')}</p></main>
  }
  let response: Response | null = null
  try { response = await listAuthenticatedVersions(clientId, workItemId, new URLSearchParams()) } catch { /* A failed list read is unavailable, never an empty history. */ }
  if (response?.status === 401) redirect(`/${lang}/auth/login`)
  if (response?.status === 404 || response?.status === 403) notFound()
  let initial: VersionPageDTO | null = null, initialVersion: VersionDetail | null = null, initialError = 'unavailable'
  if (response?.ok) {
    try {
      const body = await response.json()
      initial = smeCopilot ? parseVersionPage(body, workItemId) : body
      initialError = ''
    } catch { /* Retain the successfully loaded draft for explicit retry. */ }
  }
  if (smeCopilot && initial?.latestVersionId) {
    let detail: Response | null = null
    try { detail = await readAuthenticatedVersion(clientId, workItemId, initial.latestVersionId) } catch { /* Keep history available when this detail cannot be read. */ }
    if (detail?.status === 401) redirect(`/${lang}/auth/login`)
    if (detail?.status === 404 || detail?.status === 403) notFound()
    try {
      if (!detail?.ok) throw Error()
      const body = await detail.json()
      const summary = initial.versions.find(version => version.id === initial.latestVersionId)
      const candidate = parseVersionDetail(body?.version, workItemId, {
        id: initial.latestVersionId, contentHash: summary?.contentHash, draftRevision: summary?.draftRevision,
      })
      if (summary && (candidate.schemaVersion !== summary.schemaVersion || candidate.versionNumber !== summary.versionNumber)) throw Error()
      initialVersion = candidate
    } catch { initialError = 'unavailable' }
  }
  return <VersionWorkspace key={`${clientId}:${workItemId}`} clientId={clientId} workItemId={workItemId}
    initialDraft={draft} initial={initial} initialVersion={initialVersion} initialError={initialError} smeCopilot={smeCopilot} />
}
