# Search Console connector — design

**Phase 2, sub-project 1 of 6.** Date: 2026-09-24. Status: approved in conversation, pending written review.

## 1. Where this sits

The product roadmap (`docs/product/geo-aeo-seo-roadmap.md` §6) defines **Phase 2 — Outcome
integrations**: connect Search Console, Bing/IndexNow, analytics and optional crawler logs;
attribute improvements to pages, queries and conversions; add regression alerts. The
owner-platform plan (`docs/implementation/aiso-owner-platform/01-DELIVERY-PLAN.md` §6) kept
"GSC and GA4 connectors" out of its Phase 1, which is now complete.

Phase 2 is six independent sub-projects, each with its own spec → plan → build cycle:

1. **Google connection + Search Console** ← this document
2. Analytics (GA4) conversions, on the same Google connection
3. Attribution: measured metrics against registered pages and delivered work items
4. Regression alerts tied to deployments and score changes
5. Bing Webmaster / IndexNow — IndexNow *pushes* URLs, which would be the product's first
   external **write**, contrary to the owner-platform plan's "no external write connector".
   Needs its own decision before design.
6. Crawler logs (optional in the roadmap)

**What this sub-project does not do for AC-11.** Search Console measures the *search* layer
(impressions, clicks, position). AC-11 is PARTIAL because the *business* layer — the Local
Trust enquiry figure — is modelled, not observed. Sub-project 2 (conversions) is what can
change that. This one supplies the foundation and a measured search layer, kept separate
from both the technical score and any business figure.

**Out of scope here:** GA4, attribution to work items, regression alerts, Bing/IndexNow,
whole-property page × query data, and backfill beyond 90 days.

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Build approach | In-repo, direct REST over `fetch` | Matches the codebase (no SDKs, injected fetchers, one scheduler, tenancy in SQL). The `googleapis` SDK is a very large serverless dependency and hides the HTTP detail needed to tell *revoked* from *Google is down*. n8n would put customer tokens outside the product's tenancy rules. |
| Ownership | A connection (one Google login) belongs to the **account**, which may hold several; each **brand** binds one property from any of them | Covers both agency patterns: one agency login with access to many properties, or one login per client. |
| Token protection | App-level **AES-256-GCM**, dedicated key, key id stored per row | A database leak or stray `select *` alone yields no usable token. No new infrastructure. The key never reaches SQL, unlike pgcrypto. |
| Data stored | Property totals + each **registered page** (migration `050`) + top queries per registered page | Small, joins directly onto what attribution will use, and stores query text only for pages the owner chose. |
| Binding rule | Property must **cover the brand's domain**, with **verified** access | A brand can never show another site's search data under its name. |
| Entitlement | **Pro and Enterprise**, via a new plan-catalogue feature | Matches the roadmap's packaging; fails closed through `resolveCommercialEntitlement`. |

## 3. Architecture

### 3.1 Modules

All under `lib/integrations/`. Each has one job and is testable on its own.

| Module | Responsibility | Depends on |
|---|---|---|
| `google/vault.ts` | Encrypt/decrypt a token with AES-256-GCM. Output carries a key id. Refuses at load if the key is missing or not 32 bytes. | `node:crypto`, `GOOGLE_TOKEN_ENCRYPTION_KEY` |
| `google/consent-state.ts` | Sign and verify the consent cookie (profile, account, PKCE verifier, state, return path, expiry). Domain-separated HMAC, the same shape as `lib/security/scan-claim-intent.ts`. | `shareSigningSecret` |
| `google/oauth.ts` | Build the consent URL, exchange a code, refresh an access token, revoke. Injected `fetch`. | Google OAuth endpoints |
| `search-console/client.ts` | `listSites()` and `querySearchAnalytics()`. Injected `fetch`. Returns **typed** failures: `revoked`, `forbidden`, `quota`, `unavailable`. | `oauth.ts` |
| `search-console/binding.ts` | Pure: does a property cover a domain, with verified access? | — |
| `search-console/state.ts` | Pure: derive what the owner sees from the newest ledger row + connection status (§5). | — |
| `search-console/store.ts` | All SQL. Tenancy inside every statement. Named `returning` columns, never `returning *` on a join. | `db()` |
| `search-console/sync.ts` | Sync one binding: refresh, fetch, upsert, write the ledger row. | client, store, vault |
| `search-console/guard.ts` | auth → entitlement → ownership, in that order, in one place — copying `lib/localTrust/guard.ts`. | `getProfile`, tier |

### 3.2 Migration `054_search_console.sql`

Tenancy by composite foreign key throughout, per `041`–`046`. RLS is not used (see `036`);
every query filters by account explicitly.

- **`google_connections`** — `id`, `account_id`, `google_subject`, `google_email`,
  `scopes text[]`, `token_ciphertext bytea` (nullable: null once revoked), `token_key_id`,
  `status` ∈ `active` / `needs_reconnect` / `revoked`, `connected_by` (provenance: composite
  FK `(connected_by, account_id)` → `profiles(id, account_id)` with the **column-list** form
  `on delete set null (connected_by)` — erasable, like `created_by`. The plain form would
  also null `account_id`, which is `NOT NULL`: the `044`/`046` class of trap. `053` already
  uses the column-list form),
  timestamps. **Unique `(account_id, google_subject)`**: reconnecting the same login updates
  the row rather than duplicating it. Unique `(id, account_id)` for composite FKs.
- **`search_console_bindings`** — primary key `(account_id, client_id)`: one property per
  brand. `connection_id` (composite FK with `account_id` → `google_connections`),
  `site_url`, `permission_level`, `bound_domain` (the brand's domain **at bind time**),
  `backfill_pending boolean`, `bound_by` (same column-list `on delete set null (bound_by)`
  as `connected_by`), `bound_at`. Composite FK `(client_id, account_id)` → `clients`.
- **`search_console_daily`** — `account_id`, `client_id`, `date`, `scope` ∈ `property` /
  `page`, `page_url` (null for `property`), `clicks`, `impressions`, `ctr`, `position`,
  `synced_at`. A CHECK ties `scope = 'property'` to `page_url is null`.
  **`unique nulls not distinct (account_id, client_id, scope, page_url, date)`** (PostgreSQL 15+; this
  project runs 16) so re-syncing a day overwrites rather than double-counting — the defect
  `pulse_metrics` has (CLAUDE.md) — and so the constraint can be the `on conflict` arbiter
  directly. A plain unique would treat every property row's null `page_url` as distinct.
- **`search_console_page_queries`** — `account_id`, `client_id`, `page_url`, `date`, `query`,
  `clicks`, `impressions`, `ctr`, `position`. Unique `(account_id, client_id, page_url, date, query)`.
  (Both upsert keys lead with `account_id` — changed after the database review.)
- **`search_console_sync_runs`** — the ledger: `account_id`, `client_id`, `ran_at`,
  `outcome` (closed vocabulary, CHECK-constrained, §5), `rows_written`, `data_through date`.
- **Grants:** `aeo_app` gets SELECT/INSERT/UPDATE with **no DELETE** on `search_console_daily`;
  SELECT/INSERT only on the insert-only ledger `search_console_sync_runs`; and DELETE on
  `search_console_page_queries` alone, because each sync replaces a re-fetched query window.
  Disconnecting removes the credential, not the history.

### 3.3 Routes

| Route | Method | Gate |
|---|---|---|
| `/api/integrations/google/start` | GET | session + entitlement |
| `/api/integrations/google/callback` | GET | consent cookie must match the session's profile **and** account |
| `/api/account/integrations/google` | GET (list), DELETE (revoke) | session; **no** account parameter — the account is the session's, like `/api/account/*` |
| `/api/dashboard/clients/[clientId]/search-console` | GET (state + eligible properties), PUT (bind), DELETE (unbind) | `search-console/guard.ts` |
| `/api/cron/search-console` | GET | `Authorization: Bearer $CRON_SECRET`, as the existing crons |

`vercel.json` gets a literal `functions` entry for the cron route (`maxDuration: 60`) —
keys are literal paths, not prefixes, so nothing is inherited.

## 4. Data flow

### 4.1 Connect

1. `start`: check session and entitlement; mint a PKCE verifier and random state; set the
   consent cookie (10-minute expiry, HttpOnly, Secure, `SameSite=Lax` — required for Google's
   redirect back); redirect to Google requesting `https://www.googleapis.com/auth/webmasters.readonly`,
   `openid` and `email`, with `access_type=offline` and `prompt=consent` so a refresh token
   is always issued.
2. `callback`: refuse unless `state` matches the cookie **and** the signed-in profile and
   account are the ones that started the flow — otherwise one person could complete another's
   consent. Exchange the code. **Refuse** if no refresh token is returned, or if the granted
   scopes omit Search Console (Google's granular consent lets owners untick it); storing a
   connection that can never sync is worse than saying why. Otherwise encrypt and upsert the
   connection, and redirect to the return path.

### 4.2 Bind

On the brand's registered-pages screen: list properties live from each of the account's
active connections; mark each eligible or ineligible with the reason (`binding.ts`); bind in
one statement with tenancy inside it, setting `backfill_pending`. Binding performs no sync;
the screen states that first data arrives within a day.

**Binding rule** (`binding.ts`), for a brand domain `d`:
- `sc-domain:d` → eligible (a Domain property covers every host and scheme under `d`).
- URL-prefix `https://d/`, `http://d/`, `https://www.d/`, `http://www.d/` → eligible.
- Any other host → ineligible: *does not cover this brand's domain*.
- Permission `siteUnverifiedUser` → ineligible: *access not verified in Search Console*.
- A brand with no domain cannot bind at all.

A binding whose `bound_domain` no longer equals the brand's current domain is treated as
mismatched and is not synced — the behaviour of domain verification (`053`).

### 4.3 Sync

`GET /api/cron/search-console`, daily. **Scheduling constraint discovered while writing this
spec:** `cloudflare/cron-worker` maps each schedule to exactly one route, and its three
triggers are all in use (its own comment: the free tier allows three per Worker). Rather than
add a fourth trigger or a second Worker, the worker's `ROUTES` becomes
`Record<string, string[]>` and the existing daily `0 9 * * *` schedule calls both
`/api/cron/trial-emails` and `/api/cron/search-console`. The two calls are **independent**
(`Promise.allSettled`); a failure in either is reported after both have run, so one can never
skip the other. `__tests__/config/function-durations.test.ts` and the worker's own test are
updated to pin the new shape.

Per run: select due bindings — active connection, entitled account, not mismatched,
least recently attempted first — and process as many as fit a wall-clock budget below the
60-second limit; the rest wait for the next run. No binding starts after 40 s, and each sync
checks a deadline of run start + 45 s before **every** Google call (including each
`startRow` page), recording `deferred` if it is reached. Per binding:

1. Refresh an access token. It lives in memory only and is never stored.
2. Window: **90 days** when `backfill_pending`, else **the last 7 days** (Google revises
   recent days; the unique keys make re-fetching an overwrite).
3. Fetch property totals by `date`.
4. For each registered page (capped at **20** per brand, oldest-registered first): page
   totals by `date`, then **one** request with dimensions `date` + `query` filtered to that
   page, keeping the top **25** queries **per date** (by clicks, then impressions) locally.
   Asking Google one day at a time would cost 90 requests per page on a backfill.
5. Upsert; clear `backfill_pending`; write one ledger row with `data_through`.

Totals always come from Google's own totals, **never** from summing query rows: Google drops
rare queries for privacy, so query rows do not add up to page totals.

### 4.4 Show

On the registered-pages screen, per page: 28-day clicks, impressions, CTR and average
position, and the property's totals, each with **"data up to ⟨date⟩"** — Google's data lags
2–3 days. Labelled as **search** outcomes, visually and in copy separate from the technical
score and from any business figure.

## 5. Failures and owner-visible state

Every state is derived (`state.ts`) from the newest ledger row plus the connection's status.
Nothing renders as zero or as a silent gap; in every non-`ok` state the stored history stays
visible with its last date.

| Ledger outcome | Cause | Owner sees | Effect |
|---|---|---|---|
| `ok` | Synced | Data up to ⟨date⟩ | — |
| `revoked` | `invalid_grant` on refresh, or a 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` from the API (the grant no longer carries the scope) | "Reconnect Google" | Connection → `needs_reconnect`; every brand on it stops syncing |
| `access_lost` | 403 for this property | "This login no longer has access to ⟨property⟩" | This brand only; the connection stays `active` |
| `google_unavailable` | 5xx or timeout | "Google didn't respond — retrying" | Retried next run; connection **not** flagged |
| `quota` | 429 | Same as above | Same as above |
| `domain_mismatch` | Brand domain changed after binding | "Rebind for the new domain" | Skipped |
| `not_entitled` | Account below Pro | "Syncing paused — plan" | Skipped; data kept |
| `vault_error` | Ciphertext cannot be decrypted (missing or unknown key id) | "Temporarily unavailable" — **not** "reconnect" | Error-level log. Our fault, so the owner is never asked to act. |
| `config_error` | Our Google client or Cloud project is wrong: token endpoint answers `invalid_client` / any 401, or the API is disabled for our project (`SERVICE_DISABLED`) | "Temporarily unavailable" — **not** "reconnect" | Error-level log; connection **not** flagged. Added after code review: a 401 from the token endpoint is a client-credential fault, so treating it as `revoked` would flip every connection after one bad deploy. Only `invalid_grant`, or the API's scope-insufficient 403, means revoked. |
| `deferred` | The run's per-sync deadline (cron start + 45 s) arrived before every Google call was made | Nothing new: "Data up to ⟨date⟩" if an earlier run succeeded, else "first data arrives within a day" | Added after the whole-branch review. Whole pages fetched so far are written; `backfill_pending` stays set; counts as due and not ok for the cron's 502 rule. The ledger row puts the brand behind never-attempted brands tomorrow. |

**Hard rules:**
- Missing or short `GOOGLE_TOKEN_ENCRYPTION_KEY` → connect and sync return 500 before doing
  anything, as `CRON_SECRET` does today. There is **no** plaintext fallback.
- The cron route never returns a 2xx over a failed write. It reports counts per outcome and
  returns **502** when bindings were due and none synced — `evaluate-alerts`'
  `evaluated === 0` rule.
- Tokens never appear in URLs or logs; `lib/security/redact-secrets.ts` gains Google token
  patterns (`ya29.`, `1//`).
- **Disconnect:** call Google's revoke endpoint best-effort, then null the ciphertext and set
  `revoked` **regardless** of Google's answer. If Google's revoke failed, the screen says so,
  so the owner can remove access in their Google account too.

## 6. Security and tenancy

- Gate order auth → entitlement → ownership in one module. A foreign brand or connection is
  **404**; a failed ownership *lookup* is **503**, so an outage never reads as "not yours".
- Composite FKs make it impossible, at the database, to bind one account's brand to another
  account's connection.
- The cron route is account-blind by design, like alert evaluation. It is declared in
  `__tests__/security/tenancy-inventory.test.ts` with its reason; the route-gate inventory
  covers every new handler automatically.
- **External dependency with lead time.** `webmasters.readonly` is a Google **sensitive**
  scope. Until Google verifies the OAuth app, its consent screen shows an "unverified app"
  warning and the app is capped at **100 users**. Verification is a manual Google review
  (privacy policy, domain ownership, demo video) that can take weeks. It does not block
  building or a pilot, but it gates a real launch, so it should start in parallel. The Google
  Cloud project also needs one registered redirect URI per environment (production, preview,
  local).

## 7. Testing

**No real Google in any test.** Every Google-facing module takes an injected `fetch`, as the
scan checks take `PublicUrlFetch`. Tests use a fake Google returning recorded response shapes,
including `invalid_grant`, 403, 429, 5xx, a token response without a refresh token, and granted
scopes missing Search Console.

- **Unit:** vault (round-trip; tampered ciphertext fails rather than returning garbage; unknown
  key id is a distinct error; short key refuses at load); binding rule (Domain vs URL-prefix,
  `www.`, trailing slash, `siteUnverifiedUser`, domain change); client error mapping (each HTTP
  failure → exactly one outcome); state derivation (every row of §5); consent (state mismatch,
  profile mismatch, expired cookie, missing refresh token, missing scope).
- **Route:** every handler, including gate order and 404 vs 503.
- **Real Postgres, exact-target wrapper from day one** (a `C9F`-style approved-target suite,
  per `__tests__/integration/tenancy-target.ts`):
  - `054`'s constraints: composite FKs, unique keys, the closed outcome vocabulary,
    `aeo_app`'s grants including no DELETE on metric rows.
  - **Idempotency:** syncing the same 7 days twice leaves identical rows.
  - **Cross-account:** B cannot list, bind to, or revoke A's connection; B cannot bind A's
    property to its own brand; a sync writes each brand's metrics only to its own account.
  - A mutation check on each new suite.
- **Bilingual:** every new string in both catalogues (enforced by
  `message-catalogue-parity.test.ts`); every §5 state rendered in both locales at touch size.
- **Scheduling:** the worker test and `function-durations.test.ts` pin the daily schedule
  calling both routes, and that one failing does not skip the other.

## 8. Rollout

1. `FEATURE_SEARCH_CONSOLE` (in `lib/flags.ts`, default **off**). Checked **first**, before
   auth: off means every new route returns a plain 404 to everyone and the UI does not
   render, so nothing exists to an owner until it is switched on. The cron route also returns
   `200 {skipped: 'flag_off'}` rather than 502, so a switched-off feature never looks like an
   outage.
2. Apply `054` to the AISO development database; pilot on Fimmick's own properties with the
   flag on in development only.
3. Start Google's sensitive-scope verification in parallel (§6).
4. Production is a separate cutover decision, as migrations `050`–`053` were.

**New environment variables** (added to `.env.example` with what breaks without them):
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`
(32 bytes, base64), `FEATURE_SEARCH_CONSOLE`.
