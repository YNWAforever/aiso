# Restore agents (competitors, progress, recommendations) Design

**Goal:** Restore the three `agents` fenced routes —
`app/api/clients/[clientId]/agents/{competitors,progress,recommendations}/route.ts`, all
currently `featureUnavailable('agents')` 503 stubs — by porting their original Supabase-era
implementations to `db()`/Neon.

**Context:** This is the last of the three fenced features (`content-tools` and `trial-emails`
were restored earlier this session). Unlike those two, the entire read/UI/query side of
`agents` is already live and unaffected by the fence:

- `app/[lang]/dashboard/[clientId]/page.tsx` and `app/api/clients/[clientId]/overview/route.ts`
  both already query `agent_recommendations`, `agent_progress`, and `agent_competitors` via
  `db()`.
- `components/dashboard/ImproveStep.tsx` (feeding `AgentSection`, `AgentRecommendations`,
  `AgentProgress`, `AgentCompetitors`, all plan-gated via `PlanFeatures`) is a live, wired
  component reading exactly that data.
- `app/api/scan/route.ts` already fires an outbound webhook to `clients.webhook_url` when a
  dashboard-owned scan completes, using the SSRF-safe `fetchPublicUrl` — this triggers an
  external agent-analysis system (not part of this repo) to do the actual competitor/progress/
  recommendation analysis.

**The only fenced piece is the inbound side**: the three routes the external system POSTs its
results *back* to. Today that callback 503s unconditionally, so the pipeline is silently
broken at the last mile — the outbound webhook fires, external analysis presumably runs, and
every attempt to write the result back fails. Restoring these three routes is the entire scope
of this work; no UI, query, or type changes are needed anywhere else.

**Confirmed via research:**
- All three tables (`agent_recommendations`, `agent_progress`, `agent_competitors`) and
  `scans.agent_status` (`pending`/`running`/`complete`/`error`, CHECK-constrained) and
  `scans.agent_platforms` exist (migrations `013`, `014`). Each table has a `unique(scan_id,
  platform, <third column>)` constraint matching the original code's `onConflict` target.
- The pre-fence implementation (git history at `71abd27~1`, after its own dedicated security
  fix at `0f42305`) uses `x-cron-secret` header auth against `CRON_SECRET`, matching
  `app/api/pulse/run/route.ts`'s shape exactly — **not** `getProfile()`. This is the only other
  live route with this exact auth shape, and is the pattern to mirror.
- `__tests__/api/agent-routes.test.ts` existed before the fence (per `0f42305`'s commit stat)
  but no longer exists in the repo — it needs recreating, not extending an existing file (the
  `fix.test.ts` situation from the last two restorations doesn't apply here).

## What changes

**1. `lib/agents.ts` (new)** — one shared helper, `markCompleteIfAllPresent(sql, scanId)`. The
original code repeats an identical block in all three routes: check whether all three tables
now have at least one row for `scanId`, and if so, set `scans.agent_status = 'complete'`. This
is genuinely duplicated logic (not three different queries that happen to look similar, the
way each route's own ownership check differs by table) — worth extracting once, called from
all three routes after their own upsert succeeds.

**2. `app/api/clients/[clientId]/agents/competitors/route.ts`** and **`.../progress/route.ts`**
— restored, both following the identical shape. Status codes here match `pulse/run`'s pattern
exactly (confirmed by reading it directly, not assumed) — that route's own comments spell out
why: *"a failed lookup is a database incident, not 'no such client' — never let an outage read
as a 404,"* which is why a failed **lookup** and a **not-found** result get different codes
below, and why *write* failures get a third, different code:
- `CRON_SECRET` check: unset/short → 500 `'Server misconfiguration'`; wrong/missing
  `x-cron-secret` header → 401.
- Parse and validate the body (`scanId` + an array) → 400 if missing/malformed.
- **Improvement over the original**: look up the scan by *both* `id` and `client_id` (the URL
  param), not `id` alone. The lookup itself is wrapped in try/catch: if the query throws, 503
  `'Scan lookup failed'` (never let an outage read as "not yours"); if it succeeds but returns
  no row (scan doesn't exist, or belongs to a different client), 404 `'Not found'`. The
  original silently accepted any `scanId` regardless of the URL's `clientId`, which isn't a
  security hole given the single shared `CRON_SECRET` already has full access, but does mean a
  caller with a stale/wrong client mapping would silently write into the wrong place with no
  signal anything was off.
- Upsert each row into its table (`insert ... on conflict (scan_id, platform, <col>) do update
  set ...`, looped per row — Neon's driver has no Supabase-style bulk `.upsert()`), wrapped in
  its own try/catch → 500 `'Database error'` on failure (a write failure, not a lookup failure
  — `pulse/run` uses 500 for exactly this case, e.g. `'Pulse run failed'`), matching this
  codebase's "never return success over a failed write" rule.
- Call `markCompleteIfAllPresent` after a successful upsert.
- Return `{ count: rows.length }`.

**3. `app/api/clients/[clientId]/agents/recommendations/route.ts`** — same shape as above, plus
the original's one extra step: after a successful upsert, flip `scans.agent_status` from
`pending`/`null` to `running` (`update scans set agent_status = 'running' where id = ${scanId}
and agent_status is distinct from 'complete' and (agent_status is null or agent_status =
'pending')` — preserving the original's "only on first data" guard) before the
all-three-present check. This route-specific ordering assumption (recommendations arriving
first) is inherited behavior, not something this restoration changes.

**4. `__tests__/api/agent-routes.test.ts` (new)** — covers, per route: 500 on unset/short
`CRON_SECRET`, 401 on wrong/missing header, 400 on missing `scanId`/array, 503 when the scan
lookup itself throws, 404 on scan-not-found and scan-belongs-to-another-client, 500 when the
upsert write itself throws, a successful upsert asserting the exact upserted row shape and
`{ count }` response, and that `markCompleteIfAllPresent` only fires `scans.agent_status =
'complete'` when all three tables report data (not just this route's own table).
`recommendations`' test additionally covers the `pending`/`null` → `running` transition firing
only on first write.

**5. `__tests__/api/fenced-routes.test.ts`** — remove all three `agents/*` entries. `FENCED`
becomes an empty array. The file and its mechanism stay (not deleted) — it's designed to catch
a *future* fence added without a matching test entry, and this is the last currently-fenced
feature, not a reason to remove the guard itself.

**6. `CLAUDE.md` / `README.md`** — this is the last fenced feature, so the "Routes whose
feature is fenced" framing in CLAUDE.md needs a real rewrite (no fenced routes remain, aside
from the two explicitly-deleted-not-restored fences already documented separately), not a
one-line edit removing three names from a list. README's fenced/live summary gets the
equivalent update.

## What this design deliberately does not do

- Does not touch any read path, UI component, or type — `lib/types.ts`'s `AgentRecommendation`/
  `AgentProgress`/`AgentCompetitor`, the dashboard page's queries, `overview/route.ts`, and
  every `Agent*` component are already correct and untouched.
- Does not touch `app/api/scan/route.ts`'s outbound webhook trigger — already live, already
  SSRF-safe, not part of the fence.
- Does not add a `vercel.json` `maxDuration` entry — these are plain upserts, no LLM call, no
  reason to expect them to exceed the platform default.
- Does not change the external agent-analysis system itself — it's outside this repo; these
  routes only need to accept its callback correctly.

## Testing

- `__tests__/api/agent-routes.test.ts` (new), run via `npx vitest run
  __tests__/api/agent-routes.test.ts`.
- `__tests__/api/fenced-routes.test.ts` after its edit (now passing vacuously with an empty
  `FENCED` array).
- Full `npm run test:unit`, `npm run lint`, `npm run typecheck` once all changes land.
