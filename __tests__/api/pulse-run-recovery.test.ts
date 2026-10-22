import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sql: vi.fn(), collect: vi.fn(), classify: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))
vi.mock('@/lib/openrouter', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/openrouter')>(),
  callMultiPlatform: h.collect,
  callOpenRouter: h.classify,
}))
import { POST } from '@/app/api/pulse/run/route'

const secret = 'fixture-legacy-recovery-secret-0001'
let plan = 'basic'
let accepted: string[] = []
let lookupFailed = false
let failPrompt: string | null = null
let prompts: string[] = []
const persisted = new Map<string, string[]>()
const calls: { sql: string; params: unknown[] }[] = []
const dispatched: string[][] = []

beforeEach(() => {
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS', '0')
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '0')
  vi.stubEnv('CRON_SECRET', secret)
  plan = 'basic'
  accepted = []
  lookupFailed = false
  failPrompt = null
  prompts = ['frozen-prompt']
  persisted.clear()
  calls.length = 0
  dispatched.length = 0
  h.sql.mockReset().mockImplementation((strings: TemplateStringsArray, ...params: unknown[]) => {
    const sql = strings.join('?')
    calls.push({ sql, params })
    if (/select\s+(?:distinct\s+)?m\.platform\b/i.test(sql)) {
      const promptId = prompts.find(id => params.includes(id))!
      if (lookupFailed || promptId === failPrompt) return Promise.reject(Error('cache lookup failed'))
      return Promise.resolve((persisted.get(promptId) ?? accepted).map(platform => ({ platform })))
    }
    if (/from clients c/i.test(sql)) return Promise.resolve([{
      account_id: 'owner-a', brand_name: 'Synthetic recovery', industry: null, competitors: [],
      plan, status: 'active', stripe_subscription_id: 'synthetic-subscription',
      override_plan: null, override_expires_at: null, trial_ends_at: null,
    }])
    if (/from prompt_bank/i.test(sql)) return Promise.resolve(prompts.map(id => ({
      id, question: 'Frozen question', category: 'brand_query', language: 'en', market: 'HK',
    })))
    if (/as scan_week/i.test(sql)) return Promise.resolve([{ scan_week: '2026-10-05' }])
    if (/as used/i.test(sql)) return Promise.resolve([{ used: 0 }])
    if (/insert into pulse_metrics/i.test(sql)) {
      const promptId = String(params[1])
      const platform = String(params[2])
      persisted.set(promptId, [...(persisted.get(promptId) ?? []), platform])
      return Promise.resolve([{ id: 'new-metric' }])
    }
    return Promise.resolve([])
  })
  Object.assign(h.sql, { transaction: (queries: Promise<unknown>[]) => Promise.all(queries) })
  h.collect.mockReset().mockImplementation(async (_messages: unknown, _limit: unknown, platforms: string[]) => {
    dispatched.push(platforms)
    if (platforms.some(p => accepted.includes(p))) throw Error('would recollect an accepted answer')
    return platforms.map(platform => ({
      platform, answer: 'Synthetic recovery retained answer', providerCitations: null, grounding: 'none',
    }))
  })
  h.classify.mockReset().mockResolvedValue(JSON.stringify({
    brand_mentioned: false, sentiment: 'not_mentioned', competitors_mentioned: [],
  }))
})
afterEach(() => vi.unstubAllEnvs())

function post(limit = 1) {
  return POST(new Request('http://127.0.0.1/api/pulse/run', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ clientId: 'owned-client', cursor: 0, limit }),
  }) as never)
}

describe('T36 legacy retry preserves accepted raw before paid dispatch', () => {
  it('advances the saved prompt without collection or classification when its allowed answer already exists', async () => {
    accepted = ['gemini-flash']
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ processed: 1, nextCursor: null, failedPrompts: 0 })
    expect(dispatched).toEqual([])
    expect(h.classify.mock.calls).toHaveLength(0)
    expect(calls.filter(c => /insert into pulse_metrics|delete from pulse_metrics|insert into ai_citation_log/i.test(c.sql))).toEqual([])
  })

  it('collects only the three missing Pro platforms while preserving two accepted answers', async () => {
    plan = 'pro'
    accepted = ['gpt-4o', 'gemini-flash']
    const res = await post()
    expect(res.status).toBe(200)
    expect(dispatched).toEqual([['claude-haiku', 'perplexity-sonar', 'perplexity-sonar-pro']])
    const writes = calls.filter(c => /insert into pulse_metrics/i.test(c.sql))
    expect(writes).toHaveLength(3)
    for (const w of writes) {
      expect(w.params).not.toContain('gpt-4o')
      expect(w.params).not.toContain('gemini-flash')
    }
    const reads = calls.filter(c => /select\s+(?:distinct\s+)?m\.platform\b/i.test(c.sql))
    expect(reads).toHaveLength(1)
    expect(reads[0].params).toEqual(expect.arrayContaining(['owner-a', 'owned-client', 'frozen-prompt', '2026-10-05']))
  })

  it('returns unavailable before any provider call when the saved-answer read fails', async () => {
    lookupFailed = true
    const res = await post()
    expect(res.status).toBe(503)
    expect(dispatched).toEqual([])
    expect(calls.filter(c => /insert into pulse_metrics|delete from pulse_metrics|insert into pulse_weekly_summary/i.test(c.sql))).toEqual([])
  })

  it('resumes the same cursor after a later read failure without recollecting an earlier committed prompt', async () => {
    prompts = ['prompt-a', 'prompt-b']
    failPrompt = 'prompt-b'
    const failed = await post(2)
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'Saved answer lookup failed', cursor: 0 })
    expect(persisted.get('prompt-a')).toEqual(['gemini-flash'])
    expect(dispatched).toEqual([['gemini-flash']])
    expect(calls.filter(c => /insert into pulse_weekly_summary/i.test(c.sql))).toEqual([])

    failPrompt = null
    const resumed = await post(2)
    expect(resumed.status).toBe(200)
    expect(dispatched).toEqual([['gemini-flash'], ['gemini-flash']])
    expect(calls.filter(c => /insert into pulse_metrics/i.test(c.sql)).map(c => c.params[1])).toEqual(['prompt-a', 'prompt-b'])
    expect(h.classify.mock.calls).toHaveLength(2)
  })
})
