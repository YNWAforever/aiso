import 'server-only'
import {
  DataForSeoError,
  type DataForSeoConfig,
  type DataForSeoFailureKind,
  type DataForSeoOrganicItem,
  type DataForSeoOrganicResult,
} from './types'

export const DATAFORSEO_SERP_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced'
export const DATAFORSEO_TIMEOUT_MS = 15_000
export const DATAFORSEO_DEFAULT_LOCATION_CODE = 2344
export const DATAFORSEO_DEFAULT_LANGUAGE_CODE = 'zh-TW'
export const DATAFORSEO_DEPTH = 10

type Environment = Record<string, string | undefined>

function text(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Reads Preview/Prod environment names only. Missing or blank pairs are not usable. */
export function dataForSeoConfig(env: Environment = process.env): DataForSeoConfig | null {
  const login = text(env.DATAFORSEO_LOGIN)
  const credential = text(env.DATAFORSEO_PASSWORD)
  if (!login || !credential) return null
  return {
    login,
    credential,
    locationCode: positiveInteger(env.DATAFORSEO_LOCATION_CODE, DATAFORSEO_DEFAULT_LOCATION_CODE),
    languageCode: text(env.DATAFORSEO_LANGUAGE_CODE) || DATAFORSEO_DEFAULT_LANGUAGE_CODE,
  }
}

export function classifyDataForSeoFailure(httpStatus: number, statusCode?: number): DataForSeoFailureKind {
  const code = typeof statusCode === 'number' && Number.isFinite(statusCode) ? statusCode : 0
  if (code >= 40100 && code < 40200) return 'auth'
  if (code >= 40200 && code < 40300) return 'payment'
  if (code >= 42900 && code < 43000) return 'rate_limit'
  if (code >= 50000) return 'unavailable'
  if (code >= 40000) return 'invalid'
  if (httpStatus === 401 || httpStatus === 403) return 'auth'
  if (httpStatus === 402) return 'payment'
  if (httpStatus === 429) return 'rate_limit'
  if (httpStatus >= 500) return 'unavailable'
  if (httpStatus >= 400) return 'invalid'
  return 'unavailable'
}

type SerpTask = {
  keyword: string
  location_code: number
  language_code: string
  depth: number
  load_async_ai_overview: false
}

/**
 * One Live Advanced task per HTTP request. Accepting an array only here makes a
 * multi-task batch impossible through the public single-keyword API.
 */
export function buildSerpRequestBody(tasks: readonly unknown[]): { tasks: SerpTask[] } {
  if (tasks.length !== 1) throw new DataForSeoError('invalid', 0, 'single_task_required')
  return { tasks: [tasks[0] as SerpTask] }
}

type SerpResponse = {
  status_code?: number
  status_message?: string
  tasks?: Array<{
    status_code?: number
    status_message?: string
    result?: Array<{ items?: Array<Record<string, unknown>> }>
  }>
}

function organicItems(response: SerpResponse): DataForSeoOrganicItem[] {
  const items: DataForSeoOrganicItem[] = []
  for (const task of response.tasks ?? []) {
    for (const result of task.result ?? []) {
      for (const item of result.items ?? []) {
        if (typeof item.title !== 'string' || !item.title.trim()) continue
        if (typeof item.url !== 'string' || !item.url.trim()) continue
        const rank = typeof item.rank_absolute === 'number' ? item.rank_absolute
          : typeof item.rank_group === 'number' ? item.rank_group
          : items.length + 1
        items.push({
          rank,
          title: item.title,
          url: item.url,
          ...(typeof item.domain === 'string' && item.domain ? { domain: item.domain } : {}),
        })
      }
    }
  }
  return items.slice(0, DATAFORSEO_DEPTH)
}

export type LiveGoogleOrganicInput = {
  keyword: string
  locationCode: number
  languageCode: string
  depth?: number
  signal?: AbortSignal
}

/**
 * Exactly one billed Live Google Organic SERP Advanced task. Standard queue
 * polling, retries, batching and async AI overviews are deliberately absent.
 */
export async function liveGoogleOrganicAdvanced(
  input: LiveGoogleOrganicInput,
  env: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DataForSeoOrganicResult> {
  const config = dataForSeoConfig(env)
  if (!config) throw new DataForSeoError('misconfigured', 0, 'credentials_missing')

  const task: SerpTask = {
    keyword: input.keyword,
    location_code: input.locationCode,
    language_code: input.languageCode,
    depth: input.depth ?? DATAFORSEO_DEPTH,
    load_async_ai_overview: false,
  }
  const body = buildSerpRequestBody([task])
  const auth = Buffer.from(`${config.login}:${config.credential}`).toString('base64')
  const timeout = AbortSignal.timeout(DATAFORSEO_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetchImpl(DATAFORSEO_SERP_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new DataForSeoError('unavailable', 0, 'transport_failure')
  }

  let payload: SerpResponse | null = null
  try {
    payload = await response.json() as SerpResponse
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new DataForSeoError(
      classifyDataForSeoFailure(response.status, payload?.status_code),
      response.status,
      'vendor_http_failure',
      payload?.status_code,
    )
  }
  if (!payload || typeof payload !== 'object') {
    throw new DataForSeoError('unavailable', response.status, 'invalid_response')
  }
  if (typeof payload.status_code === 'number' && payload.status_code >= 40000) {
    throw new DataForSeoError(
      classifyDataForSeoFailure(response.status, payload.status_code),
      response.status,
      'vendor_status_failure',
      payload.status_code,
    )
  }
  const taskFailure = (payload.tasks ?? []).find(item => typeof item.status_code === 'number' && item.status_code >= 40000)
  if (taskFailure) {
    throw new DataForSeoError(
      classifyDataForSeoFailure(response.status, taskFailure.status_code),
      response.status,
      'vendor_task_failure',
      taskFailure.status_code,
    )
  }

  return {
    items: organicItems(payload),
    statusCode: payload.status_code ?? 20000,
    ...(payload.status_message ? { statusMessage: payload.status_message } : {}),
  }
}
