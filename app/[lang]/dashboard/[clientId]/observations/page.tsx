import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { ObservationWorkspace } from '@/components/observations/ObservationWorkspace'
import {
  observationCopyKeys,
  type ObservationCopy,
} from '@/components/observations/copy'
import { requireAuth } from '@/lib/auth'
import {
  loadAuthenticatedObservations,
  ObservationServiceError,
} from '@/lib/observations/service'

export default async function ObservationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  await requireAuth(lang)
  const raw = await searchParams
  const href = `/${lang}/dashboard/${encodeURIComponent(clientId)}/observations`
  const query = new URLSearchParams()
  for (const key of [
    'promptId',
    'platform',
    'week',
    'result',
    'limit',
    'cursor',
  ]) {
    const value = raw[key]
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value))
      for (const item of value) query.append(key, item)
  }
  const t = await getTranslations({ locale: lang, namespace: 'observations' })
  let initial
  try {
    initial = await loadAuthenticatedObservations(clientId, query)
  } catch (error) {
    const code = error instanceof ObservationServiceError ? error.code : null
    if (code === 'UNAUTHENTICATED')
      redirect(`/${lang}/auth/login?next=${encodeURIComponent(href)}`)
    if (code === 'INVALID_OBSERVATION_QUERY' || code === 'CLIENT_NOT_FOUND')
      notFound()
    return (
      <main className="p-8">
        <h1>{t('title')}</h1>
        <p role="alert">{t('loadError')}</p>
        <a className="inline-flex min-h-11 items-center underline" href={href}>
          {t('retry')}
        </a>
      </main>
    )
  }
  // Counts are substituted by the client after each response; preserve their placeholders.
  const copy = Object.fromEntries(
    observationCopyKeys.map((key) => [key, t.raw(key)]),
  ) as ObservationCopy
  return (
    <ObservationWorkspace
      clientId={clientId}
      initial={initial}
      copy={copy}
      lang={lang}
      initialFilters={{
        promptId: typeof raw.promptId === 'string' ? raw.promptId : undefined,
        platform: typeof raw.platform === 'string' ? raw.platform : undefined,
        week: typeof raw.week === 'string' ? raw.week : undefined,
        limit: typeof raw.limit === 'string' ? raw.limit : undefined,
        result:
          raw.result === 'success' || raw.result === 'incomplete'
            ? raw.result
            : undefined,
      }}
    />
  )
}
