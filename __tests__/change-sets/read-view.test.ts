import { describe, expect, it, vi } from 'vitest'
import { parseVersionDetail, parseVersionPage } from '@/lib/change-sets/read-view'
import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { CHECK_VERSIONS_2026_09_05 } from '@/lib/scan-evidence-versions'
import { initial as c9dPage, version as c9dVersion } from '../components/c9d-fixtures'
import { fixtureProps as c9eProps } from '../components/c9e-fixtures'
import { scanSuggestion } from '../components/c9c-fixtures'
import { approvedVersion } from '../delivery/fixtures'

vi.mock('server-only', () => ({}))

const ITEM = '123e4567-e89b-42d3-a456-426614174000'
const OTHER = '123e4567-e89b-42d3-a456-426614174099'
const VERSION = '123e4567-e89b-42d3-a456-426614174002'
const ERROR = new Error('CHANGE_SET_UNAVAILABLE')

function pulse(): DraftSnapshotV1 { return approvedVersion().evidenceSnapshot }
function scan(): DraftSnapshotV1 {
  if (scanSuggestion.evidence.kind !== 'scan-check') throw Error('Expected scan fixture')
  return {
    schemaVersion: 1, source: { ...scanSuggestion.source }, ruleVersion: scanSuggestion.ruleVersion,
    evidence: structuredClone(scanSuggestion.evidence), limitations: [...scanSuggestion.limitations],
    titleKey: scanSuggestion.titleKey, actionKey: scanSuggestion.actionKey, args: { ...scanSuggestion.args },
    locale: 'zh-HK', initialTitle: 'Review recorded check', initialAction: 'Inspect the retained result.',
  }
}
function draft(snapshot = pulse()): WorkItem {
  return {
    id: ITEM, clientId: OTHER, status: 'draft', revision: 3, title: 'Saved review',
    action: 'Review the recorded evidence.', notes: '', locale: 'en', evidenceSnapshot: snapshot,
    createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
  }
}
function detail(schema: 1 | 2 = 1): VersionDetail {
  const item = draft()
  const frozen = schema === 1 ? freezeReview(item) : freezeMultiSourceReview(item, [scan(), pulse(), pulse()])
  return {
    ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation,
    id: VERSION, versionNumber: 7, submittedBy: { profileId: OTHER, displayName: null, role: 'account_member' },
    submittedAt: '2026-09-06T00:00:00.123456Z', decision: null, capabilities: { canDecide: true },
  }
}
function replace(value: unknown, path: string, next: unknown): unknown {
  const cloned = structuredClone(value) as Record<string, unknown>
  const keys = path.split('.')
  let target = cloned
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>
  target[keys.at(-1)!] = next
  return cloned
}

const malformedSummary: Array<[string, unknown]> = [
  ['schemaVersion', 3], ['schemaVersion', '1'], ['id', 'not-an-id'], ['workItemId', OTHER],
  ['versionNumber', 0], ['versionNumber', '7'], ['versionNumber', 1.5], ['versionNumber', Number.MAX_SAFE_INTEGER + 1],
  ['draftRevision', 0], ['draftRevision', undefined], ['contentHash', 'A'.repeat(64)], ['contentHash', 'a'.repeat(63)],
  ['submittedBy', null], ['submittedBy.profileId', 'invalid'], ['submittedBy.displayName', undefined],
  ['submittedBy.role', 'owner'], ['submittedAt', 'invalid date'], ['submittedAt', 123],
  ['decision', undefined], ['capabilities', undefined], ['capabilities.canDecide', 'true'],
]

describe('parseVersionPage', () => {
  it('accepts empty and historical-only pages without inferring latest membership', () => {
    const empty = { versions: [], nextCursor: null, latestVersionId: null }
    expect(parseVersionPage(empty, ITEM)).toBe(empty)
    const historical = { versions: [detail()], nextCursor: 'opaque-cursor', latestVersionId: OTHER }
    expect(parseVersionPage(historical, ITEM)).toBe(historical)
  })

  it('preserves returned order, duplicates and extra fields without rebuilding summaries', () => {
    const first = { ...detail(2), extra: { retained: true } }
    const second = { ...detail(), id: OTHER, versionNumber: 2 }
    const page = { versions: [second, first, second], nextCursor: 'opaque', latestVersionId: VERSION, extra: 'saved' }
    const before = structuredClone(page)
    expect(parseVersionPage(page, ITEM)).toBe(page)
    expect(page).toEqual(before)
    expect(parseVersionPage(page, ITEM).versions.map(v => v.id)).toEqual([OTHER, VERSION, OTHER])
  })

  it('accepts the current public list fields alone (no invented clientId or detail requirements)', () => {
    const v = detail()
    const { schemaVersion, id, versionNumber, workItemId, draftRevision, contentHash, submittedBy, submittedAt, decision, capabilities } = v
    const page = { versions: [{ schemaVersion, id, versionNumber, workItemId, draftRevision, contentHash, submittedBy, submittedAt, decision, capabilities }], nextCursor: null, latestVersionId: id }
    expect(parseVersionPage(page, ITEM)).toEqual(page)
  })

  it.each(malformedSummary)('rejects malformed summary %s', (path, value) => {
    const page = { versions: [replace(detail(), path, value)], nextCursor: null, latestVersionId: VERSION }
    expect(() => parseVersionPage(page, ITEM)).toThrow(ERROR)
  })

  it.each([
    null, [], {}, { versions: null, nextCursor: null, latestVersionId: null },
    { versions: [], nextCursor: undefined, latestVersionId: null },
    { versions: [], nextCursor: '', latestVersionId: null },
    { versions: [], nextCursor: 1, latestVersionId: null },
    { versions: [], nextCursor: null, latestVersionId: 'not-an-id' },
    { versions: [], nextCursor: null },
  ])('rejects malformed list envelope %#', value => {
    expect(() => parseVersionPage(value, ITEM)).toThrow(ERROR)
  })
})

describe('parseVersionDetail', () => {
  it.each([1, 2] as const)('accepts genuine Node-frozen V%s and exact optional bindings', schema => {
    const v = detail(schema)
    expect(v.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(parseVersionDetail(v, ITEM, { id: v.id, contentHash: v.contentHash, draftRevision: v.draftRevision })).toBe(v)
    expect(parseVersionDetail(v, ITEM, {})).toBe(v)
    expect(parseVersionDetail(v, ITEM)).toBe(v)
  })

  it('accepts current C9D and downstream C9E/F fixture shapes without re-freezing their transport stubs', () => {
    expect(parseVersionPage(c9dPage, c9dVersion.workItemId)).toBe(c9dPage)
    expect(parseVersionDetail(c9dVersion, c9dVersion.workItemId)).toBe(c9dVersion)
    expect(parseVersionPage(c9eProps.initial, c9eProps.workItemId)).toBe(c9eProps.initial)
    expect(parseVersionDetail(c9eProps.initialVersion, c9eProps.workItemId)).toBe(c9eProps.initialVersion)
    // C9F's route stubs reuse this approved version and select older by id only.
    const older = { ...c9eProps.initialVersion, id: c9eProps.initial.versions[1].id }
    expect(parseVersionDetail(older, older.workItemId, { id: older.id })).toBe(older)
  })

  it('preserves every V2 snapshot, duplicate, nested array order and extra field', () => {
    const v = detail(2)
    if (v.schemaVersion !== 2) throw Error('Expected V2')
    const withExtras = { ...v, extra: { saved: true }, evidenceSnapshots: v.evidenceSnapshots.map(s => ({ ...s, extra: ['b', 'a'] })) }
    const before = structuredClone(withExtras)
    expect(parseVersionDetail(withExtras, ITEM)).toBe(withExtras)
    expect(withExtras).toEqual(before)
    expect(withExtras.evidenceSnapshots.map(s => s.source.kind)).toEqual(['scan-check', 'pulse-metric', 'pulse-metric'])
  })

  it('does not compute cryptographic provenance or normalize/reorder saved text', () => {
    const v = { ...detail(), title: ' e\u0301 ', contentHash: 'f'.repeat(64) }
    expect(parseVersionDetail(v, ITEM, { contentHash: v.contentHash })).toBe(v)
    expect(v.title).toBe(' e\u0301 ')
  })

  it('accepts genuine Node-frozen historical scanner versions and opaque source IDs', () => {
    const s = scan()
    if (s.evidence.kind !== 'scan-check') throw Error('Expected scan')
    s.source.id = 'historical-scan'
    s.evidence.scanId = s.source.id
    s.evidence.scannerVersion = '2026-09-05.v1'
    s.evidence.check.version = CHECK_VERSIONS_2026_09_05[s.evidence.checkKey]
    s.evidence.comparison.scannerVersion = s.evidence.scannerVersion
    s.evidence.comparison.checkVersions = { ...CHECK_VERSIONS_2026_09_05 }
    const frozen = freezeReview(draft(s))
    const v = { ...detail(), ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation }
    expect(parseVersionDetail(v, ITEM)).toBe(v)
  })

  it.each([
    { id: OTHER }, { contentHash: 'b'.repeat(64) }, { draftRevision: 2 },
  ])('rejects mismatched expected binding %j', expected => {
    expect(() => parseVersionDetail(detail(), ITEM, expected)).toThrow(ERROR)
  })

  it('rejects another work item, wrappers and malformed requested scope', () => {
    expect(() => parseVersionDetail(detail(), OTHER)).toThrow(ERROR)
    expect(() => parseVersionDetail({ version: detail() }, ITEM)).toThrow(ERROR)
    expect(() => parseVersionDetail(detail(), 'not-an-id')).toThrow(ERROR)
    expect(() => parseVersionPage({ versions: [], nextCursor: null, latestVersionId: null }, 'not-an-id')).toThrow(ERROR)
  })

  it.each(malformedSummary)('rejects malformed detail summary %s', (path, value) => {
    expect(() => parseVersionDetail(replace(detail(), path, value), ITEM)).toThrow(ERROR)
  })

  it.each([
    ['title', undefined], ['title', ''], ['action', []], ['action', ''], ['notes', null], ['locale', 'fr'],
    ['validation', null], ['validation.policyVersion', 'future'], ['validation.checks', []],
    ['validation.checks.0.status', 'fail'], ['validation.checks.0.code', 'unknown'],
    ['validation.checks.1.code', 'text'], ['evidenceSnapshot', null], ['evidenceSnapshot.schemaVersion', 2],
    ['evidenceSnapshot.source.kind', 'agent-recommendation'], ['evidenceSnapshot.source.id', null],
    ['evidenceSnapshot.ruleVersion', 'stored-recommendation.v1'], ['evidenceSnapshot.locale', 'fr'],
    ['evidenceSnapshot.limitations', [null]], ['evidenceSnapshot.args', {}], ['evidenceSnapshot.args.question', 2],
    ['evidenceSnapshot.initialAction', null], ['evidenceSnapshot.evidence.kind', 'unknown'],
    ['evidenceSnapshot.evidence.answerDigest', 'bad'], ['evidenceSnapshot.evidence.provenance', 'generated'],
    ['evidenceSnapshot.evidence.hasAnswer', false], ['evidenceSnapshot.evidence.brandMentioned', true],
    ['evidenceSnapshot.evidence.promptId', undefined], ['evidenceSnapshot.evidence.result', 'failed'],
    ['evidenceSnapshot.evidence.recordedAt', 3], ['editSpec', null], ['editSpec', { schemaVersion: 2 }],
  ] as Array<[string, unknown]>)('rejects malformed V1 transport %s', (path, value) => {
    expect(() => parseVersionDetail(replace(detail(), path, value), ITEM)).toThrow(ERROR)
  })

  it.each([
    ['evidenceSnapshots', []], ['evidenceSnapshots', undefined], ['evidenceSnapshots.0.evidence.checkKey', 'c99'],
    ['evidenceSnapshots.0.evidence.check', null], ['evidenceSnapshots.0.evidence.check.assessment', 'unknown'],
    ['evidenceSnapshots.0.evidence.check.reason', 'unknown'], ['evidenceSnapshots.0.evidence.collection', 'success'],
    ['evidenceSnapshots.0.evidence.requested.pathRedacted', 'true'], ['evidenceSnapshots.0.evidence.final', {}],
    ['evidenceSnapshots.0.evidence.comparisonSignature', 'bad'], ['evidenceSnapshots.0.evidence.comparison.scope', 'site-wide'],
    ['evidenceSnapshots.0.evidence.comparison.checkVersions.c1_robots', undefined],
    ['evidenceSnapshots.0.evidence.observations', [null]], ['evidenceSnapshots.0.evidence.limited', null],
    ['evidenceSnapshots.0.evidence.provenance', 'self_reported'],
  ] as Array<[string, unknown]>)('rejects malformed V2/scan transport %s', (path, value) => {
    expect(() => parseVersionDetail(replace(detail(2), path, value), ITEM)).toThrow(ERROR)
  })

  it('validates retained observations without dropping nullable fields, order or extra signals', () => {
    const snapshot = scan()
    if (snapshot.evidence.kind !== 'scan-check') throw Error('Expected scan')
    snapshot.evidence.observations = [{
      observedAt: null, provenance: null, collection: 'unknown', target: snapshot.evidence.requested,
      httpStatus: null, signals: {}, check: null,
    }, {
      observedAt: '2026-09-02T10:00:00.123456Z', provenance: 'validated-fetch', collection: 'complete',
      target: snapshot.evidence.evaluated, httpStatus: 200, signals: { noindex: false, contentLength: 123 }, check: 'page',
    }]
    const frozen = freezeMultiSourceReview(draft(), [snapshot, pulse()])
    const v = { ...detail(2), ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation }
    expect(parseVersionDetail(v, ITEM)).toBe(v)
    for (const [path, value] of [
      ['observedAt', 123], ['provenance', 'generated'], ['collection', 'success'], ['target', null],
      ['httpStatus', 99], ['httpStatus', 600], ['httpStatus', 200.5], ['check', 'c99'],
      ['signals', { noindex: null }], ['signals', { nested: {} }],
    ] as Array<[string, unknown]>) {
      expect(() => parseVersionDetail(replace(v, 'evidenceSnapshots.0.evidence.observations.0.' + path, value), ITEM)).toThrow(ERROR)
    }
  })

  it('preserves validation array order rather than reconstituting it', () => {
    const v = detail()
    v.validation.checks.reverse()
    expect(parseVersionDetail(v, ITEM).validation.checks[0].code).toBe('content_size')
  })

  it.each(['approved', 'changes_requested'] as const)('accepts %s decision only with approver snapshot and boolean capability', decision => {
    const v = { ...approvedVersion(), decision: { ...approvedVersion().decision!, decision } }
    expect(parseVersionDetail(v, ITEM)).toBe(v)
    for (const [path, value] of [
      ['decision.decision', 'pending'], ['decision.reason', ''], ['decision.decidedBy.role', 'platform_admin'],
      ['decision.decidedBy.profileId', 'bad'], ['decision.decidedAt', 'bad'], ['capabilities.canDecide', true],
    ] as Array<[string, unknown]>) {
      expect(() => parseVersionDetail(replace(v, path, value), ITEM)).toThrow(ERROR)
    }
  })

  it.each([
    { schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://example.test/', schemaType: 'FAQPage', payload: { '@context': 'https://schema.org', '@type': 'FAQPage' } },
    { schemaVersion: 1, kind: 'jsonld_remove', targetUrl: 'https://example.test/', schemaType: 'Organization', payload: { '@context': 'https://schema.org', '@type': 'Organization' } },
    { schemaVersion: 1, kind: 'meta', targetUrl: 'https://example.test/', title: 'Title', description: null },
    { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://example.test/llms.txt', content: '# Saved content\n' },
  ])('preserves genuine Node-frozen edit spec $kind', editSpec => {
    const frozen = freezeReview({ ...draft(), editSpec: editSpec as WorkItem['editSpec'] })
    const v = { ...detail(), ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation }
    expect(parseVersionDetail(v, ITEM)).toBe(v)
    expect(v.editSpec).toEqual(editSpec)
  })
})
