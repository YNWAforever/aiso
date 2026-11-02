# Conversation Studio Stage 6f — Firecrawl public page in-answer

- Brief: `/workspace/aiso-brief-stage-6f-firecrawl.md` (base `77102ddf`)
- Spend facts: `/workspace/aiso-brief-6e6f-spend-facts.md`
- Design: `docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md` §4 6f
- Approve: Willy answering **t389s1728** (2026-11-02): «… Firecrawl Free (1k, PAYG off); … Firecrawl 1 URL/turn scrape-only public; Preview env only (… FIRECRAWL_API_KEY) …». Post-#137 Approve **t414s1890**: «… Then Stage 6f Firecrawl under same spend Approve.»
- Lane: reassigned from the fleet lane to Claude Code by Willy (2026-11-02).
- Base: `77102ddf98ba4710fcdf418fdcf94a423c4ca540` (`origin/main`, Stage 6e #137)
- Branch: `claude/stage-6f-firecrawl-1mqfrv` — draft PR only

## Outcome

With the Preview `FIRECRAWL_API_KEY` present, commercial `platform_access`, and
the per-brand switch ON (default OFF), a Studio turn that contains an explicit
`http(s)` URL makes **at most one** Firecrawl single-page scrape of that one
public URL. The turn shows an honest page snapshot — title, URL, bounded
excerpt, status — under the answer, in the evidence inspector and as a research
step. A turn without a URL never calls Firecrawl.

Missing key, switch off, no entitlement, a bad or non-public URL, or a vendor
failure is a soft-fail with explicit status copy. No page body is ever
invented, and the body of an error page (HTTP ≥ 400) is never shown as content.

## Vendor contract

| Item | Lock |
| --- | --- |
| Endpoint | `POST https://api.firecrawl.dev/v2/scrape` |
| URLs per HTTP | **exactly 1** (no crawl, map, batch, search or extract) |
| Attempts | **1** — no retries, no auto-resume of a 408 "processing continues" |
| Formats | `['markdown']` only (JSON format costs +4 credits/page) |
| `onlyMainContent` | `true` |
| `proxy` | `'basic'` (stealth/auto can bill more per page) |
| Vendor page timeout | 12 s (`timeout: 12000`), under our deadline so the vendor gives up first |
| Our deadline | 15 s for the HTTP exchange |
| Location | vendor default — `location.country` is **not** sent; HK proxy is 待確認 |
| Auth | `Authorization: Bearer` from `process.env.FIRECRAWL_API_KEY` only |

The endpoint, body fields and response shape (`{ success, data: { markdown,
metadata: { title, url, sourceURL, statusCode, contentType } } }`) were checked
against the official `@mendable/firecrawl-js` 4.51.0 v2 client source. The
Firecrawl docs site was not reachable from the build environment; re-check it
before Prod keys are requested.

Ops facts (not product UI): 1 credit per page; a 404/403 target page still
costs 1 credit; Free = 1,000 credits/month; `/scrape` Free rate limit 10/min;
pay-as-you-go is off.

## Modules and data

| Layer | Path |
| --- | --- |
| Vendor client | `lib/integrations/firecrawl/client.ts` + `types.ts` |
| Turn URL extraction (client-safe) | `lib/conversation-studio/firecrawl-url.ts` |
| Studio query | `lib/conversation-studio/firecrawl-query.ts` + `firecrawl-types.ts` |
| Migration | `supabase/migrations/083_studio_firecrawl.sql` — **file only** |
| Turn route | `POST app/api/dashboard/clients/[clientId]/studio/firecrawl/route.ts` |
| Settings route | `POST app/api/dashboard/clients/[clientId]/studio/firecrawl/settings/route.ts` |
| UI chrome | `components/dashboard/StudioFirecrawlSnapshot.tsx` |

`083` creates only `studio_firecrawl_brand_settings` (`client_id` primary key,
`enabled` default `false`, composite FKs to `clients(id, account_id)` and
`profiles(id, account_id)`), with RLS enabled and public/anon/authenticated/
service-role revoked, mirroring 080–082. **There is no usage table**: the
Approve sets 1 URL/turn and no weekly product cap. **Do not run `npm run
migrate` or apply this migration to hosted Neon.** Until it is applied, a
hosted settings read fails, the connections card falls back to the existing
disconnected card, and the turn route answers `unavailable`.

## Query contract

```ts
type StudioFirecrawlSnapshot = {
  status: 'ok' | 'empty' | 'disabled' | 'disconnected'
        | 'unavailable' | 'auth' | 'payment' | 'rate_limit' | 'invalid' | 'misconfigured'
  url?: string
  title?: string
  excerpt?: string
  contentType?: string
  messageKey?: string
}
```

Order of checks — every refusal happens before the vendor call:

1. Key present and non-blank, otherwise `disconnected` — no settings read, DNS or fetch.
2. URL syntax: empty → `invalid` / `firecrawl.noUrl`; longer than 2,048 → `invalid` /
   `firecrawl.urlTooLong` (refused, never truncated); not `http(s)`, credentials in the URL,
   `localhost` / `*.localhost`, or a non-public IP literal → `invalid` / `firecrawl.urlNotPublic`.
3. Per-brand `enabled=true`, otherwise `disabled`.
4. DNS (3 s deadline): unresolvable → `invalid` / `firecrawl.urlUnresolved`; any answer that is
   not public (`isPublicAddress` from `lib/security/public-url.ts`) → `invalid` / `firecrawl.urlNotPublic`.
5. Exactly one scrape. Failure → mapped status, no content.
6. Target page status ≥ 400 → `empty` / `firecrawl.pageError` with the URL only.
   No readable markdown → `empty` / `firecrawl.empty` / 未有.
7. Otherwise `ok` with a markdown excerpt: images dropped, blank runs collapsed,
   capped at **1,200 characters** (title capped at 300).

The DNS check is a best-effort refusal of obviously private targets. Firecrawl
fetches the page from its own network, so a later DNS change or a redirect
cannot reach AISO's network through this path.

Vendor HTTP mapping: 401 → `auth`, 402 → `payment`, 429 → `rate_limit`,
408 / 5xx / transport → `unavailable`, other 4xx (including 403, Firecrawl's
"site not supported") → `invalid`.

## URL source

The first explicit `http(s)` URL in the turn's own text (Willy, 2026-11-02).
Any public host is allowed — it is not restricted to the brand's domain.
Attached approved sources (6a) are not scraped. Extraction stops at whitespace,
quotes and full-width CJK punctuation, and trims trailing `.,;:!?)]}`.

## Routes and UI

`POST …/studio/firecrawl` runs feature flag → profile → commercial entitlement
(`features.platform_access`, else `403 UPGRADE_REQUIRED`) → account-owned
**active** brand (else 404), accepts only `{ url?: string }` (malformed JSON or
any other key → `400 INVALID_STUDIO_INPUT`) and returns `Cache-Control:
no-store`. Studio calls it once per turn submit only when the turn has a URL;
page load, layout and the connections view never call Firecrawl.

`POST …/studio/firecrawl/settings` accepts only `{ enabled: boolean }` with the
same gate order. Only the owning account can toggle; platform `is_admin` has no
cross-account toggle.

The snapshot is display-only and is not persisted with the 6c thread turn — the
same as the GSC and DataForSEO turn snapshots. The research step appears only
for `ok` / `empty`, i.e. when a scrape actually ran.

`evidence.liveLimit` and `live.savedScope` no longer claim Firecrawl is never
queried; they now say a public page appears only when a turn fetched one.

## Engineering guards to confirm

Accepted by Willy as defaults (2026-11-02), flagged for confirmation:

| Guard | Value |
| --- | --- |
| Per-brand weekly cap | none (1 URL/turn + Free 1,000/month only) |
| `location.country` | not sent (vendor default) |
| URL max length | 2,048 |
| Our deadline / vendor page timeout | 15 s / 12 s |
| DNS deadline | 3 s |
| Excerpt cap / title cap | 1,200 / 300 characters |
| Scrape options | `formats: ['markdown']`, `onlyMainContent: true`, `proxy: 'basic'` |

## Tests

- `__tests__/integrations/firecrawl-client.test.ts` — URL, method, body, Bearer presence,
  single-URL guard, classifier, one attempt on 408, no key in body or logs; mocked fetch only.
- `__tests__/conversation-studio/firecrawl-query.test.ts` — URL extraction, excerpt bounds,
  disconnected / disabled / invalid / non-public / unresolved → no vendor call; ok / empty /
  error page / failure mapping; one call only.
- `__tests__/conversation-studio/firecrawl-settings-sql.test.ts` — PGlite migration 083, RLS on,
  no usage table, default OFF, account-scoped reads, composite FK.
- `__tests__/conversation-studio/firecrawl-route.test.ts` — 401 / 403 / 404 / inactive / 400 /
  no-store, settings owner-only, no admin cross-account.
- Component and guardrail tests — snapshot and honesty copy in both locales, research step only
  when a scrape ran, unsafe URLs never rendered as links, settings switch, `vercel.json` 25 keys,
  scrape-only client.
- `__tests__/integration/migrate.test.ts` and `__tests__/scripts/migrate-baseline-guard.test.ts`
  pin the new table.
- No live network to `api.firecrawl.dev` in CI.

## Deploy

`.env.example` documents an empty `FIRECRAWL_API_KEY=`. No value is committed and
no Vercel env is written. `vercel.json` appends only
`"claude/stage-6f-firecrawl-1mqfrv": false` (24 → 25 keys).

## HOLD / NO_GO

- Prod/Preview LIVE ON; `STUDIO_LIVE_ANSWERS_PER_WEEK`; any `FEATURE_*` or env flip.
- Hosted Neon migrate of **081, 082 or 083**.
- Crawl, map, batch, search, extract, multi-page, retries, JSON format, stealth proxy.
- A weekly Firecrawl counter or usage table; vendor `$` or credit counts in product UI.
- Scraping private or credentialed pages; new Studio nav or a Firecrawl page.
- DataForSEO semantic changes; the post–Stage 6 vendor-name rename.
- Merge.
