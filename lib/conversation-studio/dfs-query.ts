import 'server-only'
import { db } from '@/lib/db'
import {
  DATAFORSEO_DEPTH,
  dataForSeoConfig,
  liveGoogleOrganicAdvanced,
  type LiveGoogleOrganicInput,
} from '@/lib/integrations/dataforseo/client'
import { DataForSeoError, type DataForSeoConfig, type DataForSeoOrganicResult } from '@/lib/integrations/dataforseo/types'
import { DFS_TIME_ZONE, type StudioDfsSnapshot, type StudioDfsStatus } from './dfs-types'

export const DFS_WEEKLY_CAP_PER_BRAND = 20
/** The Studio prompt is 1,000 characters; the vendor keyword is capped lower. */
export const DFS_KEYWORD_LIMIT = 500

const HKT_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: DFS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})
const WEEKDAY_OFFSET: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/** Asia/Hong_Kong Monday 00:00 as YYYY-MM-DD. LIVE's studioWeek() stays UTC. */
export function dfsWeekStart(now: Date | number = new Date()): string {
  const date = typeof now === 'number' ? new Date(now) : now
  const parts = HKT_PARTS.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))
  const offset = WEEKDAY_OFFSET[value('weekday')] ?? 0
  return new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10)
}

export type StudioDfsCounterDecision = {
  allowed: boolean
  remaining: number
}

export type DurableDfsCounter = (
  accountId: string,
  clientId: string,
  week: string,
  count: number,
  cap: number,
) => Promise<StudioDfsCounterDecision>

const consumeFromNeon: DurableDfsCounter = async (accountId, clientId, week, count, cap) => {
  const rows = await db()`
    with consumed as (
      insert into studio_dataforseo_weekly_usage (account_id, client_id, week_start, call_count)
      values (${accountId}::uuid, ${clientId}::uuid, ${week}::date, ${count}::int)
      on conflict (client_id, week_start)
      do update set call_count = studio_dataforseo_weekly_usage.call_count + excluded.call_count
      where studio_dataforseo_weekly_usage.call_count + excluded.call_count <= ${cap}::int
      returning call_count
    )
    select exists(select 1 from consumed) as allowed,
      coalesce(
        (select call_count from consumed),
        (select call_count from studio_dataforseo_weekly_usage
         where client_id = ${clientId}::uuid and week_start = ${week}::date),
        0
      ) as call_count
  `
  const row = rows[0] as { allowed: boolean; call_count: number | string } | undefined
  if (!row) throw new Error('Studio DataForSEO quota returned no result')
  const used = Number(row.call_count)
  if (!Number.isSafeInteger(used) || used < 0) throw new Error('Studio DataForSEO quota returned invalid usage')
  return { allowed: row.allowed === true && used <= cap, remaining: Math.max(0, cap - used) }
}

/** Exactly one call is reserved before dispatch; failed or unknown calls stay charged. */
export async function reserveStudioDfsCall(
  accountId: string,
  clientId: string,
  week: string,
  count = 1,
  cap = DFS_WEEKLY_CAP_PER_BRAND,
  consume: DurableDfsCounter = consumeFromNeon,
): Promise<StudioDfsCounterDecision> {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(cap) || cap < 1
    || count > cap || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    throw new Error('STUDIO_DFS_QUOTA_INVALID')
  }
  return consume(accountId, clientId, week, count, cap)
}

export type StudioDfsBrandSettings = {
  enabled: boolean
  credentialsConfigured: boolean
  locationCode: number
  languageCode: string
}

export async function loadStudioDfsBrandSettings(
  accountId: string,
  clientId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<StudioDfsBrandSettings> {
  const rows = await db()`
    select enabled from studio_dataforseo_brand_settings
    where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
  `
  const config = dataForSeoConfig(env)
  return {
    enabled: rows[0]?.enabled === true,
    credentialsConfigured: config !== null,
    locationCode: config?.locationCode ?? 2344,
    languageCode: config?.languageCode ?? 'zh-TW',
  }
}

export async function setStudioDfsBrandEnabled(input: {
  accountId: string
  clientId: string
  enabled: boolean
  updatedBy: string
}): Promise<void> {
  await db()`
    insert into studio_dataforseo_brand_settings (account_id, client_id, enabled, updated_by, updated_at)
    values (${input.accountId}::uuid, ${input.clientId}::uuid, ${input.enabled}, ${input.updatedBy}::uuid, now())
    on conflict (client_id) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
  `
}

export type StudioDfsDeps = {
  credentials(): DataForSeoConfig | null
  isEnabled(accountId: string, clientId: string): Promise<boolean>
  reserve(accountId: string, clientId: string, week: string, cap: number): Promise<StudioDfsCounterDecision>
  search(input: LiveGoogleOrganicInput): Promise<DataForSeoOrganicResult>
  now(): number
}

function realDeps(): StudioDfsDeps {
  return {
    credentials: () => dataForSeoConfig(process.env),
    isEnabled: async (accountId, clientId) => {
      const rows = await db()`
        select enabled from studio_dataforseo_brand_settings
        where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
      `
      return rows[0]?.enabled === true
    },
    reserve: (accountId, clientId, week, cap) =>
      reserveStudioDfsCall(accountId, clientId, week, 1, cap),
    search: input => liveGoogleOrganicAdvanced(input),
    now: Date.now,
  }
}

function weekState(weekStart: string, remaining?: number): NonNullable<StudioDfsSnapshot['week']> {
  return {
    weekStart,
    timeZone: DFS_TIME_ZONE,
    cap: DFS_WEEKLY_CAP_PER_BRAND,
    ...(remaining === undefined ? {} : { remaining }),
  }
}

function normalizeKeyword(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().slice(0, DFS_KEYWORD_LIMIT) : ''
}

const STATUS_FOR_FAILURE: Record<string, StudioDfsStatus> = {
  unavailable: 'unavailable',
  auth: 'auth',
  payment: 'payment',
  rate_limit: 'rate_limit',
  invalid: 'invalid',
  misconfigured: 'misconfigured',
}

/**
 * One in-answer Live Google Organic SERP read. Credentials and the per-brand
 * switch are checked before the durable weekly reservation; only a successful
 * reservation can reach the single vendor call.
 */
export async function queryStudioDfs(
  input: { accountId: string; clientId: string; keyword?: string; now?: number },
  overrides: Partial<StudioDfsDeps> = {},
): Promise<StudioDfsSnapshot> {
  const deps: StudioDfsDeps = { ...realDeps(), ...overrides }
  const weekStart = dfsWeekStart(input.now ?? deps.now())
  const config = deps.credentials()
  if (!config) {
    return { status: 'disconnected', week: weekState(weekStart), locationPending: true, messageKey: 'dfs.disconnected' }
  }

  const base = {
    locationCode: config.locationCode,
    languageCode: config.languageCode,
    locationPending: true as const,
  }
  const keyword = normalizeKeyword(input.keyword)
  if (!keyword) {
    return { status: 'invalid', week: weekState(weekStart), ...base, messageKey: 'dfs.emptyKeyword' }
  }

  if (!(await deps.isEnabled(input.accountId, input.clientId))) {
    return { status: 'disabled', week: weekState(weekStart), ...base, keyword, messageKey: 'dfs.disabled' }
  }

  const decision = await deps.reserve(input.accountId, input.clientId, weekStart, DFS_WEEKLY_CAP_PER_BRAND)
  if (!decision.allowed) {
    return { status: 'capped', week: weekState(weekStart, 0), ...base, keyword, messageKey: 'dfs.capped' }
  }

  const week = weekState(weekStart, decision.remaining)
  try {
    const result = await deps.search({
      keyword,
      locationCode: config.locationCode,
      languageCode: config.languageCode,
      depth: DATAFORSEO_DEPTH,
    })
    if (!result.items.length) {
      return { status: 'empty', week, ...base, keyword, messageKey: 'dfs.empty' }
    }
    return { status: 'ok', week, ...base, keyword, items: result.items }
  } catch (error) {
    const kind = error instanceof DataForSeoError ? error.kind : 'unavailable'
    const status = STATUS_FOR_FAILURE[kind] ?? 'unavailable'
    return { status, week, ...base, keyword, messageKey: `dfs.${status}` }
  }
}
