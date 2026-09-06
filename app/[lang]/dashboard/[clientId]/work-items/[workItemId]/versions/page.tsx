import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import {
  readAuthenticatedDraft,
  WorkItemServiceError,
} from '@/lib/work-items/service'
import { listAuthenticatedVersions } from '@/lib/change-sets/service'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
export default async function VersionsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string; workItemId: string }>
}) {
  const { lang: requested, clientId, workItemId } = await params,
    lang = requested === 'zh-HK' ? 'zh-HK' : 'en'
  await requireAuth(lang)
  const t = await getTranslations({ locale: lang, namespace: 'changeSets' })
  let draft
  try {
    draft = (await readAuthenticatedDraft(clientId, workItemId)).item
  } catch (error) {
    if (error instanceof WorkItemServiceError) {
      if (error.code === 'UNAUTHENTICATED') redirect(`/${lang}/auth/login`)
      if (
        [
          'WORK_ITEM_NOT_FOUND',
          'CLIENT_NOT_FOUND',
          'INVALID_WORK_ITEM_INPUT',
        ].includes(error.code)
      )
        notFound()
    }
    return (
      <main className="space-y-4 p-8">
        <h1>{t('title')}</h1>
        <p role="alert">{t('unavailable')}</p>
      </main>
    )
  }
  const response = await listAuthenticatedVersions(
    clientId,
    workItemId,
    new URLSearchParams(),
  )
  if (response.status === 401) redirect(`/${lang}/auth/login`)
  if (response.status === 404 || response.status === 403) notFound()
  return (
    <VersionWorkspace
      clientId={clientId}
      workItemId={workItemId}
      initialDraft={draft}
      initial={response.ok ? await response.json() : null}
      initialError={response.ok ? '' : 'unavailable'}
    />
  )
}
