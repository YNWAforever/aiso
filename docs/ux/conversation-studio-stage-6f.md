# Conversation Studio Stage 6f — Firecrawl public page scrape

## Scope

On a brand with a Preview `FIRECRAWL_API_KEY`, the per-brand switch ON (default
OFF), and commercial `features.platform_access`, a Studio turn may make **one**
Firecrawl scrape of **one public URL** and show an honest page snapshot (title,
URL, truncated excerpt, status) in the answer, inspector and research steps.

The turn's URL rule is explicit: the prompt must name an `http(s)` URL. An
attached brand document is not turned into a site crawl. There is no automatic
URL discovery.

## Sources

- Brief: `/workspace/aiso-brief-stage-6f-firecrawl.md` (AC-C1/C2/Q/H/T/D/V).
- Spend facts: `/workspace/aiso-brief-6e6f-spend-facts.md`.
- Design: `docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md`
  §3 row **6f** and §4 **Wave 3 / 6f — Firecrawl**.
- GM Approve: **t389s1728** (2026-11-02). Firecrawl Free, PAYG off; product cap
  **one URL per turn, scrape-only, public pages**; Preview env key name only.
- ClickUp: [z8qgvca4pm](https://app.clickup.com/t/z8qgvca4pm).
- Base: `77102ddf98ba4710fcdf418fdcf94a423c4ca540` (Stage 6e #137).

String pack: Hazel polish flagged for the new `conversationStudio.firecrawl`
status keys and the extended public-page honesty copy. No `STRINGS.md` file
exists in this repo, so the message JSON is the source of truth.

## Product locks

| Lock | Value |
| --- | --- |
| Vendor call | `POST https://api.firecrawl.dev/v2/scrape` only |
| Calls per turn | **1** (single attempt, no retry storm) |
| URL | Public `http`/`https` only; refuse `file:`, localhost, private/link-local IPs, credentials-in-URL, empty, malformed and over-long values |
| Max URL length | 2048 characters |
| Request timeout | 15 seconds |
| Display excerpt | 1200 characters; raw full pages are never stored |
| Enable | env key **and** `studio_firecrawl_brand_settings.enabled = true` **and** `platform_access` |
| Weekly product counter | **None** — Approve set a per-turn cap, not a weekly Neon counter |

Firecrawl Free (~1k credits/month) and PAYG off are ops facts from the spend
brief. Remaining credits are vendor-side; the product UI never invents a
remaining-credit number and never shows `$`.

## Status honesty

`StudioFirecrawlSnapshot.status` is one of `ok | empty | disabled | disconnected
| unavailable | auth | payment | rate_limit | invalid | misconfigured`.

- Missing/blank key → `disconnected` before any fetch.
- Brand switch off → `disabled` before any fetch.
- Bad URL → `invalid` with a bilingual message key, before any fetch.
- Vendor failure → typed soft-fail, no invented page body.
- `researchSteps` only claims **Checked Firecrawl** for `ok`/`empty`. A failure
  shown in the inspector is never described as a completed check.
- Scope copy says public pages only. Private-property scraping is not offered.

## API

- `POST app/api/dashboard/clients/[clientId]/studio/firecrawl`
  - feature → profile → `resolveCommercialEntitlement(profile.accounts)` with
    `features.platform_access.length > 0` (else `403 UPGRADE_REQUIRED`) → owned
    active client.
  - `Cache-Control: no-store`; malformed JSON or extra keys →
    `400 INVALID_STUDIO_INPUT`.
  - Body: `{ "url": "https://…" }`.
- `POST …/studio/firecrawl/settings`
  - owning `profile.account_id` only; no platform `is_admin` cross-account
    toggle. Body: `{ "enabled": boolean }`; default OFF.

Both routes call the vendor only on turn submit. Page load, layout and the
connections view read saved settings only.

## Persistence

The Firecrawl display snapshot is client-only for the turn. Existing Studio
thread storage persists the reply and LIVE blobs only, so 6f adds no new stored
blob and never stores credentials.

## Migration

`supabase/migrations/083_studio_firecrawl.sql` creates
`studio_firecrawl_brand_settings` with `enabled boolean not null default false`
and closes RLS/ACL like 080/082. The file is **authored only**. Hosted Neon
migrate **081 / 082 / 083** is not applied by this change and needs a separate
GM Approve.

## Environment

Add only the empty variable name to `.env.example`:

```
FIRECRAWL_API_KEY=
```

Preview values are provisioned by ops/GM, never by agents and never committed.
Production keys are a separate Ask.

## Tests

- Client: endpoint/method/Bearer, one-URL and crawl/batch rejection, public URL
  guard, failure classifier, transport timeout, key never logged. `fetch` is
  mocked; CI never calls `api.firecrawl.dev`.
- Query: missing key → disconnected, disabled brand → no fetch, invalid URL →
  no fetch, one scrape attempt, excerpt truncation, typed failures.
- Routes: 401/403/404, foreign/inactive brand, malformed JSON, settings
  non-owner and no admin cross-account.
- SQL: migration 083 default OFF and owning-account toggle.
- UI: inspector, research step and connections copy in en + zh-HK; DataForSEO
  6e path still renders; Mentions honesty unchanged.

## NO_GO

- Crawl, map, batch or search Firecrawl products.
- Private-property scrape or inventing page content.
- A weekly Firecrawl product counter or vendor `$` in the UI.
- LIVE / `STUDIO_LIVE_ANSWERS_PER_WEEK` / FEATURE / env flips.
- Hosted Neon migrate 081/082/083.
- Prod env keys written by agents; logging or committing the API key.
- Changing DataForSEO 6e semantics beyond shared UI chrome.
- CloudAgent or merging this draft.
