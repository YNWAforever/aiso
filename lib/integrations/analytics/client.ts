import { GOOGLE_TIMEOUT_MS, type GoogleFetch } from '@/lib/integrations/google/oauth'
import { DeadlineReachedError } from '@/lib/integrations/search-console/client'
import type { WebStream } from './binding'

/**
 * Google Analytics 4 client: the Admin API (properties, web streams, key
 * events) and the Data API (`runReport`). Plain HTTP over an injected fetch,
 * mirroring lib/integrations/search-console/client.ts, with its own typed
 * failures. `revoked` is deliberately not one of them: only the token
 * endpoint's `invalid_grant` means the grant is gone, so a 401 from these APIs
 * is `unavailable`, exactly as it is for Search Console.
 *
 * Nothing here logs or embeds a response body in an error message.
 */

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta'
const DATA = 'https://analyticsdata.googleapis.com/v1beta'

/** Rows requested per runReport page. */
const REPORT_LIMIT = 10_000
/** Worst-case runReport page count; beyond it the window is reported as incomplete. */
const MAX_REPORT_PAGES = 20
const LIST_PAGE_SIZE = 200
/** Runaway guard for a list endpoint that never stops handing out a nextPageToken. */
const MAX_LIST_PAGES = 50

export type AnalyticsFailure = 'scope_missing' | 'access_lost' | 'quota' | 'unavailable' | 'misconfigured'

export class AnalyticsApiError extends Error {
  constructor(readonly kind: AnalyticsFailure, readonly status: number, readonly code?: string) {
    super(`analytics api ${kind}`)
    this.name = 'AnalyticsApiError'
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED'])
const MISCONFIGURED_REASONS = new Set(['SERVICE_DISABLED', 'accessNotConfigured'])
const SCOPE_REASONS = new Set(['ACCESS_TOKEN_SCOPE_INSUFFICIENT'])
// Machine codes reach logs and callers, so only a value of this safe shape is kept.
const API_ERROR_CODE_RE = /^[A-Za-z_]{1,64}$/

function errorReasons(body: unknown): string[] {
  const error = isRecord(body) ? body.error : undefined
  if (!isRecord(error)) return []
  const list = [
    ...(Array.isArray(error.errors) ? error.errors : []),
    ...(Array.isArray(error.details) ? error.details : []),
  ]
  return list.flatMap(item => {
    const reason = isRecord(item) ? item.reason : undefined
    return typeof reason === 'string' ? [reason] : []
  })
}

function errorStatus(body: unknown): string | null {
  const error = isRecord(body) ? body.error : undefined
  const status = isRecord(error) ? error.status : undefined
  return typeof status === 'string' ? status : null
}

/** The first `reason` (it distinguishes a scope failure from a permission one), else `error.status`. */
function errorCode(body: unknown): string | undefined {
  const [reason] = errorReasons(body)
  if (reason && API_ERROR_CODE_RE.test(reason)) return reason
  const status = errorStatus(body)
  return status && API_ERROR_CODE_RE.test(status) ? status : undefined
}

/**
 * Classifies a GA4 API failure. Order matters: a scope failure and a disabled
 * service both arrive as 403 PERMISSION_DENIED, and only the `reason` tells
 * them from a genuine loss of access, which is a plain 403 or a 404.
 */
export function classifyAnalyticsFailure(status: number, body: unknown): AnalyticsFailure {
  const reasons = errorReasons(body)
  if (reasons.some(r => SCOPE_REASONS.has(r))) return 'scope_missing'
  if (reasons.some(r => MISCONFIGURED_REASONS.has(r))) return 'misconfigured'
  if (status === 429 || errorStatus(body) === 'RESOURCE_EXHAUSTED' || reasons.some(r => QUOTA_REASONS.has(r))) return 'quota'
  if (status === 401) return 'unavailable'
  if (status === 403 || status === 404) return 'access_lost'
  return 'unavailable'
}

async function call(url: string, token: string, f: GoogleFetch, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch {
    throw new AnalyticsApiError('unavailable', 0)
  }
  if (!res.ok) {
    // The status alone still classifies, so an unreadable error body degrades to {}.
    const body = await res.json().catch(() => ({})) as unknown
    throw new AnalyticsApiError(classifyAnalyticsFailure(res.status, body), res.status, errorCode(body))
  }
  // A 200 that does not parse to an object must not read as "Google has nothing".
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new AnalyticsApiError('unavailable', res.status, 'malformed_body')
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new AnalyticsApiError('unavailable', res.status, 'malformed_body')
  return parsed
}

function malformedRows(): AnalyticsApiError {
  return new AnalyticsApiError('unavailable', 200, 'malformed_rows')
}

/** A property id is interpolated into a path, so anything but digits is refused before a request is made. */
function assertPropertyId(propertyId: string): void {
  if (!/^\d{1,20}$/.test(propertyId)) throw new AnalyticsApiError('misconfigured', 0, 'invalid_property_id')
}

/** Follows `nextPageToken` and returns the `key` array of every page, flattened. */
async function listAll(base: string, key: string, token: string, f: GoogleFetch): Promise<unknown[]> {
  const items: unknown[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const url = `${base}?pageSize=${LIST_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const body = await call(url, token, f)
    if (Array.isArray(body[key])) items.push(...body[key] as unknown[])
    const next = body.nextPageToken
    if (typeof next !== 'string' || next === '') break
    pageToken = next
  }
  return items
}

const lastSegment = (name: string): string => name.slice(name.lastIndexOf('/') + 1)

export async function listProperties(token: string, f: GoogleFetch = fetch): Promise<Array<{ propertyId: string; displayName: string }>> {
  const summaries = await listAll(`${ADMIN}/accountSummaries`, 'accountSummaries', token, f)
  return summaries.flatMap(account => {
    const props = isRecord(account) && Array.isArray(account.propertySummaries) ? account.propertySummaries as unknown[] : []
    return props.flatMap(p => {
      if (!isRecord(p) || typeof p.property !== 'string') return []
      const propertyId = lastSegment(p.property)
      if (propertyId === '') return []
      return [{ propertyId, displayName: typeof p.displayName === 'string' ? p.displayName : '' }]
    })
  })
}

/** Web streams only: a property also holds app streams, which carry no site to match a brand against. */
export async function listWebStreams(token: string, propertyId: string, f: GoogleFetch = fetch): Promise<WebStream[]> {
  assertPropertyId(propertyId)
  const streams = await listAll(`${ADMIN}/properties/${propertyId}/dataStreams`, 'dataStreams', token, f)
  return streams.flatMap(s => {
    if (!isRecord(s) || s.type !== 'WEB_DATA_STREAM' || typeof s.name !== 'string') return []
    const streamId = lastSegment(s.name)
    if (streamId === '') return []
    const web = isRecord(s.webStreamData) ? s.webStreamData : {}
    return [{
      streamId,
      displayName: typeof s.displayName === 'string' ? s.displayName : '',
      defaultUri: typeof web.defaultUri === 'string' ? web.defaultUri : '',
    }]
  })
}

/** Event names exactly as GA4 spells them: they are case-sensitive, so no normalising here. */
export async function listKeyEvents(token: string, propertyId: string, f: GoogleFetch = fetch): Promise<string[]> {
  assertPropertyId(propertyId)
  const events = await listAll(`${ADMIN}/properties/${propertyId}/keyEvents`, 'keyEvents', token, f)
  return events.flatMap(e => (isRecord(e) && typeof e.eventName === 'string' && e.eventName !== '' ? [e.eventName] : []))
}

export type KeyEventRow = { date: string; eventName: string; source: string; channelGroup: string; count: number }

/** GA4 sends `YYYYMMDD`; the store wants an ISO date. Anything that is not a real calendar day is refused. */
function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{8}$/.test(v)) throw malformedRows()
  const y = Number(v.slice(0, 4))
  const m = Number(v.slice(4, 6))
  const d = Number(v.slice(6, 8))
  const at = new Date(Date.UTC(y, m - 1, d))
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) throw malformedRows()
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
}

function dimensionValue(values: unknown[], i: number): unknown {
  const v = values[i]
  return isRecord(v) ? v.value : undefined
}

/** A missing or non-string label is not an error, but it must still be a string for the classifier downstream. */
function label(values: unknown[], i: number): string {
  const v = dimensionValue(values, i)
  return typeof v === 'string' ? v : ''
}

function toKeyEventRow(r: unknown): KeyEventRow {
  if (!isRecord(r) || !Array.isArray(r.dimensionValues) || !Array.isArray(r.metricValues)) throw malformedRows()
  const dims = r.dimensionValues as unknown[]
  if (dims.length < 4 || r.metricValues.length < 1) throw malformedRows()
  const eventName = dimensionValue(dims, 1)
  if (typeof eventName !== 'string' || eventName === '') throw malformedRows()
  const metric = isRecord(r.metricValues[0]) ? (r.metricValues[0] as Record<string, unknown>).value : undefined
  if (!((typeof metric === 'string' && metric.trim() !== '') || typeof metric === 'number')) throw malformedRows()
  const count = Number(metric)
  if (!Number.isFinite(count) || count < 0) throw malformedRows()
  return { date: isoDate(dimensionValue(dims, 0)), eventName, source: label(dims, 2), channelGroup: label(dims, 3), count }
}

/**
 * Key events for one web stream, broken down by day, event, source and default
 * channel group. `eventNames` filters server-side; matching is case-sensitive.
 *
 * `withheld` is true when GA4 says some rows were thresholded away or folded
 * into "(other)", and also when the page cap was hit with rows still to come:
 * in both cases the counts are a lower bound, and the caller must not present
 * them as complete.
 *
 * The deadline is checked before every page, and a partial result is never
 * returned early: running out of time throws DeadlineReachedError.
 */
export async function runKeyEventReport(
  token: string,
  input: {
    propertyId: string; streamId: string; eventNames: string[]
    startDate: string; endDate: string; deadline: number; now?: () => number
  },
  f: GoogleFetch = fetch,
): Promise<{ rows: KeyEventRow[]; withheld: boolean }> {
  assertPropertyId(input.propertyId)
  if (input.eventNames.length === 0) return { rows: [], withheld: false }
  const now = input.now ?? Date.now
  const url = `${DATA}/properties/${input.propertyId}:runReport`
  const rows: KeyEventRow[] = []
  let withheld = false
  let complete = false
  for (let page = 0; page < MAX_REPORT_PAGES; page++) {
    if (now() >= input.deadline) throw new DeadlineReachedError()
    const body = await call(url, token, f, {
      method: 'POST',
      body: JSON.stringify({
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: [{ name: 'date' }, { name: 'eventName' }, { name: 'source' }, { name: 'defaultChannelGroup' }],
        metrics: [{ name: 'keyEvents' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: input.streamId, caseSensitive: true } } },
              { filter: { fieldName: 'eventName', inListFilter: { values: input.eventNames, caseSensitive: true } } },
            ],
          },
        },
        limit: REPORT_LIMIT,
        offset: rows.length,
      }),
    })
    const meta = isRecord(body.metadata) ? body.metadata : {}
    if (meta.subjectToThresholding === true || meta.dataLossFromOtherRow === true) withheld = true
    const rawRows = Array.isArray(body.rows) ? body.rows as unknown[] : []
    rows.push(...rawRows.map(toKeyEventRow))
    if (rawRows.length === 0) { complete = true; break }
    const total = typeof body.rowCount === 'number' && Number.isFinite(body.rowCount) ? body.rowCount : null
    if (total !== null ? rows.length >= total : rawRows.length < REPORT_LIMIT) { complete = true; break }
  }
  return { rows, withheld: withheld || !complete }
}
