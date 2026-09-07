export type WorkItemListQuery = { limit: number; cursor: { createdAt: string; id: string } | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const POSTGRES_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
function invalid(): never { throw new Error('INVALID_WORK_ITEM_INPUT') }
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value.toLowerCase()
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) invalid()
}
function canonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match || match[1] === '0000') return false
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string') invalid()
  const match = POSTGRES_TIMESTAMP.exec(value)
  if (!match || !canonicalDate(match[1])) invalid()
  return value
}
function decodeCursor(value: string): NonNullable<WorkItemListQuery['cursor']> {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid()
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) invalid()
    const parsed = record(JSON.parse(bytes.toString('utf8')))
    exactKeys(parsed, ['createdAt', 'id'])
    return { createdAt: timestamp(parsed.createdAt), id: uuid(parsed.id) }
  } catch { invalid() }
}
export function encodeWorkItemCursor(value: NonNullable<WorkItemListQuery['cursor']>): string {
  const encoded = Buffer.from(JSON.stringify({ createdAt: timestamp(value.createdAt), id: uuid(value.id) })).toString('base64url')
  if (encoded.length > 512) invalid()
  return encoded
}
export function parseWorkItemListQuery(params: URLSearchParams): WorkItemListQuery {
  const seen = new Set<string>()
  for (const key of params.keys()) {
    if (!['limit', 'cursor'].includes(key) || seen.has(key)) invalid()
    seen.add(key)
  }
  const limitValue = params.get('limit')
  if (limitValue !== null && !/^[1-9]\d*$/.test(limitValue)) invalid()
  const limit = limitValue === null ? 50 : Number(limitValue)
  if (limit > 100) invalid()
  const cursor = params.get('cursor')
  return { limit, cursor: cursor === null ? null : decodeCursor(cursor) }
}
