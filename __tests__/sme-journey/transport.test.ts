import { describe, expect, it, vi } from 'vitest'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import type { DeliveryEvent, DeliveryPage } from '@/lib/delivery/types'
import type { VersionDetail } from '@/lib/change-sets/types'
import { createJourneyScenario, freezeJourneyDraft } from './scenario.node'
import { JourneyMemory } from './transport'
import type { JourneyActor } from './types'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => { throw Error('No database in controlled journey') } }))
const decisionId = 'b1500000-0000-4000-8000-000000000001'
const deliveryId = 'b1500000-0000-4000-8000-000000000002'
const withdrawId = 'b1500000-0000-4000-8000-000000000003'

for (const lang of ['en', 'zh-HK'] as const) describe(`controlled journey ${lang}`, () => {
  function setup(dynamic = false) {
    const scenario = createJourneyScenario(lang), memory = new JourneyMemory(scenario, dynamic ? { freeze: freezeJourneyDraft } : {})
    const base = `/api/clients/${scenario.ids.clientId}/work-items/${scenario.ids.itemId}`
    const call = (method: string, path = '', body?: unknown, actor: JourneyActor = 'owner') => memory.request({ actor, method, path: base + path, body })
    function submit() {
      const response = call('POST', '/versions', { expectedRevision: memory.draft.revision })
      expect(response.status).toBe(201)
      return parseVersionDetail((response.body as { version: VersionDetail }).version, scenario.ids.itemId)
    }
    function approve(version: VersionDetail) {
      const response = call('POST', `/versions/${version.id}/decision`, { decision: 'approved', reason: 'Checked the sample product facts.', requestId: decisionId }, 'reviewer')
      expect(response.status).toBe(201)
    }
    const attest = (version: VersionDetail, actor: JourneyActor = 'owner') => call('POST', `/versions/${version.id}/delivery`, { contentHash: version.contentHash, destination: 'Sample product page', deliveredAt: scenario.deliveredAt, note: 'Recorded in the sample only.', requestId: deliveryId }, actor)
    return { scenario, memory, base, call, submit, approve, attest }
  }
  it('freezes the actual normalized saved edit and keeps actor projections independent', () => {
    const { scenario, memory, call, submit, approve } = setup(true), edited = scenario.canonicalDrafts[1]
    expect(call('PATCH', '', { title: edited.title, action: edited.action, notes: edited.notes, expectedRevision: 1 }).status).toBe(200)
    const version = submit()
    expect(version.contentHash).toBe(freezeJourneyDraft(memory.draft).contentHash)
    expect(version.notes).toBe(edited.notes)
    expect(memory.versionProps('owner').initialVersion?.capabilities.canDecide).toBe(false)
    expect(memory.versionProps('reviewer').initialVersion?.capabilities.canDecide).toBe(true)
    expect(call('POST', `/versions/${version.id}/decision`, { decision: 'approved', reason: 'Self approval', requestId: decisionId }).status).toBe(403)
    approve(version)
    expect(memory.versionProps('owner').initialVersion?.decision?.decidedBy.profileId).toBe(scenario.ids.reviewerId)
    expect(call('POST', '/versions', { expectedRevision: 2 }).status).toBe(200)
    expect(memory.versions).toHaveLength(1)
    expect(memory.unexpected).toEqual([])
  })
  it('rejects stale or extra draft fields without changing saved state', () => {
    const { memory, call } = setup(), before = structuredClone(memory.draft)
    expect(call('PATCH', '', { title: 'Changed', action: before.action, notes: before.notes, expectedRevision: 2 }).status).toBe(409)
    expect(call('PATCH', '', { title: 'Changed', action: before.action, notes: before.notes, expectedRevision: 1, accountId: 'other' }).status).toBe(400)
    expect(memory.draft).toEqual(before)
  })
  for (const field of ['title', 'action', 'notes', 'revision', 'locale', 'evidenceSnapshot'] as const) it(`never attaches a sample hash to unsupported ${field}`, () => {
    const { memory, call } = setup()
    if (field === 'revision') memory.draft.revision = 3
    else if (field === 'locale') memory.draft.locale = lang === 'en' ? 'zh-HK' : 'en'
    else if (field === 'evidenceSnapshot') memory.draft.evidenceSnapshot = { ...memory.draft.evidenceSnapshot, initialTitle: 'Different evidence' }
    else memory.draft[field] += ' different'
    expect(call('POST', '/versions', { expectedRevision: memory.draft.revision }).status).toBe(422)
    expect(memory.versions).toEqual([])
  })
  it('replays decisions without a second decision and conflicts on changed payload', () => {
    const { call, submit, approve, memory } = setup(), version = submit()
    approve(version)
    const body = { decision: 'approved', reason: 'Checked the sample product facts.', requestId: decisionId }
    expect(call('POST', `/versions/${version.id}/decision`, body, 'reviewer').status).toBe(200)
    expect(call('POST', `/versions/${version.id}/decision`, { ...body, reason: 'Other reason' }, 'reviewer').status).toBe(409)
    expect(memory.versions).toHaveLength(1)
    expect(memory.versions[0].decision?.reason).toBe(body.reason)
  })
  it('loses an acknowledgement after exactly one event and safely reconciles/replays', () => {
    const { scenario, call, submit, approve, attest, memory } = setup(), version = submit()
    approve(version); memory.loseNextDeliveryReply = true
    expect(() => attest(version)).toThrow('SAMPLE_ACK_LOST_AFTER_COMMIT')
    expect(memory.events).toHaveLength(1)
    const page = call('GET', `/versions/${version.id}/delivery`).body as DeliveryPage
    expect(page.activeAttestationId).toBe(scenario.ids.attestationId)
    expect(page.capabilities.canAttest).toBe(false)
    expect(attest(version).status).toBe(200)
    expect(memory.events).toHaveLength(1)
    const outcome = parseOutcomeResponse(call('GET', `/versions/${version.id}/outcomes`).body)
    expect(outcome.anchor).toEqual({ id: scenario.ids.attestationId, deliveredAt: scenario.deliveredAt, recordedAt: scenario.clock })
    expect(outcome.contentHash).toBe(version.contentHash)
    expect(outcome.windows.every(window => window.timeState === 'not-due' && !window.selected)).toBe(true)
    expect(memory.stage).toBe('delivered')
  })
  it('shares delivery request identities across kinds and replays a completed withdrawal', () => {
    const { call, submit, approve, attest, memory } = setup(), version = submit()
    approve(version); expect(attest(version).status).toBe(201)
    const path = `/versions/${version.id}/delivery/${memory.active!.eventId}/withdraw`
    expect(call('POST', path, { reason: 'Correct sample', requestId: deliveryId }).status).toBe(409)
    expect(memory.events).toHaveLength(1)
    expect(call('POST', path, { reason: 'Correct sample', requestId: withdrawId }).status).toBe(201)
    expect(call('POST', path, { reason: 'Correct sample', requestId: withdrawId }).status).toBe(200)
    expect(memory.events).toHaveLength(2)
    expect(parseOutcomeResponse(call('GET', `/versions/${version.id}/outcomes`).body).anchorState).toBe('withdrawn')
  })
  it('records reviewer delivery as a member event accepted by the genuine DTO', () => {
    const { submit, approve, attest } = setup(), version = submit()
    approve(version)
    const event = (attest(version, 'reviewer').body as { event: DeliveryEvent }).event
    expect(event.kind).toBe('attest')
    if (event.kind !== 'attest') throw Error('Expected attestation')
    expect(deliveryEventDTO({ schema_version: 1, id: event.eventId, version_id: event.versionId, content_hash: event.contentHash,
      actor: event.actor, actor_id: event.actor.profileId, recorded_at: event.recordedAt, kind: event.kind, destination: event.destination,
      delivered_at: event.deliveredAt, note: event.note, provenance: event.provenance, target_attestation_id: null, reason: null })).toEqual(event)
  })
  it('keeps old active delivery isolated when a newer actual version is prepared', () => {
    const { call, submit, approve, attest, memory } = setup(true), old = submit()
    approve(old); attest(old)
    expect(call('PATCH', '', { title: memory.draft.title, action: memory.draft.action, notes: 'A genuinely changed saved revision', expectedRevision: 1 }).status).toBe(200)
    const latest = submit()
    expect(latest.id).not.toBe(old.id)
    expect(memory.stage).toBe('pending')
    expect(parseOutcomeResponse(call('GET', `/versions/${latest.id}/outcomes`).body).anchorState).toBe('no-delivery')
    const history = call('GET', `/versions/${old.id}/delivery`).body as DeliveryPage
    expect(history.capabilities).toMatchObject({ canExport: true, canAttest: false, canWithdraw: true, attestReason: 'superseded', withdrawReason: null })
    expect(history.activeAttestationId).toBe(memory.events[0].eventId)
  })
  it('keeps failed reads explicit, denies other scopes and rejects every unlisted route', () => {
    const { memory, submit, call } = setup(), version = submit()
    memory.failNext = 'members'
    expect(memory.request({ actor: 'owner', method: 'GET', path: '/api/account/members' }).status).toBe(503)
    expect(memory.request({ actor: 'owner', method: 'GET', path: '/api/account/members' }).status).toBe(200)
    for (const kind of ['delivery', 'outcomes'] as const) {
      memory.failNext = kind; expect(call('GET', `/versions/${version.id}/${kind}`).status).toBe(503)
      expect(call('GET', `/versions/${version.id}/${kind}`).status).toBe(200)
    }
    expect(memory.request({ actor: 'owner', method: 'GET', path: '/api/clients/other/work-items' }).status).toBe(404)
    expect(call('POST', `/versions/${version.id}/handoff`, {}).status).toBe(404)
    expect(memory.unexpected).toHaveLength(2)
    memory.reset(); expect(memory.versions).toEqual([]); expect(memory.events).toEqual([]); expect(memory.unexpected).toEqual([])
  })
})
