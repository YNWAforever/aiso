import 'server-only'
import { getTranslations } from 'next-intl/server'
import { scanOpportunityCopy } from '@/lib/opportunities/presentation'
import {
  loadAuthenticatedOpportunities,
  OpportunityServiceError,
} from '@/lib/opportunities/service'
import type { OpportunityLocale, OpportunityResponse, SourceRef } from '@/lib/opportunities/types'
import type { StudioOpportunities, StudioOpportunityEvidenceRef } from './types'

const pending = (): StudioOpportunities => ({
  state: 'pending',
  suggestions: [],
  partial: true,
  pulseWeek: null,
  sourceStates: { pulse: 'unavailable', scan: 'unavailable' },
})

function evidenceRef(ref: SourceRef): StudioOpportunityEvidenceRef | null {
  if (ref.kind === 'agent-recommendation') return null
  return { kind: ref.kind, id: ref.id, ...(ref.checkKey ? { checkKey: ref.checkKey } : {}) }
}

/**
 * Reuses the authenticated opportunities service and reduces its response to
 * the serializable fields Studio displays. No vendor or generation path runs.
 */
export async function loadStudioOpportunities(
  clientId: string,
  lang: string,
): Promise<StudioOpportunities | null> {
  let data: OpportunityResponse
  try {
    data = await loadAuthenticatedOpportunities(clientId)
  } catch (error) {
    if (error instanceof OpportunityServiceError && (error.code === 'CLIENT_NOT_FOUND' || error.code === 'UNAUTHENTICATED')) {
      return null
    }
    return pending()
  }

  const locale: OpportunityLocale = lang === 'zh-HK' ? 'zh-HK' : 'en'
  const t = await getTranslations({ locale, namespace: 'opportunities' })
  const refsBySuggestion = new Map<string, SourceRef[]>()
  for (const group of data.groups ?? []) {
    for (const key of group.suggestionKeys) refsBySuggestion.set(key, group.evidenceRefs)
  }

  const suggestions = data.suggestions.flatMap(suggestion => {
    const scanCopy = suggestion.evidence.kind === 'scan-check'
      ? scanOpportunityCopy(suggestion.evidence, locale)
      : null
    const args = scanCopy
      ? { ...suggestion.args, checkTitle: scanCopy.title, checkAction: scanCopy.action }
      : suggestion.args
    const refs = (refsBySuggestion.get(suggestion.key) ?? [suggestion.source])
      .map(evidenceRef)
      .filter((ref): ref is StudioOpportunityEvidenceRef => ref !== null)
    const uniqueRefs = refs.filter((ref, index) => refs.findIndex(candidate =>
      candidate.kind === ref.kind && candidate.id === ref.id && candidate.checkKey === ref.checkKey,
    ) === index)
    return [{
      key: suggestion.key,
      title: scanCopy?.title ?? t(`rules.${suggestion.titleKey}.title`, args),
      action: scanCopy?.action ?? t(`rules.${suggestion.actionKey}.action`, args),
      recordedAt: suggestion.evidence.recordedAt,
      evidenceRefs: uniqueRefs,
    }]
  })
  const unavailable = Object.values(data.sourceStates).includes('unavailable')
  return {
    state: suggestions.length ? 'ready' : unavailable ? 'pending' : 'empty',
    suggestions,
    partial: data.partial,
    pulseWeek: data.window.pulseWeek,
    sourceStates: data.sourceStates,
  }
}
