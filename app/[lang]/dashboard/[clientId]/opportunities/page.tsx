import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { requireAuth } from '@/lib/auth'
import { loadOwnedDraftClient } from '@/lib/work-items/store'
import {
  loadAuthenticatedOpportunities,
  OpportunityServiceError,
} from '@/lib/opportunities/service'
export default async function OpportunitiesPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(lang)
  const t = await getTranslations({ locale: lang, namespace: 'opportunities' })
  const href = `/${lang}/dashboard/${encodeURIComponent(clientId)}/opportunities`
  let initial
  try {
    initial = await loadAuthenticatedOpportunities(clientId)
  } catch (error) {
    const code = error instanceof OpportunityServiceError ? error.code : null
    if (code === 'UNAUTHENTICATED')
      redirect(`/${lang}/auth/login?next=${encodeURIComponent(href)}`)
    if (code === 'CLIENT_NOT_FOUND' || code === 'INVALID_OPPORTUNITY_QUERY')
      notFound()
    // A 503 may precede source loading; verify ownership independently before
    // exposing the workspace. Draft APIs still authenticate and scope every read/write.
    const ownedClient = await loadOwnedDraftClient(
      profile.account_id,
      clientId,
    ).catch(() => undefined)
    if (ownedClient === null) notFound()
    if (ownedClient) {
      return (
        <OpportunityWorkspace
          clientId={clientId}
          initial={null}
          initialError="unavailable"
        />
      )
    }
    return (
      <main className="space-y-4 p-8">
        <h1>{t('title')}</h1>
        <p role="alert">{t('initialLoadError')}</p>
        <a className="inline-flex min-h-11 items-center underline" href={href}>
          {t('refresh')}
        </a>
      </main>
    )
  }
  return <OpportunityWorkspace clientId={clientId} initial={initial} />
}
