import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'
import { ObservationWorkspace } from '@/components/observations/ObservationWorkspace'
import { WhatAiSaysPage } from '@/components/dashboard/sme/WhatAiSaysPage'
import { observationCopyKeys, type ObservationCopy } from '@/components/observations/copy'
import { requireAuth } from '@/lib/auth'
import { isSmeCopilotUiEnabled } from '@/lib/flags'
import { observationQueryKeys, observationSelection, observationsHref } from '@/lib/observations/links'
import { loadRunTroubleshooting } from '@/lib/observations/run-troubleshooting'
import { loadAuthenticatedObservations, ObservationServiceError } from '@/lib/observations/service'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const runFilters = ['all', 'failed', 'pending', 'unclassified'] as const

export default async function ObservationsPage({ params, searchParams }: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { lang: requestedLang, clientId } = await params
  const lang = requestedLang === 'zh-HK' ? 'zh-HK' : 'en'
  const profile = await requireAuth(lang)
  const raw = await searchParams
  const query = new URLSearchParams()
  for (const key of observationQueryKeys) {
    const value = raw[key]
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value)) for (const item of value) query.append(key, item)
  }
  const runFilter = runFilters.find(value => value === raw.runStatus)
  const selection = {
    ...observationSelection(query),
    observation: typeof raw.observation === 'string' && uuid.test(raw.observation) ? raw.observation.toLowerCase() : undefined,
    runStatus: runFilter,
    runCursor: runFilter && typeof raw.runCursor === 'string' && uuid.test(raw.runCursor) ? raw.runCursor : undefined,
  }
  const href = observationsHref(lang, clientId, selection, runFilter ? '#run-status' : '')
  const t = await getTranslations({ locale: lang, namespace: 'observations' })
  let initial
  try {
    initial = await loadAuthenticatedObservations(clientId, query)
  } catch (error) {
    const code = error instanceof ObservationServiceError ? error.code : null
    if (code === 'UNAUTHENTICATED') redirect(`/${lang}/auth/login?next=${encodeURIComponent(href)}`)
    if (code === 'INVALID_OBSERVATION_QUERY' || code === 'CLIENT_NOT_FOUND') notFound()
    return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p role="alert">{t('loadError')}</p>
      <a className="inline-flex min-h-11 items-center underline" href={href}>{t('retry')}</a>
    </main>
  }

  if (initial.selectedRun && selection.week !== initial.selectedRun.week) {
    redirect(observationsHref(lang, clientId, {
      ...selection, run: initial.selectedRun.id, week: initial.selectedRun.week,
      cursor: undefined, runCursor: undefined,
    }, runFilter ? '#run-status' : ''))
  }
  const runData = initial.selectedRun ? await loadRunTroubleshooting(
    profile.account_id, clientId, initial.selectedRun.id, runFilter ?? 'all', selection.runCursor ?? null, !!runFilter,
  ).catch(() => null) : undefined
  const copy = Object.fromEntries(observationCopyKeys.map(key => [key, t.raw(key)])) as ObservationCopy
  const smeCopilot = isSmeCopilotUiEnabled()
  const workspace = <ObservationWorkspace
    key={href}
    clientId={clientId}
    lang={lang}
    initial={initial}
    initialFilters={selection}
    smeCopilot={smeCopilot}
    embedded={smeCopilot}
    copy={copy}
    runData={runData}
  />
  if (!smeCopilot) return workspace
  return <WhatAiSaysPage title={t('smeTitle')} description={t('smeDescription')} actions={
    <a className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium"
      href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/prompts`}>{t('smeManageQuestions')}</a>
  }>{workspace}</WhatAiSaysPage>
}
