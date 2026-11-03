import { CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import type { DraftSnapshotV1, OpportunityLocale, OpportunitySourceKind, SourceRef } from '@/lib/opportunities/types'

export const CREATE_DRAFT_BODY_LIMIT = 4 * 1024
export { EDIT_DRAFT_BODY_LIMIT, parseDraftEdit, type DraftEditInput } from './edit-input'
export const EVIDENCE_SNAPSHOT_LIMIT = 64 * 1024

export type CreateDraftInput = {
  source: SourceRef
  ruleVersion: 'pulse-brand-absent.v1' | 'scan-check-gap.v1' | 'stored-recommendation.v1'
  fingerprint: string
  locale: OpportunityLocale
}
export type WorkItem = {
  id: string; clientId: string; status: 'draft'; title: string; action: string; notes: string
  locale: OpportunityLocale; revision: number; createdAt: string; updatedAt: string
  evidenceSnapshot: DraftSnapshotV1
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FINGERPRINT = /^[0-9a-f]{64}$/
const SOURCE_RULE: Record<OpportunitySourceKind, CreateDraftInput['ruleVersion']> = {
  'pulse-metric': 'pulse-brand-absent.v1', 'scan-check': 'scan-check-gap.v1', 'agent-recommendation': 'stored-recommendation.v1',
}
function invalid(): never { throw new Error('INVALID_WORK_ITEM_INPUT') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) invalid()
}
function boundedBytes(value: unknown, limit: number) {
  let encoded: string | undefined
  try { encoded = JSON.stringify(value) } catch { invalid() }
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > limit) invalid()
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value.toLowerCase()
}
export function parseCreateDraft(value: unknown): CreateDraftInput {
  boundedBytes(value, CREATE_DRAFT_BODY_LIMIT)
  const input = record(value)
  exactKeys(input, ['source', 'ruleVersion', 'fingerprint', 'locale'])
  const source = record(input.source)
  if (source.kind === 'agent-recommendation') invalid()
  if (typeof source.kind !== 'string' || !Object.hasOwn(SOURCE_RULE, source.kind)) invalid()
  const kind = source.kind as OpportunitySourceKind
  exactKeys(source, kind === 'scan-check' ? ['kind', 'id', 'checkKey'] : ['kind', 'id'])
  if (input.ruleVersion !== SOURCE_RULE[kind]) invalid()
  if (typeof input.fingerprint !== 'string' || !FINGERPRINT.test(input.fingerprint)) invalid()
  if (input.locale !== 'en' && input.locale !== 'zh-HK') invalid()
  const parsedSource: SourceRef = { kind, id: uuid(source.id) }
  if (kind === 'scan-check') {
    if (typeof source.checkKey !== 'string' || !Object.hasOwn(CHECK_VERSIONS, source.checkKey)) invalid()
    parsedSource.checkKey = source.checkKey as EvidenceCheckKey
  }
  return { source: parsedSource, ruleVersion: input.ruleVersion as CreateDraftInput['ruleVersion'], fingerprint: input.fingerprint, locale: input.locale }
}
