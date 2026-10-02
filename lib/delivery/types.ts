import type { ActorSnapshot, StoreResult } from '@/lib/change-sets/types'

export type DeliveryScope = { accountId: string; clientId: string; itemId: string; versionId: string; actorId: string }
/**
 * What an attestation asks to have measured (attribution, migration 056): the
 * whole site, or 1-MEASURE_PAGES_MAX of this brand's registered pages. Frozen in
 * work_item_delivery_measures by the attestation's own statement. Absent means
 * nothing is measured — and is the only shape while attribution is off.
 */
export type MeasureInput = { scope: 'site' } | { scope: 'page'; assetIds: string[] }
export type AttestInput = { contentHash: string; destination: string; deliveredAt: string; note: string; requestId: string; measure?: MeasureInput }
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
/** `unknown_page`: a measured asset id is not one of this brand's registered pages, so nothing was written. */
export type DeliveryResult<T> = StoreResult<T> | { kind: 'unknown_page' }
export type ExportArtifact = { body: string; exportHash: string; contentType: string; filename: string }
