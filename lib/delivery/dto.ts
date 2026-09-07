import type { ActorSnapshot } from '@/lib/change-sets/types'
import { deliveryHash, deliveryId, deliveryText, deliveryTime } from './input'
import type { DeliveryEvent, EventBase } from './types'

function invalid(): never { throw new Error('DELIVERY_VALIDATION_FAILED') }

/** Explicit minimal projection: historical missing names remain null. */
export function deliveryActor(value: unknown): ActorSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  const actor = value as Record<string, unknown>
  if (actor.displayName !== null && typeof actor.displayName !== 'string') invalid()
  if (actor.role !== 'account_member' && actor.role !== 'account_approver' && actor.role !== 'platform_admin') invalid()
  return { profileId: deliveryId(actor.profileId), displayName: actor.displayName, role: actor.role }
}
function retainedText(value: unknown, maximum: number, multiline: boolean): string {
  const text = deliveryText(value, maximum, multiline)
  if (text !== value) invalid()
  return text
}
export function deliveryEventDTO(row: Record<string, unknown>): DeliveryEvent {
  try {
    if (row.schema_version !== 1) invalid()
    const actor = deliveryActor(row.actor)
    if (actor.role !== 'account_member' || actor.profileId !== deliveryId(row.actor_id)) invalid()
    const base: EventBase = { schemaVersion: 1, eventId: deliveryId(row.id), versionId: deliveryId(row.version_id),
      contentHash: deliveryHash(row.content_hash), actor, recordedAt: deliveryTime(row.recorded_at, 6) }
    if (row.kind === 'attest') {
      if (row.reason !== null || row.target_attestation_id !== null) invalid()
      return { ...base, kind: 'attest', destination: retainedText(row.destination, 500, false),
        deliveredAt: deliveryTime(row.delivered_at, 6), note: retainedText(row.note, 2000, true) }
    }
    if (row.kind === 'withdraw') {
      if (row.destination !== null || row.delivered_at !== null || row.note !== null) invalid()
      const targetAttestationId = deliveryId(row.target_attestation_id)
      if (targetAttestationId === base.eventId) invalid()
      return { ...base, kind: 'withdraw', targetAttestationId, reason: retainedText(row.reason, 2000, true) }
    }
    invalid()
  } catch { invalid() }
}
