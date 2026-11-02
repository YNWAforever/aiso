# Conversation Studio Stage 6e — DataForSEO Live SERP in-answer

- Brief: `/workspace/aiso-brief-stage-6e-dataforseo.md`
- Spend facts: `/workspace/aiso-brief-6e6f-spend-facts.md`
- Design: `docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md` §3 table row **6e** + §4 Wave 3 / 6e
- Approve: GM answering **t389s1728** (2026-11-02) — Preview DataForSEO keys only; product caps 1 call/turn + 20/week/brand
- ClickUp: [z8qgvca4pk](https://app.clickup.com/t/z8qgvca4pk)
- Base: `16534492dc1c0c4480ca399e07e56fd50cef2203` (`origin/main`, Stage 6d #136)
- Branch: `codex/conversation-studio-stage-6e` — draft PR only

## Outcome

On a brand with Preview DataForSEO credentials present and the per-brand switch
ON, one Studio turn makes **at most one** Live Google Organic SERP Advanced
call. The call is reserved against a durable **≤20 calls per brand per
Asia/Hong_Kong week** counter before dispatch. The snapshot is folded into that
turn's answer, inspector and research steps.

Missing env, disabled brand, over-cap and vendor failure are honest soft-fails.
There are no invented SERP rows, no Mentions HK scores, no Firecrawl call, and
no LIVE/FEATURE/env flip. The migration ships as a file only; it is not applied
to hosted Neon here.

## Vendor contract

| Item | Lock |
| --- | --- |
| Endpoint | `POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced` |
| Tasks per HTTP | **exactly 1** (no batching, no Standard queue + poll, no retries) |
| Depth | **10** |
| Async AI overview | `load_async_ai_overview: false` |
| Auth | HTTP Basic from `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` env only |
| Deadline | 15 s |
| Location / language | defaults `2344` (Hong Kong) / `zh-TW`, overridable by Preview env |
| Mentions | **non-goal**: US/EN LLM Mentions honesty stays unchanged |

The public CSV references for the defaults are
`https://cdn.dataforseo.com/v3/locations/locations_serp_google_2026_09_01.csv`
(Hong Kong, `location_code=2344`) and
`https://cdn.dataforseo.com/v3/languages/languages_serp_google_2026_04_06.csv`
(`zh-TW`, Chinese (Traditional)). The UI still labels the geo/language pair
**待核實** because ops confirmation with a credentialed locations call is out of
band.

## Modules and data

| Layer | Path |
| --- | --- |
| Vendor client | `lib/integrations/dataforseo/client.ts` + `types.ts` |
| Studio query | `lib/conversation-studio/dfs-query.ts` + `dfs-types.ts` |
| Migration | `supabase/migrations/082_studio_dataforseo.sql` — **file only** |
| Turn route | `POST app/api/dashboard/clients/[clientId]/studio/dataforseo/route.ts` |
| Settings route | `POST app/api/dashboard/clients/[clientId]/studio/dataforseo/settings/route.ts` |
| UI chrome | `components/dashboard/StudioDfsSnapshot.tsx` |

`studio_dataforseo_weekly_usage` is keyed by `(client_id, week_start)` with a
composite FK to `clients(id, account_id)`. `studio_dataforseo_brand_settings`
has `client_id` as its primary key and defaults `enabled=false`. Both tables
have RLS enabled and public/anon/authenticated/service-role revoked, mirroring
080. **Do not run `npm run migrate` or apply this migration to hosted Neon.**

## Query contract

`StudioDfsSnapshot`:

```ts
{
  status: 'ok' | 'empty' | 'capped' | 'disabled' | 'disconnected'
        | 'unavailable' | 'auth' | 'payment' | 'rate_limit' | 'invalid' | 'misconfigured'
  week?: { weekStart: string; timeZone: 'Asia/Hong_Kong'; remaining?: number; cap: 20 }
  locationCode?: number
  languageCode?: string
  locationPending: true
  keyword?: string
  items?: Array<{ rank: number; title: string; url: string; domain?: string }>
  messageKey?: string
}
```

Order of checks:

1. Credentials present and non-blank, otherwise `disconnected` — no fetch.
2. Keyword trimmed; empty is `invalid`, and longer than 500 characters is
   `invalid` / `dfs.keywordTooLong` — no fetch and no quota reservation.
3. Per-brand `enabled=true`, otherwise `disabled` — no fetch.
4. Atomic reservation `call_count + 1 <= 20`, otherwise `capped` / 本週額滿 — no fetch.
5. Exactly one Live Advanced call. Failure after reservation keeps the charge and
   returns the mapped status with no fabricated items.
6. Empty organic items with an OK response is `empty` / 未有.

`dfsWeekStart(now)` uses `Asia/Hong_Kong`, Monday 00:00, and returns
`YYYY-MM-DD`. It is intentionally separate from LIVE's UTC `studioWeek()`.
`locationPending` is always `true` in this PR.

## Routes and UI

`POST …/studio/dataforseo` runs feature flag → profile → commercial entitlement
(`features.platform_access`) → account-owned **active** brand, reads only
optional `{ keyword?: string }`, and returns `Cache-Control: no-store`. It is
called once per turn submit for saved and LIVE turns; page load, layout and the
connections view never call DataForSEO.

`POST …/studio/dataforseo/settings` accepts only `{ enabled: boolean }`, uses the
same feature → profile → entitlement → owned active brand order, and only the
owning account can toggle. Platform `is_admin` has no cross-account toggle. The
default remains OFF.

The inspector's DataForSEO section shows the turn snapshot when one exists and
keeps the existing disconnected copy until a turn or settings state is known.
The connections card shows the per-brand switch, status honesty and the
geo/language **待核實** badge; remaining weekly calls appear on turn snapshots,
not the card. Firecrawl remains disconnected and
the Mentions US/EN-only coverage string is unchanged. No `$` amounts appear in
product UI; the Approve's ops facts (top-up / daily limit) are not product
prices. Hazel: polish the bilingual copy; the status and cap behaviour above is
the contract.

## Tests

- `__tests__/integrations/dataforseo-client.test.ts` — URL, method, body,
  `depth:10`, Basic header presence, single-task guard, classifier, no secret in
  logs/assertions; mocked fetch only.
- `__tests__/conversation-studio/dfs-query.test.ts` — HKT week boundary, missing
  env, disabled, cap, empty, failure mapping, one call only.
- `__tests__/conversation-studio/dfs-quota-sql.test.ts` — 20th allowed, 21st
  capped, PGlite migration 082, no vendor call on cap.
- `__tests__/conversation-studio/dfs-route.test.ts` — 401/404/inactive/no-store,
  settings default OFF, non-owner denied.
- Component tests — snapshot/honesty, Firecrawl still disconnected, Mentions
  coverage string remains.
- No live network to `api.dataforseo.com` in CI. Fixtures use example domains or
  brand codes, never customer data.

## Deploy

`.env.example` documents empty `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` plus
optional `DATAFORSEO_LOCATION_CODE` / `DATAFORSEO_LANGUAGE_CODE` comments. No
values are committed and no Vercel env is written by this PR.

`vercel.json` appends only `"codex/conversation-studio-stage-6e": false` under
`git.deploymentEnabled`, preserving the previous 23 keys (result 24).

## HOLD / NO_GO

- Prod/Preview LIVE ON; `STUDIO_LIVE_ANSWERS_PER_WEEK` changes; any `FEATURE_*`
  or env flip. FEATURE already ON in Prod does not authorize these.
- Hosted Neon migrate **081 or 082** — separate GM Approve; not run here.
- 6f Firecrawl (Free path later), public-page scraping.
- Keywords Data / Labs / LLM Mentions APIs; inventing Mentions HK scores.
- Auto top-up; inventing vendor dollar prices in product UI.
- Multi-task batching; Standard queue + poll; `load_async_ai_overview: true`.
- New Studio nav / parallel DFS page / default-home flip.
- 6a/6b/6c schema changes, 6g LIVE quota semantics, 6h beyond display fold-in.
- CloudAgent; merge; logging Basic credentials.
