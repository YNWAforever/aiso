import { evidenceFetchContext } from '@/lib/scan-evidence-context'
import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'
import type { CollectionState, EvidenceCheckKey, EvidenceInput, EvidenceObservation } from '@/lib/scan-evidence'

export function createScanEvidenceCapture(fetcher: PublicUrlFetch) {
  const observations: EvidenceObservation[] = []
  const collections = new Map<string, CollectionState[]>()
  let limited = false
  function forCheck(check: EvidenceCheckKey | 'page' | 'sitemap'): PublicUrlFetch {
    return (input, init) => evidenceFetchContext.run(observation => {
      if (['page', 'c4_structured_data', 'c5_extractability'].includes(check) && observation.httpStatus !== undefined && observation.httpStatus >= 400) observation = { ...observation, collection: 'failed' }
      const states = collections.get(check) ?? []
      states.push(observation.collection)
      collections.set(check, states)
      if (observations.length < 40) observations.push({ ...observation, check })
      else limited = true
    }, () => fetcher(input, init))
  }
  function stateFor(key: string): CollectionState {
    const states = collections.get(key) ?? []
    if (!states.length) return 'unknown'
    if (states.every(s => s === 'complete')) return 'complete'
    if (states.some(s => s === 'complete')) return 'partial'
    return states.includes('blocked') ? 'blocked' : 'failed'
  }
  function checks(settled: PromiseSettledResult<CheckResult>[], keys: EvidenceCheckKey[]): EvidenceInput['checks'] {
    return Object.fromEntries(keys.map((key, index) => {
      const result = settled[index]
      if (!result) return [key, { collection: 'unknown', assessment: 'not-verifiable' }]
      if (result.status === 'rejected') return [key, { collection: 'failed', assessment: 'fail' }]
      const check = result.value
      // HTML parsers inherit actual page collection; provider inference must declare diagnostics.
      let collection = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability','c6_llms_full_txt','c7_mcp_card','c8_sitemap'].includes(key) ? stateFor(key) : key === 'c19_topical_authority' ? stateFor('sitemap') : stateFor('page')
      if (check.diagnostic) {
        const declared = check.diagnostic.collection
        collection = ['blocked', 'failed'].includes(collection) ? collection : collection === 'complete' || collection === 'unknown' ? declared : declared === 'complete' ? collection : declared
      }
      const fallbackUnavailable = key === 'c7_mcp_card' && check.message !== 'mcp_card_found' && stateFor('page') !== 'complete'
      if (fallbackUnavailable && collection === 'complete') collection = 'partial'
      const assessment = fallbackUnavailable || !['complete','partial'].includes(collection) ? 'not-verifiable' : check.status
      return [key, { collection, assessment, reason: check.diagnostic?.reason }]
    }))
  }
  function failedRead(check: 'page' | 'sitemap') {
    collections.set(check, ['failed'])
    const observed = observations.find(o => o.check === check)
    if (observed) observed.collection = 'failed'
  }
  return { forCheck, failedRead, checks, observations, get limited() { return limited } }
}
