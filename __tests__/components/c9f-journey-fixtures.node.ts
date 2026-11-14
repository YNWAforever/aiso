import 'server-only'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createJourneyCallbacks, createJourneyScenario } from '../sme-journey/scenario.node'
import { JourneyMemory } from '../sme-journey/transport'
import type { JourneyActor, JourneyClockKey, JourneyKind, JourneyObservationProfile } from '../sme-journey/types'
import { parseSelectedOutcome, selectedOutcomeExpectation, type SelectedOutcomeResponse } from '@/lib/outcomes/client-context'

/** Real controlled commits and Node projection; this producer never enters the client fixture graph. */
export function journeyOutcomeFixture(lang: 'en' | 'zh-HK', kind: JourneyKind, alternative = false) {
  const scenario = createJourneyScenario(lang, kind), memory = new JourneyMemory(scenario, createJourneyCallbacks(scenario))
  const base = `/api/clients/${scenario.ids.clientId}/work-items/${scenario.ids.itemId}`
  function request(actor: JourneyActor, method: string, path: string, body?: unknown) {
    const reply = memory.request({ actor, method, path, ...(body === undefined ? {} : { body }) })
    assert(reply.status >= 200 && reply.status < 300, `Controlled ${method} ${path}: ${reply.status}`)
    return reply.body
  }
  if (alternative) {
    const draft = scenario.canonicalDrafts[1]
    request('owner', 'PATCH', base, { expectedRevision: memory.draft.revision, title: draft.title, action: draft.action, notes: draft.notes })
  }
  request('owner', 'POST', base + '/versions', { expectedRevision: memory.draft.revision })
  const versionBase = base + '/versions/' + memory.versions[0].id
  request('reviewer', 'POST', versionBase + '/decision', { decision: 'approved', reason: 'Controlled independent review', requestId: randomUUID() })
  request('owner', 'POST', versionBase + '/delivery', { contentHash: memory.versions[0].contentHash,
    destination: 'Controlled sample website', deliveredAt: scenario.deliveredAt, note: 'Controlled self-reported record', requestId: randomUUID() })
  const props = memory.versionProps('owner'), expected = selectedOutcomeExpectation(props.clientId, props.workItemId, props.initialVersion!)
  const values = {} as Record<JourneyClockKey, Record<JourneyObservationProfile, SelectedOutcomeResponse>>
  for (const clock of ['early', 'mature-d7'] as const) {
    memory.setClock(clock)
    values[clock] = {} as Record<JourneyObservationProfile, SelectedOutcomeResponse>
    for (const profile of ['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'] as const) {
      memory.setObservationProfile(profile)
      values[clock][profile] = parseSelectedOutcome(request('owner', 'GET', versionBase + '/outcomes'), expected)
    }
  }
  return { props, values, viewerKeys: { ...scenario.viewerKeys }, delivery: request('owner', 'GET', versionBase + '/delivery') }
}
