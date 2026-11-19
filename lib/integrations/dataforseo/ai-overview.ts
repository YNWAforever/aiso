/**
 * Google AI Overviews for one question, through DataForSEO's Live Google Organic
 * SERP Advanced endpoint with `load_async_ai_overview: true`.
 *
 * No OpenRouter model serves Google AI Overviews (see lib/pulse/platforms.ts,
 * `google_aio`), so this is the only collector for it. It is deliberately
 * dependency-free (no `server-only`, no `@/` imports) so that
 * `scripts/aio-probe.ts` can run it under plain Node before any plan changes.
 *
 * The response shape is parsed defensively: anything unexpected is treated as
 * "no AI Overview", never as an answer. An absent overview is a real, common
 * outcome (Google shows one only for some queries and markets) and is reported
 * as `absent`, distinct from a failed request.
 */

export const AIO_SERP_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced'
export const AIO_TIMEOUT_MS = 60_000
/** Hong Kong, Traditional Chinese: the product's market (same defaults as the SERP client). */
export const AIO_DEFAULT_LOCATION_CODE = 2344
export const AIO_DEFAULT_LANGUAGE_CODE = 'zh-TW'

export type AiOverviewReference = { url: string; domain: string | null; title: string | null }

export type AiOverviewResult =
  | { status: 'present'; text: string; references: AiOverviewReference[] }
  | { status: 'absent' }
  | { status: 'failed'; reason: 'credentials_missing' | 'transport' | 'http' | 'task' | 'unparseable'; code?: number }

export type AiOverviewConfig = { login: string; credential: string; locationCode: number; languageCode: string }

type Env = Record<string, string | undefined>

export function aiOverviewConfig(env: Env): AiOverviewConfig | null {
  const login = env.DATAFORSEO_LOGIN?.trim() ?? ''
  const credential = env.DATAFORSEO_PASSWORD?.trim() ?? ''
  if (!login || !credential) return null
  const location = Number(env.DATAFORSEO_LOCATION_CODE)
  return {
    login,
    credential,
    locationCode: Number.isSafeInteger(location) && location > 0 ? location : AIO_DEFAULT_LOCATION_CODE,
    languageCode: env.DATAFORSEO_LANGUAGE_CODE?.trim() || AIO_DEFAULT_LANGUAGE_CODE,
  }
}

export function buildAiOverviewBody(keyword: string, config: Pick<AiOverviewConfig, 'locationCode' | 'languageCode'>) {
  return {
    tasks: [{
      keyword,
      location_code: config.locationCode,
      language_code: config.languageCode,
      depth: 10,
      load_async_ai_overview: true,
    }],
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const str = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

function referencesOf(item: Record<string, unknown>): AiOverviewReference[] {
  const seen = new Set<string>()
  const out: AiOverviewReference[] = []
  const candidates = [...list(item.references), ...list(item.items).flatMap(element => list(record(element)?.references))]
  for (const candidate of candidates) {
    const ref = record(candidate)
    const url = str(ref?.url)
    if (!ref || !url || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ url, domain: str(ref.domain), title: str(ref.title) })
  }
  return out
}

function textOf(item: Record<string, unknown>): string {
  const own = str(item.markdown) ?? str(item.text)
  if (own) return own
  return list(item.items)
    .map(element => {
      const el = record(element)
      return el ? [str(el.title), str(el.markdown) ?? str(el.text)].filter(Boolean).join('\n') : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/** Pure: a DataForSEO SERP response body → the AI Overview it contains, if any. */
export function parseAiOverview(payload: unknown): AiOverviewResult {
  const body = record(payload)
  if (!body) return { status: 'failed', reason: 'unparseable' }
  const task = record(list(body.tasks)[0])
  if (!task) return { status: 'failed', reason: 'unparseable' }
  const code = typeof task.status_code === 'number' ? task.status_code : 0
  if (code !== 20000) return { status: 'failed', reason: 'task', code }
  for (const result of list(task.result)) {
    for (const raw of list(record(result)?.items)) {
      const item = record(raw)
      if (item?.type !== 'ai_overview') continue
      const text = textOf(item)
      if (!text) continue
      return { status: 'present', text, references: referencesOf(item) }
    }
  }
  return { status: 'absent' }
}

/** One billed SERP task. Never retries; the caller decides what a failure means. */
export async function fetchAiOverview(
  keyword: string,
  config: AiOverviewConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<AiOverviewResult> {
  if (!config) return { status: 'failed', reason: 'credentials_missing' }
  const auth = Buffer.from(`${config.login}:${config.credential}`).toString('base64')
  let response: Response
  try {
    response = await fetchImpl(AIO_SERP_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAiOverviewBody(keyword, config)),
      signal: AbortSignal.timeout(AIO_TIMEOUT_MS),
    })
  } catch {
    return { status: 'failed', reason: 'transport' }
  }
  if (!response.ok) return { status: 'failed', reason: 'http', code: response.status }
  let payload: unknown
  try { payload = await response.json() } catch { return { status: 'failed', reason: 'unparseable' } }
  return parseAiOverview(payload)
}

/** Which of the given names appear in the overview text (case-insensitive, exact substring). */
export function namesMentioned(text: string, names: readonly string[]): string[] {
  const haystack = text.toLocaleLowerCase()
  return names.filter(name => name.trim() && haystack.includes(name.trim().toLocaleLowerCase()))
}
