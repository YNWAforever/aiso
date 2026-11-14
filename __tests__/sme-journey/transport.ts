import type { VersionWorkspaceProps } from '@/components/change-sets/VersionWorkspace'
import type { ActorSnapshot, VersionDetail } from '@/lib/change-sets/types'
import type { DeliveryEvent, DeliveryPage } from '@/lib/delivery/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { parseDraftEdit } from '@/lib/work-items/edit-input'
import { deliveryId, deliveryText, parseAttest, parseWithdraw } from '@/lib/delivery/input'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { evaluateMultiSourceOutcomes, parseMultiSourceOutcomeResponse } from '@/lib/outcomes/multi-source'
import { utcMicros } from '@/lib/outcomes/time'
import type { JourneyActor, JourneyClockKey, JourneyMemoryOptions, JourneyObservationProfile, JourneyOutcomeSnapshot, JourneyReply, JourneyRequest, JourneyReview, JourneyScenario, JourneyStage } from './types'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const error = (status: number, code: string): JourneyReply => ({ status, body: { error: code } })
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid sample request')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw Error('Invalid sample request')
}
/** Compare every input frozen by the real Node freezer; time metadata is not frozen content. */
const frozenInputs = (d: WorkItem, review: JourneyReview) => JSON.stringify([d.clientId, d.id, d.status, d.title, d.action, d.notes, d.locale, d.revision, d.evidenceSnapshot, d.editSpec ?? null, review])
/** Full immutable content, hash, validation, version and submit metadata; decisions/capabilities vary independently. */
export function journeyVersionKey(version: VersionDetail): string {
  const { decision, capabilities, ...immutable } = version
  void decision; void capabilities
  return JSON.stringify(immutable)
}

/** A closed, in-memory demonstration transport. It is not authentication or a database emulator. */
export class JourneyMemory {
  draft: WorkItem
  versions: VersionDetail[] = []
  events: DeliveryEvent[] = []
  readonly requests: JourneyRequest[] = []
  readonly unexpected: JourneyRequest[] = []
  failNext: 'members' | 'delivery' | 'outcomes' | null = null
  loseNextDeliveryReply = false
  review: JourneyReview
  private selectedClock: JourneyClockKey = 'early'
  private selectedProfile: JourneyObservationProfile = 'stored'
  private decisions = new Map<string, string>()
  private approvals = new Map<string, string>()
  private journal = new Map<string, { payload: string; reply: JourneyReply }>()
  constructor(readonly scenario: JourneyScenario, private options: JourneyMemoryOptions = {}) {
    if (scenario.review.schemaVersion === 2 && Boolean(options.freeze) !== Boolean(options.outcomes)) throw Error('SAMPLE_V2_CALLBACK_PAIR_REQUIRED')
    this.draft = clone(scenario.draft); this.review = clone(scenario.review)
  }
  get clockKey(): JourneyClockKey { return this.selectedClock }
  get clock(): string { return this.scenario.clocks[this.selectedClock] }
  get observationProfile(): JourneyObservationProfile { return this.selectedProfile }
  setClock(key: JourneyClockKey): void {
    if (!['early', 'mature-d7'].includes(key) || (this.selectedClock === 'mature-d7' && key === 'early')) throw Error('SAMPLE_CLOCK_REQUIRES_RESET')
    this.selectedClock = key
  }
  setObservationProfile(profile: JourneyObservationProfile): void {
    if (!['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'].includes(profile)) throw Error('SAMPLE_PROFILE_UNAVAILABLE')
    this.selectedProfile = profile
  }
  reset(): void {
    this.draft = clone(this.scenario.draft); this.review = clone(this.scenario.review); this.versions = []; this.events = []
    this.requests.length = 0; this.unexpected.length = 0; this.journal.clear(); this.decisions.clear(); this.approvals.clear()
    this.selectedClock = 'early'; this.selectedProfile = 'stored'
    this.failNext = null; this.loseNextDeliveryReply = false
  }
  outcomeSnapshot(versionId: string): JourneyOutcomeSnapshot {
    const version = this.versions.find(value => value.id === versionId)
    if (!version) throw Error('SAMPLE_VERSION_UNAVAILABLE')
    return clone({ scope: { accountId: this.scenario.ids.accountId, clientId: this.scenario.ids.clientId, itemId: this.scenario.ids.itemId },
      version, decisionRowId: this.decisions.get(versionId) ?? null,
      events: this.events.filter(event => event.versionId === versionId).map(event => ({ event, approvalDecisionId: event.kind === 'attest' ? this.approvals.get(event.eventId) ?? null : null })),
      clockKey: this.clockKey, evaluatedAt: this.clock, observationProfile: this.observationProfile })
  }
  private portableOutcome(snapshot: JourneyOutcomeSnapshot) {
    const kernel = this.scenario.kernels.find(value => value.versionKey === journeyVersionKey(snapshot.version) &&
      value.schemaVersion === snapshot.version.schemaVersion && value.scope.accountId === snapshot.scope.accountId &&
      value.scope.clientId === snapshot.scope.clientId && value.scope.itemId === snapshot.scope.itemId && value.clockKey === snapshot.clockKey &&
      value.evaluatedAt === snapshot.evaluatedAt && value.observationProfile === snapshot.observationProfile)
    if (!kernel) throw Error('SAMPLE_OUTCOME_NOT_PRECOMPUTED')
    const { version, events, evaluatedAt, decisionRowId } = snapshot
    if (version.decision) {
      deliveryId(decisionRowId)
      if (version.decision.decidedBy.profileId !== this.scenario.ids.reviewerId || version.decision.decidedBy.role !== 'account_approver') throw Error('Invalid sample decision')
      utcMicros(version.decision.decidedAt)
    }
    const attestations = events.filter(row => row.event.kind === 'attest')
    const withdrawn = new Set<string>(), ids = new Set<string>()
    for (const { event, approvalDecisionId } of events) {
      deliveryId(event.eventId)
      if (ids.has(event.eventId) || event.schemaVersion !== 1 || event.contentHash !== version.contentHash || event.versionId !== version.id ||
        event.actor.role !== 'account_member' || utcMicros(event.recordedAt) > utcMicros(evaluatedAt)) throw Error('Invalid sample event')
      ids.add(event.eventId)
      if (event.kind === 'attest') {
        if (version.decision?.decision !== 'approved' || !decisionRowId || approvalDecisionId !== decisionRowId ||
          utcMicros(event.deliveredAt) < utcMicros(version.decision.decidedAt) || utcMicros(event.deliveredAt) > utcMicros(event.recordedAt)) throw Error('Invalid sample approval')
      } else {
        const target = attestations.find(row => row.event.eventId === event.targetAttestationId)?.event
        if (approvalDecisionId !== null || !target || withdrawn.has(target.eventId) || utcMicros(target.recordedAt) > utcMicros(event.recordedAt)) throw Error('Invalid sample withdrawal')
        withdrawn.add(target.eventId)
      }
    }
    const active = attestations.filter(row => !withdrawn.has(row.event.eventId))
    if (active.length > 1) throw Error('Invalid sample active history')
    const anchor = active[0]?.event
    const common = { clientId: snapshot.scope.clientId, itemId: snapshot.scope.itemId, versionId: version.id, contentHash: version.contentHash,
      evaluatedAt, anchorState: anchor ? 'active' as const : attestations.length ? 'withdrawn' as const : 'no-delivery' as const,
      anchor: anchor?.kind === 'attest' ? { id: anchor.eventId, deliveredAt: anchor.deliveredAt, recordedAt: anchor.recordedAt } : null }
    if (kernel.schemaVersion === 1) return parseOutcomeResponse(evaluateOutcomes({ ...common, ...clone(kernel.source) }))
    if (version.schemaVersion !== 2) throw Error('Invalid sample review schema')
    const input = { ...common, schemaVersion: 2 as const, sources: clone(kernel.sources) }
    return parseMultiSourceOutcomeResponse(evaluateMultiSourceOutcomes(input), { ...common,
      sourceRefs: version.evidenceSnapshots.map(source => source.evidence.kind === 'scan-check'
        ? { kind: 'scan-check' as const, id: source.evidence.scanId, checkKey: source.evidence.checkKey }
        : { kind: 'pulse-metric' as const, id: source.evidence.id, checkKey: null }) })
  }
  get active(): Extract<DeliveryEvent, { kind: 'attest' }> | null {
    for (const event of this.events) {
      if (event.kind === 'attest' && !this.events.some(other => other.kind === 'withdraw' && other.targetAttestationId === event.eventId)) return event
    }
    return null
  }
  private activeFor(versionId: string): Extract<DeliveryEvent, { kind: 'attest' }> | null {
    return this.events.find((event): event is Extract<DeliveryEvent, { kind: 'attest' }> => event.kind === 'attest' && event.versionId === versionId && !this.events.some(other => other.kind === 'withdraw' && other.targetAttestationId === event.eventId)) ?? null
  }
  get stage(): JourneyStage {
    const latest = this.versions[0]
    if (latest && this.activeFor(latest.id)) return 'delivered'
    return latest?.decision?.decision === 'approved' ? 'approved' : latest ? 'pending' : 'draft'
  }
  private actor(actor: JourneyActor): ActorSnapshot {
    return { profileId: actor === 'owner' ? this.scenario.ids.ownerId : this.scenario.ids.reviewerId,
      displayName: actor === 'owner' ? (this.scenario.lang === 'en' ? 'Sample owner' : '示範店主') : (this.scenario.lang === 'en' ? 'Sample reviewer' : '示範審批者'),
      role: actor === 'owner' ? 'account_member' : 'account_approver' }
  }
  private project(version: VersionDetail, actor: JourneyActor): VersionDetail {
    return clone({ ...version, capabilities: { canDecide: actor === 'reviewer' && !version.decision && version.id === this.versions[0]?.id && version.submittedBy.profileId !== this.actor(actor).profileId } })
  }
  versionProps(actor: JourneyActor): VersionWorkspaceProps {
    return { clientId: this.scenario.ids.clientId, workItemId: this.draft.id, initialDraft: clone(this.draft),
      initial: { versions: this.versions.map(version => this.project(version, actor)), latestVersionId: this.versions[0]?.id ?? null, nextCursor: null },
      initialVersion: this.versions[0] ? this.project(this.versions[0], actor) : null, smeCopilot: true, viewerProfileId: this.actor(actor).profileId, outcomeViewerKey: this.scenario.viewerKeys[actor] }
  }
  private delivery(version: VersionDetail): DeliveryPage {
    const active = this.activeFor(version.id), approved = version.decision?.decision === 'approved', latest = version.id === this.versions[0]?.id
    return { events: clone(this.events.filter(event => event.versionId === version.id)), activeAttestationId: active?.eventId ?? null, nextCursor: null,
      capabilities: { canExport: approved, canAttest: approved && latest && !active, canWithdraw: Boolean(active),
        attestReason: !approved ? 'not_approved' : !latest ? 'superseded' : active ? 'active_attestation' : null,
        withdrawReason: active ? null : 'no_active_attestation' } }
  }
  private replay(request: JourneyRequest, requestId: string, normalized: unknown, make: () => JourneyReply, namespace: 'decision' | 'delivery' = 'decision'): JourneyReply {
    const key = JSON.stringify([request.actor, namespace, requestId]), payload = JSON.stringify([request.method, request.path, normalized]), saved = this.journal.get(key)
    if (saved) return saved.payload === payload ? { ...clone(saved.reply), status: 200 } : error(409, 'CONFLICT')
    const reply = make()
    if (reply.status >= 200 && reply.status < 300) this.journal.set(key, { payload, reply: clone(reply) })
    return reply
  }
  request(input: JourneyRequest): JourneyReply {
    const request = clone(input); this.requests.push(request)
    if (!['owner', 'reviewer'].includes(request.actor) || !request.path.startsWith('/api/') || request.path.includes('?') || request.path.includes('#')) {
      this.unexpected.push(request); return error(404, 'SAMPLE_ROUTE_UNAVAILABLE')
    }
    const { method, path, actor } = request, base = `/api/clients/${this.scenario.ids.clientId}`, item = `${base}/work-items/${this.draft.id}`, versions = item + '/versions'
    const ok = (body: unknown, status = 200): JourneyReply => ({ status, body: clone(body) })
    const failRead = (kind: typeof this.failNext) => {
      if (this.failNext === kind) { this.failNext = null; return true }
      return false
    }
    try {
      if (path === '/api/account/members' && method === 'GET') {
        if (failRead('members')) return error(503, 'UNAVAILABLE')
        return ok({ self: this.actor(actor).profileId, members: [
          { profileId: this.scenario.ids.ownerId, active: true, approver: false },
          { profileId: this.scenario.ids.reviewerId, active: true, approver: true },
        ] })
      }
      if (path === base + '/opportunities' && method === 'GET') return ok(this.scenario.opportunities)
      if (path === base + '/work-items' && method === 'GET') return ok({ items: [this.draft], nextCursor: null })
      if (path === item && method === 'GET') return ok({ item: this.draft })
      if (path === item && method === 'PATCH') {
        if (actor !== 'owner') return error(403, 'DENIED')
        const edit = parseDraftEdit(request.body)
        if (edit.expectedRevision !== this.draft.revision) return error(409, 'CONFLICT')
        const next: WorkItem = { ...this.draft, title: edit.title, action: edit.action, notes: edit.notes,
          revision: this.draft.revision + 1, updatedAt: this.clock }
        if (edit.editSpec === null) delete next.editSpec
        else if (edit.editSpec !== undefined) next.editSpec = edit.editSpec
        const canonical = this.scenario.canonicalDrafts.find(value => frozenInputs(value, this.scenario.review) === frozenInputs(next, this.review))
        this.draft = clone(canonical ?? next)
        return ok({ item: this.draft })
      }
      if (path === versions && method === 'GET') return ok(this.versionProps(actor).initial)
      if (path === versions && method === 'POST') {
        if (actor !== 'owner') return error(403, 'DENIED')
        const value = object(request.body); exact(value, ['expectedRevision'])
        if (value.expectedRevision !== this.draft.revision) return error(409, 'CONFLICT')
        const previous = this.versions.find(version => version.draftRevision === this.draft.revision)
        if (previous) return ok({ version: this.project(previous, actor) })
        let version: VersionDetail
        if (this.options.freeze) version = this.options.freeze(clone(this.draft), this.versions.length + 1, clone(this.review), this.versions.length ? this.clock : this.scenario.timeline.submittedAt)
        else {
          const index = this.scenario.canonicalDrafts.findIndex(value => frozenInputs(value, this.scenario.review) === frozenInputs(this.draft, this.review))
          if (index < 0 || this.versions.length) return error(422, 'SAMPLE_REVISION_NOT_PRECOMPUTED')
          version = clone(this.scenario.canonicalVersions[index])
        }
        parseVersionDetail(version, this.draft.id, { draftRevision: this.draft.revision })
        if (version.schemaVersion !== this.review.schemaVersion || (version.schemaVersion === 2 && this.review.schemaVersion === 2 &&
          JSON.stringify(version.evidenceSnapshots) !== JSON.stringify(this.review.evidenceSnapshots))) return error(503, 'UNAVAILABLE')
        this.versions.unshift(version)
        return ok({ version: this.project(version, actor) }, 201)
      }
      const version = this.versions.find(candidate => path === `${versions}/${candidate.id}` || path.startsWith(`${versions}/${candidate.id}/`))
      if (version) {
        const versionBase = `${versions}/${version.id}`
        if (path === versionBase && method === 'GET') return ok({ version: this.project(version, actor) })
        if (path === versionBase + '/decision' && method === 'POST') {
          const value = object(request.body); exact(value, ['decision', 'reason', 'requestId'])
          const requestId = deliveryId(value.requestId), reason = deliveryText(value.reason, 2000, true)
          if (!['approved', 'changes_requested'].includes(value.decision as string)) return error(400, 'INVALID_INPUT')
          if (actor !== 'reviewer' || version.submittedBy.profileId === this.actor(actor).profileId) return error(403, 'DENIED')
          return this.replay(request, requestId, { decision: value.decision, reason }, () => {
            if (!this.project(version, actor).capabilities.canDecide) return error(409, 'CONFLICT')
            const decisionRowId = deliveryId(globalThis.crypto.randomUUID())
            version.decision = { decision: value.decision as 'approved' | 'changes_requested', reason, decidedBy: this.actor(actor), decidedAt: version.versionNumber === 1 ? this.scenario.timeline.decidedAt : this.clock }
            this.decisions.set(version.id, decisionRowId)
            version.capabilities = { canDecide: false }
            return ok({ version: this.project(version, actor) }, 201)
          })
        }
        if (path === versionBase + '/handoff' && method === 'GET') return ok({ handoff: { state: 'none', jobId: null, executorRef: null, lastEventAt: null, canSend: false,
          block: version.decision?.decision === 'approved' ? 'no_edit_spec' : 'not_approved', receipt: null, liveCheck: null, canCheck: false, checkBlock: 'not_open' } })
        if (path === versionBase + '/delivery' && method === 'GET') return failRead('delivery') ? error(503, 'UNAVAILABLE') : ok(this.delivery(version))
        if (path === versionBase + '/delivery' && method === 'POST') {
          const value = parseAttest(request.body)
          const reply = this.replay(request, value.requestId, value, () => {
            if (value.contentHash !== version.contentHash || !this.delivery(version).capabilities.canAttest) return error(409, 'CONFLICT')
            if (utcMicros(value.deliveredAt) < utcMicros(version.decision!.decidedAt) || utcMicros(value.deliveredAt) > utcMicros(this.clock)) return error(400, 'INVALID_INPUT')
            if (!this.options.outcomes && (value.deliveredAt !== this.scenario.deliveredAt || this.events.filter(event => event.kind === 'attest').length >= 2)) return error(422, 'SAMPLE_TRANSITION_NOT_PRECOMPUTED')
            const approvalId = this.decisions.get(version.id)
            if (!approvalId) return error(503, 'UNAVAILABLE')
            const event: DeliveryEvent = { schemaVersion: 1, eventId: this.events.length ? this.scenario.ids.attestationId.slice(0, 24) + (1000 + this.events.length).toString(16).padStart(12, '0') : this.scenario.ids.attestationId,
              versionId: version.id, contentHash: version.contentHash, actor: { ...this.actor(actor), role: 'account_member' }, recordedAt: this.clock,
              kind: 'attest', destination: value.destination, deliveredAt: value.deliveredAt, note: value.note, provenance: 'self_reported' }
            this.approvals.set(event.eventId, approvalId)
            this.events.unshift(event); return ok({ event }, 201)
          }, 'delivery')
          if (this.loseNextDeliveryReply && reply.status < 300) { this.loseNextDeliveryReply = false; throw Error('SAMPLE_ACK_LOST_AFTER_COMMIT') }
          return reply
        }
        const active = this.events.find((event): event is Extract<DeliveryEvent, { kind: 'attest' }> => event.kind === 'attest' && event.versionId === version.id && path === versionBase + `/delivery/${event.eventId}/withdraw`)
        if (active && method === 'POST') {
          const value = parseWithdraw(request.body)
          return this.replay(request, value.requestId, value, () => {
            if (!this.delivery(version).capabilities.canWithdraw || this.activeFor(version.id)?.eventId !== active.eventId) return error(409, 'CONFLICT')
            const event: DeliveryEvent = { schemaVersion: 1, eventId: this.scenario.ids.attestationId.slice(0, 24) + (1000 + this.events.length).toString(16).padStart(12, '0'), versionId: version.id,
              contentHash: version.contentHash, actor: { ...this.actor(actor), role: 'account_member' }, recordedAt: this.clock, kind: 'withdraw', targetAttestationId: active.eventId, reason: value.reason }
            this.events.unshift(event); return ok({ event }, 201)
          }, 'delivery')
        }
        if (path === versionBase + '/outcomes' && method === 'GET') {
          if (failRead('outcomes')) return error(503, 'UNAVAILABLE')
          try {
            const snapshot = this.outcomeSnapshot(version.id)
            return ok(this.options.outcomes ? this.options.outcomes(snapshot) : this.portableOutcome(snapshot))
          } catch { return error(503, 'OUTCOMES_UNAVAILABLE') }
        }
      }
    } catch (failure) {
      if (failure instanceof Error && failure.message === 'SAMPLE_ACK_LOST_AFTER_COMMIT') throw failure
      return error(400, 'INVALID_INPUT')
    }
    this.unexpected.push(request)
    return error(404, 'SAMPLE_ROUTE_UNAVAILABLE')
  }
}
