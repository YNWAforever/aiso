import 'server-only'
import { createHash } from 'node:crypto'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { projectObservation } from '@/lib/observations/schema'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
import type { JourneyKind, JourneyMemoryOptions, JourneyProjectedKernel, JourneyReview, JourneyScenario } from './types'
import { journeyVersionKey } from './transport'
import { journeyScanEnvelope, projectJourneyInput, projectJourneyOutcomes } from './projection.node'
export { createJourneyRawSnapshot, projectJourneyInput, projectJourneyOutcomes } from './projection.node'

// Fictitious controlled sample data. These identities are not sessions or grants.
const clientId = 'a1500000-0000-4000-8000-000000000001'
const itemId = 'a1500000-0000-4000-8000-000000000002'
const ownerId = 'a1500000-0000-4000-8000-000000000003'
const reviewerId = 'a1500000-0000-4000-8000-000000000004'
const attestationId = 'a1500000-0000-4000-8000-000000000005'
const scanId = 'a1500000-0000-4000-8000-000000000006'
const accountId = 'a1500000-0000-4000-8000-000000000007'
const pulseId = 'a1500000-0000-4000-8000-000000000008'

function versionIdFor(workItemId: string, versionNumber: number): string {
  const hash = createHash('sha256').update(`sme-journey:${workItemId}:${versionNumber}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function freezeSample(draft: WorkItem, versionNumber: number, review: JourneyReview, submittedAt: string): VersionDetail {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new Error('Invalid sample version number')
  const frozen = review.schemaVersion === 2 ? freezeMultiSourceReview(draft, review.evidenceSnapshots) : freezeReview(draft)
  return parseVersionDetail({ ...frozen.content, id: versionIdFor(draft.id, versionNumber), versionNumber,
    contentHash: frozen.contentHash, validation: frozen.validation,
    submittedBy: { profileId: ownerId, displayName: draft.locale === 'zh-HK' ? '示例店主' : 'Sample owner', role: 'account_member' },
    submittedAt, decision: null, capabilities: { canDecide: false } }, draft.id)
}
/** Preserve the legacy V1 direct-call signature. V2 uses the explicit callback package. */
export function freezeJourneyDraft(draft: WorkItem, versionNumber = 1): VersionDetail {
  return freezeSample(draft, versionNumber, { schemaVersion: 1 }, '2026-11-14T00:02:00.000Z')
}
export function createJourneyCallbacks(scenario: JourneyScenario): JourneyMemoryOptions {
  return {
    freeze: (draft, number, review, submittedAt = scenario.timeline.submittedAt) => freezeSample(draft, number, review, submittedAt),
    outcomes: snapshot => projectJourneyOutcomes(scenario, snapshot),
  }
}

const scenarioPackets = new Map<string, JourneyScenario>()
export function createJourneyScenario(lang: 'en' | 'zh-HK', kind: JourneyKind = 'v1-scan'): JourneyScenario {
  const packetKey = JSON.stringify([lang, kind]), cached = scenarioPackets.get(packetKey)
  if (cached) return structuredClone(cached)
  const legacy = kind === 'v1-scan', day = legacy ? '2026-11-14' : '2026-10-24'
  const clock = `${day}T00:15:00.000Z`, clocks = { early: clock, 'mature-d7': legacy ? '2026-11-28T00:15:00.000000Z' : '2026-11-07T00:15:00.000000Z' }
  const timeline = { submittedAt: `${day}T00:02:00.000Z`, decidedAt: `${day}T00:05:00.000Z`,
    collectedAt: `${day}T00:00:00.000Z`, sourceRecordedAt: `${day}T00:00:30.000Z`,
    observedAt: legacy ? '2026-11-22T00:00:00.000Z' : '2026-11-01T00:00:00.000Z',
    observationRecordedAt: legacy ? '2026-11-22T00:01:00.000001Z' : '2026-11-01T00:01:00.000001Z' }
  const brandName = lang === 'zh-HK' ? '海港茶舖' : 'Harbour Tea'
  const title = lang === 'zh-HK' ? '釐清海港茶舖產品資料' : 'Clarify Harbour Tea product details'
  const action = lang === 'zh-HK' ? '核對產品頁嘅茶葉名稱、成分同包裝份量，整理清晰資料後再交審批。'
    : 'Check the tea name, ingredients and pack size against the product page, then prepare clear product details for review.'
  const notes = lang === 'zh-HK' ? '只供示例。加入結構化資料前，請先同店主確認每項產品資料；目前未有發佈任何修改。'
    : 'Controlled sample only. Confirm every product fact with the owner before adding structured data; nothing has been published.'
  const source = { kind: 'scan-check' as const, scanId, recordedAt: timeline.sourceRecordedAt, envelope: journeyScanEnvelope(timeline.collectedAt, 'warn', !legacy) }
  const suggestion = deriveSuggestions(source).find(value => value.source.checkKey === 'c4_structured_data')
  if (!suggestion || suggestion.evidence.kind !== 'scan-check') throw new Error('Sample scan suggestion unavailable')
  const snapshot = JSON.parse(serializeDraftSnapshot(buildInitialDraftSnapshot(suggestion, source, lang))) as WorkItem['evidenceSnapshot']
  const initial: WorkItem = { id: itemId, clientId, status: 'draft', title, action, notes, locale: lang, revision: 1,
    createdAt: `${day}T00:01:00.000Z`, updatedAt: `${day}T00:01:00.000Z`, evidenceSnapshot: snapshot }
  const edited: WorkItem = { ...structuredClone(initial), revision: 2, updatedAt: `${day}T00:01:30.000Z`,
    notes: notes + (lang === 'zh-HK' ? '\n店主備註：交審前再次核對包裝份量。' : '\nOwner note: check the pack size again before review.') }
  const rawAnswer = lang === 'zh-HK' ? '可以先比較茶葉成分同每包份量。' : 'Compare the tea ingredients and pack size before choosing.'
  const pulseSource = { kind: 'pulse-metric' as const, answerDigest: createHash('sha256').update(rawAnswer).digest('hex'),
    observation: projectObservation({ id: pulseId, prompt_id: null, platform: 'chatgpt', question: lang === 'zh-HK' ? '點樣揀烏龍茶？' : 'How should I choose oolong tea?',
      scan_week: legacy ? '2026-11-09' : '2026-10-19', created_at: timeline.sourceRecordedAt, raw_answer: rawAnswer,
      brand_mentioned: false, classification_status: 'classified' }, null) }
  const pulseSuggestion = deriveSuggestions(pulseSource)[0]
  if (!pulseSuggestion) throw new Error('Sample retained Pulse suggestion unavailable')
  const pulse = JSON.parse(serializeDraftSnapshot(buildInitialDraftSnapshot(pulseSuggestion, pulseSource, lang))) as WorkItem['evidenceSnapshot']
  const review: JourneyReview = legacy ? { schemaVersion: 1 } : { schemaVersion: 2,
    evidenceSnapshots: kind === 'v2-one-scan' ? [snapshot] : [snapshot, pulse, structuredClone(snapshot)] }
  const canonicalDrafts = [initial, edited]
  // Two alternative FIRST submissions, with the same version ID and distinct hashes.
  const canonicalVersions = canonicalDrafts.map(draft => freezeSample(draft, 1, review, timeline.submittedAt))
  const version = canonicalVersions[0]
  const base: Omit<JourneyScenario, 'baseline' | 'kernels'> = { lang, kind, brandName,
    ids: { accountId, clientId, itemId, ownerId, reviewerId, versionId: version.id, attestationId }, viewerKeys: { owner: ownerId, reviewer: reviewerId },
    clock, clocks, timeline, deliveredAt: `${day}T00:10:00.000Z`, review, draft: structuredClone(initial), canonicalDrafts, canonicalVersions,
    opportunities: { schemaVersion: 1, window: { pulseWeek: null, pulseLimit: 200, pulseTruncated: false, scanId },
      sourceStates: { pulse: kind === 'v2-mixed' ? 'ok' : 'empty', scan: 'ok' }, savedDraftsState: 'ok', partial: false,
      suggestions: [suggestion, ...(kind === 'v2-mixed' ? [pulseSuggestion] : [])].map(value => ({ ...value, savedDraftId: itemId, savedState: 'saved', saveAvailability: 'available' })) } }
  const kernels: JourneyProjectedKernel[] = []
  let baseline: JourneyScenario['baseline'] | null = null
  for (const canonical of canonicalVersions) for (const clockKey of ['early', 'mature-d7'] as const) {
    for (const observationProfile of ['stored', 'unavailable-scan', 'limited-scan', 'diagnostic-heavy'] as const) {
      const input = projectJourneyInput(base, { scope: { accountId, clientId, itemId }, version: canonical, decisionRowId: null, events: [],
        clockKey, evaluatedAt: clocks[clockKey], observationProfile })
      const binding = { versionKey: journeyVersionKey(canonical), scope: { accountId, clientId, itemId }, clockKey, evaluatedAt: clocks[clockKey], observationProfile }
      if ('schemaVersion' in input) {
        baseline ??= input.sources[0].baseline
        kernels.push({ ...binding, schemaVersion: 2, sources: input.sources })
      } else {
        baseline ??= input.baseline
        const { baseline: value, candidates, sourceState, truncated } = input
        kernels.push({ ...binding, schemaVersion: 1, source: { baseline: value, candidates, sourceState, truncated } })
      }
    }
  }
  if (!baseline) throw new Error('Sample baseline unavailable')
  const packet = { ...base, kernels, baseline }
  scenarioPackets.set(packetKey, packet)
  return structuredClone(packet)
}
