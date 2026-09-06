import type { AttestInput, DeliveryQuery, WithdrawInput } from './types'

function invalid(): never { throw new Error('INVALID_DELIVERY_INPUT') }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid()
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) invalid()
}
function body(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const input = object(value)
  exactKeys(input, keys)
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 16 * 1024) invalid()
  } catch { invalid() }
  return input
}

/** Shared validation helpers also guard retained DTOs; callers map their errors. */
export function deliveryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid()
  return value.toLowerCase()
}
export function deliveryHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid()
  return value
}
export function deliveryText(value: unknown, maximum: number, multiline: boolean): string {
  if (typeof value !== 'string') invalid()
  const text = value.replace(/\r\n/g, '\n').normalize('NFC').trim()
  // Validate before trimming so forbidden controls cannot disappear at the edges.
  const controls = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u : /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u
  if (controls.test(value.replace(/\r\n/g, '\n')) || /[\ud800-\udfff]/u.test(value)) invalid()
  if (Array.from(text).length < 1 || Array.from(text).length > maximum) invalid()
  return text
}

/** Validate the Gregorian fields before Date can silently roll an impossible day. */
export function deliveryTime(value: unknown, precision: 3 | 6 = 3): string {
  if (value instanceof Date) value = value.toISOString()
  if (typeof value !== 'string') invalid()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match || (match[7]?.length ?? 0) > precision) invalid()
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || Number(match[10] ?? 0) > 23 || Number(match[11] ?? 0) > 59) invalid()
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) invalid()
  const utc = new Date(milliseconds).toISOString()
  if (!/^\d{4}-/.test(utc) || utc.startsWith('0000-')) invalid()
  // Date only retains milliseconds. The final three fraction digits remain exact
  // across timezone offsets because RFC3339 offsets are whole minutes.
  return precision === 6 && (match[7]?.length ?? 0) > 3
    ? utc.slice(0, -1) + match[7].padEnd(6, '0').slice(3) + 'Z'
    : utc
}

export function parseAttest(value: unknown): AttestInput {
  const input = body(value, ['contentHash', 'destination', 'deliveredAt', 'note', 'requestId'])
  if (typeof input.deliveredAt !== 'string') invalid()
  return { contentHash: deliveryHash(input.contentHash), destination: deliveryText(input.destination, 500, false),
    deliveredAt: deliveryTime(input.deliveredAt), note: deliveryText(input.note, 2000, true), requestId: deliveryId(input.requestId) }
}
export function parseWithdraw(value: unknown): WithdrawInput {
  const input = body(value, ['reason', 'requestId'])
  return { reason: deliveryText(input.reason, 2000, true), requestId: deliveryId(input.requestId) }
}
function queryKeys(params: URLSearchParams, keys: readonly string[]): void {
  for (const key of params.keys()) if (!keys.includes(key) || params.getAll(key).length !== 1) invalid()
}
export function parseDeliveryQuery(params: URLSearchParams): DeliveryQuery {
  queryKeys(params, ['limit', 'cursor'])
  const raw = params.get('limit')
  const limit = raw === null ? 20 : Number(raw)
  if ((raw !== null && !/^[1-9]\d*$/.test(raw)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalid()
  const encoded = params.get('cursor')
  if (encoded === null) return { limit, cursor: null }
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) invalid()
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) invalid()
    const cursor = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    exactKeys(cursor, ['recordedAt', 'id'])
    return { limit, cursor: { recordedAt: deliveryTime(cursor.recordedAt, 6), id: deliveryId(cursor.id) } }
  } catch { invalid() }
}
export function parseExportFormat(params: URLSearchParams): 'json' | 'text' {
  queryKeys(params, ['format'])
  const format = params.get('format') ?? 'json'
  if (format !== 'json' && format !== 'text') invalid()
  return format
}
