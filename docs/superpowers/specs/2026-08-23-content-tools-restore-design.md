# Restore content-tools (fix/cluster-map, fix/content-brief) Design

**Goal:** Restore the two `content-tools` fenced routes — `app/api/fix/cluster-map/route.ts`
and `app/api/fix/content-brief/route.ts`, both currently `featureUnavailable('content-tools')`
503 stubs — by porting their original Supabase-era implementations to `db()`/Neon, following
the same auth/ownership/error conventions as the only other live route in this area,
`app/api/fix/route.ts`.

**Context:** Both routes' pre-fence implementations exist intact in git history at `71abd27~1`
(the commit before the fencing landed). Both are single-shot OpenRouter calls scoped to a
client: `cluster-map` reads existing `topical_clusters` rows and an industry's topical
keywords, asks the LLM for a topical cluster map, and returns it. `content-brief` asks the LLM
for a content brief for a target topic, writes the result to `content_briefs`, and returns it
with the new row's id.

**Confirmed via research, not assumed:**
- `topical_clusters` and `content_briefs` both already exist (migration `012_aiso_v3.sql`).
  Migration `036_drop_dead_rls_policies.sql` dropped their Supabase-era RLS policies *and*
  disabled RLS entirely on both tables — no `BYPASSRLS` concern, no policy using the
  nonexistent-under-Neon-Auth `auth.uid()`. Ordinary `account_id`/`client_id` filtering in
  application code is sufficient, matching every other table in this codebase.
- `lib/authority/packs.ts`'s `INDUSTRY_PACKS`, `lib/openrouter.ts`'s `callOpenRouter`, and
  `lib/types.ts`'s `IndustryCode` are all unchanged and still exported exactly as the pre-fence
  code expects.
- The pre-fence ownership check (`ownsClient`) was already written against `db()`/Neon, not
  Supabase — only the actual data read (`topical_clusters` select) and write (`content_briefs`
  insert) used the now-dead Supabase client and need porting.
- **No UI anywhere references either feature** — a repo-wide grep for `cluster-map`,
  `content-brief`, `clusterMap`, `contentBrief` outside `__tests__/` returns nothing. This is a
  pure API restoration; no frontend work is in scope.
- No `PlanFeatures` flag exists for this feature, and `fix/route.ts` (the direct sibling) has
  no entitlement gate either — none gets invented here.
- `fix_packs.cluster_map` is a column migration `012` provisioned but the pre-fence
  `cluster-map` route never wrote to — `fix_packs` is keyed by `scan_id`, while `cluster-map`
  operates per `client_id`, so that column was never actually wireable to this route as
  designed. Left alone; wiring it up would be a different, unrequested feature.

## What changes

**1. `app/api/fix/cluster-map/route.ts`** — restored, mirroring `fix/route.ts`'s shape:
- `getProfile()` → 401 if absent.
- `ownsClient(clientId, profile.account_id)` via `db()` (ported verbatim — already Neon-based)
  → 404 if not owned or not found. Wrapped in try/catch → 500 `'Database error'` on a failed
  ownership *lookup*, matching `fix/route.ts`'s and this codebase's established convention of
  distinguishing "not yours" (404) from "couldn't check" (500).
- Read `topical_clusters` for the client via `db()` (ported from the Supabase select).
- Call `callOpenRouter` with the same prompt structure as the original.
- **Improvement over the original:** the original silently swallowed a bad LLM JSON response
  (`try { JSON.parse(...) } catch {}`, returning `{}` as if it had succeeded). This restoration
  returns 500 `'Failed to parse LLM response'` instead, matching `fix/route.ts`'s
  `parseFixPack` pattern — a caller should never see a fabricated empty result presented as
  success.
- No persistence of the cluster map — matches the original, which never wrote its output
  anywhere.

**2. `app/api/fix/content-brief/route.ts`** — restored, same shape as above, plus:
- After a successful LLM call and JSON parse, insert into `content_briefs` (`client_id`,
  `target_topic`, `brief_markdown`, `recommended_authorities` as `${JSON.stringify(...)}::jsonb`,
  matching the jsonb-write pattern already used in `lib/localTrust/store.ts`) and return the new
  row's `id` alongside the brief.
- **Improvement over the original:** `fix/route.ts`'s cache write to `fix_packs` is
  deliberately best-effort (the LLM result is already paid for, so a caching failure shouldn't
  discard it). `content_briefs` here is not a cache — the response's `id` field comes directly
  from that insert — so this write is *not* best-effort: a failed insert returns 500
  `'Database error'`, the same as a failed ownership lookup, rather than silently returning a
  response with a missing/null id.

**3. `vercel.json`** — add `"app/api/fix/cluster-map/route.ts": { "maxDuration": 30 }` and
`"app/api/fix/content-brief/route.ts": { "maxDuration": 30 }`, matching `fix/route.ts`'s own
value (same shape: one OpenRouter call, comparable-or-smaller `maxTokens`). CLAUDE.md
explicitly documents that `fix/`'s subroutes inherit nothing from `app/api/fix/route.ts`'s
entry — this is a required step, not an optional one, or both routes silently run at the
platform's 10s Hobby default and time out mid-LLM-call.

**4. `__tests__/config/function-durations.test.ts`** — add both new route paths to the
`LLM_ROUTES` array, so a future regression (duration entry removed) is caught by a test rather
than discovered as a production timeout.

**5. `__tests__/api/fenced-routes.test.ts`** — remove both `content-tools` entries from
`FENCED`. After this, the array holds only the three `agents/*` entries.

**6. `__tests__/api/fix.test.ts`** — this file already exists and already contains a
`describe('POST /api/fix/cluster-map', ...)` and a `describe('POST /api/fix/content-brief',
...)` block, each currently asserting only the fenced 503 behavior (it also covers the live
`POST /api/fix` and `POST /api/fix/rewrite-chunks` routes in the same file, with the same mock
scaffold). No new test file is created — both blocks are replaced with real behavioral
coverage using the file's existing scaffold (queued `db()` mock via `sqlMock`, `callOpenRouter`
and `getProfile` mocked directly, same as `POST /api/fix`'s own tests just above them). Covers:
401 with no profile, 404 for an unowned/nonexistent client, 500 on a failed ownership lookup,
500 on unparseable LLM output, the happy path (200 with the expected shape), and for
`content-brief` specifically, 500 when the `content_briefs` insert itself fails after a
successful LLM call.

## What this design deliberately does not do

- Does not build any UI for either feature — none exists to restore, and building one is a
  separate, unrequested scope decision.
- Does not add an entitlement/plan gate — matches `fix/route.ts`'s own precedent, and no
  `PlanFeatures` flag exists for this to check against.
- Does not wire up `fix_packs.cluster_map` — that column was never actually reachable by this
  route's per-client design, restoring exact original behavior rather than inventing new
  persistence.
- Does not change `fix/route.ts` itself — it's the pattern being mirrored, not a file this work
  touches.

## Testing

- `__tests__/api/fix.test.ts`'s two updated `describe` blocks, run via `npx vitest run
  __tests__/api/fix.test.ts`.
- `__tests__/config/function-durations.test.ts` and `__tests__/api/fenced-routes.test.ts` after
  their respective edits.
- Full `npm run test:unit`, `npm run lint`, `npm run typecheck` once all changes land.
