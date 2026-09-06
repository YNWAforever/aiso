const BODY_LIMIT = 4 * 1024
const VERSION_LIMIT_DEFAULT = 20
const VERSION_LIMIT_MAXIMUM = 50
const CURSOR_MAXIMUM = 1_024

function invalid(): never {
  throw new Error('INVALID_CHANGE_SET_INPUT')
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

export function parseSubmission(value: unknown): { expectedRevision: number } {
  boundedBody(value)
  const input = record(value)
  exactKeys(input, ['expectedRevision'])
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) <= 0) invalid()
  return { expectedRevision: input.expectedRevision as number }
}

export function parseVersionQuery(params: URLSearchParams): { limit: number; cursor: string | null } {
  const allowed = ['limit', 'cursor'] as const
  for (const key of params.keys()) if (!allowed.includes(key as typeof allowed[number])) invalid()
  for (const key of allowed) if (params.getAll(key).length > 1) invalid()

  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? VERSION_LIMIT_DEFAULT : Number(rawLimit)
  if (rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) invalid()
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > VERSION_LIMIT_MAXIMUM) invalid()

  const cursor = params.get('cursor')
  if (cursor !== null && (cursor.length === 0 || Array.from(cursor).length > CURSOR_MAXIMUM)) invalid()
  return { limit, cursor }
}
