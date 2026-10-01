# Attribution — design

**Phase 2, sub-project 3 of 6.** Date: 2026-10-01. Status: approved in conversation, pending written review.
Builds on sub-project 1 (`2026-09-24-search-console-connector-design.md`, PR #65) and sub-project 2
(`2026-09-30-ga4-conversions-design.md`, PR #66). Both must merge first; this branch stacks on #66.

## 1. Where this sits

Phase 2 (`docs/product/geo-aeo-seo-roadmap.md` §6) says: *"Attribute improvements to queries, pages,
citations, traffic and conversions."* Sub-projects 1 and 2 brought measured data into the product:
Search Console daily figures per property and per registered page (`search_console_daily`), and GA4
observed enquiries per day and source class (`analytics_daily`). Nothing reads either of them against
delivered work. The only before/after comparison in the product is the technical outcomes view
(`lib/outcomes/`, AC-10), which judges one scan check's pass/warn/fail at days 7/28/56 after
delivery and knows nothing about traffic.

**Purpose.** On each delivered work item, the owner sees **proof of work**: *"since this shipped on
12 Sep, this page's search clicks went from 140 to 210 (the 28 days after compared with the 28 days
before)"*. It is an **observed change**, never a claim of cause.

**What exists to build on.**
- A delivery is an append-only attestation (`work_item_delivery_events`, migration `043`) with an
  owner-declared `delivered_at`, made against an approved version. Withdrawing it is a second event.
- Registered pages are `client_assets` (migration `050`): `url` (normalised), `label`, per brand.
- Nothing links a work item to a page. Scan evidence is origin-only by design (`origin-only.v1`),
  and a delivery's `destination` is free text.

**Out of scope:** per-page enquiries (GA4 has no page dimension today; it would need a landing-page
dimension and a new table), statistical confidence or seasonality adjustment, stored snapshots,
agency/client roll-up reports, regression alerts (sub-project 4), and multi-source (`schemaVersion`
2) versions, which the technical outcomes view does not support either.

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| Who it is for | The brand owner, on the delivered work item | Proof of work is the use the owner asked for; reports and cross-brand learning need volume this product does not have yet |
| Linking work to pages | The owner picks what to measure **when attesting the delivery** | Frozen with `delivered_at` in the same append-only record, so it cannot drift afterwards; the existing withdraw-and-re-attest path is the correction path |
| What can be measured | Specific registered pages (1–20), the whole site, or nothing | "Whole site" uses property-level figures; "nothing" keeps today's flow |
| Metrics | Per page: Search Console clicks, impressions, CTR, position. Whole site: the same at property level **plus** GA4 enquiries (total and by source class) | GA4 has no page dimension; adding one doubles the scope and touches the GA4 connector still in review |
| Window | **28 days before vs 28 days after**, delivery day excluded from both | One fixed number per metric that stops changing once complete; rolling numbers move under the owner |
| Computation | **On read**, no stored snapshots, no new cron | The windows are fixed and Google re-fetches only the last 7 days, so a complete comparison reads the same every time |
| Wording | "Observed change", with a standing caption; never "caused by" or "result of" | No control group and no seasonality adjustment exist |
| Layers | Search figures and enquiry figures are separate fields, never combined | AC-11 keeps technical, search/AI and business outcomes apart |

## 3. Comparison rules

### 3.1 Dates and windows

- `D` is `delivered_at`'s calendar date in `Asia/Hong_Kong`.
- **Before** = `D−28 … D−1`. **After** = `D+1 … D+28`. Both are inclusive and 28 days long.
- **Ready on** = `D+31`: the after-window plus Google's ~3-day reporting lag.
- **Known limitation, stated in the UI caption's help text and the docs:** Search Console dates are
  Pacific Time and GA4 dates are the property's timezone, so a window edge may be up to one day off
  from the Hong Kong date. It is not corrected.

### 3.2 Figures

For each measured target (one registered page, or the whole site):

- **Search** (from `search_console_daily`; `scope='page'` with the page's URL, or `scope='property'`):
  - `clicks`, `impressions`: sums over the window.
  - `ctr` = total clicks ÷ total impressions (null when impressions is 0).
  - `position`: impression-weighted mean, `Σ(position × impressions) ÷ Σ impressions` — the rule
    `loadPanelData` already uses (null when impressions is 0).
- **Enquiries** (whole site only, and only when GA4 is enabled, entitled and bound): from
  `analytics_daily`, restricted to the binding's **currently chosen** key events and to rows
  `synced_at >= bound_at`; a total and the three source classes `organic_search`, `ai_assistant`,
  `other`.
- For each figure: `before`, `after`, `change` (after − before), and `changePct`
  (change ÷ before). When `before` is 0 and `after` is not, `changePct` is the marker `'new'`, never
  infinity. When both are 0 it is 0. CTR and position report their change in points
  (`change` only, `changePct` null).

A day with no stored row inside a **covered** range (§3.4) counts as zero. Search Console, like GA4,
omits days with no activity.

### 3.3 Statuses

Each target gets exactly one status, decided in this order:

1. `withdrawn` — the attestation has been withdrawn. No figures.
2. `not_supported` — the version is not `schemaVersion` 1. No figures.
3. `not_measured` — no measure rows were recorded for the attestation (deliveries attested before
   this feature, or "don't measure"). The UI says to re-record the delivery to measure it.
4. `unavailable` — with a `reason`:
   - `not_bound` — the brand has no Search Console binding;
   - `rebound` — the binding's `bound_at` is after `D−28` (a rebind since before-window start would
     mix two properties' data, and `synced_at >= bound_at` hides the older rows anyway);
   - `sync_failing` — the binding's latest run is not `ok` and its last good run does not reach `D+28`
     (the existing Search Console owner-state reason is reused for the copy).
5. `not_ready` — today (Hong Kong) is before `D+31`, **or** the last good Search Console run's
   `data_through` is before `D+28`. Carries `readyOn`.
6. `insufficient_history` — the stored coverage (§3.4) for the target starts after `D−28`. Carries
   `missingFrom` and `missingTo` (the uncovered part of the before-window). Never a partial comparison.
7. `comparable` — the figures in §3.2.

Enquiries have their own sub-status inside a `comparable` or `not_ready` whole-site target, using
the same vocabulary (`unavailable` with `not_enabled` / `not_bound` / `rebound` / `sync_failing`,
`not_ready`, `insufficient_history`, `comparable`), so a GA4 problem never hides the search figures.
GA4's coverage start is the analytics binding's first good backfill after `max(bound_at,
events_chosen_at)`; a re-pick of events starts a fresh 90-day backfill.

### 3.4 Search Console coverage (a gap in sub-project 1 this fixes)

Today the Search Console sync fetches 90 days only while the binding's `backfill_pending` is set, at
the first sync after binding. A page registered later only ever gets the routine 7-day window, so its
before-window would never fill, and with zero-activity days omitted there is no way to tell "zero"
from "never fetched".

Fix:
- Migration `056` adds `search_console_coverage` (`account_id`, `client_id`, `scope` in
  `('property','page')`, `page_url` null iff property, `covered_from date`, `covered_at`), unique per
  `(account_id, client_id, scope, page_url)` with nulls not distinct, composite FK to `clients`.
- After a page's (or the property's) fetch succeeds, the sync upserts `covered_from =
  least(existing, window start)` for that target, in the same transaction as the daily rows for it.
- A page with no coverage row is fetched with the 90-day backfill window; covered pages keep the
  7-day window. The property gets a coverage row from its first successful backfill.
- Rebinding deletes the brand's coverage rows in the same statement that resets the binding, so
  coverage never outlives the data it describes.
- Effect: registering a page on its delivery day is enough — its first sync fetches the 90 days
  before it, which covers `D−28`.

## 4. Data model — migration `056`

### 4.1 `work_item_delivery_measures`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `account_id`, `client_id`, `work_item_id`, `version_id`, `content_hash`, `attestation_id` | composite FK to `work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, id, kind)`, `on delete restrict` |
| `attestation_kind` | `text not null default 'attest' check (attestation_kind = 'attest')` — the FK's last column, so a measure can only point at an attest event, never a withdraw |
| `scope` | `'site'` or `'page'` |
| `asset_id` | null iff `scope = 'site'`; composite FK `(account_id, client_id, asset_id)` → `client_assets (account_id, client_id, id)`, `on delete restrict` |
| `recorded_at` | `clock_timestamp()` |

- `unique (account_id, attestation_id, asset_id)` with nulls not distinct: one site row, or each
  page once.
- A constraint trigger (deferred to commit) enforces **either exactly one `site` row or 1–20 `page`
  rows per attestation**; the route validates the same rule first, so the trigger is a backstop.
- Insert-only: `aeo_app` gets `select, insert`; no update, no delete. RLS is not enabled (the
  convention since `036`); every query filters by `account_id`.

### 4.2 `search_console_coverage`

As §3.4. `aeo_app` gets `select, insert, update, delete` (delete for the rebind reset).

`056` states plainly in its header that it is applied to no persistent database, like `054`/`055`.

## 5. Architecture

### 5.1 Modules — `lib/attribution/`

- `windows.ts` (pure): `deliveryDay(deliveredAt)`, `windowsFor(D)`, `readyOn(D)`.
- `compare.ts` (pure): `compareTarget(input) → TargetResult`, taking the daily rows for the target,
  its coverage, the binding's `bound_at`, last good `data_through` and latest outcome, and today. All
  of §3.2–§3.3 lives here; no I/O.
- `store.ts`: its own SQL; every statement names `account_id`; no `returning *` on a join. Reads the
  attestation state and measure rows, the measured assets, `search_console_daily` for the targets over
  `D−28 … D+28` only, `search_console_coverage`, the Search Console binding and its last good run,
  and — for whole-site targets with GA4 enabled — `analytics_daily` totals and the analytics binding.
  It imports no other store, so the connectors' stores can change without breaking it.
- `guard.ts`: auth → entitlement → ownership, in that order, the shape of `lib/localTrust/guard.ts`.
  Ownership is "this version belongs to the session's `profile.account_id`". A malformed id is 404
  before any query; not-found is 404; a failed lookup is 503.

Separation: `lib/attribution` never imports `lib/localTrust` (added to
`__tests__/security/outcome-layer-separation.test.ts`), and search and enquiry figures stay separate
fields.

### 5.2 Route

`GET /api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/attribution`, beside
`.../outcomes`. Returns:

```
{ deliveredOn: 'YYYY-MM-DD' | null,
  windows: { before: {from, to}, after: {from, to} } | null,
  readyOn: 'YYYY-MM-DD' | null,
  targets: Array<{
    scope: 'site' | 'page',
    asset?: { id, url, label },
    status, reason?, readyOn?, missingFrom?, missingTo?,
    search?: { clicks, impressions, ctr, position },          // each {before, after, change, changePct}
    enquiries?: { status, reason?, total, organic_search, ai_assistant, other }
  }> }
```

A version with no active attestation returns `targets: []` with `deliveredOn: null`.

### 5.3 Write path

- `POST .../versions/[versionId]/delivery` accepts an optional
  `measure: { scope: 'site' } | { scope: 'page', assetIds: string[] }`.
- `attestDelivery` (`lib/delivery/store.ts`) inserts the attestation and its measure rows in **one
  transaction**; the asset ids are checked as this brand's registered pages inside the insert
  (`… from client_assets where account_id = … and client_id = … and id = any(…)`), and a count
  mismatch aborts the transaction. 2xx only after both writes commit.
- Validation before any write: 400 for a bad shape (unknown scope, duplicates, more than 20 pages,
  a non-UUID id, `assetIds` with `site`); 422 `{ error: 'INELIGIBLE', reason: 'unknown_page' }` for
  an id that is not one of this brand's registered pages.

### 5.4 Gating

- The feature is on only when `FEATURE_ATTRIBUTION === '1'` **and** Search Console is enabled
  (`FEATURE_SEARCH_CONSOLE === '1'`), via one helper `isAttributionEnabled()` in `lib/flags.ts`, and
  the account's `resolveCommercialEntitlement(...).features.search_console` is true (Pro and
  Enterprise). No new plan feature.
- Enquiry figures additionally need `isAnalyticsEnabled()` and `features.analytics`.
- With the feature off: the attest route **ignores** `measure` (it does not fail, so a stale client
  cannot break delivery), the attribution route answers 404, and the delivery form and version page
  render exactly as today.

## 6. UI

Copy in a new `attribution` namespace in `messages/en.json` and `messages/zh-HK.json` (Traditional
Chinese), identical keys; components pick copy by a `lang` prop; no apostrophes in strings that tests
assert with `toContain`.

- **`DeliveryForm`** gains "What should we measure?" with three choices — *Specific pages*
  (checkboxes over the brand's registered pages, label + URL, max 20), *Whole site*, *Don't
  measure* (default). With no registered pages, *Specific pages* is disabled and links to the assets
  page.
- **`MeasuredChangeBlock`** renders on the version page beside `OutcomeWorkspace` as its own block
  headed "Measured change". One row per target: page label and URL, or "Whole site"; the status copy
  (`ready on <date>`, the missing days, the unavailable reason, re-record to measure); for a
  `comparable` target a small before/after table (clicks, impressions, CTR, position; enquiries by
  source for whole site). A standing caption on every comparable row: *"Observed change in the 28
  days after delivery compared with the 28 days before. Other changes and seasonality also affect
  these figures."* The block never says "caused by" or "result of".
- Presentational pieces (`TargetRow`, `FigureTable`, `TargetStatusNotice`) have no effects, so they
  render-test without mocks.
- A failed attribution fetch shows "Measured change is temporarily unavailable"; the technical
  outcomes block beside it is unaffected.

## 7. Failures, security and tenancy

- Every failed DB read answers 503 and logs `error.name` only — never the Neon driver's message.
- Ownership failure is 404; a failed ownership lookup is 503, so an incident never reads as "not
  yours".
- Every new statement names `account_id`; new statements join the tenancy inventory
  (`__tests__/security/tenancy-inventory.test.ts`).
- The attestation and its measures are one transaction; the coverage upsert and its daily rows are
  one transaction.
- Measures can only name the brand's own registered pages: the composite FK makes another brand's or
  account's page impossible at the database level, and the route checks it first.

## 8. Testing

- **Unit, pure:** `windows.ts` (Hong Kong midnight edges, both bounds, `readyOn`); `compare.ts`
  (every status in §3.3 in order, zero-filled covered days, `insufficient_history` with the missing
  range, `before = 0` → `'new'`, both zero → 0, impression-weighted position, CTR/position change in
  points, enquiries only for site targets, a GA4 failure leaving search figures intact).
- **Routes:** each gate in order; 404 vs 503; no driver text in any body or log; attest with and
  without `measure`, with the flag off (`measure` ignored), with a foreign asset id (422), and 2xx
  only after both writes.
- **Search Console sync:** an uncovered page gets the 90-day window and a covered one the 7-day
  window; coverage is written only after that target's fetch succeeds; a deferred page writes no
  coverage; rebinding clears coverage.
- **Real Postgres** (a new exact-target suite, `vitest.attribution-integration.config.ts`): `056`
  applies after `055`; composite FKs reject another account's attestation or page (`23503`); the
  site-or-1–20-pages trigger; `aeo_app` cannot UPDATE or DELETE measures (`42501`); a failed attest
  leaves no rows; the store excludes other accounts and pre-rebind rows; `covered_from` only moves
  earlier.
- **Static:** the separation-test rule, catalogue parity (`attribution` in alphabetical position),
  and the orphaned-components inventory.

## 9. Rollout and acceptance

- Dark by default behind `FEATURE_ATTRIBUTION`, which needs `FEATURE_SEARCH_CONSOLE` too.
- `056` is applied to no persistent database until the `054`/`055` cutover decision.
- No cron change: attribution reads the data the existing Search Console and GA4 syncs already
  write; the coverage change rides the existing Search Console sync.
- **Acceptance matrix:** there is no attribution row today. Add **AC-16, "a delivered work item shows
  its observed search change, separated from technical outcomes and labelled observed"**, at PARTIAL
  until a pilot brand has a delivered item with a `comparable` target on real data. AC-10 and AC-11
  are unchanged by this sub-project, and AC-13's stale "no external provider connector exists" line
  is corrected while the matrix is open.
