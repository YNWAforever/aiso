import type { ApproverAccessInput, ReviewDecisionInput } from '@/lib/change-sets/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BODY_LIMIT = 16 * 1024

function invalid(): never {
  throw new Error('INVALID_APPROVAL_INPUT')
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) invalid()
}

function boundedBody(value: unknown): void {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    invalid()
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > BODY_LIMIT) invalid()
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value.toLowerCase()
}

function reason(value: unknown): string {
  if (typeof value !== 'string') invalid()
  const normalized = value.trim().normalize('NFC')
  const length = Array.from(normalized).length
  if (length < 1 || length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(normalized)) invalid()
  return normalized
}

export function parseReviewDecision(value: unknown): ReviewDecisionInput {
  boundedBody(value)
  const input = record(value)
  exactKeys(input, ['decision', 'reason', 'requestId'])
  if (input.decision !== 'approved' && input.decision !== 'changes_requested') invalid()
  return { decision: input.decision, reason: reason(input.reason), requestId: uuid(input.requestId) }
}

export function parseApproverAccess(value: unknown): ApproverAccessInput {
  boundedBody(value)
  const input = record(value)
  exactKeys(input, ['profileId', 'action', 'reason', 'expectedRevision', 'requestId'])
  if (input.action !== 'grant' && input.action !== 'revoke') invalid()
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) invalid()
  return {
    profileId: uuid(input.profileId),
    action: input.action,
    reason: reason(input.reason),
    expectedRevision: input.expectedRevision as number,
    requestId: uuid(input.requestId),
  }
}
