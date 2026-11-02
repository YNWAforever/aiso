import 'server-only'
import { appOrigin } from '@/lib/app-origin'
import { GoogleApiError, googleOAuthConfig, refreshAccessToken, type GoogleFailure } from '@/lib/integrations/google/oauth'
import { openToken, VaultError, type SealedToken } from '@/lib/integrations/google/vault'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import {
  DeadlineReachedError, querySearchAnalytics, type AnalyticsQuery, type AnalyticsRow,
} from '@/lib/integrations/search-console/client'
import { loadBinding, loadConnectionSecret, type BindingRow } from '@/lib/integrations/search-console/store'
import { gscAnswerWindow, type GscAnswerWindow } from '@/lib/integrations/search-console/window'
import {
  STUDIO_GSC_COUNTRY, STUDIO_GSC_TIME_ZONE, type StudioGscSnapshot, type StudioGscStatus,
} from './gsc-types'

/**
 * Stage 6d: one in-answer Search Console lookup. At most two Search Analytics
 * series per turn (date totals, then top queries), both filtered to Hong Kong
 * (`hkg`) and bounded by the Pacific answer window. The sync cron keeps its own
 * UTC calendar and its own much larger budget; this path is deliberately small.
 */
export const GSC_STUDIO_DEADLINE_MS = 8_000
export const GSC_TOTALS_ROW_LIMIT = 100
export const GSC_TOP_QUERY_LIMIT = 25

export type StudioGscDeps = {
  loadBinding(accountId: string, clientId: string): Promise<BindingRow | null>
  loadSecret(accountId: string, connectionId: string): Promise<{ status: string; sealed: SealedToken | null } | null>
  open(sealed: SealedToken, accountId: string): string
  refresh(refreshToken: string): Promise<string>
  query(accessToken: string, siteUrl: string, q: AnalyticsQuery): Promise<AnalyticsRow[]>
  now(): number
}

function realDeps(): StudioGscDeps {
  const cfg = googleOAuthConfig(process.env, appOrigin())
  return {
    loadBinding,
    loadSecret: loadConnectionSecret,
    open: (sealed, accountId) => openToken(sealed, { accountId }),
    refresh: token => cfg
      ? refreshAccessToken(cfg, token)
      : Promise.reject(new GoogleApiError('misconfigured', 0, 'oauth_config_missing')),
    query: querySearchAnalytics,
    now: Date.now,
  }
}

const STATUS_FOR_FAILURE: Record<GoogleFailure, StudioGscStatus> = {
  revoked: 'reconnect',
  forbidden: 'forbidden',
  quota: 'quota',
  unavailable: 'unavailable',
  misconfigured: 'misconfigured',
}

function snapshotWindow(window: GscAnswerWindow): NonNullable<StudioGscSnapshot['window']> {
  return { startDate: window.startDate, endDate: window.endDate, timeZone: STUDIO_GSC_TIME_ZONE, lagDays: window.lagDays }
}

function withoutMetrics(status: StudioGscStatus, window: GscAnswerWindow, messageKey?: string): StudioGscSnapshot {
  return {
    status,
    window: snapshotWindow(window),
    country: STUDIO_GSC_COUNTRY,
    completeness: 'unknown',
    ...(messageKey ? { messageKey } : {}),
  }
}

function totalsFor(rows: AnalyticsRow[]): NonNullable<StudioGscSnapshot['totals']> | undefined {
  if (!rows.length) return undefined
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
  if (!Number.isFinite(clicks) || !Number.isFinite(impressions)) return undefined
  const weightedPosition = rows.reduce((sum, row) => sum + row.position * row.impressions, 0)
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : undefined,
    position: impressions > 0 ? weightedPosition / impressions : undefined,
  }
}

function topQueriesFor(rows: AnalyticsRow[]): StudioGscSnapshot['topQueries'] {
  const queries = rows
    .filter(row => typeof row.keys[0] === 'string' && row.keys[0].trim())
    .slice(0, GSC_TOP_QUERY_LIMIT)
    .map(row => ({ query: row.keys[0]!, clicks: row.clicks, impressions: row.impressions }))
  return queries.length ? queries : undefined
}

/** Returns an honest typed snapshot. It never invents zeroes for a failed or empty read. */
export async function queryStudioGsc(
  input: { accountId: string; clientId: string; now?: number },
  overrides: Partial<StudioGscDeps> = {},
): Promise<StudioGscSnapshot> {
  const deps: StudioGscDeps = { ...realDeps(), ...overrides }
  const window = gscAnswerWindow({ now: input.now ?? deps.now() })

  const binding = await deps.loadBinding(input.accountId, input.clientId)
  if (!binding) return { status: 'unbound', country: STUDIO_GSC_COUNTRY, completeness: 'unknown' }
  if (binding.connectionStatus === 'revoked') return { status: 'unbound', country: STUDIO_GSC_COUNTRY, completeness: 'unknown' }
  if (binding.connectionStatus === 'needs_reconnect') return withoutMetrics('reconnect', window)
  if (!bindingMatchesDomain(binding, binding.currentDomain)) return withoutMetrics('rebind', window)

  const secret = await deps.loadSecret(input.accountId, binding.connectionId)
  if (!secret || secret.status !== 'active' || !secret.sealed) return withoutMetrics('reconnect', window)

  let refreshToken: string
  try {
    refreshToken = deps.open(secret.sealed, input.accountId)
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[conversation-studio/gsc] vault failure', { code: error.code })
    return withoutMetrics('unavailable', window, 'gsc.vault')
  }

  const deadline = deps.now() + GSC_STUDIO_DEADLINE_MS
  const base: Omit<AnalyticsQuery, 'dimensions'> = {
    startDate: window.startDate,
    endDate: window.endDate,
    countryEquals: STUDIO_GSC_COUNTRY,
    deadline,
  }

  let accessToken: string
  let dateRows: AnalyticsRow[]
  try {
    accessToken = await deps.refresh(refreshToken)
    dateRows = await deps.query(accessToken, binding.siteUrl, {
      ...base, dimensions: ['date'], rowLimit: GSC_TOTALS_ROW_LIMIT,
    })
  } catch (error) {
    return failureSnapshot(error, window)
  }

  const totals = totalsFor(dateRows)
  if (!totals) return withoutMetrics('empty', window, 'gsc.empty')

  let topQueries: StudioGscSnapshot['topQueries']
  try {
    const queryRows = await deps.query(accessToken, binding.siteUrl, {
      ...base, dimensions: ['query'], rowLimit: GSC_TOP_QUERY_LIMIT,
    })
    topQueries = topQueriesFor(queryRows)
  } catch (error) {
    // Totals are already an honest complete window; losing the optional second
    // series must not turn a good read into a failed one or fabricate queries.
    if (!(error instanceof GoogleApiError) && !(error instanceof DeadlineReachedError)) throw error
  }

  return {
    status: 'ok',
    window: snapshotWindow(window),
    country: STUDIO_GSC_COUNTRY,
    totals,
    ...(topQueries ? { topQueries } : {}),
    completeness: 'complete',
  }
}

function failureSnapshot(error: unknown, window: GscAnswerWindow): StudioGscSnapshot {
  if (error instanceof DeadlineReachedError) return withoutMetrics('unavailable', window, 'gsc.deadline')
  if (!(error instanceof GoogleApiError)) throw error
  return withoutMetrics(STATUS_FOR_FAILURE[error.kind], window, `gsc.${error.kind}`)
}
