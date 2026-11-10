import { createHash } from 'node:crypto'
import type { StudioEvidence, StudioOpportunities, StudioReply } from './types'

/**
 * A receipt is what the server actually read to compose one saved answer, in a
 * closed vocabulary. It is deliberately not a log line: no prompt, no answer
 * body, no provider text. `digest` binds the receipt to the exact bytes of the
 * selection (or the stored reply, for the final compose receipt) so a reader can
 * tell "same records" from "same label". `records` is the count read, and
 * `truncated` says the read hit a bound — never that the data was complete.
 */
export type StudioReceiptKind = 'pulse-week' | 'pulse-observations' | 'scan' | 'opportunities' | 'compose'

export type StudioReceipt = {
  kind: StudioReceiptKind
  id: string | null
  records: number
  truncated: boolean
  digest: string
}

/** A composed reply stores at most this many receipts; the builder cannot exceed it. */
export const STUDIO_RECEIPTS_LIMIT = 8

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Build the receipt list for one composed saved reply. Order is fixed:
 * the week snapshot, the selected observations, the scan evidence, the
 * opportunities (when the reply carries them), and finally the stored reply
 * itself, whose digest lets a reader prove the receipts describe it.
 */
export function buildStudioReceipts(input: {
  evidence: StudioEvidence
  reply: StudioReply
  opportunities: StudioOpportunities | null
  /** What applyStudioReplyBudget left out, so a bounded read is recorded as such. */
  trimmed?: { observations: number; scan: boolean }
}): StudioReceipt[] {
  const { evidence, reply, opportunities } = input
  const trimmedObservations = input.trimmed?.observations ?? 0
  const trimmedScan = input.trimmed?.scan ?? false
  const receipts: StudioReceipt[] = []
  if (evidence.week) {
    receipts.push({
      kind: 'pulse-week',
      id: evidence.week,
      records: evidence.totalRecorded,
      truncated: evidence.truncated,
      digest: digest({ week: evidence.week, totalRecorded: evidence.totalRecorded }),
    })
  }
  if (reply.observations.length || trimmedObservations > 0) {
    receipts.push({
      kind: 'pulse-observations',
      id: null,
      records: reply.observations.length,
      truncated: evidence.truncated || trimmedObservations > 0,
      digest: digest(reply.observations.map(item => ({ id: item.id, week: item.scanWeek, result: item.result }))),
    })
  }
  if (reply.scan) {
    receipts.push({
      kind: 'scan',
      id: reply.scan.id,
      records: reply.scan.evidence.checks.length,
      truncated: trimmedScan,
      digest: digest(reply.scan),
    })
  }
  if (opportunities && (opportunities.state === 'ready' || opportunities.suggestions.length > 0)) {
    receipts.push({
      kind: 'opportunities',
      id: opportunities.pulseWeek,
      records: opportunities.suggestions.length,
      truncated: opportunities.partial,
      digest: digest(opportunities.suggestions.map(item => ({ key: item.key, fingerprint: item.fingerprint }))),
    })
  }
  receipts.push({
    kind: 'compose',
    id: null,
    records: reply.observations.length,
    truncated: evidence.truncated || trimmedObservations > 0 || trimmedScan,
    digest: digest(reply),
  })
  return receipts.slice(0, STUDIO_RECEIPTS_LIMIT)
}

/** Parse a stored `receipts` column; anything malformed reads as absent, never as an empty success. */
export function parseStudioReceipts(value: unknown): StudioReceipt[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > STUDIO_RECEIPTS_LIMIT) return null
  const kinds: readonly string[] = ['pulse-week', 'pulse-observations', 'scan', 'opportunities', 'compose']
  const parsed: StudioReceipt[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Record<string, unknown>
    if (Object.keys(item).some(key => !['kind', 'id', 'records', 'truncated', 'digest'].includes(key))) return null
    if (typeof item.kind !== 'string' || !kinds.includes(item.kind)) return null
    if (item.id !== null && typeof item.id !== 'string') return null
    if (!Number.isSafeInteger(item.records) || (item.records as number) < 0) return null
    if (typeof item.truncated !== 'boolean') return null
    if (typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest)) return null
    parsed.push({
      kind: item.kind as StudioReceiptKind,
      id: item.id as string | null,
      records: item.records as number,
      truncated: item.truncated,
      digest: item.digest,
    })
  }
  return parsed
}
