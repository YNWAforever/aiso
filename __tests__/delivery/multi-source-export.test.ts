import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import { versionDTO } from '@/lib/change-sets/store'
import type { VersionDetail } from '@/lib/change-sets/types'
import { createDeliveryExport } from '@/lib/delivery/export'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import type { WorkItem } from '@/lib/work-items/schema'
import { approvedVersion, ID, REQUEST_ID } from './fixtures'
import { approvedMultiSourceVersion, editSpecs, scanSnapshot, versionRow } from './multi-source-fixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => { throw new Error('No database reads in renderer/DTO tests') } }))
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function refreeze(version: VersionDetail): VersionDetail {
  const item = { ...version, id: version.workItemId, revision: version.draftRevision }
  const frozen = version.schemaVersion === 1 ? freezeReview({ ...version, id: version.workItemId, revision: version.draftRevision,
    clientId: REQUEST_ID, status: 'draft', createdAt: version.submittedAt, updatedAt: version.submittedAt })
    : freezeMultiSourceReview(item, version.evidenceSnapshots)
  return { ...version, ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation } as VersionDetail
}

describe('multi-source delivery export', () => {
  it('exports the full genuine mixed scan/Pulse snapshots in saved order, including duplicates', () => {
    const version = approvedMultiSourceVersion()
    const artifact = createDeliveryExport(version, 'json')
    const envelope = JSON.parse(artifact.body)
    expect(artifact.rendererVersion).toBe('delivery-export.v2')
    expect(envelope.schemaVersion).toBe('delivery-export.v2')
    expect(envelope.content.schemaVersion).toBe(2)
    expect(envelope.content.evidenceSnapshots).toEqual(version.evidenceSnapshots)
    expect(envelope.content.evidenceSnapshots.map((snapshot: WorkItem['evidenceSnapshot']) => snapshot.evidence.kind)).toEqual(['scan-check', 'pulse-metric', 'scan-check'])
    expect(envelope.content.evidenceSnapshots[0]).toEqual(envelope.content.evidenceSnapshots[2])
    expect(envelope.content.evidenceSnapshots.every((snapshot: WorkItem['evidenceSnapshot']) => snapshot.schemaVersion === 1)).toBe(true)
    expect(envelope.content).not.toHaveProperty('evidenceSnapshot')
    expect(envelope.contentHash).toBe(version.contentHash)
    expect(fingerprintEvidence(envelope.content)).toBe(version.contentHash)
    expect(envelope.validation).toEqual(version.validation)
    expect(envelope.validation.policyVersion).toBe('change-set-review.v1')
    expect(envelope.limitations).toEqual(['delivery-export.v2: This is a retained approved review package. Export does not attest delivery, verify publication, or demonstrate measured impact.'])
    expect(artifact.exportHash).toBe(sha256(artifact.body))
    expect(Object.keys(envelope)).toEqual(Object.keys(envelope).sort())
    expect(Object.keys(envelope.content)).toEqual(Object.keys(envelope.content).sort())
    expect(artifact.body).not.toContain('private?q=redacted')
  })

  it('hashes the canonical JSON for both formats and retains the complete labelled text envelope', () => {
    const version = approvedMultiSourceVersion()
    const json = createDeliveryExport(version, 'json'), text = createDeliveryExport(version, 'text')
    expect(text.rendererVersion).toBe('delivery-export.v2')
    expect(text.exportHash).toBe(json.exportHash)
    expect(text.exportHash).not.toBe(sha256(text.body))
    expect(text.body).toBe([
      'Approved review package', `Version ID: ${version.id}`, `Version number: ${version.versionNumber}`,
      `Content hash: ${version.contentHash}`, `Submitted at: ${version.submittedAt}`,
      `Approved at: ${version.decision!.decidedAt}`, `Export hash: ${json.exportHash}`,
      'The export hash identifies the canonical JSON envelope, not these text bytes.',
      JSON.parse(json.body).limitations[0], '', 'Complete canonical review envelope:',
      JSON.stringify(JSON.parse(json.body), null, 2), '',
    ].join('\n'))
    expect(text.filename).toBe(`delivery-${version.id}.txt`)
    expect(text.contentType).toBe('text/plain; charset=utf-8')
    expect(json.filename).toBe(`delivery-${version.id}.json`)
    expect(json.contentType).toBe('application/json; charset=utf-8')
  })

  it('re-freezes a reordered package coherently and produces different content and artifact hashes', () => {
    const original = approvedMultiSourceVersion()
    const reordered = approvedMultiSourceVersion(undefined, [original.evidenceSnapshots[1], original.evidenceSnapshots[0], original.evidenceSnapshots[2]])
    expect(reordered.contentHash).not.toBe(original.contentHash)
    expect(createDeliveryExport(reordered, 'json').exportHash).not.toBe(createDeliveryExport(original, 'json').exportHash)
    expect(JSON.parse(createDeliveryExport(reordered, 'json').body).content.evidenceSnapshots).toEqual(reordered.evidenceSnapshots)
  })

  it('ignores private metadata and legacy live-evidence extras without downgrading the snapshot array', () => {
    const version = approvedMultiSourceVersion()
    const original = createDeliveryExport(version, 'json')
    Object.assign(version, { email: 'private-secret', latestVersionId: REQUEST_ID, evidenceSnapshot: scanSnapshot(), liveSources: ['private-secret'] })
    Object.assign(version.submittedBy, { authSubject: 'private-secret' })
    Object.assign(version.decision!.decidedBy, { email: 'private-secret' })
    Object.assign(version.decision!, { internalNote: 'private-secret' })
    expect(createDeliveryExport(version, 'json')).toEqual(original)
    expect(original.body).not.toContain('private-secret')
  })

  it('normalizes retained actor identities and preserves C9d reason/microsecond date semantics', () => {
    const version = approvedMultiSourceVersion()
    version.submittedBy.profileId = version.submittedBy.profileId.toUpperCase()
    version.decision!.reason = 'Reviewed\tcontent\r\nand evidence 保留 é'
    version.submittedAt = '2026-09-06T08:00:00.123456+08:00'
    version.decision!.decidedAt = '2026-09-06T09:00:00.654321+08:00'
    const envelope = JSON.parse(createDeliveryExport(version, 'json').body)
    expect(envelope.decision.reason).toBe(version.decision!.reason)
    expect(envelope.submittedBy.profileId).toBe(version.submittedBy.profileId.toLowerCase())
    expect(envelope.submittedAt).toBe('2026-09-06T00:00:00.123456Z')
    expect(envelope.decision.decidedAt).toBe('2026-09-06T01:00:00.654321Z')
  })

  it.each([null, 'changes_requested'] as const)('refuses a valid unapproved V2 package %s', decision => {
    const version = approvedMultiSourceVersion()
    version.decision = decision === null ? null : { ...version.decision!, decision }
    expect(() => createDeliveryExport(version, 'json')).toThrow('DELIVERY_NOT_APPROVED')
  })
})

for (const schema of [1, 2] as const) {
  describe(`schema ${schema} retained integrity`, () => {
    const build = (): VersionDetail => schema === 1 ? approvedVersion() : approvedMultiSourceVersion()
    it.each([...editSpecs.map(spec => [spec.kind, spec] as const), ['null', null] as const, ['absent', undefined] as const])('preserves edit spec %s without changing nested schema versions', (_name, spec) => {
      const version = build()
      if (spec !== undefined) Object.assign(version, { editSpec: spec })
      const frozen = refreeze(version)
      const envelope = JSON.parse(createDeliveryExport(frozen, 'json').body)
      expect(envelope.contentHash).toBe(frozen.contentHash)
      if (spec == null) expect(envelope.content).not.toHaveProperty('editSpec')
      else {
        expect(envelope.content.editSpec).toEqual(spec)
        expect(envelope.content.editSpec.schemaVersion).toBe(1)
      }
      expect(envelope.content.schemaVersion).toBe(schema)
    })

    const mutations: [string, (version: VersionDetail) => void][] = [
      ['mismatched hash', v => { v.contentHash = 'b'.repeat(64) }],
      ['malformed hash', v => { v.contentHash = 'a'.repeat(63) }],
      ['missing validation check', v => { v.validation.checks.pop() }],
      ['validation policy', v => { Object.assign(v.validation, { policyVersion: 'change-set-review.v2' }) }],
      ['validation order', v => { v.validation.checks.reverse() }],
      ['submitter identity', v => { v.submittedBy.profileId = 'bad' }],
      ['submitter role', v => { Object.assign(v.submittedBy, { role: 'owner' }) }],
      ['approver role', v => { v.decision!.decidedBy.role = 'platform_admin' }],
      ['self approval', v => { v.decision!.decidedBy.profileId = v.submittedBy.profileId.toUpperCase() }],
      ['approver identity', v => { v.decision!.decidedBy.profileId = 'bad' }],
      ['unsafe version ID', v => { v.id = '../unsafe' }],
      ['unsafe item ID', v => { v.workItemId = '../unsafe' }],
      ['changed item binding', v => { v.workItemId = REQUEST_ID }],
      ['changed draft revision', v => { v.draftRevision += 1 }],
      ['noninteger version number', v => { v.versionNumber = 1.5 }],
      ['zero version number', v => { v.versionNumber = 0 }],
      ['text corruption', v => { v.notes = 'tampered' }],
      ['noncanonical draft text', v => { v.title = ' Review ' }],
      ['invalid locale', v => { Object.assign(v, { locale: 'fr' }) }],
      ['empty reason', v => { v.decision!.reason = '' }],
      ['noncanonical reason', v => { v.decision!.reason = ' Reviewed ' }],
      ['oversized reason', v => { v.decision!.reason = 'x'.repeat(2001) }],
      ['invalid submit time', v => { v.submittedAt = '2026-02-30T00:00:00Z' }],
      ['invalid decision time', v => { v.decision!.decidedAt = '2026-09-06T25:00:00Z' }],
      ['excess timestamp precision', v => { v.submittedAt = '2026-09-06T00:00:00.1234567Z' }],
      ['unknown schema', v => { Object.assign(v, { schemaVersion: 3 }) }],
      ['noncanonical spec', v => { Object.assign(v, { editSpec: { ...editSpecs[2], title: ' padded ' } }) }],
      ['nested private evidence', v => {
        const snapshot = v.schemaVersion === 1 ? v.evidenceSnapshot : v.evidenceSnapshots[1]
        Object.assign(snapshot.evidence, { rawAnswer: 'private-secret' })
      }],
      ['inconsistent source binding', v => {
        const snapshot = v.schemaVersion === 1 ? v.evidenceSnapshot : v.evidenceSnapshots[1]
        snapshot.source.id = REQUEST_ID
      }],
    ]
    it.each(mutations)('rejects %s', (_name, mutate) => {
      const version = build()
      mutate(version)
      for (const format of ['json', 'text'] as const) expect(() => createDeliveryExport(version, format)).toThrow('DELIVERY_VALIDATION_FAILED')
    })
  })
}

it.each([
  ['empty', (v: Extract<VersionDetail, { schemaVersion: 2 }>) => { v.evidenceSnapshots = [] }],
  ['missing', (v: Extract<VersionDetail, { schemaVersion: 2 }>) => { Object.assign(v, { evidenceSnapshots: undefined }) }],
  ['array reorder without refreeze', (v: Extract<VersionDetail, { schemaVersion: 2 }>) => { v.evidenceSnapshots.reverse(); [v.evidenceSnapshots[0], v.evidenceSnapshots[1]] = [v.evidenceSnapshots[1], v.evidenceSnapshots[0]] }],
  ['oversize package', (v: Extract<VersionDetail, { schemaVersion: 2 }>) => { v.evidenceSnapshots = Array.from({ length: 120 }, () => scanSnapshot()) }],
] as const)('rejects V2 %s', (_name, mutate) => {
  const version = approvedMultiSourceVersion()
  mutate(version)
  expect(() => createDeliveryExport(version, 'json')).toThrow('DELIVERY_VALIDATION_FAILED')
})

it.each([1, 2] as const)('roundtrips schema %i freeze → stored row → real versionDTO → export with approval bindings', schema => {
  const version = schema === 1 ? approvedVersion() : approvedMultiSourceVersion()
  const row = JSON.parse(JSON.stringify(versionRow(version))) as Record<string, unknown>
  const dto = versionDTO(row)
  expect(dto).toEqual(version)
  expect(createDeliveryExport(dto, 'json')).toEqual(createDeliveryExport(version, 'json'))
  for (const field of ['version_id', 'content_hash', 'actor_id']) {
    const invalidRow = structuredClone(row)
    Object.assign(invalidRow.decision_record as object, { [field]: field === 'content_hash' ? 'b'.repeat(64) : REQUEST_ID })
    expect(() => versionDTO(invalidRow)).toThrow('CHANGE_SET_UNAVAILABLE')
  }
  const invalidItem = structuredClone(row)
  invalidItem.work_item_id = REQUEST_ID
  expect(() => versionDTO(invalidItem)).toThrow('CHANGE_SET_UNAVAILABLE')
  expect(dto.workItemId).toBe(ID)
})
