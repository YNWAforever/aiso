# GA4 conversions — design

**Phase 2, sub-project 2 of 6.** Date: 2026-09-30. Status: approved in conversation, pending written review.
Builds on sub-project 1 (`2026-09-24-search-console-connector-design.md`, PR #65), which must merge first.

## 1. Where this sits

Phase 2 (`docs/product/geo-aeo-seo-roadmap.md` §6) connects outcome sources. Sub-project 1 shipped
the account-owned Google connection, the token vault, the consent flow, per-brand binding, the daily
cron and the sync ledger, with Search Console as the first product on it. This sub-project adds
**Google Analytics 4 key events**, which GA4 calls what used to be conversions, on that same connection.

**Why this one next: AC-11.** The acceptance matrix keeps AC-11 ("technical, search/AI and business
outcomes stay separate") at PARTIAL, and states the condition for PASS: *a business outcome is observed
rather than modelled*. Today the only business figure in the product is Local Trust's "enquiry value
scenario", which turns trust-score points into enquiries with two invented constants
(`POINTS_PER_ENQUIRY_LOW/HIGH` in `lib/localTrust/roi.ts`), honestly labelled as unmeasured. GA4 key
events are observed enquiries. This sub-project makes an observed business outcome possible. A pilot
with real data is what would make it PASS (§8).

**Out of scope:** per-page attribution (sub-project 3), regression alerts (sub-project 4), ecommerce
revenue, app (non-web) data streams, storing raw referrer hosts, backfill beyond 90 days, and any
calibration of the Local Trust model from observed data.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Relation to the modelled scenario | **Beside it.** The observed figure is its own block, labelled observed; the scenario is unchanged and still labelled a model | This is the separation AC-11 asks for. Replacing the scenario would hide the model rather than separate it. Calibrating the constants per brand from a few months of data is a regression on noise: the same invention, more confidently stated |
| What counts as an enquiry | **The owner picks** which of the property's key events mean an enquiry | Only the owner knows. "All key events" overcounts purchases, downloads and sign-ups; a fixed list we choose silently shows zero for differently-named events |
| Money | **The count is always shown; a value appears only from the owner's own lead value and close rate**, labelled as theirs | The count is measured and the assumptions are the owner's. An industry default would reintroduce an invention of ours, which is the defect AC-11 is about |
| Analytics access | **The same connection gains `analytics.readonly` only when an owner turns GA4 on** | One login and one token, and nobody is asked for Analytics access they did not want |
| Data scope | **Daily key-event counts per chosen event, split by source class:** `organic_search`, `ai_assistant`, `other` | "Are search and AI bringing enquiries?" is the question an AEO product exists to answer. Per-page data waits for attribution; GA4 can backfill it then |
| Binding rule | **A web data stream whose URL host covers the brand's domain**; every report is filtered to that stream | Preserves sub-project 1's headline rule, that a brand never shows another site's data, even when a property rolls up several sites |
| Build approach | **Sibling module `lib/integrations/analytics/` on a shared Google foundation**, direct REST, own migration, own cron route | Each product stays simple and independently testable; the reviewed Search Console code only has shared pieces extracted, with no behaviour change. A generic framework would couple both products to every future change for shapes that do not match (stream + events + sources versus site + pages) |
| Plans | Pro and Enterprise (new `analytics` plan feature) | Same as Search Console |

## 3. Architecture

### 3.1 Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `google/access.ts` *(extracted from `search-console/sync.ts`)* | Connection → fresh access token (vault open plus refresh), and the one rule for which token-endpoint failures flag a reconnect | `vault`, `oauth` |
| `google/scopes.ts` *(extracted)* | Scope constants, `hasScope(connection, scope)`, and the consent-URL builder taking a scope list | — |
| `analytics/client.ts` | Admin API: `accountSummaries` (properties), `properties/{id}/dataStreams`, `properties/{id}/keyEvents`. Data API: `properties/{id}:runReport`. Injected `fetch`, typed failures, and the deadline checked between pages | `google/access` |
| `analytics/binding.ts` | Stream eligibility: the stream's `defaultUri` host covers the brand's domain. Reuses `normalizeBrandDomain`; no www stripping on the stored host | `search-console/binding` (helper only) |
| `analytics/sources.ts` | Sorts a key event's attributed source into a source class, using a maintained AI-referrer host list | — |
| `analytics/store.ts` | All SQL; every statement names `account_id` | `db()` |
| `analytics/state.ts` | Owner state derived from the binding, the live checks and the ledger | — |
| `analytics/guard.ts` | flag → auth → entitlement → ownership, in that order | `lib/auth`, `lib/tier` |
| `analytics/sync.ts` | One binding's daily sync; always writes exactly one ledger row | all of the above |

**Change to sub-project 1's code:** only the extraction into `google/access.ts` and `google/scopes.ts`.
`search-console/sync.ts`, the consent routes and the cron call the extracted functions. Behaviour
does not change, and that is proven by the existing Search Console suites passing **unedited**.

**API versions.** GA4's Admin and Data APIs are published as `v1beta`, and that is what the
ecosystem uses in production. The exact metric and dimension names this design relies on, `keyEvents`
(and its per-event form, if supported), the key-event-attributed channel and source dimensions
(`defaultChannelGroup` is confirmed; the matching source dimension is not), and a stream dimension to
filter by, are **verified against Google's metadata endpoint in plan task 1**, with the responses
recorded as fixtures, before any code depends on them. If a stream filter dimension does not exist,
the plan must say how stream scoping is achieved instead, or stop and return to design. It must not
fall back to whole-property counts.

### 3.2 Migration `055`

Same tenancy rules as `054`: composite `(…, account_id)` FKs, upsert keys that lead with `account_id`,
and no RLS (036).

- **`analytics_bindings`**, unique `(account_id, client_id)`:
  - Columns: `connection_id` (composite FK `(connection_id, account_id)` → `google_connections`),
    `property_id`, `stream_id`, `stream_host` (raw, as Google reports it), `key_events text[]`,
    `events_chosen_at`, `bound_at`, `backfill_pending`. Composite FK `(client_id, account_id)` → `clients`.
  - CHECKs: `key_events` has 1–20 elements, each 1–40 characters (GA4's event-name limit);
    `stream_host` has a length cap.
  - Changing the chosen events updates `key_events` and `events_chosen_at` and sets `backfill_pending`.
    It does **not** move `bound_at`, because data for events that stay chosen remains valid.
  - Binding a different stream moves `bound_at`.
- **`analytics_daily`**, unique `(account_id, client_id, date, event_name, source_class)`:
  - Columns: `source_class` (CHECK ∈ `organic_search` / `ai_assistant` / `other`), `count bigint`
    (CHECK ≥ 0), `synced_at`.
  - Each sync **replaces the re-fetched window**: delete then insert in one transaction, as
    `search_console_page_queries` does. Otherwise a source that drops to zero keeps a stale count.
- **`analytics_sync_runs`**, the ledger:
  - Columns: `account_id`, `client_id`, the binding identity it synced (`connection_id`,
    `property_id`, `stream_id`), `ran_at` (default `clock_timestamp()`), `outcome`, `rows_written`,
    `data_through`, `data_withheld boolean` (§5, rule 3).
  - `outcome` is a CHECK over the closed vocabulary in §5, mirrored by `ANALYTICS_SYNC_OUTCOMES`.

**Grants to `aeo_app`:**

| Table | Grants | Note |
|---|---|---|
| `analytics_bindings` | SELECT, INSERT, UPDATE, DELETE | DELETE is for unbinding |
| `analytics_daily` | SELECT, INSERT, DELETE | Window replacement needs no UPDATE |
| `analytics_sync_runs` | SELECT, INSERT | Insert-only |

**Deliberate trade-off:** the *class* of source is stored, not the raw referrer host. The AI-referrer
list lives in code. When it changes, only the re-fetched 7-day window and future backfills are
reclassified; older history keeps the class it had.

### 3.3 Routes

| Route | Purpose | Gate |
|---|---|---|
| `GET /api/dashboard/clients/[clientId]/analytics` | Owner state and observed figures. With `?properties=1` it lists properties. With `?property=<id>` it lists that property's streams, each with an eligibility verdict, and its key events. Google is called only when asked | guard |
| `PUT` same | Bind `{connectionId, propertyId, streamId, keyEvents[]}`: server re-fetches and re-checks everything | guard |
| `DELETE` same | Unbind | guard |
| `GET /api/integrations/google/start?scope=analytics` | Existing consent flow, requesting both scopes | account guard |
| `GET /api/cron/analytics` | Daily sync, own 60 s budget | `CRON_SECRET` (Vercel Cron header shape) |

`vercel.json` gets `maxDuration: 60` for the cron route. `cloudflare/cron-worker` adds it as the third
route on `0 9 * * *`, run with `Promise.allSettled` so each route is independent.
`__tests__/config/function-durations.test.ts` and the worker's own test pin the new shape.

## 4. Flows

### 4.1 Granting Analytics access

- "Turn on GA4" on the brand panel checks the connection's recorded scopes. If `analytics.readonly`
  is missing, it starts `/api/integrations/google/start?scope=analytics`.
- The consent request names **both** scopes explicitly, with `include_granted_scopes=true`,
  `prompt=consent`, `access_type=offline` and `login_hint` set to the connection's email, so the new
  refresh token covers Search Console and Analytics.
- The callback keeps every existing check (PKCE, the signed consent cookie, session match). It upserts
  by Google subject as today, replacing the sealed token and recording the scopes Google
  **actually granted**.
- Google's granular consent lets people untick a scope. If Analytics was not granted, the owner returns
  with the new reason `analytics_not_granted`, added to `CONSENT_ERROR_REASONS` in both catalogues, and
  nothing else changes. Search Console access is never lost by this flow: a callback that would drop
  `webmasters.readonly` from a connection that had it keeps the old token and returns
  `search_console_not_granted` instead.

### 4.2 Binding

A two-step picker, so an agency with hundreds of properties never costs hundreds of calls:

1. **Property.** `?properties=1` → one `accountSummaries` call per connection that has the scope.
2. **Stream and events.** `?property=<id>` → one `dataStreams` call and one `keyEvents` call. Each web
   stream carries its eligibility verdict; app streams are not offered.
3. **Save.** `PUT` with `{connectionId, propertyId, streamId, keyEvents[]}`. The server re-fetches the
   stream and the key events from Google and re-checks the stream's eligibility, that every chosen
   name is a current key event, and that the connection belongs to the caller's account. It never
   trusts the client, the same rule as the Search Console bind. The binding is written with
   `backfill_pending`, inside one statement that also proves the connection's account.

### 4.3 Daily sync

Same run shape as Search Console: select due bindings (active connection, entitled account, least
recently attempted first), start none after 40 s, and give each sync a deadline of run start + 45 s,
checked before every Google call including each report page. Hitting the deadline records `deferred`.

Per binding:

1. **Token.** If `analytics.readonly` is not in the connection's granted scopes, record `scope_missing`.
2. **Stream.** Re-read it. A host that no longer covers the brand's domain gives `domain_mismatch`; a
   stream that is gone gives `access_lost`.
3. **Key events.** Re-read them. If none of the chosen events is still a key event, record
   `events_missing`. If some are, sync those.
4. **Report.** One `runReport`: date × event name × the key event's attributed source and channel,
   filtered to the bound stream and the chosen events. The window is 90 days while `backfill_pending`
   is set, otherwise the last 7 days, because GA4 revises recent days for up to about 72 hours.
5. **Classify.** A source host on the AI-referrer list is `ai_assistant`. This is checked **first**,
   because GA4 files AI referrals under "Referral". Otherwise the "Organic Search" channel is
   `organic_search`, and anything else is `other`. Rows are summed per date, event and class.
6. **Write.** Replace the window in one transaction, then write the ledger row (`ok`, rows written,
   data through, and whether GA4 withheld data).

That is four Google calls per brand per day, well inside GA4's per-property token quota.

## 5. Failures, owner states, hard rules

**Ledger outcomes:** Search Console's eleven (`ok`, `revoked`, `access_lost`, `google_unavailable`,
`quota`, `domain_mismatch`, `not_entitled`, `vault_error`, `config_error`, `internal_error`,
`deferred`) plus:

| Outcome | Cause | Owner sees |
|---|---|---|
| `scope_missing` | The connection lacks `analytics.readonly` | "Turn on GA4 for this Google login", with a button that runs §4.1 |
| `events_missing` | None of the chosen events is a key event any more | "Re-pick your enquiry events", with the picker |

**Classification:**

| Signal | Outcome | Connection flagged? |
|---|---|---|
| Token endpoint `400 invalid_grant` | `revoked` | **Yes**, for both products, because the token is dead |
| Token endpoint 401 / `invalid_client`, or API `SERVICE_DISABLED` | `config_error` | No |
| API 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | `scope_missing` | **No** (see the cross-product rule) |
| API 403 `PERMISSION_DENIED` | `access_lost` | No |
| API 429 / `RESOURCE_EXHAUSTED` | `quota` | No |
| 5xx, timeout, malformed body | `google_unavailable` | No |

**Cross-product rule:** an Analytics failure never changes the connection in a way that stops Search
Console. Only a dead token (`invalid_grant`) affects both. Search Console reads its own missing scope
as "reconnect"; Analytics reads its missing scope as `scope_missing`. A test pins this rule.

**Owner states:** `unbound`, `grant_analytics`, `awaiting_first_sync`, `synced`, `reconnect`,
`access_lost`, `retrying`, `rebind`, `repick_events`, `paused_plan`, `temporarily_unavailable`.

**Stale ledger rows**, as in Search Console:
- A row from before `bound_at` is ignored.
- A `scope_missing`, `revoked`, `not_entitled`, `domain_mismatch` or `deferred` row is ignored once
  the live checks contradict it.
- An `events_missing` row from before `events_chosen_at` is ignored.

The panel reads only `analytics_daily` rows with `event_name = any(key_events)` and
`synced_at >= bound_at`.

**Hard rules:**

1. **Money only from the owner's own figures.** The value line appears only when the owner has entered
   average lead value and close rate (the existing Local Trust profile fields). It is
   observed count × close rate × lead value, labelled "uses your lead value and close rate". It never
   uses a constant of ours and never reads the trust score.
2. **The modelled scenario is untouched,** code and copy alike. A test pins that `lib/localTrust` never
   imports `lib/integrations/analytics`, and vice versa. Pages compose the two; libraries do not.
   Analytics reads the two owner figures through its own account-scoped SQL.
3. **Honest about GA4's gaps.** When `runReport`'s response metadata says thresholding was applied or
   rows were pooled into "(other)", the ledger records `data_withheld = true`. The panel then says
   "GA4 withheld some small counts, so these figures may be low" rather than showing a clean-looking
   undercount.
4. **Disconnect** works as it does for Search Console: the credential goes, the history stays, and the
   brand reads `reconnect`.

## 6. Security and tenancy

- Every route gates flag → auth → entitlement → ownership. Ownership failure is 404; a failed
  ownership lookup is 503; a non-UUID id is 404 before any query.
- Every SQL statement names `account_id`. `loadDueAnalyticsBindings` is a deliberate cross-account read
  scoped by its join, declared in `ACCOUNT_BLIND_BY_DESIGN`. All three new tables go into the
  tenancy inventory's `TENANT_TABLES`.
- No token, vault key, Neon driver `error.message` or Google response body is logged or returned.
  Logs carry `name`, `code` and the outcome only.
- `analytics.readonly` is a Google **sensitive** scope. Sub-project 1's verification has not started,
  so one verification request should cover both scopes.

## 7. Testing

No real Google calls in any test.

- **Unit:**
  - the client (fixtures from plan task 1, including thresholding and "(other)" metadata, malformed
    bodies, pagination, and the deadline between pages);
  - `sources.ts`, including AI referrals filed under "Referral" and host-matching edge cases;
  - stream eligibility, including www and apex;
  - owner state, including every stale-row rule;
  - the sync, including window replacement, partially missing events and every outcome;
  - the guard;
  - every route, including the server-side re-check on bind and `?property=` only calling Google
    when asked;
  - the consent callback's `analytics_not_granted` and `search_console_not_granted` paths.
- **Rule tests:** Analytics failures never flag the connection except `invalid_grant`; `lib/localTrust`
  and `lib/integrations/analytics` never import each other; the value line never appears without both
  owner figures.
- **Extraction proof:** the existing Search Console suites pass unedited after `google/access.ts` and
  `google/scopes.ts` are extracted.
- **Real Postgres**, as an 11th exact-target suite: `055` applies after `054`; tenancy and composite
  FKs across two accounts; window replacement; the insert-only ledger; the chosen-events filter;
  `bound_at` and `events_chosen_at` scoping.
- **Inventories:** the migration static test, the baseline-guard table list, tenancy-inventory entries,
  function-durations and worker route pins, and bilingual render tests with catalogue parity.

## 8. Rollout and AC-11 evidence

- Dark behind `FEATURE_ANALYTICS=1`; the new `analytics` plan feature is Pro and Enterprise only.
- `055` is applied to no persistent database by this work. PR #65 merges first.
- The cron worker is redeployed for the third `0 9` route.
- One Google verification request covers `webmasters.readonly` and `analytics.readonly`.
- **AC-11 stays PARTIAL until a pilot shows real data.** The evidence required to mark it PASS: at
  least one pilot brand with a bound GA4 stream and chosen enquiry events, one or more `ok` sync runs
  with observed counts, and the Local Trust page showing the observed card beside the unchanged,
  still-labelled scenario. The matrix row is updated with that evidence, not with this code.
