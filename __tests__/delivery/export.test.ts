import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createDeliveryExport } from '@/lib/delivery/export'
import { fingerprintEvidence } from '@/lib/opportunities/fingerprint'
import { approvedVersion, VERSION_ID } from './fixtures'
vi.mock('server-only', () => ({}))
describe('approved delivery export', () => {
  it('exports stable bytes independently of capabilities and download time', () => {
    const version = approvedVersion()
    const artifact = createDeliveryExport(version, 'json')
    expect(createDeliveryExport({ ...version, capabilities: { canDecide: true } }, 'json')).toEqual(artifact)
    expect(artifact.exportHash).toBe(createHash('sha256').update(artifact.body, 'utf8').digest('hex'))
    const parsed = JSON.parse(artifact.body)
    expect(parsed.schemaVersion).toBe('delivery-export.v1')
    expect(parsed.contentHash).toBe(version.contentHash)
    expect(fingerprintEvidence(parsed.content)).toBe(version.contentHash)
    expect(parsed.validation).toEqual(version.validation)
    expect(parsed.submittedBy.displayName).toBeNull()
    expect(parsed.content.evidenceSnapshot.evidence.recordedAt).toBeNull()
    expect(parsed.content.evidenceSnapshot.limitations).toEqual(['unknown-answer-coverage'])
    for (const field of ['canDecide', 'downloadedAt', 'exportHash']) expect(artifact.body).not.toContain(field)
    expect(artifact.filename).toBe(`delivery-${VERSION_ID}.json`)
    expect(artifact.contentType).toBe('application/json; charset=utf-8')
  })
  it('sorts nested object keys and preserves array order', () => {
    const version = approvedVersion()
    const reordered = approvedVersion()
    reordered.evidenceSnapshot.args = { platform: 'chatgpt', question: 'Example?' }
    expect(createDeliveryExport(reordered, 'json')).toEqual(createDeliveryExport(version, 'json'))
    const parsed = JSON.parse(createDeliveryExport(version, 'json').body)
    expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort())
    expect(Object.keys(parsed.content)).toEqual(Object.keys(parsed.content).sort())
    expect(parsed.validation.checks).toEqual(version.validation.checks)
  })
  it('renders the identical envelope and hash as labelled plain text', () => {
    const version = approvedVersion()
    const json = createDeliveryExport(version, 'json')
    const text = createDeliveryExport(version, 'text')
    expect(text.exportHash).toBe(json.exportHash)
    expect(text.body).toContain(JSON.stringify(JSON.parse(json.body), null, 2))
    expect(text.body).toContain(`Export hash: ${json.exportHash}`)
    expect(text.body).toContain(`Content hash: ${version.contentHash}`)
    expect(text.body).toContain('保留證據 é')
    expect(text.filename).toBe(`delivery-${VERSION_ID}.txt`)
    expect(text.contentType).toBe('text/plain; charset=utf-8')
  })
  it('excludes private extras on explicit version and actor projections', () => {
    const version = Object.assign(approvedVersion(), { email: 'secret@example.com', accountId: 'secret' })
    Object.assign(version.submittedBy, { authSubject: 'secret', email: 'secret@example.com' })
    expect(createDeliveryExport(version, 'json').body).not.toContain('secret')
  })
  it.each([null, 'changes_requested'] as const)('refuses an unapproved valid package %s', decision => {
    const version = approvedVersion()
    version.decision = decision === null ? null : { ...version.decision!, decision }
    expect(() => createDeliveryExport(version, 'json')).toThrow('DELIVERY_NOT_APPROVED')
  })
  it.each(['hash', 'evidence', 'validation', 'actor', 'id', 'date', 'decision', 'schema'] as const)('rejects malformed retained %s', field => {
    const version = approvedVersion()
    if (field === 'hash') version.contentHash = 'a'.repeat(63)
    if (field === 'evidence') Object.assign(version.evidenceSnapshot.evidence, { rawAnswer: 'secret' })
    if (field === 'validation') version.validation.checks.pop()
    if (field === 'actor') version.submittedBy.profileId = 'bad'
    if (field === 'id') version.id = '../unsafe'
    if (field === 'date') version.submittedAt = '2026-02-30T00:00:00Z'
    if (field === 'decision') version.decision!.decidedBy.role = 'account_member'
    if (field === 'schema') Object.assign(version, { schemaVersion: 2 })
    expect(() => createDeliveryExport(version, 'json')).toThrow('DELIVERY_VALIDATION_FAILED')
  })
})

it('preserves valid C9d approval reason formatting and retained timestamp precision', () => {
  const version = approvedVersion()
  version.decision!.reason = 'Reviewed\tcontent\r\nand evidence'
  version.submittedAt = '2026-09-06T00:00:00.123456Z'
  version.decision!.decidedAt = '2026-09-06T01:00:00.654321Z'
  const parsed = JSON.parse(createDeliveryExport(version, 'json').body)
  expect(parsed.decision.reason).toBe(version.decision!.reason)
  expect(parsed.submittedAt).toBe(version.submittedAt)
  expect(parsed.decision.decidedAt).toBe(version.decision!.decidedAt)
})
