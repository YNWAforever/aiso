import type { ActorSnapshot, StoreResult } from '@/lib/change-sets/types'

export type DeliveryScope = { accountId: string; clientId: string; itemId: string; versionId: string; actorId: string }
export type AttestInput = { contentHash: string; destination: string; deliveredAt: string; note: string; requestId: string }
export type WithdrawInput = { reason: string; requestId: string }
export type EventBase = { schemaVersion: 1; eventId: string; versionId: string; contentHash: string; actor: ActorSnapshot; recordedAt: string }
export type DeliveryEvent =
  | (EventBase & { kind: 'attest'; destination: string; deliveredAt: string; note: string })
  | (EventBase & { kind: 'withdraw'; targetAttestationId: string; reason: string })
export type DisabledReason = 'not_approved' | 'superseded' | 'active_attestation' | 'no_active_attestation' | null
export type DeliveryPage = {
  events: DeliveryEvent[]
  activeAttestationId: string | null
  capabilities: { canExport: boolean; canAttest: boolean; canWithdraw: boolean; attestReason: DisabledReason; withdrawReason: DisabledReason }
  nextCursor: string | null
}
export type DeliveryQuery = { limit: number; cursor: { recordedAt: string; id: string } | null }
export type DeliveryResult<T> = StoreResult<T>
export type ExportArtifact = { body: string; exportHash: string; contentType: string; filename: string }
