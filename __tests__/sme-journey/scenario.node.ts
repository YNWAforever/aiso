import 'server-only'
import { createHash } from 'node:crypto'
import { buildScanEvidence, describeEvidenceUrl } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { freezeReview } from '@/lib/change-sets/validation'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { projectOutcomeSnapshot } from '@/lib/outcomes/sources'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
import type { JourneyScenario } from './types'

// Fictitious controlled sample data. These identities are not sessions or grants.
const clientId = 'a1500000-0000-4000-8000-000000000001'
const itemId = 'a1500000-0000-4000-8000-000000000002'
const ownerId = 'a1500000-0000-4000-8000-000000000003'
const reviewerId = 'a1500000-0000-4000-8000-000000000004'
const attestationId = 'a1500000-0000-4000-8000-000000000005'
const scanId = 'a1500000-0000-4000-8000-000000000006'
const accountId = 'a1500000-0000-4000-8000-000000000007'
const submittedAt = '2026-11-14T00:02:00.000Z'
const clock = '2026-11-14T00:15:00.000Z'

function versionIdFor(workItemId: string, versionNumber: number): string {
  const hash = createHash('sha256').update(`sme-journey:${workItemId}:${versionNumber}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Node only: freeze the actual saved draft, never a browser-invented content hash. */
export function freezeJourneyDraft(draft: WorkItem, versionNumber = 1): VersionDetail {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new Error('Invalid sample version number')
  const frozen = freezeReview(draft)
  return parseVersionDetail({
    ...frozen.content,
    id: versionIdFor(draft.id, versionNumber), versionNumber,
    contentHash: frozen.contentHash, validation: frozen.validation,
    submittedBy: { profileId: ownerId, displayName: draft.locale === 'zh-HK' ? '示例店主' : 'Sample owner', role: 'account_member' },
    submittedAt, decision: null, capabilities: { canDecide: false },
  }, draft.id)
}

export function createJourneyScenario(lang: 'en' | 'zh-HK'): JourneyScenario {
  const brandName = lang === 'zh-HK' ? '海港茶舖' : 'Harbour Tea'
  const title = lang === 'zh-HK' ? '釐清海港茶舖產品資料' : 'Clarify Harbour Tea product details'
  const action = lang === 'zh-HK'
    ? '核對產品頁嘅茶葉名稱、成分同包裝份量，整理清晰資料後再交審批。'
    : 'Check the tea name, ingredients and pack size against the product page, then prepare clear product details for review.'
  const notes = lang === 'zh-HK'
    ? '只供示例。加入結構化資料前，請先同店主確認每項產品資料；目前未有發佈任何修改。'
    : 'Controlled sample only. Confirm every product fact with the owner before adding structured data; nothing has been published.'
  const envelope = buildScanEvidence({
    requestedUrl: 'https://harbour-tea.example/products/oolong',
    evaluatedUrl: 'https://harbour-tea.example/products/oolong',
    industry: 'retail_ecommerce', region: 'HK', sitemapSource: 'unknown',
    collectedAt: '2026-11-14T00:00:00.000Z',
    checks: { c4_structured_data: { assessment: 'warn', collection: 'complete' } },
    observations: [{ check: 'page', observedAt: '2026-11-14T00:00:00.000Z', collection: 'complete', httpStatus: 200,
      target: describeEvidenceUrl('https://harbour-tea.example/products/oolong'), signals: { mimeType: 'text/html' } }],
  })
  const source = { kind: 'scan-check' as const, scanId, recordedAt: '2026-11-14T00:00:30.000Z', envelope }
  const suggestion = deriveSuggestions(source).find(value => value.source.checkKey === 'c4_structured_data')
  if (!suggestion || suggestion.evidence.kind !== 'scan-check') throw new Error('Sample scan suggestion unavailable')
  const snapshot = buildInitialDraftSnapshot(suggestion, source, lang)
  const initial: WorkItem = {
    id: itemId, clientId, status: 'draft', title, action, notes, locale: lang, revision: 1,
    createdAt: '2026-11-14T00:01:00.000Z', updatedAt: '2026-11-14T00:01:00.000Z',
    evidenceSnapshot: JSON.parse(serializeDraftSnapshot(snapshot)) as DraftSnapshotV1,
  }
  const edited: WorkItem = {
    ...structuredClone(initial), revision: 2, updatedAt: '2026-11-14T00:01:30.000Z',
    notes: notes + (lang === 'zh-HK' ? '\n店主備註：交審前再次核對包裝份量。' : '\nOwner note: check the pack size again before review.'),
  }
  // These are two alternative first submissions, not pre-existing version history.
  const canonicalDrafts = [initial, edited]
  const canonicalVersions = canonicalDrafts.map(value => freezeJourneyDraft(value))
  const version = canonicalVersions[0]
  const frozen = freezeReview(initial)
  // Use the real owned-read decoder/projection, retaining all baseline limitations.
  // No delivery or later candidate observation is manufactured for this packet.
  const baseline = projectOutcomeSnapshot({
    member: true, owned: true, evaluated_at: clock, events: [], scans: [],
    version: {
      account_id: accountId, client_id: clientId, work_item_id: itemId,
      id: version.id, version_number: version.versionNumber, draft_revision: version.draftRevision,
      content: frozen.content, content_hash: frozen.contentHash, validation: frozen.validation,
      submitter: version.submittedBy, submitted_at: submittedAt, decision_record: null, can_decide: false,
    },
  }).baseline
  if (!baseline) throw new Error('Sample baseline unavailable')
  return {
    lang, brandName,
    ids: { clientId, itemId, ownerId, reviewerId, versionId: version.id, attestationId },
    clock, deliveredAt: '2026-11-14T00:10:00.000Z', draft: structuredClone(initial),
    canonicalDrafts, canonicalVersions, baseline,
    opportunities: {
      schemaVersion: 1,
      window: { pulseWeek: null, pulseLimit: 200, pulseTruncated: false, scanId },
      sourceStates: { pulse: 'empty', scan: 'ok' }, savedDraftsState: 'ok', partial: false,
      suggestions: [{ ...suggestion, savedDraftId: itemId, savedState: 'saved', saveAvailability: 'available' }],
    },
  }
}
