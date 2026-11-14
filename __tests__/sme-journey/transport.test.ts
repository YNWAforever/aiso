import { describe, expect, it, vi } from 'vitest'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import type { DeliveryEvent, DeliveryPage } from '@/lib/delivery/types'
import type { VersionDetail } from '@/lib/change-sets/types'
import { createJourneyScenario, createJourneyCallbacks, freezeJourneyDraft, projectJourneyOutcomes, createJourneyRawSnapshot } from './scenario.node'
import { JourneyMemory } from './transport'
import type { JourneyActor, JourneyKind, JourneyOutcomeReply } from './types'
import { utcMicros } from '@/lib/outcomes/time'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => { throw Error('No database in controlled journey') } }))
const decisionId = 'b1500000-0000-4000-8000-000000000001'
const deliveryId = 'b1500000-0000-4000-8000-000000000002'
const withdrawId = 'b1500000-0000-4000-8000-000000000003'

function v2Harness(lang: 'en' | 'zh-HK' = 'en', kind: JourneyKind = 'v2-mixed', dynamic = false) {
  const scenario = createJourneyScenario(lang, kind), callbacks = createJourneyCallbacks(scenario)
  const memory = new JourneyMemory(scenario, dynamic ? callbacks : {})
  const base = `/api/clients/${scenario.ids.clientId}/work-items/${scenario.ids.itemId}`
  const call = (method: string, path = '', body?: unknown, actor: JourneyActor = 'owner') => memory.request({ actor, method, path: base + path, body })
  const submit = () => {
    const reply = call('POST', '/versions', { expectedRevision: memory.draft.revision })
    expect(reply.status).toBe(201)
    return (reply.body as { version: VersionDetail }).version
  }
  const decide = (version: VersionDetail, decision: 'approved' | 'changes_requested' = 'approved') => call('POST', `/versions/${version.id}/decision`, { decision, reason: 'Checked actual retained sample evidence.', requestId: decisionId }, 'reviewer')
  const attest = (version: VersionDetail, requestId = deliveryId, deliveredAt = scenario.deliveredAt) => call('POST', `/versions/${version.id}/delivery`, { contentHash: version.contentHash, destination: 'Sample page', note: 'Sample declaration only.', deliveredAt, requestId })
  const withdraw = (version: VersionDetail, requestId = withdrawId) => call('POST', `/versions/${version.id}/delivery/${memory.active!.eventId}/withdraw`, { reason: 'Correct sample declaration.', requestId })
  return { scenario, memory, callbacks, call, submit, decide, attest, withdraw }
}

for (const lang of ['en', 'zh-HK'] as const) describe(`controlled journey ${lang}`, () => {
  function setup(dynamic = false) {
    const scenario = createJourneyScenario(lang), memory = new JourneyMemory(scenario, dynamic ? createJourneyCallbacks(scenario) : {})
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

for (const lang of ['en', 'zh-HK'] as const) for (const kind of ['v2-mixed', 'v2-one-scan'] as const) {
  it(`compares EVERY supported V2 transition/clock/profile/hash to the Node callback (${lang}, ${kind})`, () => {
    const scenario = createJourneyScenario(lang, kind), callbacks = createJourneyCallbacks(scenario)
    let witnesses = 0
    for (const draftIndex of [0, 1]) for (const decision of ['approved', 'changes_requested'] as const) {
      for (const profile of ['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'] as const) {
        for (const advanceAt of decision === 'approved' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 6]) {
          const memory = new JourneyMemory(scenario), base = `/api/clients/${scenario.ids.clientId}/work-items/${scenario.ids.itemId}`
          const call = (method: string, path: string, body?: unknown, actor: JourneyActor = 'owner') => memory.request({ actor, method, path: base + path, body })
          memory.setObservationProfile(profile)
          if (draftIndex) {
            const edited = scenario.canonicalDrafts[1]
            expect(call('PATCH', '', { title: edited.title, action: edited.action, notes: edited.notes, expectedRevision: 1 }).status).toBe(200)
          }
          const version = (call('POST', '/versions', { expectedRevision: memory.draft.revision }).body as { version: VersionDetail }).version
          expect(version.contentHash).toBe(scenario.canonicalVersions[draftIndex].contentHash)
          const path = `/versions/${version.id}`, decisionBody = { decision, reason: 'Checked actual retained sample evidence.', requestId: decisionId }
          const check = (stage: number) => {
            if (advanceAt === stage) memory.setClock('mature-d7')
            const snapshot = memory.outcomeSnapshot(version.id), expected = callbacks.outcomes!(snapshot)
            for (const actor of ['owner', 'reviewer'] as const) {
              const reply = call('GET', path + '/outcomes', undefined, actor)
              expect(reply.status).toBe(200); expect(reply.body).toEqual(expected)
            }
            witnesses++
            if (expected.schemaVersion !== 2) throw Error('Expected genuine V2')
            expect(expected.evaluatedAt).toBe(memory.clock)
            if (memory.active && memory.clockKey === 'mature-d7') {
              const source = expected.sources[0], d7 = source.windows[0]
              if (profile === 'stored') {
                expect(d7).toMatchObject({ provisional: false, evidenceState: 'available', comparison: { status: 'partially_comparable', outcome: 'improved', baselineVerdict: 'warn', observedVerdict: 'pass' } })
                expect(d7.reasons).toContain('final-path-identity-withheld')
              } else if (profile === 'unavailable-scan') expect(d7.evidenceState).toBe('unavailable')
              else if (profile === 'limited-scan') { expect(d7.evidenceState).toBe('evidence-limited'); expect(source.reasons).toContain('candidate-limit-exceeded') }
              if (kind === 'v2-mixed') {
                expect(expected.sources[0].baseline).toEqual(expected.sources[2].baseline)
                expect(expected.sources[1].windows.every(window => window.comparison.outcome === 'cannot_determine')).toBe(true)
                if (profile === 'diagnostic-heavy') {
                  expect(expected.sources.map(row => row.diagnostics.length)).toEqual([134, 133, 133])
                  expect(expected.sources.every(row => row.reasons.includes('diagnostic-limit-exceeded'))).toBe(true)
                }
              }
              const raw = createJourneyRawSnapshot(scenario, snapshot)
              expect(raw.scans.length).toBeLessThanOrEqual(201); expect(raw.pulse.length).toBeLessThanOrEqual(201)
              expect(new Set(raw.scans.map(row => row.id)).size).toBe(raw.scans.length)
            }
          }
          check(0)
          expect(call('POST', path + '/decision', decisionBody, 'reviewer').status).toBe(201)
          const committedId = memory.outcomeSnapshot(version.id).decisionRowId
          expect(committedId).not.toBe(decisionId)
          expect(call('POST', path + '/decision', decisionBody, 'reviewer').status).toBe(200)
          expect(memory.outcomeSnapshot(version.id).decisionRowId).toBe(committedId)
          check(1)
          if (decision === 'approved') {
            const attest = { contentHash: version.contentHash, destination: 'Sample page', note: 'Controlled sample only.', deliveredAt: scenario.deliveredAt, requestId: deliveryId }
            memory.loseNextDeliveryReply = true
            expect(() => call('POST', path + '/delivery', attest)).toThrow('SAMPLE_ACK_LOST_AFTER_COMMIT')
            expect(memory.outcomeSnapshot(version.id).events[0].approvalDecisionId).toBe(committedId)
            expect(call('POST', path + '/delivery', attest).status).toBe(200); expect(memory.events).toHaveLength(1)
            check(2)
            const withdrawal = { reason: 'Correct sample declaration.', requestId: withdrawId }, withdrawPath = path + `/delivery/${memory.active!.eventId}/withdraw`
            expect(call('POST', withdrawPath, withdrawal).status).toBe(201)
            expect(call('POST', withdrawPath, withdrawal).status).toBe(200); expect(memory.events).toHaveLength(2)
            check(3)
            expect(call('POST', path + '/delivery', { ...attest, requestId: 'b1500000-0000-4000-8000-000000000004' }).status).toBe(201)
            check(4)
            expect(call('POST', path + `/delivery/${memory.active!.eventId}/withdraw`, { ...withdrawal, requestId: 'b1500000-0000-4000-8000-000000000005' }).status).toBe(201)
            check(5)
            expect(call('POST', path + '/delivery', { ...attest, requestId: 'b1500000-0000-4000-8000-000000000006' }).status).toBe(422)
          }
          memory.reset()
          expect(memory.clockKey).toBe('early'); expect(memory.observationProfile).toBe('stored'); expect(memory.events).toEqual([])
          expect(call('POST', '/versions', { expectedRevision: 1 }).status).toBe(201)
          expect(memory.outcomeSnapshot(version.id)).toMatchObject({ decisionRowId: null, events: [] })
          expect(call('GET', path + '/outcomes').body).toEqual(callbacks.outcomes!(memory.outcomeSnapshot(version.id)))
          witnesses++
        }
      }
    }
    // 2 hashes * 4 profiles * (7 approved paths * 7 checks incl.reset + 3 rejected paths * 3 checks incl.reset).
    expect(witnesses).toBe(464)
  }, 120_000)
}

it('uses actual Node callbacks for changed edits, genuine second submissions and historical outcomes', () => {
  const f = v2Harness('en', 'v2-mixed', true), first = f.submit()
  f.decide(first); f.attest(first)
  const original = f.memory.outcomeSnapshot(first.id), oldOutcome = f.call('GET', `/versions/${first.id}/outcomes`).body
  expect(f.call('PATCH', '', { title: f.memory.draft.title, action: f.memory.draft.action, notes: 'A genuine different saved revision.', expectedRevision: 1 }).status).toBe(200)
  const second = f.submit()
  expect(second.id).not.toBe(first.id); expect(second.versionNumber).toBe(2)
  expect(utcMicros(second.submittedAt)).toBe(utcMicros(f.memory.clock))
  const latest = f.call('GET', `/versions/${second.id}/outcomes`).body as JourneyOutcomeReply
  expect(latest.anchorState).toBe('no-delivery')
  expect(f.call('GET', `/versions/${first.id}/outcomes`).body).toEqual(oldOutcome)
  expect(f.memory.outcomeSnapshot(first.id).decisionRowId).toBe(original.decisionRowId)
  expect(f.withdraw(first).status).toBe(201)
  expect((f.call('GET', `/versions/${first.id}/outcomes`).body as JourneyOutcomeReply).anchorState).toBe('withdrawn')
})

it('rejects unsupported portable version/schema/source-order/metadata bindings and requires paired V2 Node callbacks', () => {
  const scenario = createJourneyScenario('en', 'v2-mixed'), callbacks = createJourneyCallbacks(scenario)
  expect(() => new JourneyMemory(scenario, { freeze: callbacks.freeze })).toThrow('SAMPLE_V2_CALLBACK_PAIR_REQUIRED')
  for (const mutation of ['hash', 'notes', 'submittedAt', 'schema', 'source-order', 'scope', 'diagnostic-packet'] as const) {
    const f = v2Harness(), version = f.submit(), stored = f.memory.versions[0]
    if (mutation === 'hash') stored.contentHash = 'f'.repeat(64)
    else if (mutation === 'notes') stored.notes += ' unsupported'
    else if (mutation === 'submittedAt') stored.submittedAt = '2026-10-25T00:02:00.000Z'
    else if (mutation === 'schema') Object.assign(stored, { schemaVersion: 1 })
    else if (mutation === 'source-order' && stored.schemaVersion === 2) [stored.evidenceSnapshots[0], stored.evidenceSnapshots[1]] = [stored.evidenceSnapshots[1], stored.evidenceSnapshots[0]]
    else if (mutation === 'scope') for (const kernel of f.memory.scenario.kernels) kernel.scope.clientId = withdrawId
    else f.memory.scenario.kernels = []
    expect(f.call('GET', `/versions/${version.id}/outcomes`).status).toBe(503)
  }
  const f = v2Harness(), version = f.submit(); f.decide(version)
  expect(f.attest(version, deliveryId, '2026-10-24T00:11:00.000Z').status).toBe(422)
  f.memory.setClock('mature-d7'); expect(() => f.memory.setClock('early')).toThrow('SAMPLE_CLOCK_REQUIRES_RESET')
  f.memory.reset(); expect(f.memory.clockKey).toBe('early')
})

it('passes actual private ledgers to the production projector and rejects corrupted primary snapshots', () => {
  const f = v2Harness('en', 'v2-mixed', true), version = f.submit(); f.decide(version); f.attest(version)
  const original = f.memory.outcomeSnapshot(version.id)
  for (const mutation of ['approval', 'hash', 'event-calendar', 'provenance', 'target'] as const) {
    const state = structuredClone(original)
    if (mutation === 'approval') state.events[0].approvalDecisionId = withdrawId
    else if (mutation === 'hash') state.version.contentHash = 'f'.repeat(64)
    else if (mutation === 'event-calendar') state.events[0].event.recordedAt = '2026-02-30T00:00:00Z'
    else if (mutation === 'provenance') Object.assign(state.events[0].event, { provenance: 'forged' })
    else state.events.push({ approvalDecisionId: null, event: { schemaVersion: 1, eventId: withdrawId, versionId: version.id, contentHash: version.contentHash,
      actor: { profileId: f.scenario.ids.ownerId, displayName: 'Sample owner', role: 'account_member' }, recordedAt: f.memory.clock,
      kind: 'withdraw', targetAttestationId: decisionId, reason: 'Invalid target sample' } })
    expect(() => projectJourneyOutcomes(f.scenario, state)).toThrow()
  }
  const raw = createJourneyRawSnapshot(f.scenario, original)
  expect(raw.version.decision_record?.id).toBe(original.decisionRowId)
  expect(raw.events[0].approval_decision_id).toBe(original.decisionRowId)
  expect(raw.version.content_hash).toBe(version.contentHash)
})
