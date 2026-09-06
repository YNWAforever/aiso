export interface ObservationQuery {
  promptId: string | null
  platform: string | null
  week: string | null
  result: 'success' | 'incomplete' | null
  limit: number
  cursor: { recordedAt: string | null; id: string } | null
}

const QUERY_KEYS = new Set(['promptId', 'platform', 'week', 'result', 'limit', 'cursor'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const POSTGRES_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

function invalidQuery(): never {
  throw new Error('INVALID_OBSERVATION_QUERY')
}

function isCanonicalDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isPostgresTimestamp(value: string): boolean {
  const match = POSTGRES_TIMESTAMP.exec(value)
  return match !== null && isCanonicalDate(match[1])
}

function parseUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalidQuery()
  return value.toLowerCase()
}

function decodeCursor(value: string): NonNullable<ObservationQuery['cursor']> {
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidQuery()

  let parsed: unknown
  try {
    const decoded = Buffer.from(value, 'base64url')
    if (decoded.toString('base64url') !== value) invalidQuery()
    parsed = JSON.parse(decoded.toString('utf8'))
  } catch {
    invalidQuery()
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) invalidQuery()
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'recordedAt') || !Object.hasOwn(record, 'id')) invalidQuery()
  if (record.recordedAt !== null && (typeof record.recordedAt !== 'string' || !isPostgresTimestamp(record.recordedAt))) invalidQuery()

  return {
    recordedAt: record.recordedAt as string | null,
    id: parseUuid(record.id),
  }
}

export function encodeObservationCursor(value: NonNullable<ObservationQuery['cursor']>): string {
  const id = parseUuid(value.id)
  if (value.recordedAt !== null && !isPostgresTimestamp(value.recordedAt)) invalidQuery()
  const encoded = Buffer.from(JSON.stringify({ recordedAt: value.recordedAt, id })).toString('base64url')
  if (encoded.length > 512) invalidQuery()
  return encoded
}

export function parseObservationQuery(params: URLSearchParams): ObservationQuery {
  const seen = new Set<string>()
  for (const key of params.keys()) {
    if (!QUERY_KEYS.has(key) || seen.has(key)) invalidQuery()
    seen.add(key)
  }

  const promptIdValue = params.get('promptId')
  const platform = params.get('platform')
  const week = params.get('week')
  const result = params.get('result')
  const limitValue = params.get('limit')
  const cursorValue = params.get('cursor')

  if (platform !== null && (platform.length < 1 || platform.length > 80)) invalidQuery()
  if (week !== null && !isCanonicalDate(week)) invalidQuery()
  if (result !== null && result !== 'success' && result !== 'incomplete') invalidQuery()
  if (cursorValue !== null && week === null) invalidQuery()

  let limit = 50
  if (limitValue !== null) {
    if (!/^[1-9]\d*$/.test(limitValue)) invalidQuery()
    limit = Number(limitValue)
    if (limit > 100) invalidQuery()
  }

  return {
    promptId: promptIdValue === null ? null : parseUuid(promptIdValue),
    platform,
    week,
    result: result as ObservationQuery['result'],
    limit,
    cursor: cursorValue === null ? null : decodeCursor(cursorValue),
  }
}
