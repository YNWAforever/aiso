import { resolveCommercialEntitlement } from '@/lib/tier'
import { GoogleApiError, type GoogleFailure } from '@/lib/integrations/google/oauth'
import { VaultError, type SealedToken } from '@/lib/integrations/google/vault'
import type { AnalyticsQuery, AnalyticsRow } from './client'
import { normalizeBrandDomain } from './binding'
import type { SyncOutcome } from './state'
import type { DailyMetric, DueBinding, PageQueryMetric, QueryWindow } from './store'

/**
 * Sync one binding and say exactly what happened (spec §4.3, §5). Every
 * dependency is injected, so the whole decision table is unit-tested with no
 * Google and no database. A ledger row is written for every outcome, skips
 * included — the owner's screen is derived from it.
 *
 * `syncBinding` writes that ledger row exactly once, from ONE call site,
 * after `attempt()` returns or throws. The cron (Task 16) runs bindings
 * oldest-synced first, so a brand whose write hits a DB failure or a unique
 * violation is always the oldest again tomorrow: if that error escaped
 * uncaught it would abort the whole run and starve every other brand behind
 * it forever. `attempt()` still throws for anything it does not itself
 * classify (a non-VaultError from `open`, a DB error from `writeDaily` or
 * `writePageQueries`, `markConnection` itself failing) — `syncBinding` is the
 * one place that turns that into a named, logged outcome instead of letting
 * it propagate.
 */

export const BACKFILL_DAYS = 90
export const ROUTINE_DAYS = 7
export const PAGE_CAP = 20
export const QUERY_CAP = 25
/** Matches migration 054's CHECK: a longer query is dropped rather than failing the batch. */
export const QUERY_MAX_LENGTH = 512

export type SyncDeps = {
  loadSecret(accountId: string, connectionId: string): Promise<{ status: string; sealed: SealedToken | null } | null>
  /** Opens the sealed refresh token; the vault binds each ciphertext to its account. */
  open(sealed: SealedToken, accountId: string): string
  refresh(refreshToken: string): Promise<string>
  query(accessToken: string, siteUrl: string, q: AnalyticsQuery): Promise<AnalyticsRow[]>
  listPages(accountId: string, clientId: string, cap: number): Promise<string[]>
  writeDaily(accountId: string, clientId: string, metrics: DailyMetric[]): Promise<number>
  writePageQueries(accountId: string, clientId: string, metrics: PageQueryMetric[], window: QueryWindow): Promise<number>
  markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void>
  recordRun(input: {
    accountId: string
    clientId: string
    /** The binding this run synced: backfill is only cleared if it is still bound. */
    siteUrl: string
    connectionId: string
    outcome: SyncOutcome
    rowsWritten: number
    dataThrough: string | null
    clearBackfill: boolean
  }): Promise<void>
  today(): string
}

type AttemptResult = { outcome: SyncOutcome; rows: number; through: string | null }

const OUTCOME_FOR: Record<GoogleFailure, SyncOutcome> = {
  revoked: 'revoked',
  forbidden: 'access_lost',
  quota: 'quota',
  unavailable: 'google_unavailable',
  // Our client secret or Cloud project is wrong. Never flips the connection, never asks the owner.
  misconfigured: 'config_error',
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** True/string properties are read this way for an unknown thrown value without assuming it is an Error. */
function stringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * Keeps the first row seen per (date, query) — Google Search Analytics can
 * return the same key twice across `startRow` pages, and inserting it twice
 * would violate `search_console_page_queries_unique`. Dedup happens before
 * the per-date sort/cap so which duplicate survives does not affect ranking.
 */
function topQueriesPerDate(pageUrl: string, rows: AnalyticsRow[]): PageQueryMetric[] {
  const seen = new Set<string>()
  const byDate = new Map<string, AnalyticsRow[]>()
  for (const row of rows) {
    const [date, query] = row.keys
    if (!date || !query || query.length > QUERY_MAX_LENGTH) continue
    const key = `${date}\u0000${query}`
    if (seen.has(key)) continue
    seen.add(key)
    byDate.set(date, [...(byDate.get(date) ?? []), row])
  }
  return [...byDate.entries()].flatMap(([date, list]) => list
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, QUERY_CAP)
    .map(r => ({
      pageUrl, date, query: r.keys[1]!, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    })))
}

/**
 * Everything that decides an outcome, without writing the ledger. Throws for
 * anything it does not itself classify — the one caller, `syncBinding`, turns
 * that into `internal_error` and writes the row exactly once either way.
 */
async function attempt(b: DueBinding, deps: SyncDeps): Promise<AttemptResult> {
  if (!resolveCommercialEntitlement(b.account).features.search_console) {
    return { outcome: 'not_entitled', rows: 0, through: null }
  }
  if (normalizeBrandDomain(b.currentDomain) !== normalizeBrandDomain(b.boundDomain)) {
    return { outcome: 'domain_mismatch', rows: 0, through: null }
  }

  const secret = await deps.loadSecret(b.accountId, b.connectionId)
  if (!secret || secret.status !== 'active' || !secret.sealed) return { outcome: 'revoked', rows: 0, through: null }

  let refreshToken: string
  try {
    refreshToken = deps.open(secret.sealed, b.accountId)
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[search-console] vault failure', { clientId: b.clientId, code: error.code })
    return { outcome: 'vault_error', rows: 0, through: null }
  }

  const endDate = deps.today()
  const startDate = daysBefore(endDate, (b.backfillPending ? BACKFILL_DAYS : ROUTINE_DAYS) - 1)

  try {
    const accessToken = await deps.refresh(refreshToken)
    const property = await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date'] })
    const daily: DailyMetric[] = property.map(r => ({
      date: r.keys[0]!, scope: 'property' as const, pageUrl: null,
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }))

    const queries: PageQueryMetric[] = []
    const pageUrls = await deps.listPages(b.accountId, b.clientId, PAGE_CAP)
    for (const pageUrl of pageUrls) {
      const pageRows = await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date'], pageEquals: pageUrl })
      daily.push(...pageRows.map(r => ({
        date: r.keys[0]!, scope: 'page' as const, pageUrl,
        clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
      })))
      // One request per page with date + query; the top QUERY_CAP per date are kept
      // locally. One request per day would cost 90 per page on a backfill. Skipped
      // entirely when the page had no activity in the window — there is no query
      // breakdown to fetch, but the page stays in pageUrls below so writePageQueries
      // still clears any of its stale rows.
      const queryRows = pageRows.length
        ? await deps.query(accessToken, b.siteUrl, { startDate, endDate, dimensions: ['date', 'query'], pageEquals: pageUrl })
        : []
      queries.push(...topQueriesPerDate(pageUrl, queryRows))
    }

    const written = await deps.writeDaily(b.accountId, b.clientId, daily)
      // Called with the same fetched window even when queries is empty, so a
      // page that dropped out of the top ranks entirely still has its stale
      // rows cleared — see store.ts's writePageQueries doc.
      + await deps.writePageQueries(b.accountId, b.clientId, queries, { startDate, endDate, pageUrls })
    const dataThrough = property.map(r => r.keys[0]!).sort().at(-1) ?? null
    return { outcome: 'ok', rows: written, through: dataThrough }
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error
    if (error.kind === 'revoked') await deps.markConnection(b.accountId, b.connectionId, 'needs_reconnect')
    if (error.kind === 'misconfigured') {
      console.error('[search-console] google misconfigured', { clientId: b.clientId, status: error.status, code: error.code })
    }
    return { outcome: OUTCOME_FOR[error.kind], rows: 0, through: null }
  }
}

export async function syncBinding(b: DueBinding, deps: SyncDeps): Promise<SyncOutcome> {
  let result: AttemptResult
  try {
    result = await attempt(b, deps)
  } catch (error) {
    // Never log error.message: the Neon driver can echo the full connection
    // string, password included, into some of its own error messages. Only
    // well-known, narrow string fields are logged, and only if present.
    console.error('[search-console] sync failed', {
      clientId: b.clientId,
      name: error instanceof Error ? error.name : typeof error,
      code: stringProp(error, 'code'),
      constraint: stringProp(error, 'constraint'),
    })
    result = { outcome: 'internal_error', rows: 0, through: null }
  }

  // recordRun itself is allowed to throw here and propagate: a failure to
  // write the ledger row is not something this function can paper over.
  await deps.recordRun({
    accountId: b.accountId, clientId: b.clientId, siteUrl: b.siteUrl, connectionId: b.connectionId,
    outcome: result.outcome, rowsWritten: result.rows, dataThrough: result.through,
    clearBackfill: result.outcome === 'ok',
  })
  return result.outcome
}
