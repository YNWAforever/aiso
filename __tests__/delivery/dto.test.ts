import { describe, expect, it, vi } from 'vitest'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { eventRow, ID, ACTOR_ID, VERSION_ID, member } from './fixtures'
vi.mock('server-only', () => ({}))
describe('delivery event DTO', () => {
  it('detaches an explicit attestation retaining nullable names and microseconds', () => {
    const row: Record<string, unknown> = { ...eventRow(), account_id: ID, private: 'secret' }
    const dto = deliveryEventDTO(row)
    expect(dto).toEqual({ schemaVersion: 1, eventId: ID, kind: 'attest', versionId: VERSION_ID, contentHash: 'a'.repeat(64), actor: member, recordedAt: '2026-09-07T01:00:00.123456Z', destination: 'Site', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Delivered manually' })
    ;(row.actor as typeof member).displayName = 'Mutated'
    expect(dto.actor.displayName).toBeNull()
  })
  it('returns only withdrawal fields', () => {
    expect(deliveryEventDTO({ ...eventRow(), kind: 'withdraw', destination: null, delivered_at: null, note: null, target_attestation_id: VERSION_ID, reason: 'Correction' })).toEqual({ schemaVersion: 1, eventId: ID, kind: 'withdraw', versionId: VERSION_ID, contentHash: 'a'.repeat(64), actor: member, recordedAt: '2026-09-07T01:00:00.123456Z', targetAttestationId: VERSION_ID, reason: 'Correction' })
  })
  it.each([{ schema_version: 2 }, { id: 'bad' }, { version_id: 'bad' }, { content_hash: 'A'.repeat(64) }, { actor_id: ID }, { actor: { ...member, role: 'platform_admin' } }, { actor: { ...member, role: 'account_approver' } }, { actor: { ...member, profileId: 'bad' } }, { actor: { ...member, displayName: 1 } }, { recorded_at: '2026-02-30T00:00:00Z' }, { delivered_at: '2026-09-07T00:00:60Z' }, { destination: ' Site' }, { note: 'e\u0301' }, { reason: 'mixed' }, { target_attestation_id: ACTOR_ID }, { kind: 'other' }, { kind: 'withdraw', target_attestation_id: ACTOR_ID, reason: 'why' }])('rejects invalid or mixed retained fields %j', patch => {
    expect(() => deliveryEventDTO({ ...eventRow(), ...patch })).toThrow('DELIVERY_VALIDATION_FAILED')
  })
})
