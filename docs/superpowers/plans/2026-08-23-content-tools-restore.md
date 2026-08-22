# Restore content-tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `app/api/fix/cluster-map/route.ts` and `app/api/fix/content-brief/route.ts`
(currently fenced 503 stubs) by porting their original Supabase-era implementations to
`db()`/Neon, mirroring `app/api/fix/route.ts`'s auth/ownership/error conventions.

**Architecture:** Both routes follow the identical shape already live in `fix/route.ts`:
`getProfile()` → ownership check via `db()` → 404/500 as appropriate → single OpenRouter call →
response. `content-brief` additionally persists its result to `content_briefs` (not
best-effort, since the response's `id` comes from that write). Both tables
(`topical_clusters`, `content_briefs`) already exist with RLS fully disabled (migration `036`),
so no RLS/bypass concerns apply.

**Tech Stack:** Next.js route handlers, `db()` (Neon tagged-template SQL), `callOpenRouter`
(`lib/openrouter.ts`), Vitest.

---

### Task 1: Restore `app/api/fix/cluster-map/route.ts`

**Files:**
- Modify: `app/api/fix/cluster-map/route.ts` (currently a `featureUnavailable` stub)
- Modify: `__tests__/api/fix.test.ts:209-219` (the existing `describe('POST /api/fix/cluster-map', ...)` block)

- [ ] **Step 1: Replace the route file**

Replace the entire contents of `app/api/fix/cluster-map/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'
import type { IndustryCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Ownership is checked via Neon because lib/supabase points at a deleted project
async function ownsClient(clientId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `
  return rows.length > 0
}

type TopicalCluster = {
  topic: string
  pillar_page_url: string | null
  completeness_score: number | null
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, industry } = await req.json()
  if (!clientId || !industry) {
    return NextResponse.json({ error: 'clientId and industry required' }, { status: 400 })
  }

  let owned = false
  try {
    owned = await ownsClient(clientId, profile.account_id)
  } catch (error) {
    console.error('[fix/cluster-map] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  // 404 rather than 403 so the endpoint does not leak client existence
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let clusters: TopicalCluster[]
  try {
    clusters = (await db()`
      select topic, pillar_page_url, completeness_score
      from topical_clusters
      where client_id = ${clientId}
    `) as TopicalCluster[]
  } catch (error) {
    console.error('[fix/cluster-map] cluster lookup failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const keywords = INDUSTRY_PACKS[industry as IndustryCode]?.topicalKeywords?.slice(0, 15) ?? []

  const prompt = `Create a topical cluster map for ${industry} industry AEO.
Existing clusters: ${JSON.stringify(clusters)}
Industry keywords: ${keywords.join(', ')}

Return JSON:
{
  "clientClusters": [{"topic":"string","completenessScore":number,"recommendation":"string"}],
  "recommendedNewClusters": [{"topic":"string","priority":"high|medium|low","rationale":"string"}],
  "priorityOrder": ["topic 1","topic 2","topic 3"],
  "competitorGaps": ["topic competitors have that client lacks"]
}`

  const raw = await callOpenRouter({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
  })

  let clusterMap: object
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    clusterMap = JSON.parse(match?.[0] ?? raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  return NextResponse.json({ clusterMap })
}
```

- [ ] **Step 2: Replace the test block**

In `__tests__/api/fix.test.ts`, replace the entire
`describe('POST /api/fix/cluster-map', ...)` block (lines 209-219 — starts right after the
comment `// Fenced during the Supabase to Neon migration...` above it; leave that comment line
and the blank line before it alone, only replace the `describe(...)` block itself):

```typescript
describe('POST /api/fix/cluster-map', () => {
  const CLUSTER_ROW = { topic: 'mortgage rates', pillar_page_url: 'https://example.com/mortgages', completeness_score: 0.6 }

  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(401)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing clientId or industry without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1' }))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the client belongs to another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]] // ownership check: no rows
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the ownership check fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the cluster lookup fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      new Error('connection terminated') as never, // cluster lookup fails
    ]
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('generates a cluster map for an owned client, scoped to that client', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      [CLUSTER_ROW], // existing clusters
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(
      '{"clientClusters":[],"recommendedNewClusters":[],"priorityOrder":[],"competitorGaps":[]}'
    )
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      clusterMap: { clientClusters: [], recommendedNewClusters: [], priorityOrder: [], competitorGaps: [] },
    })
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
    const query = queries[1]!
    expect(query).toMatch(/from topical_clusters/i)
    const [, ...params] = sqlMock.mock.calls[1]!
    expect(params).toEqual(['client-1'])
  })

  it('returns 500 when the LLM response is not parseable JSON', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'client-1' }], []]
    vi.mocked(callOpenRouter).mockResolvedValue('not json at all')
    const { POST } = await import('@/app/api/fix/cluster-map/route')

    const res = await POST(post('/api/fix/cluster-map', { clientId: 'client-1', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to parse LLM response' })
  })
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/fix.test.ts`
Expected: PASS — all tests in the file (the `POST /api/fix`, `POST /api/fix/rewrite-chunks`, and
`parseFixPack` blocks are untouched and must still pass too)

- [ ] **Step 4: Commit**

```bash
git add app/api/fix/cluster-map/route.ts __tests__/api/fix.test.ts
git commit -m "feat(content-tools): restore cluster-map, ported to db()"
```

---

### Task 2: Restore `app/api/fix/content-brief/route.ts`

**Files:**
- Modify: `app/api/fix/content-brief/route.ts` (currently a `featureUnavailable` stub)
- Modify: `__tests__/api/fix.test.ts` (the `describe('POST /api/fix/content-brief', ...)` block, immediately after Task 1's edit)

- [ ] **Step 1: Replace the route file**

Replace the entire contents of `app/api/fix/content-brief/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { callOpenRouter } from '@/lib/openrouter'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { INDUSTRY_PACKS } from '@/lib/authority/packs'
import type { IndustryCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Ownership is checked via Neon because lib/supabase points at a deleted project
async function ownsClient(clientId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `
  return rows.length > 0
}

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, targetTopic, industry, region } = await req.json()
  if (!clientId || !targetTopic || !industry) {
    return NextResponse.json({ error: 'clientId, targetTopic, industry required' }, { status: 400 })
  }

  let owned = false
  try {
    owned = await ownsClient(clientId, profile.account_id)
  } catch (error) {
    console.error('[fix/content-brief] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  // 404 rather than 403 so the endpoint does not leak client existence
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pack = INDUSTRY_PACKS[industry as IndustryCode]
  const recommendedDomains = [
    ...(pack?.authorityDomains.tier1 ?? []).slice(0, 3),
    ...(pack?.authorityDomains.tier2 ?? []).slice(0, 2),
  ]

  const prompt = `You are an AEO content strategist. Create a content brief for:
TOPIC: "${targetTopic}", INDUSTRY: ${industry}, REGION: ${region ?? 'global'}

Return JSON:
{
  "titleSuggestions": ["title 1","title 2","title 3","title 4","title 5"],
  "sections": [{"heading":"string","estimatedWords":number}],
  "requiredOriginalDataPoints": ["data 1","data 2","data 3"],
  "suggestedFaq": ["q1","q2","q3","q4","q5"],
  "recommendedSchema": {"@type":"Article"},
  "chunkabilityRequirements": {"idealChunkLength":"600-1000 tokens","answerFirst":true,"selfContained":true}
}

Target 2000-3000 word pillar page with 6-8 sections.`

  const aiResponse = await callOpenRouter({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 1200,
  })

  let brief: object
  try {
    const match = aiResponse.match(/\{[\s\S]*\}/)
    brief = JSON.parse(match?.[0] ?? aiResponse)
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response' }, { status: 500 })
  }

  const authorityWithReasons = recommendedDomains.map(d => ({
    domain: d,
    tier: 'tier1',
    reason: `Top ${industry} authority source`,
  }))
  const fullBrief = { targetTopic, ...brief, requiredAuthorities: authorityWithReasons }

  let id: string
  try {
    const rows = await db()`
      insert into content_briefs (client_id, target_topic, brief_markdown, recommended_authorities)
      values (${clientId}, ${targetTopic}, ${JSON.stringify(fullBrief, null, 2)}, ${JSON.stringify(authorityWithReasons)}::jsonb)
      returning id
    `
    id = (rows[0] as { id: string }).id
  } catch (error) {
    console.error('[fix/content-brief] brief save failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ id, brief: fullBrief })
}
```

- [ ] **Step 2: Replace the test block**

In `__tests__/api/fix.test.ts`, replace the `describe('POST /api/fix/content-brief', ...)`
block (immediately after the block Task 1 just replaced) with:

```typescript
describe('POST /api/fix/content-brief', () => {
  const BRIEF_JSON = '{"titleSuggestions":["A"],"sections":[],"requiredOriginalDataPoints":[],"suggestedFaq":[],"recommendedSchema":{"@type":"Article"},"chunkabilityRequirements":{"idealChunkLength":"600-1000 tokens","answerFirst":true,"selfContained":true}}'

  it('rejects an anonymous caller with 401 and never calls OpenRouter', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(401)
    expect(callOpenRouter).not.toHaveBeenCalled()
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 for missing required fields without touching the DB', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1' }))

    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('returns 404 (not 403) when the client belongs to another account', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[]]
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(404)
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('returns 500 when the ownership check fails, not a silent success', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
    expect(callOpenRouter).not.toHaveBeenCalled()
  })

  it('generates a content brief and persists it with the industry authority domains', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      [{ id: 'brief-1' }], // insert
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(BRIEF_JSON)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('brief-1')
    expect(body.brief.targetTopic).toBe('mortgage rates')
    expect(body.brief.titleSuggestions).toEqual(['A'])
    expect(body.brief.requiredAuthorities.length).toBeGreaterThan(0)
    expect(callOpenRouter).toHaveBeenCalledTimes(1)
    const query = queries[1]!
    expect(query).toMatch(/insert into content_briefs/i)
  })

  it('returns 500 when the LLM response is not parseable JSON', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [[{ id: 'client-1' }]]
    vi.mocked(callOpenRouter).mockResolvedValue('not json at all')
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to parse LLM response' })
    expect(sqlMock).toHaveBeenCalledTimes(1) // ownership check only, no insert attempted
  })

  it('returns 500 when the content_briefs insert fails, not a response with a missing id', async () => {
    vi.mocked(getProfile).mockResolvedValue(PROFILE as never)
    nextResults = [
      [{ id: 'client-1' }], // ownership check
      new Error('connection terminated') as never, // insert fails
    ]
    vi.mocked(callOpenRouter).mockResolvedValue(BRIEF_JSON)
    const { POST } = await import('@/app/api/fix/content-brief/route')

    const res = await POST(post('/api/fix/content-brief', { clientId: 'client-1', targetTopic: 'mortgage rates', industry: 'finance' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Database error' })
  })
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/fix.test.ts`
Expected: PASS — all tests in the file

- [ ] **Step 4: Commit**

```bash
git add app/api/fix/content-brief/route.ts __tests__/api/fix.test.ts
git commit -m "feat(content-tools): restore content-brief, ported to db()"
```

---

### Task 3: Wire up duration config and remove the fence

**Files:**
- Modify: `vercel.json`
- Modify: `__tests__/config/function-durations.test.ts`
- Modify: `__tests__/api/fenced-routes.test.ts`

- [ ] **Step 1: Add maxDuration entries to vercel.json**

Replace `vercel.json`'s contents:

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts": { "maxDuration": 30 },
    "app/api/fix/cluster-map/route.ts": { "maxDuration": 30 },
    "app/api/fix/content-brief/route.ts": { "maxDuration": 30 },
    "app/api/pulse/run/route.ts": { "maxDuration": 60 },
    "app/api/cron/pulse/route.ts": { "maxDuration": 60 },
    "app/api/cron/evaluate-alerts/route.ts": { "maxDuration": 60 },
    "app/api/cron/trial-emails/route.ts": { "maxDuration": 60 }
  }
}
```

- [ ] **Step 2: Add both routes to LLM_ROUTES**

In `__tests__/config/function-durations.test.ts`, find the `LLM_ROUTES` array and insert two
new entries right after `'app/api/fix/route.ts'`:

```typescript
const LLM_ROUTES = [
  'app/api/scan/route.ts',
  'app/api/fix/route.ts',
  // Same shape as fix/route.ts: one OpenRouter call each, comparable token budget.
  'app/api/fix/cluster-map/route.ts',
  'app/api/fix/content-brief/route.ts',
  'app/api/pulse/run/route.ts',
  // Not an LLM caller itself, but it awaits one, so it needs the same headroom.
  'app/api/cron/pulse/route.ts',
  // Not an LLM caller either — it awaits a Resend send per fired alert, serially.
  'app/api/cron/evaluate-alerts/route.ts',
  // Same shape as evaluate-alerts: a Resend send per due email, serially.
  'app/api/cron/trial-emails/route.ts',
]
```

(Leave every other line in the array and the rest of the file exactly as it is.)

- [ ] **Step 3: Remove the content-tools entries from fenced-routes.test.ts**

In `__tests__/api/fenced-routes.test.ts`, remove these two lines from the `FENCED` array:

```typescript
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/fix/content-brief/route', feature: 'content-tools', methods: ['POST'] },
```

so the array now reads:

```typescript
const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/clients/[clientId]/agents/competitors/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/progress/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/recommendations/route', feature: 'agents', methods: ['POST'] },
]
```

- [ ] **Step 4: Run the affected tests**

Run: `npx vitest run __tests__/config/function-durations.test.ts __tests__/api/fenced-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add vercel.json __tests__/config/function-durations.test.ts __tests__/api/fenced-routes.test.ts
git commit -m "refactor(content-tools): declare maxDuration and remove the fence"
```

---

### Task 4: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Fix CLAUDE.md's fenced-routes list**

In `CLAUDE.md`, replace:

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `fix/cluster-map`, `fix/content-brief`, `agents/*`. **Local
> Trust, the alerts *config* route, `notifications/*`, the Pulse producer (`pulse/run`), the
> whole prompt bank and `pulse/suggest-questions` are restored**. `cron/evaluate-alerts` is now Neon-backed
```

with:

```markdown
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `agents/*`. **Local
> Trust, the alerts *config* route, `notifications/*`, the Pulse producer (`pulse/run`), the
> whole prompt bank, `pulse/suggest-questions` and `content-tools` (`fix/cluster-map`,
> `fix/content-brief`, restored 2026-08-23) are restored**. `cron/evaluate-alerts` is now Neon-backed
```

- [ ] **Step 2: Fix README's fenced-feature list**

In `README.md`, replace:

```markdown
Several features are **fenced**: their routes return `503 FEATURE_UNAVAILABLE` via
`lib/unavailable.ts`, and `__tests__/api/fenced-routes.test.ts` is the canonical list. Still
fenced: agents and content tools. Live: Local Trust, alert *configuration*, the Pulse
producer (`POST /api/pulse/run`), the question bank (including AI question suggestions),
`notifications` (restored), and `cron/trial-emails` (restored 2026-08-22). Alert *evaluation*
```

with:

```markdown
Several features are **fenced**: their routes return `503 FEATURE_UNAVAILABLE` via
`lib/unavailable.ts`, and `__tests__/api/fenced-routes.test.ts` is the canonical list. Still
fenced: agents. Live: Local Trust, alert *configuration*, the Pulse
producer (`POST /api/pulse/run`), the question bank (including AI question suggestions),
`notifications` (restored), `cron/trial-emails` (restored 2026-08-22), and content tools
(`fix/cluster-map`, `fix/content-brief`, restored 2026-08-23). Alert *evaluation*
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: reflect content-tools restoration in CLAUDE.md and README"
```

---

### Task 5: Full verification sweep

**Files:** none (verification only — no changes expected)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS, same file count as before this plan, more tests than before (both restored
routes now have real coverage instead of a single 503 assertion each).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: `0 errors, 0 warnings`. Fix any stray issue in the two new route files or the test
file before proceeding.

- [ ] **Step 3: Run the type checker**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Confirm no leftover fenced/stub trace**

Run:
```bash
grep -rn "featureUnavailable('content-tools')" app __tests__ 2>/dev/null
```
Expected: no output — nothing should still return the fenced 503 for either route.

No commit for this task — it is verification only. If any step required a fix, that fix was
already committed as part of its own step above.
