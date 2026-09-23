import { GOOGLE_TIMEOUT_MS, GoogleApiError, type GoogleFailure, type GoogleFetch } from '@/lib/integrations/google/oauth'

/**
 * Google Search Console API client (spec §4). Plain HTTP over an injected
 * fetch, mirroring lib/integrations/google/oauth.ts's shape, but with its OWN
 * failure classifier: API status codes mean different things than the token
 * endpoint's. A 401 straight after a successful refresh is transient, not
 * proof of revocation — only the token endpoint's `invalid_grant` is that. A
 * 403 can be our own Cloud project having the API disabled (misconfigured),
 * which must never tell an owner they lost access.
 */

const BASE = 'https://www.googleapis.com/webmasters/v3'

/** Rows requested per Search Analytics page, and the default overall page size when the caller sets none. */
export const ROW_LIMIT = 25_000
/**
 * Worst-case page count for one query. 200k rows is far beyond what the sync
 * ever keeps (top 25 per date, spec §4.3) — this bounds runtime for a
 * pathological property rather than expecting to reach it in practice.
 */
export const MAX_PAGES = 8

export type SiteEntry = { siteUrl: string; permissionLevel: string }
export type AnalyticsDimension = 'date' | 'page' | 'query'
export type AnalyticsQuery = {
  startDate: string
  endDate: string
  dimensions: AnalyticsDimension[]
  pageEquals?: string
  rowLimit?: number
}
export type AnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED'])
const MISCONFIGURED_REASONS = new Set(['SERVICE_DISABLED', 'accessNotConfigured'])
// Only the unambiguous scope reason flips a connection. The older v1 reason
// `insufficientPermissions` is also used for property-level denials, and treating
// it as revoked would flip every brand on a connection because of one property.
const SCOPE_REASONS = new Set(['ACCESS_TOKEN_SCOPE_INSUFFICIENT'])

// Same shape as oauth.ts's ERROR_CODE_RE, but case-insensitive: the token
// endpoint's `error` is a lowercase snake string ("invalid_grant"), while
// this API's `error.status` / `reason` values are UPPER_SNAKE or camelCase
// ("SERVICE_DISABLED", "accessNotConfigured").
const API_ERROR_CODE_RE = /^[A-Za-z_]{1,64}$/

/** Every `reason` Google attached, from both its v1 (`errors[]`) and v2 (`details[]`) error shapes. */
function errorReasons(body: unknown): string[] {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  if (!error || typeof error !== 'object') return []
  const e = error as { errors?: unknown; details?: unknown }
  const list = [
    ...(Array.isArray(e.errors) ? e.errors : []),
    ...(Array.isArray(e.details) ? e.details : []),
  ]
  return list.flatMap(item => {
    const reason = item && typeof item === 'object' ? (item as { reason?: unknown }).reason : undefined
    return typeof reason === 'string' ? [reason] : []
  })
}

/**
 * Best-effort machine code for the caller/logs, mirroring oauth.ts's
 * errorCode(): prefer `error.status` (e.g. "PERMISSION_DENIED"), else the
 * first `reason` found across both error shapes, only if it matches the safe
 * code pattern.
 */
function errorCode(body: unknown): string | null {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined
  if (typeof status === 'string' && API_ERROR_CODE_RE.test(status)) return status
  const [first] = errorReasons(body)
  return typeof first === 'string' && API_ERROR_CODE_RE.test(first) ? first : null
}

async function call(url: string, accessToken: string, f: GoogleFetch, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(url, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleApiError('unavailable', 0)
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new GoogleApiError(classifyApiFailure(res.status, body), res.status, errorCode(body))
  return body
}

/**
 * Classifies a Search Console API failure — NOT the token endpoint (that is
 * classifyGoogleFailure in oauth.ts). Status codes mean different things here:
 * a 401 after a fresh token is transient (unavailable); a 403 can be our own
 * Cloud project's fault (misconfigured); rate reasons are quota; only
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT means the owner must reconnect (revoked);
 * any other 403 is forbidden (this one property).
 */
export function classifyApiFailure(status: number, body: unknown): GoogleFailure {
  const reasons = errorReasons(body)
  if (status === 429 || reasons.some(r => QUOTA_REASONS.has(r))) return 'quota'
  if (reasons.some(r => MISCONFIGURED_REASONS.has(r))) return 'misconfigured'
  if (status === 403 && reasons.some(r => SCOPE_REASONS.has(r))) return 'revoked'
  if (status === 403) return 'forbidden'
  return 'unavailable'
}

export async function listSites(accessToken: string, f: GoogleFetch = fetch): Promise<SiteEntry[]> {
  const body = await call(`${BASE}/sites`, accessToken, f)
  const entries = Array.isArray(body.siteEntry) ? body.siteEntry as unknown[] : []
  return entries.flatMap(e => {
    if (!isRecord(e)) return []
    return typeof e.siteUrl === 'string' && typeof e.permissionLevel === 'string'
      ? [{ siteUrl: e.siteUrl, permissionLevel: e.permissionLevel }]
      : []
  })
}

/**
 * A row Google cannot be trusted to have sent cleanly is refused rather than
 * coerced: retrying tomorrow is honest, inventing zeros or NaN for a
 * malformed metric is not.
 */
function malformedRows(): GoogleApiError {
  return new GoogleApiError('unavailable', 200, 'malformed_rows')
}

function toAnalyticsRow(r: unknown): AnalyticsRow {
  if (!isRecord(r) || !Array.isArray(r.keys)) throw malformedRows()
  const metric = (v: unknown): number => {
    if (v === undefined) return 0
    const n = Number(v)
    if (!Number.isFinite(n)) throw malformedRows()
    return n
  }
  return {
    keys: r.keys.map(String),
    clicks: metric(r.clicks),
    impressions: metric(r.impressions),
    ctr: metric(r.ctr),
    position: metric(r.position),
  }
}

/**
 * `dataState: 'all'` includes days Google has not finalised. Those values can
 * change, which is why a routine sync re-fetches the last seven days and the
 * store overwrites them (spec §4.3).
 *
 * Pages through `startRow` until a page returns fewer than `rowLimit` rows,
 * capped at MAX_PAGES. 200k rows for one query's date+query breakdown is
 * beyond what the sync ever keeps (top 25 per date) — reaching the cap on a
 * still-full page is a deliberate bound on runtime, not an error, so it
 * returns what was collected rather than throwing.
 */
export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  q: AnalyticsQuery,
  f: GoogleFetch = fetch,
): Promise<AnalyticsRow[]> {
  const pageSize = q.rowLimit ?? ROW_LIMIT
  const url = `${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`
  const rows: AnalyticsRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const startRow = page * pageSize
    const body = await call(url, accessToken, f, {
      method: 'POST',
      body: JSON.stringify({
        startDate: q.startDate,
        endDate: q.endDate,
        dimensions: q.dimensions,
        dataState: 'all',
        rowLimit: pageSize,
        startRow,
        ...(q.pageEquals
          ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: q.pageEquals }] }] }
          : {}),
      }),
    })
    const rawRows = Array.isArray(body.rows) ? body.rows as unknown[] : []
    const pageRows = rawRows.map(toAnalyticsRow)
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }
  return rows
}
