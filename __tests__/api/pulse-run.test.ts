import { readFile } from 'node:fs/promises'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Ported from the 491-line __tests__/api/pulse-flow.test.ts the fencing commit
 * deleted (`git show 71abd27^:__tests__/api/pulse-flow.test.ts`). Only the
 * `/api/pulse/run` block survives — onboard, summary and missed are still fenced
 * and still asserted by __tests__/api/fenced-routes.test.ts.
 *
 * The cases the original could not have: the two platform-vocabulary boundaries,
 * the chunk cursor, the once-only rollup, and 5xx-on-failed-write. The original
 * asserted `citations` was a number while the inserts producing it were all
 * violating a CHECK, which is the failure mode these replace.
 */

const CRON_SECRET = 'test-cron-secret-0123'

type Call = { text: string; params: unknown[] }

const calls: Call[] = []
let clientRow: Record<string, unknown> | null
let promptRows: Array<Record<string, unknown>>
let failOn: RegExp | null
let lookupError: RegExp | null

const mockSql = vi.fn((strings: TemplateStringsArray, ...params: unknown[]) => {
  const text = strings.join('?')
  calls.push({ text, params })

  if (lookupError && lookupError.test(text)) return Promise.reject(new Error('boom'))
  if (failOn && failOn.test(text)) return Promise.reject(new Error('write failed'))

  if (/from clients c/i.test(text)) return Promise.resolve(clientRow ? [clientRow] : [])
  if (/from prompt_bank/i.test(text)) return Promise.resolve(promptRows)
  if (/as scan_week/i.test(text)) return Promise.resolve([{ scan_week: '2026-08-03' }])
  if (/insert into pulse_weekly_summary/i.test(text)) {
    return Promise.resolve([{ scan_week: '2026-08-03', platform: 'gemini-flash' },
      { scan_week: '2026-08-03', platform: null }])
  }
  return Promise.resolve([])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

// PLATFORM_KEYS stays real — lib/pulse/platforms.ts validates against it, and a
// stubbed list would let a bad translation pass.
const llm = vi.hoisted(() => ({
  callMultiPlatform: vi.fn(),
  callOpenRouter: vi.fn(),
}))
vi.mock('@/lib/openrouter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/openrouter')>()),
  ...llm,
}))

import { POST } from '@/app/api/pulse/run/route'

function post(body: unknown, secret: string | null = CRON_SECRET) {
  return POST(new Request('http://localhost/api/pulse/run', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { 'x-cron-secret': secret }),
    },
  }) as never)
}

function account(plan: string, extra: Record<string, unknown> = {}) {
  return {
    brand_name: 'AcmeCo',
    industry: 'technology',
    competitors: ['CompetitorX'],
    plan,
    status: 'active',
    stripe_subscription_id: 'sub_1',
    trial_ends_at: null,
    override_plan: null,
    override_expires_at: null,
    ...extra,
  }
}

const inserts = (table: string) => calls.filter(c => new RegExp(`insert into ${table}`, 'i').test(c.text))

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  calls.length = 0
  failOn = null
  lookupError = null
  clientRow = account('pro')
  promptRows = [
    { id: 'p1', question: 'What is AcmeCo?', category: 'brand_query' },
    { id: 'p2', question: 'AcmeCo vs competitors?', category: 'brand_query' },
    { id: 'p3', question: 'Best AI SEO tools?', category: 'category_query' },
  ]
  llm.callMultiPlatform.mockReset()
  llm.callOpenRouter.mockReset()
  llm.callMultiPlatform.mockResolvedValue([
    { platform: 'gemini-flash', answer: 'AcmeCo is great. See https://acme.co/about for details.' },
  ])
  // Analysis is the real implementation; this is the model behind it.
  llm.callOpenRouter.mockResolvedValue(JSON.stringify({
    brand_mentioned: true, sentiment: 'positive', mention_position: 0,
    competitors_mentioned: ['CompetitorX'],
  }))
})

afterEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
})

describe('POST /api/pulse/run — authentication', () => {
  it('returns 401 without a cron secret header', async () => {
    const res = await post({ clientId: 'client-1' }, null)

    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('returns 401 with the wrong cron secret', async () => {
    const res = await post({ clientId: 'client-1' }, 'wrong')

    expect(res.status).toBe(401)
    expect(llm.callMultiPlatform).not.toHaveBeenCalled()
  })

  it('refuses to run at all when CRON_SECRET is unset', async () => {
    // The pre-fence guard compared an undefined env var against a header and
    // failed closed only because a missing header reads as null. This makes the
    // misconfiguration itself the error.
    delete process.env.CRON_SECRET
    const res = await post({ clientId: 'client-1' }, 'anything')

    expect(res.status).toBe(500)
    expect(calls).toHaveLength(0)
  })

  it('refuses a CRON_SECRET too short to be worth guessing against', async () => {
    process.env.CRON_SECRET = 'short'
    const res = await post({ clientId: 'client-1' }, 'short')

    expect(res.status).toBe(500)
  })
})

describe('POST /api/pulse/run — request validation', () => {
  it('returns 400 for a body that is not a JSON object', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post(['array'])).status).toBe(400)
  })

  it('returns 400 when clientId is missing or not a string', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ clientId: 42 })).status).toBe(400)
    expect(llm.callMultiPlatform).not.toHaveBeenCalled()
  })

  it('returns 404 when no client matches', async () => {
    clientRow = null
    const res = await post({ clientId: 'nope' })

    expect(res.status).toBe(404)
  })

  it('returns 503, not 404, when the ownership lookup itself fails', async () => {
    // A database incident must never read as "no such client".
    lookupError = /from clients c/i
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(503)
  })
})

describe('POST /api/pulse/run — entitlement', () => {
  it('refuses a plan that grants no platforms, before any LLM spend', async () => {
    clientRow = account('free')
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'PLAN_HAS_NO_PLATFORMS' })
    expect(llm.callMultiPlatform).not.toHaveBeenCalled()
    expect(inserts('pulse_metrics')).toHaveLength(0)
  })

  it('refuses a cancelled account even though its plan column still says pro', async () => {
    // resolveCommercialEntitlement, not getPlanFeatures: the latter reads the
    // plan string and would grant all five platforms to a dead subscription.
    clientRow = account('pro', { status: 'cancelled' })
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(403)
  })

  it('queries only the platforms basic grants', async () => {
    clientRow = account('basic')
    await post({ clientId: 'client-1' })

    expect(llm.callMultiPlatform).toHaveBeenCalled()
    for (const call of llm.callMultiPlatform.mock.calls) {
      expect(call[2]).toEqual(['gemini-flash'])
    }
  })

  it('translates entitlement keys into runtime keys instead of passing them through', async () => {
    // platform_access is ['gemini', ...]; callMultiPlatform filters on
    // 'gemini-flash'. Passing the raw list selects nothing and the run silently
    // does no work while still reporting 200.
    clientRow = account('pro')
    await post({ clientId: 'client-1' })

    const only = llm.callMultiPlatform.mock.calls[0][2] as string[]
    expect(only).toHaveLength(5)
    expect(only).not.toContain('gemini')
    expect(only).toContain('gemini-flash')
  })
})

describe('POST /api/pulse/run — writes', () => {
  it('writes one pulse_metrics row per prompt × platform, all for the requested client', async () => {
    llm.callMultiPlatform.mockResolvedValue([
      { platform: 'gemini-flash', answer: 'AcmeCo is great.' },
      { platform: 'gpt-4o', answer: 'CompetitorX leads, though AcmeCo is growing.' },
    ])
    await post({ clientId: 'client-1' })

    const rows = inserts('pulse_metrics')
    expect(rows).toHaveLength(6)
    for (const row of rows) expect(row.params[0]).toBe('client-1')
  })

  it('persists the analysis rather than a substring guess', async () => {
    // competitors_mentioned is the column the live dashboard Missed table reads;
    // the pre-fence producer never populated it.
    await post({ clientId: 'client-1' })

    const [row] = inserts('pulse_metrics')
    expect(row.params).toContainEqual(['CompetitorX'])
    expect(row.params).toContain('positive')
  })

  it('degrades to the naive analysis instead of losing the row when the model fails', async () => {
    llm.callOpenRouter.mockRejectedValue(new Error('rate limited'))
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(200)
    const rows = inserts('pulse_metrics')
    expect(rows).toHaveLength(3)
    // Substring path still finds the brand in "AcmeCo is great…".
    expect(rows[0].params).toContain(true)
  })

  it('logs citations using the vocabulary the ai_citation_log CHECK allows', async () => {
    const migration = await readFile(
      new URL('../../supabase/migrations/012_aiso_v3.sql', import.meta.url), 'utf8',
    )
    const check = migration.match(/platform\s+text not null check \(platform in\s*\(([^)]*)\)/i)
    const allowed = new Set([...check![1].matchAll(/'([^']+)'/g)].map(m => m[1]))

    await post({ clientId: 'client-1' })

    const rows = inserts('ai_citation_log')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // The 5th parameter is `platform`; 'gemini-flash' would violate the CHECK.
      expect(allowed.has(row.params[4] as string)).toBe(true)
      expect(row.params[4]).toBe('gemini')
    }
  })

  it('counts only the citations it actually wrote', async () => {
    await post({ clientId: 'client-1' })
    const json = await (await post({ clientId: 'client-1' })).json()

    expect(json.citations).toBe(inserts('ai_citation_log').length / 2)
  })

  it('skips citation logging for a platform with no allowed key', async () => {
    llm.callMultiPlatform.mockResolvedValue([
      { platform: 'some-future-model', answer: 'See https://acme.co/about.' },
    ])
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(200)
    expect(inserts('ai_citation_log')).toHaveLength(0)
    // The metric row is still written — only the constrained table is skipped.
    expect(inserts('pulse_metrics')).toHaveLength(3)
  })

  it('clears a prompt\'s existing rows for the week before writing them', async () => {
    // pulse_metrics has no unique key and total_queries is a count over its
    // rows, so reprocessing a prompt would inflate sov_score — the number the
    // whole feature reports. With a scheduler driving this, reprocessing is
    // routine rather than exceptional.
    await post({ clientId: 'client-1', limit: 1 })

    const deletes = calls.filter(c => /delete from pulse_metrics/i.test(c.text))
    expect(deletes).toHaveLength(1)
    expect(deletes[0].params).toEqual(['client-1', 'p1', '2026-08-03'])

    // And it must happen before the insert, or it deletes what it just wrote.
    const delIndex = calls.findIndex(c => /delete from pulse_metrics/i.test(c.text))
    const insIndex = calls.findIndex(c => /insert into pulse_metrics/i.test(c.text))
    expect(delIndex).toBeLessThan(insIndex)
  })

  it('scopes that delete to the one prompt, never the whole client-week', async () => {
    await post({ clientId: 'client-1', limit: 1 })
    const [del] = calls.filter(c => /delete from pulse_metrics/i.test(c.text))

    expect(del.text).toMatch(/prompt_id =/)
    expect(del.text).toMatch(/scan_week =/)
  })

  it('returns 5xx rather than a success carrying counts it never persisted', async () => {
    failOn = /insert into pulse_metrics/i
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ cursor: 0 })
  })
})

describe('POST /api/pulse/run — execution budget', () => {
  it('analyses the platform responses concurrently, not one after another', async () => {
    // A call-count assertion passes whether these run in series or in parallel.
    // Only the peak number in flight at once tells them apart: sequential peaks
    // at 1, concurrent peaks at the number of platforms.
    llm.callMultiPlatform.mockResolvedValue(
      ['gemini-flash', 'gpt-4o', 'claude-haiku', 'perplexity-sonar', 'perplexity-sonar-pro']
        .map(platform => ({ platform, answer: 'AcmeCo is great.' })),
    )
    let inFlight = 0
    let peak = 0
    llm.callOpenRouter.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 0))
      inFlight -= 1
      return JSON.stringify({
        brand_mentioned: true, sentiment: 'positive',
        mention_position: 0, competitors_mentioned: [],
      })
    })

    await post({ clientId: 'client-1', limit: 1 })

    expect(peak).toBe(5)
  })

  it('defaults to a chunk that fits the maxDuration vercel.json grants', async () => {
    // 3 x ~13s ≈ 40s against a 60s budget. Raising this without raising
    // maxDuration reintroduces the timeout it was lowered to avoid.
    promptRows = Array.from({ length: 20 }, (_, i) => (
      { id: `p${i}`, question: `q${i}`, category: 'brand_query' }
    ))
    const res = await post({ clientId: 'client-1' })

    expect((await res.json()).processed).toBe(3)
  })
})

describe('POST /api/pulse/run — chunking', () => {
  it('processes a bounded slice and reports where to resume', async () => {
    const res = await post({ clientId: 'client-1', limit: 2 })

    expect(await res.json()).toMatchObject({ processed: 2, nextCursor: 2 })
  })

  it('resumes from the cursor and finishes the bank', async () => {
    const res = await post({ clientId: 'client-1', cursor: 2, limit: 2 })
    const json = await res.json()

    expect(json).toMatchObject({ processed: 1, nextCursor: null })
    expect(llm.callMultiPlatform.mock.calls[0][0]).toEqual([
      { role: 'user', content: 'Best AI SEO tools?' },
    ])
  })

  it('does not roll up a partial week', async () => {
    await post({ clientId: 'client-1', limit: 2 })

    expect(inserts('pulse_weekly_summary')).toHaveLength(0)
  })

  it('rolls up exactly once, on the chunk that exhausts the bank', async () => {
    await post({ clientId: 'client-1', cursor: 2, limit: 2 })

    expect(inserts('pulse_weekly_summary')).toHaveLength(1)
  })

  it('clamps an oversized chunk instead of processing the whole bank', async () => {
    promptRows = Array.from({ length: 40 }, (_, i) => (
      { id: `p${i}`, question: `q${i}`, category: 'brand_query' }
    ))
    const res = await post({ clientId: 'client-1', limit: 999 })

    expect((await res.json()).processed).toBe(12)
  })

  it('ignores a nonsense cursor or limit rather than failing the run', async () => {
    const res = await post({ clientId: 'client-1', cursor: 'abc', limit: -5 })

    expect(res.status).toBe(200)
    expect((await res.json()).processed).toBe(3)
  })

  it('returns 500 when the rollup fails, not a 200 with a null summary', async () => {
    failOn = /insert into pulse_weekly_summary/i
    const res = await post({ clientId: 'client-1' })

    expect(res.status).toBe(500)
  })
})

describe('POST /api/pulse/run — scan_week', () => {
  it('takes the week boundary from the database, not from JS', async () => {
    // date_trunc runs in the session timezone while toISOString() is UTC; a run
    // near midnight would otherwise write metrics into one week and roll up
    // another.
    await post({ clientId: 'client-1' })

    expect(calls.some(c => /date_trunc\('week', now\(\)\)::date as scan_week/.test(c.text)))
      .toBe(true)
  })

  it('writes metrics and the rollup against the same week', async () => {
    const json = await (await post({ clientId: 'client-1' })).json()

    expect(json.scanWeek).toBe('2026-08-03')
    expect(inserts('pulse_metrics')[0].params).toContain('2026-08-03')
    expect(inserts('pulse_weekly_summary')[0].params).toContain('2026-08-03')
  })

  it('reads the week once per run rather than per prompt', async () => {
    await post({ clientId: 'client-1' })

    expect(calls.filter(c => /as scan_week/.test(c.text))).toHaveLength(1)
  })
})
