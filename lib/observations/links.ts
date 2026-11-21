export const observationQueryKeys = ['run', 'promptId', 'question', 'platform', 'week', 'result', 'mention', 'limit', 'cursor'] as const

const observationSelectionKeys = [...observationQueryKeys, 'observation', 'runStatus', 'runCursor'] as const
export type ObservationSelection = Partial<Record<(typeof observationSelectionKeys)[number], string>>

export function observationSelection(params: URLSearchParams): ObservationSelection {
  const selection: ObservationSelection = {}
  for (const key of observationSelectionKeys) {
    const value = params.get(key)
    if (value) selection[key] = value
  }
  return selection
}

export function observationSearch(selection: ObservationSelection) {
  const query = new URLSearchParams()
  for (const key of observationQueryKeys) {
    const value = selection[key]
    if (value) query.set(key, value)
  }
  return query
}

export function observationsPath(lang: string, clientId: string) {
  return `/${lang}/dashboard/${encodeURIComponent(clientId)}/observations`
}

export function observationsHref(lang: string, clientId: string, selection: ObservationSelection = {}, anchor = '') {
  const query = new URLSearchParams()
  for (const key of observationSelectionKeys) {
    const value = selection[key]
    if (value) query.set(key, value)
  }
  return `${observationsPath(lang, clientId)}${query.size ? `?${query}` : ''}${anchor}`
}

export function monitoringHref(lang: string, clientId: string, run?: string) {
  const query = new URLSearchParams({ step: 'monitor' })
  if (run) query.set('run', run)
  return `/${lang}/dashboard/${encodeURIComponent(clientId)}?${query}#first-monitoring`
}
