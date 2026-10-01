# GA4 Conversions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro/Enterprise brand bind a GA4 web stream on its existing Google connection, pick which key events count as enquiries, and see daily observed enquiries (split organic search / AI assistants / other) beside, never inside, the modelled Local Trust scenario.

**Architecture:** A sibling module `lib/integrations/analytics/` built on a thin shared Google foundation (`google/access.ts`, `google/scopes.ts`) extracted from the Search Console connector, with direct REST to GA4's Admin and Data APIs, migration `055`, owner routes, a daily cron route on the existing `0 9 * * *` Cloudflare fan-out, and bilingual panels.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Neon (`@neondatabase/serverless`, tagged templates), Vitest 4, React 19 client components with `lang`-prop catalogues.

**Spec:** `docs/superpowers/specs/2026-09-30-ga4-conversions-design.md`, which builds on `docs/superpowers/specs/2026-09-24-search-console-connector-design.md`.

## Global Constraints

- Branch `claude/phase2-analytics`, stacked on `claude/phase2-search-console` (PR #65). Rebase onto `main` once #65 merges; do not merge into #65's branch.
- **GA4 API facts, verified 2026-09-30** against the schema page and the Data API discovery document. Use exactly these names:
  - **Data API:** `POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`. The metric is `keyEvents` ("The count of key events"; there is no per-event `keyEvents:<name>` form, so break it down by `eventName`).
  - **Dimensions:** `date` (`YYYYMMDD`), `eventName`, `source` ("the source attributed to the key event"), `defaultChannelGroup` ("the key event's default channel group"; value `Organic Search`), and `streamId` ("the numeric data stream identifier").
  - **Response metadata:** `metadata.subjectToThresholding` and `metadata.dataLossFromOtherRow`. Pagination uses `limit`/`offset` and `rowCount`.
  - **Admin API:** `GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries` (`accountSummaries[].propertySummaries[].{property, displayName}`), `GET …/v1beta/properties/{id}/dataStreams` (`dataStreams[].{name, type, webStreamData.defaultUri}`, with `type === 'WEB_DATA_STREAM'`), and `GET …/v1beta/properties/{id}/keyEvents` (`keyEvents[].eventName`). All are paginated with `pageToken`/`nextPageToken`.
- **Scopes:** `ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'`, `SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'`.
- **Limits and windows:**
  - `BACKFILL_DAYS = 90`, `ROUTINE_DAYS = 7`. The cron starts no binding after 40 000 ms, and each sync's deadline is run start + 45 000 ms.
  - `KEY_EVENTS_MAX = 20`, `EVENT_NAME_MAX = 40`, `STREAM_HOST_MAX = 253`.
- **Source classes:** exactly `organic_search`, `ai_assistant` and `other`. Classify AI first, then `defaultChannelGroup === 'Organic Search'`, and everything else is `other`.
- **Ledger outcomes** (`ANALYTICS_SYNC_OUTCOMES`, in this order): `ok`, `revoked`, `access_lost`, `google_unavailable`, `quota`, `domain_mismatch`, `not_entitled`, `vault_error`, `config_error`, `internal_error`, `deferred`, `scope_missing`, `events_missing`.
- **Owner states:** `unbound`, `grant_analytics`, `awaiting_first_sync`, `synced`, `reconnect`, `access_lost`, `retrying`, `rebind`, `repick_events`, `paused_plan`, `temporarily_unavailable`.
- **Gating:** flag `FEATURE_ANALYTICS` must be exactly `'1'`, and the plan feature `analytics` must be true for pro and enterprise and false for free and basic. Resolve entitlement with `resolveCommercialEntitlement`, never `getPlanFeatures`.
- **Tenancy:** every SQL statement names `account_id`. Use composite `(…, account_id)` FKs. Never use `returning *` on a joined statement.
- **Logging:** never log `error.message` from the Neon driver or any Google body. Log `name`, `code` and the outcome only.
- **Copy:** every string lives in both `messages/en.json` and `messages/zh-HK.json` (Traditional Chinese) under a new `analytics` namespace, with identical keys. Components pick copy by a `lang` prop. Avoid apostrophes in strings that tests assert with `toContain`.
- **Money:** HKD, `Intl.NumberFormat(locale, { style: 'currency', currency: 'HKD', maximumFractionDigits: 0 })`. `close_rate` is 0–1 and comes back from the driver as a **string**, so coerce it.
- **Separation:** `lib/localTrust/**` never imports `lib/integrations/analytics/**`, and vice versa.
- **Commits:** every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run the full `npm run test:unit` before reporting any task done.

## Review Focus

1. **GA4 dates are `YYYYMMDD`, not ISO.** Every stored `date` must be `YYYY-MM-DD`; one unconverted row makes `::date` throw and the whole window write fail. Tested in Task 8.
2. **`source` values are hosts, not URLs, and vary.** `chatgpt.com`, `chat.openai.com`, `www.perplexity.ai`, `Perplexity.ai`, `(direct)`, `(not set)`, `google` and `copilot.microsoft.com` must classify case-insensitively and by subdomain suffix, and `notchatgpt.com` must **not** match. Tested in Task 6.
3. **Properties hold app streams too.** Only `WEB_DATA_STREAM` streams are offered or bindable; an app stream id in a `PUT` is refused. Tested in Tasks 7, 8 and 13.
4. **GA4 event names are case-sensitive.** `Generate_Lead` is not `generate_lead`, so choices match exactly, and a report row whose `eventName` is not chosen (including `(other)`) is dropped, not counted. Tested in Task 12.
5. **Owner figures arrive as strings or null.** `close_rate` `'0.25'` must compute, a null in either figure means no value line (never `NaN` or `HK$0`), and a `0` lead value is a real figure that shows `HK$0`. Tested in Task 6.

---

### Task 1: Flag and plan feature

**Files:**
- Modify: `lib/flags.ts`, `lib/plans/catalog.ts` (`PlanFeatures` plus all four plans)
- Test: append to `__tests__/lib/flags.test.ts` and to the existing catalogue test (locate it with `rg -l "search_console" __tests__`)

**Interfaces:**
- Produces: `FeatureFlag` gains `'analytics'`; `PlanFeatures.analytics: boolean`.

- [ ] **Step 1: Write failing tests.** `isFeatureEnabled('analytics')` is true only for `FEATURE_ANALYTICS === '1'` (it is false for `'true'`, `' 1'` and unset). `analytics` is `false` for free and basic and `true` for pro and enterprise.
- [ ] **Step 2: Run them.** `npx vitest run <both files>` should FAIL.
- [ ] **Step 3: Implement.** Add the union member and the catalogue field, and fix any exhaustive fixtures typecheck finds.
- [ ] **Step 4: Verify.** The targeted tests, `npm run typecheck` and `npm run test:unit` should all pass.
- [ ] **Step 5: Commit** `feat(analytics): flag and pro/enterprise plan feature`.

---

### Task 2: Shared scopes and the consent URL

This task also closes a correctness gap. An Analytics grant must survive a later Search Console reconnect, so **both** flows now send `include_granted_scopes=true`. This is a deliberate behaviour change to PR #65's consent URL; say so in the commit body.

**Files:**
- Create: `lib/integrations/google/scopes.ts`
- Modify: `lib/integrations/google/oauth.ts` (`buildConsentUrl`), `app/api/integrations/google/start/route.ts`
- Test: `__tests__/integrations/google-scopes.test.ts`; in `__tests__/integrations/oauth.test.ts`, change only the `include_granted_scopes` assertion

**Interfaces:**
- Produces:
  - `ANALYTICS_SCOPE`, `SEARCH_CONSOLE_SCOPE` (the latter re-exported from `oauth.ts` for existing importers).
  - `type GoogleProduct = 'search_console' | 'analytics'`.
  - `scopesFor(product: GoogleProduct): string[]`, which returns `[SEARCH_CONSOLE_SCOPE]` or `[SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE]`.
  - `hasScope(scopes: readonly string[], scope: string): boolean`.
  - `buildConsentUrl(cfg, input: { state: string; challenge: string; scopes: string[]; loginHint?: string }): string`.

- [ ] **Step 1: Write failing tests.**
  - The URL's `scope` param equals `'openid email ' + scopes.join(' ')`.
  - `include_granted_scopes === 'true'`.
  - `login_hint` is present only when given.
  - `prompt === 'consent'` and `access_type === 'offline'`.
  - `hasScope` is an exact string match (a scope that is merely a prefix of another does not match).
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.** The start route passes `scopes: scopesFor('search_console')` for now; Task 4 adds the analytics path.
- [ ] **Step 4: Verify.** The targeted tests and the full `npm run test:unit` should pass. The Search Console consent and route suites must pass with only the one `include_granted_scopes` assertion changed.
- [ ] **Step 5: Commit** `refactor(google): scope helpers and a consent URL that keeps earlier grants`.

---

### Task 3: Extract access-token acquisition

**Files:**
- Create: `lib/integrations/google/access.ts`
- Modify: `lib/integrations/search-console/sync.ts` (the token section of `attempt()` calls `acquireAccessToken`), `lib/integrations/search-console/store.ts` (`loadConnectionSecret` also selects and returns `scopes`)
- Test: `__tests__/integrations/google-access.test.ts`

**Interfaces:**
- Consumes: `openToken`/`VaultError` (vault), and `refreshAccessToken`/`GoogleApiError` (oauth).
- Produces:
```ts
export type ConnectionSecret = { status: string; sealed: SealedToken | null; scopes: string[] }
export type TokenDeps = {
  loadSecret(accountId: string, connectionId: string): Promise<ConnectionSecret | null>
  open(sealed: SealedToken, accountId: string): string
  refresh(refreshToken: string): Promise<string>
  markConnection(accountId: string, connectionId: string, status: 'needs_reconnect'): Promise<void>
}
export type TokenFailure = 'revoked' | 'vault_error' | 'deferred' | 'config_error' | 'google_unavailable' | 'quota'
export type TokenResult =
  | { ok: true; accessToken: string; scopes: string[] }
  | { ok: false; outcome: TokenFailure }
export async function acquireAccessToken(
  deps: TokenDeps,
  input: { accountId: string; connectionId: string; clientId: string; outOfTime: () => boolean; logTag: string },
): Promise<TokenResult>
```
- Behaviour, moved verbatim from `search-console/sync.ts`:
  - A missing, inactive or unsealed secret gives `revoked`.
  - A `VaultError` gives `vault_error`, logged as `{clientId, code}` under `logTag`. Any other error from `open` is rethrown.
  - `outOfTime()` before the refresh gives `deferred`.
  - A refresh `GoogleApiError` maps `revoked` → `markConnection(…,'needs_reconnect')` then `revoked`; `misconfigured` → `config_error`, logged as `{clientId, status, code}`; `unavailable` → `google_unavailable`; `quota` → `quota`. Any other error is rethrown.
  - `SyncDeps` in `search-console/sync.ts` extends `TokenDeps`.

- [ ] **Step 1: Write failing tests,** one per mapping above, plus: `markConnection` is called **only** for `revoked`, and a successful result carries the secret's `scopes`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement,** then replace the inline token code in `search-console/sync.ts` with a call to it.
- [ ] **Step 4: Verify.** `__tests__/integrations/sync.test.ts` and every `__tests__/api/search-console-*.test.ts` must pass **unedited**; that is the extraction proof. Then run the full `npm run test:unit`.
- [ ] **Step 5: Commit** `refactor(google): extract access-token acquisition from the search console sync`.

---

### Task 4: Consent flow for Analytics

**Files:**
- Modify:
  - `lib/integrations/google/consent-state.ts`: add a `product` field, and change the signing domain to `aiso-google-consent:v2` so pre-change cookies do not verify.
  - `lib/integrations/google/consent-reasons.ts`
  - `app/api/integrations/google/start/route.ts`
  - `app/api/integrations/google/callback/route.ts`
  - both catalogues (`searchConsole.reason_analytics_not_granted`, `searchConsole.reason_search_console_not_granted`)
- Test: append to `__tests__/integrations/consent-state.test.ts` and `__tests__/api/search-console-consent.test.ts`

**Interfaces:**
- Consumes: `scopesFor`, `hasScope` (Task 2), `listConnections` (existing store).
- Produces:
  - `ConsentState.product: GoogleProduct`, which is included in the canonical string and validated as one of the two values.
  - `CONSENT_ERROR_REASONS` gains `'analytics_not_granted'` and `'search_console_not_granted'`.
  - The start route accepts `?scope=analytics&connection=<uuid>`. The callback's required scopes are derived from `consent.product`.

- [ ] **Step 1: Write failing tests.**
  - A token signed as v1 does not verify.
  - A `product` other than the two values is rejected when signing.
  - Start with `scope=analytics` produces a consent URL carrying both scopes. When `connection` is a UUID belonging to the caller's account, it also carries `login_hint` set to that connection's email. With another account's id, a non-UUID, or no `connection` param there is no `login_hint`, and the start route still succeeds.
  - Callback with `product: 'analytics'`:
    - Grant scopes lacking `ANALYTICS_SCOPE` → redirect `reason=analytics_not_granted`, and `upsertConnection` is **not** called.
    - Grant lacking `SEARCH_CONSOLE_SCOPE` → `reason=search_console_not_granted`, and **not** called.
    - Both present → upsert with the granted scopes.
  - Callback with `product: 'search_console'` behaves exactly as before.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.** An unknown `scope` query value is treated as `search_console`.
- [ ] **Step 4: Verify.** The targeted tests, the full `npm run test:unit`, `npm run typecheck` and the catalogue parity test should all pass.
- [ ] **Step 5: Commit** `feat(google): consent flow that adds analytics to an existing connection`.

---

### Task 5: Migration `055`

**Files:**
- Create: `supabase/migrations/055_analytics.sql`
- Modify: `__tests__/scripts/migrate-baseline-guard.test.ts` (055's tables), `__tests__/security/tenancy-inventory.test.ts` (`TENANT_TABLES` gains the three tables)
- Test: `__tests__/migrations/analytics-migration.test.ts`

**Interfaces:**
- Produces the tables in spec §3.2. Constraint names are relied on by Task 10:
  - `analytics_bindings_account_client_unique` on `(account_id, client_id)`.
  - `analytics_daily_unique` on `(account_id, client_id, date, event_name, source_class)`.
- **`analytics_bindings`**
  - Columns: `id uuid pk`, `account_id`, `client_id`, `connection_id`, `property_id text`, `stream_id text`, `stream_host text`, `key_events text[]`, `events_chosen_at timestamptz`, `bound_at timestamptz`, `backfill_pending boolean`, `created_at`, `updated_at`.
  - FKs: `(client_id, account_id)` → `clients(id, account_id)` on delete cascade, and `(connection_id, account_id)` → `google_connections(id, account_id)`, mirroring 054's `search_console_bindings` connection FK and its delete action.
  - CHECKs:
    - `cardinality(key_events) between 1 and 20`;
    - every element is 1–40 characters. A CHECK cannot contain a subquery, so implement this with an `immutable` SQL helper `analytics_event_names_valid(text[])` created in the same migration, and test it.
    - `property_id ~ '^[0-9]+$'` and `stream_id ~ '^[0-9]+$'`;
    - `length(stream_host) <= 253`.
- **`analytics_daily`**
  - Columns: `account_id`, `client_id`, `date date`, `event_name text` (≤ 40), `source_class text` (CHECK in the three classes), `count bigint` (CHECK ≥ 0), `synced_at timestamptz default now()`.
  - FK `(client_id, account_id)` → `clients`.
- **`analytics_sync_runs`**
  - Columns: `id`, `account_id`, `client_id`, `connection_id`, `property_id`, `stream_id`, `ran_at timestamptz default clock_timestamp()`, `outcome` (CHECK over the 13 outcomes), `rows_written int` (CHECK ≥ 0), `data_through date`, `data_withheld boolean not null default false`.
  - Index `(account_id, client_id, ran_at desc)`.
- **Grants:** exactly the table in spec §3.2 to `aeo_app`, having revoked everything else.

- [ ] **Step 1: Write the failing static test.**
  - Every table has `account_id` and composite FKs.
  - The outcome CHECK lists exactly the 13 outcomes. Use a literal array here; Task 9 switches it to an import.
  - Grants per table are exact, with no UPDATE on daily or ledger and no DELETE on the ledger.
  - No `create policy`.
  - The file sorts after `054_`.
- [ ] **Step 2: Run it.** It should FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Verify.** The static test, the baseline-guard test, the tenancy-inventory test and the full `npm run test:unit` should pass.
- [ ] **Step 5: Commit** `feat(analytics): migration 055 with bindings, daily counts and an insert-only ledger`.

---

### Task 6: Pure helpers (source classes and the value line)

**Files:**
- Create: `lib/integrations/analytics/sources.ts`, `lib/integrations/analytics/value.ts`
- Test: `__tests__/integrations/analytics-sources.test.ts`, `__tests__/integrations/analytics-value.test.ts`

**Interfaces:**
- Produces:
```ts
export type SourceClass = 'organic_search' | 'ai_assistant' | 'other'
export const SOURCE_CLASSES: readonly SourceClass[]
export const AI_ASSISTANT_HOSTS: readonly string[]
// initial list: chatgpt.com, chat.openai.com, openai.com, perplexity.ai, gemini.google.com,
// bard.google.com, copilot.microsoft.com, claude.ai, you.com, phind.com, deepseek.com
export function classifySource(source: string, defaultChannelGroup: string): SourceClass
export function observedValue(count: number, owner: { leadValue: unknown; closeRate: unknown }): number | null
```
- `classifySource`: lower-case and trim `source`. It is `ai_assistant` when the source equals a listed host or ends with `'.' + host`; otherwise `organic_search` iff `defaultChannelGroup === 'Organic Search'`; otherwise `other`.
- `observedValue`: `null` unless both figures coerce to finite numbers with `closeRate ∈ [0,1]` and `leadValue ≥ 0`; otherwise `Math.round(count * closeRate * leadValue)`.

- [ ] **Step 1: Write failing tests** covering Review Focus items 2 and 5 exactly as listed, plus:
  - an AI host with channel `Referral` gives `ai_assistant`;
  - `google` with `Organic Search` gives `organic_search`;
  - `(direct)` with `Direct` gives `other`;
  - `observedValue(37, {leadValue: '800', closeRate: '0.25'}) === 7400`;
  - `closeRate: '1.5'` gives `null`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests should pass.
- [ ] **Step 5: Commit** `feat(analytics): source classes and the owner-figure value line`.

---

### Task 7: Stream eligibility

**Files:**
- Create: `lib/integrations/analytics/binding.ts`
- Test: `__tests__/integrations/analytics-binding.test.ts`

**Interfaces:**
- Consumes: `normalizeBrandDomain` from `lib/integrations/search-console/binding.ts`.
- Produces:
```ts
export type WebStream = { streamId: string; displayName: string; defaultUri: string }
export type StreamReason = 'no_domain' | 'other_domain' | 'invalid_uri'
export type StreamVerdict = { eligible: true; host: string } | { eligible: false; reason: StreamReason }
export function streamEligibility(defaultUri: string, brandDomain: string | null | undefined): StreamVerdict
export function streamStillMatches(storedHost: string, brandDomain: string | null | undefined): boolean
```
- A stream is eligible when `defaultUri` parses as an http(s) URL with no port, and its host (lower-cased, raw, www kept) equals the normalised brand domain or `'www.' +` it. IP literals are `invalid_uri`. `streamStillMatches` applies the same comparison to the stored raw host.

- [ ] **Step 1: Write failing tests.**
  - `https://www.example.com` and `https://example.com/` are eligible for brand `example.com`.
  - `https://shop.example.com` is `other_domain`.
  - `https://example.com:8443`, `ftp://example.com` and `http://192.0.2.1` are `invalid_uri`.
  - A null brand domain gives `no_domain`.
  - `streamStillMatches('www.example.com', 'shop.example.com') === false`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests should pass.
- [ ] **Step 5: Commit** `feat(analytics): web stream eligibility against the brand domain`.

---

### Task 8: GA4 client

**Files:**
- Create: `lib/integrations/analytics/client.ts`, and fixtures under `__tests__/fixtures/ga4/` (`account-summaries.json`, `data-streams.json`, `key-events.json`, `run-report-page1.json`, `run-report-page2.json`, `run-report-thresholded.json`, `error-scope.json`, `error-permission.json`, `error-service-disabled.json`, `error-quota.json`), built from the shapes in Global Constraints.
- Test: `__tests__/integrations/analytics-client.test.ts`

**Interfaces:**
- Consumes: `GoogleFetch`, `GOOGLE_TIMEOUT_MS` (oauth), and Search Console's `DeadlineReachedError`. If it is not already exported from a shared path, move it to `lib/integrations/google/deadline.ts` and re-export from its old path.
- Produces:
```ts
export type AnalyticsFailure = 'scope_missing' | 'access_lost' | 'quota' | 'unavailable' | 'misconfigured'
export class AnalyticsApiError extends Error {
  constructor(readonly kind: AnalyticsFailure, readonly status: number, readonly code?: string)
}
export function classifyAnalyticsFailure(status: number, body: unknown): AnalyticsFailure
export async function listProperties(token: string, f?: GoogleFetch): Promise<Array<{ propertyId: string; displayName: string }>>
export async function listWebStreams(token: string, propertyId: string, f?: GoogleFetch): Promise<WebStream[]>
export async function listKeyEvents(token: string, propertyId: string, f?: GoogleFetch): Promise<string[]>
export type KeyEventRow = { date: string; eventName: string; source: string; channelGroup: string; count: number }
export async function runKeyEventReport(
  token: string,
  input: { propertyId: string; streamId: string; eventNames: string[]; startDate: string; endDate: string; deadline: number; now?: () => number },
  f?: GoogleFetch,
): Promise<{ rows: KeyEventRow[]; withheld: boolean }>
```
- **Classification:**
  - `details[].reason` `ACCESS_TOKEN_SCOPE_INSUFFICIENT` → `scope_missing`;
  - `SERVICE_DISABLED` → `misconfigured`;
  - 401 → `unavailable`;
  - 403 or 404 (`PERMISSION_DENIED` / `NOT_FOUND`) → `access_lost`;
  - 429 or `RESOURCE_EXHAUSTED` → `quota`;
  - otherwise → `unavailable`.
- **Report request:**
  - dimensions `date`, `eventName`, `source`, `defaultChannelGroup`;
  - metric `keyEvents`;
  - `dimensionFilter` an `andGroup` of `streamId` EXACT and `eventName` `inListFilter`;
  - `limit: 10000`, with offset pagination and at most 20 pages;
  - `withheld = subjectToThresholding || dataLossFromOtherRow` on any page.
- **Row conversion:** `date` `YYYYMMDD` becomes `YYYY-MM-DD`; a malformed date or a non-numeric count throws `AnalyticsApiError('unavailable', 200, 'malformed_rows')`.
- **Listing:** streams keep only `WEB_DATA_STREAM`, and `streamId` is the last path segment of `name`. Every list call follows `nextPageToken`. Every call uses `AbortSignal.timeout(GOOGLE_TIMEOUT_MS)`, and the deadline is checked before each report page.

- [ ] **Step 1: Write failing tests.**
  - Each classification row.
  - The exact request body the fake fetch receives (dimensions, metric and filter).
  - Two-page pagination concatenates the pages.
  - A passed deadline requests no further page and throws `DeadlineReachedError`.
  - The thresholded fixture gives `withheld: true`.
  - Review Focus 1: `20260928` → `2026-09-28`, and a row dated `2026-09-28` is rejected as malformed.
  - Review Focus 3: app streams are dropped.
  - A non-JSON 200 gives `unavailable`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests and the full `npm run test:unit` should pass.
- [ ] **Step 5: Commit** `feat(analytics): GA4 admin and data client with typed failures`.

---

### Task 9: Outcomes and owner state

**Files:**
- Create: `lib/integrations/analytics/state.ts`
- Modify: `__tests__/migrations/analytics-migration.test.ts` (import `ANALYTICS_SYNC_OUTCOMES`)
- Test: `__tests__/integrations/analytics-state.test.ts`

**Interfaces:**
- Produces:
```ts
export const ANALYTICS_SYNC_OUTCOMES // the 13 in Global Constraints order, `as const`
export type AnalyticsOutcome = (typeof ANALYTICS_SYNC_OUTCOMES)[number]
export type AnalyticsOwnerState =
  | { kind: 'unbound' } | { kind: 'grant_analytics' } | { kind: 'awaiting_first_sync' }
  | { kind: 'synced'; dataThrough: string } | { kind: 'repick_events' }
  | { kind: 'reconnect' | 'access_lost' | 'retrying' | 'rebind' | 'paused_plan' | 'temporarily_unavailable'; dataThrough: string | null }
export type AnalyticsStateInput = {
  bound: boolean; entitled: boolean; connectionStatus: 'active' | 'needs_reconnect' | 'revoked' | null
  hasAnalyticsScope: boolean; domainMatches: boolean
  boundAt: string | null; eventsChosenAt: string | null
  latest: { outcome: AnalyticsOutcome; dataThrough: string | null; ranAt: string } | null
  lastGoodDataThrough: string | null
}
export function deriveAnalyticsOwnerState(input: AnalyticsStateInput): AnalyticsOwnerState
```
- **Precedence**, first match wins:
  1. `!bound` → `unbound`.
  2. `!entitled` → `paused_plan`.
  3. Connection not active → `reconnect`.
  4. `!hasAnalyticsScope` → `grant_analytics`.
  5. `!domainMatches` → `rebind`.
  6. Then the latest ledger row, after the stale rules in spec §5:
     - `ok` → `synced`;
     - `events_missing` → `repick_events`;
     - `access_lost` → `access_lost`;
     - `quota`, `google_unavailable` → `retrying`;
     - `vault_error`, `config_error`, `internal_error` → `temporarily_unavailable`.
  7. A stale or absent latest row → `synced` with `lastGoodDataThrough` if that exists, else `awaiting_first_sync`.

- [ ] **Step 1: Write failing tests,** one per precedence line, plus each stale rule:
  - a row before `boundAt`;
  - a `scope_missing` row with the scope now present;
  - an `events_missing` row before `eventsChosenAt`;
  - `not_entitled` / `domain_mismatch` / `deferred` / `revoked` rows contradicted by live checks.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests and the migration static test should pass.
- [ ] **Step 5: Commit** `feat(analytics): closed outcome vocabulary and derived owner state`.

---

### Task 10: Store

**Files:**
- Create: `lib/integrations/analytics/store.ts`
- Modify: `__tests__/security/tenancy-inventory.test.ts` (`ACCOUNT_BLIND_BY_DESIGN` gains `loadDueAnalyticsBindings` with its reason)
- Test: `__tests__/integrations/analytics-store.test.ts` (SQL shape via the mocked `db()` only; behaviour is proven in Task 15)

**Interfaces:**
- Produces:
```ts
export type AnalyticsBinding = { connectionId: string; propertyId: string; streamId: string; streamHost: string; keyEvents: string[]; eventsChosenAt: string; boundAt: string; backfillPending: boolean }
export type DueAnalyticsBinding = AnalyticsBinding & { accountId: string; clientId: string; currentDomain: string | null; account: CommercialAccount }
export type DailyCount = { date: string; eventName: string; sourceClass: SourceClass; count: number }
export type AnalyticsPanel = {
  latest: { outcome: AnalyticsOutcome; dataThrough: string | null; ranAt: string; dataWithheld: boolean } | null
  lastGoodDataThrough: string | null
  last28: { total: number; bySource: Record<SourceClass, number>; byEvent: Array<{ eventName: string; count: number }> } | null
  owner: { leadValue: string | null; closeRate: string | null }
}
export async function bindStream(input: { accountId: string; clientId: string; connectionId: string; propertyId: string; streamId: string; streamHost: string; keyEvents: string[] }): Promise<'bound' | 'not_found'>
export async function updateKeyEvents(accountId: string, clientId: string, keyEvents: string[]): Promise<boolean>
export async function unbindStream(accountId: string, clientId: string): Promise<boolean>
export async function loadAnalyticsBinding(accountId: string, clientId: string): Promise<AnalyticsBinding | null>
export async function loadDueAnalyticsBindings(limit: number): Promise<DueAnalyticsBinding[]>
export async function replaceDailyWindow(accountId: string, clientId: string, window: { startDate: string; endDate: string }, counts: DailyCount[]): Promise<number>
export async function recordAnalyticsRun(input: { accountId: string; clientId: string; connectionId: string; propertyId: string; streamId: string; outcome: AnalyticsOutcome; rowsWritten: number; dataThrough: string | null; dataWithheld: boolean; clearBackfill: boolean }): Promise<void>
export async function loadAnalyticsPanel(accountId: string, clientId: string, keyEvents: string[], boundAt: string): Promise<AnalyticsPanel>
```
- **Rules:**
  - `bindStream` is one statement that inserts, or upserts on `analytics_bindings_account_client_unique`, only if the connection row exists for `account_id`; zero rows means `not_found`.
    - It moves `bound_at` only when `(connection_id, property_id, stream_id)` changes, and always sets `events_chosen_at` and `backfill_pending`.
  - `updateKeyEvents` sets `key_events`, `events_chosen_at = now()` and `backfill_pending = true`.
  - `replaceDailyWindow` runs one `sql.transaction`: delete the window's rows for the account and client, then insert the counts via `unnest`, returning the inserted count.
  - `recordAnalyticsRun` inserts the ledger row. With `clearBackfill`, it clears `backfill_pending` in the same transaction, only where the binding still has that connection, property and stream.
  - `loadDueAnalyticsBindings`: an active connection, least recently attempted (latest ledger `ran_at` of any outcome, nulls first), and the account row for entitlement. It is a cross-account read by design.
  - `loadAnalyticsPanel` reads in one read-only repeatable-read transaction:
    - the daily rows are the last 28 days ending at the newest synced date, where `event_name = any(keyEvents)` and `synced_at >= boundAt`, with totals summed as `::bigint` then converted to numbers;
    - the latest ledger row;
    - the last `ok` row since `boundAt`;
    - `local_trust_profiles.average_lead_value::text, close_rate::text` for `(client_id, account_id)`.

- [ ] **Step 1: Write failing tests.** Every statement's SQL text contains `account_id`, except the declared due read; there is no `returning *`; and transactions are used for the window replacement and the panel.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests and the tenancy-inventory test should pass.
- [ ] **Step 5: Commit** `feat(analytics): account-scoped store with window replacement`.

---

### Task 11: Guard

**Files:**
- Create: `lib/integrations/analytics/guard.ts`
- Test: `__tests__/integrations/analytics-guard.test.ts`

**Interfaces:**
- Produces: `authorizeAnalytics(clientId: string): Promise<{ ok: true; profile: ProfileWithAccount; client: { id: string; domain: string | null } } | { ok: false; response: NextResponse }>`.
- Copy `lib/integrations/search-console/guard.ts`'s shape and order exactly, keyed on the `analytics` flag and plan feature:
  - flag off → 404;
  - no session → 401;
  - not entitled → 403;
  - non-UUID `clientId` → 404 before any query;
  - ownership miss → 404;
  - lookup throws → 503.

- [ ] **Step 1: Write failing tests,** one per branch, including that no DB call happens for a non-UUID id.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests should pass.
- [ ] **Step 5: Commit** `feat(analytics): route guard`.

---

### Task 12: Sync

**Files:**
- Create: `lib/integrations/analytics/sync.ts`
- Test: `__tests__/integrations/analytics-sync.test.ts`

**Interfaces:**
- Consumes: `acquireAccessToken`/`TokenDeps` (Task 3), `hasScope`/`ANALYTICS_SCOPE` (Task 2), the client (Task 8), `streamStillMatches` (Task 7), `classifySource` (Task 6), and the store types (Task 10).
- Produces:
```ts
export type AnalyticsSyncDeps = TokenDeps & {
  getStream(token: string, propertyId: string, streamId: string): Promise<WebStream | null>
  listKeyEvents(token: string, propertyId: string): Promise<string[]>
  report(token: string, input: Parameters<typeof runKeyEventReport>[1]): Promise<{ rows: KeyEventRow[]; withheld: boolean }>
  replaceDailyWindow: typeof replaceDailyWindow
  recordRun: typeof recordAnalyticsRun
  today(): string
  deadline: number
  now?: () => number
}
export async function syncAnalyticsBinding(b: DueAnalyticsBinding, deps: AnalyticsSyncDeps): Promise<AnalyticsOutcome>
```
- **Order,** each step recording its outcome and stopping:
  1. Entitlement → `not_entitled`.
  2. `streamStillMatches` → `domain_mismatch`.
  3. `acquireAccessToken` → its failure outcome.
  4. `!hasScope(scopes, ANALYTICS_SCOPE)` → `scope_missing`.
  5. `getStream` null → `access_lost`.
  6. Key events ∩ chosen empty → `events_missing`.
  7. The report over the window (90 days if `backfillPending`, else 7, ending `today()`).
  8. Drop rows whose `eventName` is not among the still-valid chosen events (Review Focus 4).
  9. Classify, sum per (date, event, class), `replaceDailyWindow`.
  10. `ok`, with `dataThrough` the max date or null, and `dataWithheld`.
- **Failure mapping:**
  - `AnalyticsApiError`: `scope_missing` → `scope_missing` (never `markConnection`), `access_lost` → `access_lost`, `quota` → `quota`, `unavailable` → `google_unavailable`, `misconfigured` → `config_error` (logged).
  - `DeadlineReachedError` → `deferred`, writing nothing from that report.
  - Anything else → `internal_error`, logged as `{clientId, name, code}`.
- Exactly one `recordRun` per call, outside the attempt's catch. `clearBackfill` only when the outcome is `ok`.

- [ ] **Step 1: Write failing tests.**
  - One test per outcome.
  - **The cross-product rule:** an Analytics 403 scope error never calls `markConnection`, while `invalid_grant` on refresh does.
  - Review Focus 4 (a case-different and an `(other)` event row are dropped).
  - A partially missing event list syncs the remainder.
  - The window and backfill flag.
  - Exactly one `recordRun` even when `replaceDailyWindow` throws (giving `internal_error`).
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests and the full `npm run test:unit` should pass.
- [ ] **Step 5: Commit** `feat(analytics): daily sync with outcomes and the cross-product rule`.

---

### Task 13: Owner routes

**Files:**
- Create: `app/api/dashboard/clients/[clientId]/analytics/route.ts`
- Test: `__tests__/api/analytics-binding.test.ts`

**Interfaces:**
- Consumes: `authorizeAnalytics` (11), the store (10), the client (8), `streamEligibility` (7), `deriveAnalyticsOwnerState` (9), `acquireAccessToken` (3) and `listConnections` (existing).
- Produces:
  - **`GET`** → `{ state, binding, panel, connections: Array<{ id; email; hasAnalytics }>, properties: Array<{ connectionId; items: Array<{ propertyId; displayName }>; error: AnalyticsFailure | TokenFailure | null }>, picker: { streams: Array<WebStream & { verdict: StreamVerdict }>; keyEvents: string[] } | null }`.
    - `properties` is filled only with `?properties=1`.
    - `picker` is filled only with `?property=<digits>&connection=<uuid>`.
    - With no query, Google is never called.
  - **`PUT`** body `{ connectionId, propertyId, streamId, keyEvents }`, or `{ keyEvents }` alone to change events on an existing binding.
    - The server re-fetches the streams and key events from Google. It refuses a non-web or ineligible stream, or an event name that is not currently a key event, with 422 `{ error: 'INELIGIBLE', reason }`.
    - It validates UUIDs, digit-only ids and 1–20 distinct names of at most 40 characters, answering 400 on failure.
    - A Google failure gives 502/503 `{ error: 'GOOGLE', reason }`, and a store `not_found` gives 404.
  - **`DELETE`** → unbind, answering 404 if nothing was bound.
  - Every DB failure gives 503 and is logged as `name` only.

- [ ] **Step 1: Write failing tests.**
  - Each gate status.
  - GET with no query makes zero fetch calls.
  - The picker includes verdicts and omits app streams.
  - PUT with an app stream id gives 422 (Review Focus 3).
  - PUT with an event not in Google's current list gives 422.
  - The stored host comes from Google's stream, never from the request.
  - A `keyEvents`-only PUT calls `updateKeyEvents`.
  - A DB throw gives 503 with no driver message in the body or the logs.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests and the full `npm run test:unit`, including any route-gate inventory test (add the route if it lists routes), should pass.
- [ ] **Step 5: Commit** `feat(analytics): owner routes for state, picker, bind and unbind`.

---

### Task 14: Cron route and scheduling

**Files:**
- Create: `app/api/cron/analytics/route.ts`
- Modify: `vercel.json` (`"app/api/cron/analytics/route.ts": { "maxDuration": 60 }`), `cloudflare/cron-worker/src/index.ts` (the `'0 9 * * *'` entry becomes `['/api/cron/trial-emails', '/api/cron/search-console', '/api/cron/analytics']`), the cron worker's own test, and `__tests__/config/function-durations.test.ts`
- Test: `__tests__/api/analytics-cron.test.ts`

**Interfaces:**
- Consumes: `syncAnalyticsBinding` (12), `loadDueAnalyticsBindings` (10), and `startCronRun`/`finishCronRun` (`lib/cron/recordRun`).
- Mirror `app/api/cron/search-console/route.ts`:
  - A `CRON_SECRET` shorter than 16 characters gives 500. A wrong bearer gives 401. The flag off gives `200 {skipped: 'flag_off'}`. Vault or OAuth config missing gives 500.
  - The start cutoff is 40 000 ms and the per-sync `deadline = started + 45_000`.
  - `SKIPS = {not_entitled, domain_mismatch, scope_missing, events_missing}`.
  - The response is 502 when at least one binding was due, none was `ok`, and not every due one was a skip.
  - The response carries per-outcome counts.
  - `finishCronRun` is called exactly once. Only `error.name` is logged.
  - Deps wiring:
    - `getStream: (t, p, s) => listWebStreams(t, p).then(list => list.find(x => x.streamId === s) ?? null)`.
    - `listKeyEvents` and `report` come from the Task 8 client.
    - The token deps are the same four the Search Console cron builds.

- [ ] **Step 1: Write failing tests** for each rule above, with the happy path asserting `finishCronRun` with `'ok'`. Update the function-durations test and the worker test to expect the third route.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests, the full `npm run test:unit`, and `npm test` in `cloudflare/cron-worker` should pass.
- [ ] **Step 5: Commit** `feat(analytics): daily cron on the shared 09:00 trigger`.

---

### Task 15: Real-Postgres suite

**Files:**
- Create: `__tests__/integration/analytics.test.ts`, `vitest.analytics-integration.config.ts` (copy `vitest.search-console-integration.config.ts`)
- Modify: `scripts/ci/run-exact-target-suites.mjs` (`EXACT_TARGET_CONFIGS`), `vitest.integration.config.ts` (exclude the file), `__tests__/ci/exact-target-suites.test.ts` (`SUITES`)

- [ ] **Step 1: Write the suite,** mirroring `__tests__/integration/search-console.test.ts`'s fixtures (two accounts, two clients, connections). Tests:
  - `055` applies after `054`, and all three tables exist.
  - `bindStream` with another account's connection gives `not_found`, and zero rows are written.
  - A composite FK rejects a mismatched `(client_id, account_id)` with `23503`.
  - `replaceDailyWindow` removes a class that disappeared from the window and leaves rows outside the window alone.
  - `aeo_app` can INSERT but not UPDATE or DELETE `analytics_sync_runs` (permission-denied code `42501`).
  - The panel ignores un-chosen events, rows with `synced_at < bound_at`, and another account's rows.
  - `updateKeyEvents` moves `events_chosen_at` but not `bound_at`.
  - A `key_events` of 21 names, or a 41-character name, violates its CHECK.
  - `local_trust_profiles.close_rate` round-trips to the panel as text `'0.25'`.
- [ ] **Step 2: Run** `node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"`. Expected: `11/11 suites`, including `analytics-integration`.
- [ ] **Step 3: Run** `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration 2>&1 | grep -v "postgresql://"`. Expected: green, with the analytics file not run twice.
- [ ] **Step 4: Commit** `test(analytics): prove 055, tenancy and window replacement on real Postgres`.

---

### Task 16: Brand panel

**Files:**
- Create: `components/integrations/AnalyticsPanel.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/assets/page.tsx` (render beside `SearchConsolePanel` when `isFeatureEnabled('analytics')` and the plan grants `analytics`), both catalogues (the `analytics` namespace), and `__tests__/lib/message-catalogue-parity.test.ts` (add `'analytics'` in alphabetical position)
- Test: `__tests__/components/analytics-bilingual.test.tsx`

**Interfaces:**
- Consumes: Task 13's GET/PUT/DELETE contract, `AnalyticsOwnerState` (9), `observedValue` (6) and `SourceClass` (6).
- Follow `components/integrations/SearchConsolePanel.tsx`'s structure and its reviewed failure handling:
  - The picker loads only in `unbound`, `rebind` and `repick_events`: the property list first, then the chosen property's streams and events.
  - Every write checks `res.ok` and maps the error body to a catalogue key, with busy-disabled buttons and a distinct `aria-label` per row.
  - A failed refresh after a successful write never reads as a write failure.
  - `grant_analytics` links to `/api/integrations/google/start?scope=analytics&connection=<id>&return=<this page>`.
  - `reconnect` and `access_lost` link to Settings.
- **Figures:**
  - Total enquiries (last 28 days).
  - Three source rows (organic search, AI assistants, other).
  - Per-event rows.
  - "Data up to {date}".
  - The withheld note when `latest.dataWithheld`.
  - The value line only when `observedValue` is non-null, labelled with the key `value_uses_your_figures`.
  - The heading uses the key `observed_heading` ("Observed enquiries"), never "estimate".
- Extract presentational pieces (`AnalyticsStateNotice`, `ObservedFigures`, `StreamRow`, `EventChoice`) so they render without effects.

- [ ] **Step 1: Write failing render tests,** in both languages:
  - Each owner state renders its own copy.
  - `ObservedFigures` shows the three source rows and the total.
  - The value line is absent when either figure is null, and shows `HK$7,400` for 37 / `'800'` / `'0.25'` in `en`.
  - The withheld note appears only with `dataWithheld`.
  - An app stream never renders.
  - The `grant_analytics` href carries `scope=analytics`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests, the parity test, the orphaned-components test, the full `npm run test:unit`, typecheck and lint should all pass.
- [ ] **Step 5: Commit** `feat(analytics): brand panel with picker and observed enquiries in both languages`.

---

### Task 17: Observed card beside the scenario, connection access in Settings, separation rule

**Files:**
- Create: `components/integrations/ObservedEnquiriesCard.tsx`, `__tests__/security/outcome-layer-separation.test.ts`
- Modify:
  - `app/[lang]/dashboard/[clientId]/page.tsx`: on the `roi` step, render the card **beside** `LocalTrustStep` when the flag is on, the plan grants it and a binding exists; load it with `loadAnalyticsBinding` and `loadAnalyticsPanel`.
  - `components/integrations/GoogleConnectionsPanel.tsx`: each connection lists "Search Console" / "Analytics" from its scopes.
  - both catalogues
- Test: append to `__tests__/components/analytics-bilingual.test.tsx` and `__tests__/components/search-console-bilingual.test.tsx` (the scope labels)

**Interfaces:**
- Consumes: `AnalyticsPanel` (10), `ObservedFigures` (16) and `ANALYTICS_SCOPE`/`hasScope` (2).
- Produces: `ObservedEnquiriesCard({ lang, panel }: { lang: string; panel: AnalyticsPanel })`, a thin wrapper around `ObservedFigures` with the "Observed" heading and a link to the assets page.
- The page composes both components. It must not pass analytics data into `LocalTrustStep`, whose props stay exactly as before.

- [ ] **Step 1: Write failing tests.**
  - **The separation test** walks every file under `lib/localTrust/` and asserts no import of `integrations/analytics`, then walks every file under `lib/integrations/analytics/` and asserts no import of `localTrust`.
  - A test that `LocalTrustStep`'s prop keys are unchanged with GA4 bound.
  - Render tests for the card in both languages.
  - The Settings scope labels.
- [ ] **Step 2: Run them.** They should FAIL. The separation test may already pass, so prove it bites by adding a temporary cross-import, watching it fail, then removing the import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The tests, the full `npm run test:unit`, typecheck and lint should pass.
- [ ] **Step 5: Commit** `feat(analytics): observed enquiries beside the modelled scenario`.

---

### Task 18: Configuration, docs, full verification, PR

**Files:**
- Modify:
  - `.env.example`: add `FEATURE_ANALYTICS`, and note that `analytics.readonly` shares the Google OAuth client and verification.
  - `CLAUDE.md`: a Database bullet for `055` beside the Search Console one; the `CRON_SECRET` route list; the `0 9` fan-out list.
  - `docs/runbooks/deploy-cron-worker.md`: a row for `/api/cron/analytics`.
  - `docs/implementation/aiso-owner-platform/04-ACCEPTANCE-MATRIX.md`: in the AC-11 row, add "observed enquiries built behind a flag; PASS needs the pilot evidence in the GA4 spec §8". The status stays PARTIAL.

- [ ] **Step 1: Write the docs.** Every claim must match the code: status codes, outcomes, grants and schedules.
- [ ] **Step 2: Full verification.** Each must pass:
```bash
npm run typecheck
npm run lint
npm run test:unit
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration 2>&1 | grep -v "postgresql://"
node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"
```
  and `npm test` in `cloudflare/cron-worker`. Expected: typecheck and lint clean, unit green, integration green, the wrapper `11/11 suites`, and the worker green.
- [ ] **Step 3: Commit** `docs(analytics): environment, rules, runbook and AC-11 status`.
- [ ] **Step 4: Push and open the PR only after the user approves.** The PR body must state:
  - dark by default;
  - `055` not applied anywhere;
  - it depends on PR #65 and is rebased onto `main` after #65 merges;
  - the worker redeploy is a separate step;
  - one Google verification covers both scopes;
  - `include_granted_scopes` is now `true` for Search Console consent too;
  - AC-11 stays PARTIAL until the pilot.

  End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
