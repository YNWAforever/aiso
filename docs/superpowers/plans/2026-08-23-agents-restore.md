# Restore agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the three `agents` fenced routes — `competitors`, `progress`,
`recommendations` under `app/api/clients/[clientId]/agents/` — by porting their original
Supabase-era implementations to `db()`/Neon, mirroring `app/api/pulse/run/route.ts`'s exact
`x-cron-secret` auth shape and status-code conventions.

**Architecture:** Each route: `CRON_SECRET` check (500/401) → parse body (400) → look up the
scan scoped to both `id` and the URL's `clientId` (503 on a failed lookup, 404 on not-found —
never let a lookup failure read as "not yours") → loop-upsert each row (500 on a failed write)
→ best-effort `markCompleteIfAllPresent` (a new shared helper in `lib/agents.ts`) → `{ count
}`. `recommendations` has one extra step: a best-effort `pending`/`null` → `running` status
flip on first write, before the complete-check.

**Tech Stack:** Next.js route handlers, `db()` (Neon tagged-template SQL), Vitest.

---

### Task 1: `lib/agents.ts` — shared completion-marking helper

**Files:**
- Create: `lib/agents.ts`
- Test: `__tests__/lib/agents.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/agents.test.ts
import { describe, expect, it, vi } from 'vitest'
import { markCompleteIfAllPresent } from '@/lib/agents'

function makeSql(results: unknown[][]) {
  let i = 0
  return vi.fn(() => Promise.resolve(results[i++] ?? []))
}

describe('markCompleteIfAllPresent', () => {
  it('marks the scan complete when all three tables have at least one row', async () => {
    const sql = makeSql([[{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], []])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(4) // 3 existence checks + the update
    const updateStrings = sql.mock.calls[3]![0] as TemplateStringsArray
    expect(updateStrings.join('?')).toMatch(/update scans set agent_status = 'complete'/i)
  })

  it('does not update when one table has no rows yet', async () => {
    const sql = makeSql([[{ exists: 1 }], [], [{ exists: 1 }]])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3) // only the 3 existence checks, no update call
  })

  it('does not update when none of the tables have rows yet', async () => {
    const sql = makeSql([[], [], []])

    await markCompleteIfAllPresent(sql as never, 'scan-1')

    expect(sql).toHaveBeenCalledTimes(3)
  })

  it('logs and resolves without throwing when a query fails', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection terminated'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(markCompleteIfAllPresent(sql as never, 'scan-1')).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/agents.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agents'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/agents.ts
import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

/**
 * Sets scans.agent_status = 'complete' once agent_recommendations, agent_progress,
 * and agent_competitors each have at least one row for this scan.
 *
 * Best-effort, deliberately: whichever route calls this has already persisted
 * its own payload successfully by the time this runs. A failure here means
 * agent_status lags reality, not that the caller's actual data was lost — so
 * it logs and returns rather than turning an already-successful write into an
 * error response.
 */
export async function markCompleteIfAllPresent(sql: Sql, scanId: string): Promise<void> {
  try {
    const [recs, progress, competitors] = await Promise.all([
      sql`select 1 from agent_recommendations where scan_id = ${scanId} limit 1`,
      sql`select 1 from agent_progress where scan_id = ${scanId} limit 1`,
      sql`select 1 from agent_competitors where scan_id = ${scanId} limit 1`,
    ])

    if (recs.length > 0 && progress.length > 0 && competitors.length > 0) {
      await sql`update scans set agent_status = 'complete' where id = ${scanId}`
    }
  } catch (error) {
    console.error('[lib/agents] markCompleteIfAllPresent failed:', error)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/agents.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/agents.ts __tests__/lib/agents.test.ts
git commit -m "feat(agents): add the shared agent_status completion helper"
```

---

### Task 2: Restore `app/api/clients/[clientId]/agents/competitors/route.ts`

**Files:**
- Modify: `app/api/clients/[clientId]/agents/competitors/route.ts` (currently a
  `featureUnavailable` stub)
- Test: `__tests__/api/agent-routes.test.ts` (new file — this task creates it with just the
  `competitors` block; Tasks 3 and 4 append to the same file)

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/api/agent-routes.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: h.db }))

async function importRoute(path: string) {
  vi.resetModules()
  return import(path)
}

function request(body: unknown, header?: string) {
  return new Request('https://app.example/api/clients/client-1/agents/competitors', {
    method: 'POST',
    headers: header ? { 'x-cron-secret': header, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CLIENT_ID = 'client-1'
const params = Promise.resolve({ clientId: CLIENT_ID })

describe('POST /api/clients/[clientId]/agents/competitors', () => {
  const originalSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let queries: string[]
  let nextResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    queries = []
    nextResults = []
    mockSql = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'))
      const result = nextResults.shift()
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result ?? [])
    })
    h.db.mockReturnValue(mockSql)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  const ROUTE = '@/app/api/clients/[clientId]/agents/competitors/route'
  const COMPETITOR = {
    platform: 'chatgpt', competitorDomain: 'rival.com', competitorName: 'Rival Co',
    mentionRate: 42, yourRate: 10, gapAnalysis: 'They rank for X, you do not',
  }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [] }, 'anything'), { params })

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong x-cron-secret', async () => {
    const { POST } = await importRoute(ROUTE)

    expect((await POST(request({ scanId: 'scan-1', competitors: [] }), { params })).status).toBe(401)
    expect((await POST(request({ scanId: 'scan-1', competitors: [] }, 'wrong'), { params })).status).toBe(401)
  })

  it('returns 400 when scanId or competitors is missing/malformed', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1' }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 503 when the scan lookup itself fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(503)
  })

  it('returns 404 when the scan does not exist or belongs to another client', async () => {
    nextResults = [[]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(404)
  })

  it('scopes the scan lookup to both the scanId and the URL clientId', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    await POST(request({ scanId: 'scan-1', competitors: [] }, 'test-cron-secret-0123'), { params })

    expect(queries[0]).toMatch(/from scans/i)
    expect(queries[0]).toMatch(/client_id = \?/i)
    const [, ...lookupParams] = mockSql.mock.calls[0]!
    expect(lookupParams).toEqual(['scan-1', CLIENT_ID])
  })

  it('returns { count: 0 } for an empty array without upserting or checking completion', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockSql).toHaveBeenCalledTimes(1) // the scan lookup only
  })

  it('upserts each competitor and returns 500 if the write fails', async () => {
    nextResults = [[{ id: 'scan-1' }], new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(500)
    expect(queries[1]).toMatch(/insert into agent_competitors/i)
    expect(queries[1]).toMatch(/on conflict \(scan_id, platform, competitor_domain\)/i)
  })

  it('upserts successfully and checks completion, returning the count', async () => {
    nextResults = [
      [{ id: 'scan-1' }],          // scan lookup
      [],                          // upsert (no rows returned)
      [{ exists: 1 }], [], [{ exists: 1 }], // markCompleteIfAllPresent: recs, progress, competitors — not all present, no update
    ]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    const [, ...upsertParams] = mockSql.mock.calls[1]!
    expect(upsertParams).toEqual(['scan-1', 'chatgpt', 'rival.com', 'Rival Co', 42, 10, 'They rank for X, you do not'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: FAIL — the route still returns 503 `FEATURE_UNAVAILABLE` for every case

- [ ] **Step 3: Restore the route**

Replace the entire contents of `app/api/clients/[clientId]/agents/competitors/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Competitor = {
  platform: string
  competitorDomain: string
  competitorName?: string
  mentionRate: number
  yourRate: number
  gapAnalysis: string
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, mirroring pulse/run's guard — an
 * unset var can never make an absent header match.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/competitors] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; competitors?: Competitor[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, competitors } = body
  if (!scanId || !Array.isArray(competitors)) {
    return NextResponse.json({ error: 'scanId and competitors array required' }, { status: 400 })
  }

  const sql = db()

  // Scoped to both scanId and the URL's clientId — the pre-fence version only
  // checked scanId, so a stale/wrong client mapping would silently write into
  // the wrong place with no signal anything was off.
  let scanFound: boolean
  try {
    const rows = await sql`
      select id from scans where id = ${scanId} and client_id = ${clientId} limit 1
    `
    scanFound = rows.length > 0
  } catch (error) {
    // A failed lookup is a database incident, not "no such scan" — never let
    // an outage read as a 404.
    console.error('[agents/competitors] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (competitors.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const c of competitors) {
      await sql`
        insert into agent_competitors (scan_id, platform, competitor_domain, competitor_name, mention_rate, your_rate, gap_analysis)
        values (${scanId}, ${c.platform}, ${c.competitorDomain}, ${c.competitorName ?? null}, ${c.mentionRate}, ${c.yourRate}, ${c.gapAnalysis})
        on conflict (scan_id, platform, competitor_domain) do update set
          competitor_name = excluded.competitor_name,
          mention_rate = excluded.mention_rate,
          your_rate = excluded.your_rate,
          gap_analysis = excluded.gap_analysis
      `
    }
  } catch (error) {
    console.error('[agents/competitors] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: competitors.length })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/\[clientId\]/agents/competitors/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(agents): restore competitors ingestion, ported to db()"
```

---

### Task 3: Restore `app/api/clients/[clientId]/agents/progress/route.ts`

**Files:**
- Modify: `app/api/clients/[clientId]/agents/progress/route.ts` (currently a
  `featureUnavailable` stub)
- Test: `__tests__/api/agent-routes.test.ts` (append a new `describe` block)

- [ ] **Step 1: Append the failing tests**

Append to `__tests__/api/agent-routes.test.ts`, after the `competitors` `describe` block closes
(same file-level `beforeEach`/`afterEach` scaffold does not apply across `describe` blocks in
this file — each block below defines its own, mirroring the `competitors` block exactly):

```typescript
describe('POST /api/clients/[clientId]/agents/progress', () => {
  const originalSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let queries: string[]
  let nextResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    queries = []
    nextResults = []
    mockSql = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'))
      const result = nextResults.shift()
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result ?? [])
    })
    h.db.mockReturnValue(mockSql)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  const ROUTE = '@/app/api/clients/[clientId]/agents/progress/route'
  const METRIC = { platform: 'chatgpt', metric: 'sov', currentValue: 25, previousValue: 20 }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [] }, 'anything'), { params })

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong x-cron-secret', async () => {
    const { POST } = await importRoute(ROUTE)

    expect((await POST(request({ scanId: 'scan-1', progress: [] }), { params })).status).toBe(401)
    expect((await POST(request({ scanId: 'scan-1', progress: [] }, 'wrong'), { params })).status).toBe(401)
  })

  it('returns 400 when scanId or progress is missing/malformed', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1' }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 503 when the scan lookup itself fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(503)
  })

  it('returns 404 when the scan does not exist or belongs to another client', async () => {
    nextResults = [[]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(404)
  })

  it('returns { count: 0 } for an empty array without upserting or checking completion', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockSql).toHaveBeenCalledTimes(1)
  })

  it('computes delta from currentValue - previousValue when delta is not provided', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], // all present
    ]
    const { POST } = await importRoute(ROUTE)

    await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    const [, ...upsertParams] = mockSql.mock.calls[1]!
    // scan_id, platform, metric, current_value, previous_value, delta
    expect(upsertParams).toEqual(['scan-1', 'chatgpt', 'sov', 25, 20, 5])
  })

  it('upserts each metric and returns 500 if the write fails', async () => {
    nextResults = [[{ id: 'scan-1' }], new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(500)
    expect(queries[1]).toMatch(/insert into agent_progress/i)
    expect(queries[1]).toMatch(/on conflict \(scan_id, platform, metric\)/i)
  })

  it('upserts successfully, marks complete when all three tables have data, returns the count', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], // all three present
      [],                                                 // the update itself
    ]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(queries[queries.length - 1]).toMatch(/update scans set agent_status = 'complete'/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: FAIL — the `progress` route still returns 503 for every case; the `competitors`
block (Task 2) still passes

- [ ] **Step 3: Restore the route**

Replace the entire contents of `app/api/clients/[clientId]/agents/progress/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Metric = {
  platform: string
  metric: string
  currentValue: number
  previousValue?: number | null
  delta?: number | null
}

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/progress] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; progress?: Metric[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, progress } = body
  if (!scanId || !Array.isArray(progress)) {
    return NextResponse.json({ error: 'scanId and progress array required' }, { status: 400 })
  }

  const sql = db()

  let scanFound: boolean
  try {
    const rows = await sql`
      select id from scans where id = ${scanId} and client_id = ${clientId} limit 1
    `
    scanFound = rows.length > 0
  } catch (error) {
    console.error('[agents/progress] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (progress.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const p of progress) {
      const previousValue = p.previousValue ?? null
      const delta = p.delta ?? (previousValue != null ? p.currentValue - previousValue : null)
      await sql`
        insert into agent_progress (scan_id, platform, metric, current_value, previous_value, delta)
        values (${scanId}, ${p.platform}, ${p.metric}, ${p.currentValue}, ${previousValue}, ${delta})
        on conflict (scan_id, platform, metric) do update set
          current_value = excluded.current_value,
          previous_value = excluded.previous_value,
          delta = excluded.delta
      `
    }
  } catch (error) {
    console.error('[agents/progress] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: progress.length })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: PASS — 18 tests (9 from Task 2 + 9 new)

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/\[clientId\]/agents/progress/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(agents): restore progress ingestion, ported to db()"
```

---

### Task 4: Restore `app/api/clients/[clientId]/agents/recommendations/route.ts`

**Files:**
- Modify: `app/api/clients/[clientId]/agents/recommendations/route.ts` (currently a
  `featureUnavailable` stub)
- Test: `__tests__/api/agent-routes.test.ts` (append a new `describe` block)

- [ ] **Step 1: Append the failing tests**

Append to `__tests__/api/agent-routes.test.ts`, after the `progress` block from Task 3:

```typescript
describe('POST /api/clients/[clientId]/agents/recommendations', () => {
  const originalSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let queries: string[]
  let nextResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    queries = []
    nextResults = []
    mockSql = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'))
      const result = nextResults.shift()
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result ?? [])
    })
    h.db.mockReturnValue(mockSql)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  const ROUTE = '@/app/api/clients/[clientId]/agents/recommendations/route'
  const REC = { platform: 'chatgpt', category: 'schema', priority: 'high', recommendation: 'Add FAQPage schema', impactScore: 8 }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [] }, 'anything'), { params })

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong x-cron-secret', async () => {
    const { POST } = await importRoute(ROUTE)

    expect((await POST(request({ scanId: 'scan-1', recommendations: [] }), { params })).status).toBe(401)
    expect((await POST(request({ scanId: 'scan-1', recommendations: [] }, 'wrong'), { params })).status).toBe(401)
  })

  it('returns 400 when scanId or recommendations is missing/malformed', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1' }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 503 when the scan lookup itself fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(503)
  })

  it('returns 404 when the scan does not exist or belongs to another client', async () => {
    nextResults = [[]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(404)
  })

  it('returns { count: 0 } for an empty array without upserting, flipping status, or checking completion', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockSql).toHaveBeenCalledTimes(1)
  })

  it('upserts each recommendation and returns 500 if the write fails', async () => {
    nextResults = [[{ id: 'scan-1' }], new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(500)
    expect(queries[1]).toMatch(/insert into agent_recommendations/i)
    expect(queries[1]).toMatch(/on conflict \(scan_id, platform, category\)/i)
  })

  it('flips agent_status from pending/null to running on first write', async () => {
    nextResults = [
      [{ id: 'scan-1' }], // scan lookup
      [],                 // upsert
      [],                 // the running-flip update
      [{ exists: 1 }], [], [{ exists: 1 }], // markCompleteIfAllPresent — not all present
    ]
    const { POST } = await importRoute(ROUTE)

    await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(queries[2]).toMatch(/update scans set agent_status = 'running'/i)
    expect(queries[2]).toMatch(/agent_status is null or agent_status = 'pending'/i)
  })

  it('does not fail the request if the running-flip update itself fails', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      new Error('connection terminated') as never, // running-flip fails
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], // still checks completion
      [],
    ]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    consoleError.mockRestore()
  })

  it('upserts successfully, marks complete when all three tables have data, returns the count', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [],                                                 // running-flip
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }],  // all three present
      [],                                                 // the complete update
    ]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', recommendations: [REC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(queries[queries.length - 1]).toMatch(/update scans set agent_status = 'complete'/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: FAIL — the `recommendations` route still returns 503 for every case; `competitors`
and `progress` blocks still pass

- [ ] **Step 3: Restore the route**

Replace the entire contents of `app/api/clients/[clientId]/agents/recommendations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Recommendation = {
  platform: string
  category: string
  priority: string
  recommendation: string
  impactScore: number
}

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/recommendations] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; recommendations?: Recommendation[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, recommendations } = body
  if (!scanId || !Array.isArray(recommendations)) {
    return NextResponse.json({ error: 'scanId and recommendations array required' }, { status: 400 })
  }

  const sql = db()

  let scanFound: boolean
  try {
    const rows = await sql`
      select id from scans where id = ${scanId} and client_id = ${clientId} limit 1
    `
    scanFound = rows.length > 0
  } catch (error) {
    console.error('[agents/recommendations] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (recommendations.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const r of recommendations) {
      await sql`
        insert into agent_recommendations (scan_id, platform, category, priority, recommendation, impact_score)
        values (${scanId}, ${r.platform}, ${r.category}, ${r.priority}, ${r.recommendation}, ${r.impactScore})
        on conflict (scan_id, platform, category) do update set
          priority = excluded.priority,
          recommendation = excluded.recommendation,
          impact_score = excluded.impact_score
      `
    }
  } catch (error) {
    console.error('[agents/recommendations] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Best-effort, same reasoning as markCompleteIfAllPresent: the payload this
  // request delivered is already persisted, so a failure to flip the status
  // marker should not turn that success into an error response.
  try {
    await sql`
      update scans set agent_status = 'running'
      where id = ${scanId}
        and (agent_status is null or agent_status = 'pending')
    `
  } catch (error) {
    console.error('[agents/recommendations] running-flip failed:', error)
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: recommendations.length })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/agent-routes.test.ts`
Expected: PASS — 28 tests (9 from `competitors` + 9 from `progress` + 10 from
`recommendations`, the last of which has two extra cases for the running-flip step)

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/\[clientId\]/agents/recommendations/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(agents): restore recommendations ingestion, ported to db()"
```

---

### Task 5: Remove the fence

**Files:**
- Modify: `__tests__/api/fenced-routes.test.ts`

- [ ] **Step 1: Empty the FENCED array**

In `__tests__/api/fenced-routes.test.ts`, remove the three remaining entries from `FENCED`, so
the file reads:

```typescript
const FENCED: { path: string; feature: string; methods: string[] }[] = []
```

(Leave the rest of the file — the `describe`/`it` block iterating `FENCED` — exactly as it is.
An empty array means the `it.each`-equivalent loop simply produces zero test cases, which is
the correct, passing outcome now that nothing is fenced.)

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/fenced-routes.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/api/fenced-routes.test.ts
git commit -m "refactor(agents): remove the fence — content-tools, agents, and trial-emails are all restored"
```

---

### Task 6: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

This is the last fenced feature, so both files' "fenced routes" framing needs a real rewrite,
not a one-line list edit.

- [ ] **Step 1: Rewrite CLAUDE.md's fenced-routes paragraph**

In `CLAUDE.md`, replace:

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `agents/*`. **Local
> Trust, the alerts *config* route, `notifications/*`, the Pulse producer (`pulse/run`), the
> whole prompt bank, `pulse/suggest-questions` and `content-tools` (`fix/cluster-map`,
> `fix/content-brief`, restored 2026-08-23) are restored**. `cron/evaluate-alerts` is now Neon-backed
```

with:

```markdown
> **No route is fenced any more** — `agents/*` (`clients/[clientId]/agents/{competitors,
> progress,recommendations}`, restored 2026-08-23) was the last one. `lib/unavailable.ts`'s
> `featureUnavailable()` mechanism and `__tests__/api/fenced-routes.test.ts`'s `FENCED` array
> (now empty) stay in the codebase — a future fence still routes through the same honest 503,
> and the test still fails if a new fence has no matching entry. `cron/evaluate-alerts` is now Neon-backed
```

- [ ] **Step 2: Rewrite README's fenced-feature summary**

In `README.md`, replace:

```markdown
Several features are **fenced**: their routes return `503 FEATURE_UNAVAILABLE` via
`lib/unavailable.ts`, and `__tests__/api/fenced-routes.test.ts` is the canonical list. Still
fenced: agents. Live: Local Trust, alert *configuration*, the Pulse
producer (`POST /api/pulse/run`), the question bank (including AI question suggestions),
`notifications` (restored), `cron/trial-emails` (restored 2026-08-22), and content tools
(`fix/cluster-map`, `fix/content-brief`, restored 2026-08-23). Alert *evaluation*
```

with:

```markdown
No feature is **fenced** any more — `agents` (`fix/cluster-map`, `fix/content-brief`, and
`cron/trial-emails` were the other three; `agents` was the last, restored 2026-08-23). Live:
Local Trust, alert *configuration*, the Pulse producer (`POST /api/pulse/run`), the question
bank (including AI question suggestions), `notifications`, `cron/trial-emails`, content tools
(`fix/cluster-map`, `fix/content-brief`), and `agents` (`clients/[clientId]/agents/{competitors,
progress,recommendations}` — the external agent-analysis system's own outbound call is not
part of this repo; these three routes only accept its results back). `lib/unavailable.ts`'s
`featureUnavailable()` and `__tests__/api/fenced-routes.test.ts`'s `FENCED` array (now empty)
still exist for the next feature that needs fencing. Alert *evaluation*
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: reflect that no fenced route remains after the agents restoration"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only — no changes expected)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, more test files/tests than before this plan (2 new files:
`__tests__/lib/agents.test.ts`, `__tests__/api/agent-routes.test.ts`).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 3: Run the type checker**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Confirm no leftover fenced/stub trace**

Run:
```bash
grep -rn "featureUnavailable('agents')" app __tests__ 2>/dev/null
```
Expected: no output.

- [ ] **Step 5: Confirm the fence mechanism itself is intact, just empty**

Run:
```bash
grep -n "featureUnavailable\|FENCED" lib/unavailable.ts __tests__/api/fenced-routes.test.ts
```
Expected: `lib/unavailable.ts` still exports `featureUnavailable`;
`__tests__/api/fenced-routes.test.ts` still defines `FENCED` (now `= []`).

No commit for this task — it is verification only. If any step required a fix, that fix was
already committed as part of its own step above.
