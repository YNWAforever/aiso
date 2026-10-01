# Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each delivered work item, show the owner the observed change in Search Console figures (per chosen registered page, or the whole site plus GA4 enquiries) over the 28 days after delivery against the 28 days before, labelled observed, never causal.

**Architecture:** The owner picks what to measure when attesting a delivery; the choice is frozen in a new insert-only table written in the attestation's own statement. A pure `lib/attribution/` comparison runs on read over the existing daily tables, made exact by coverage records that both connector syncs now keep gap-free. A new GET route feeds a "Measured change" block beside the technical outcomes.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Neon (`@neondatabase/serverless`, tagged templates), Vitest 4, React 19 client components with `next-intl` `useTranslations` (matching the neighbouring delivery and outcomes components).

**Spec:** `docs/superpowers/specs/2026-10-01-attribution-design.md`, building on `2026-09-24-search-console-connector-design.md` and `2026-09-30-ga4-conversions-design.md`.

## Global Constraints

- Branch `claude/phase2-attribution`, stacked on `claude/phase2-analytics` (PR #66, itself on #65). Rebase onto `main` once both merge; never merge into their branches.
- **Windows:** `D` = `delivered_at`'s calendar date in `Asia/Hong_Kong`. Before = `D−28 … D−1`, after = `D+1 … D+28`, inclusive. `readyOn = D+31`. `WINDOW_DAYS = 28`, `LAG_DAYS = 3`.
- **Measures:** scope `'site'` (exactly one row) or `'page'` (1–20 rows, `MEASURE_PAGES_MAX = 20`), or no rows ("don't measure").
- **Statuses, in this order:** `withdrawn`, `not_supported`, `not_measured`, `unavailable` (reasons `not_bound`, `rebound`, `sync_failing`), `not_ready`, `insufficient_history`, `comparable`. Enquiry sub-status reasons add `not_enabled`.
- **Figures:** clicks and impressions are sums; `ctr` = Σclicks ÷ Σimpressions; `position` = Σ(position × impressions) ÷ Σimpressions; both null at zero impressions. `changePct` is `'new'` when before = 0 and after ≠ 0, `0` when both are 0, null for `ctr`/`position` (their `change` is in points).
- **Source classes:** exactly `organic_search`, `ai_assistant`, `other`.
- **Gating:** `isAttributionEnabled()` = `FEATURE_ATTRIBUTION === '1'` **and** `FEATURE_SEARCH_CONSOLE === '1'`, plus `resolveCommercialEntitlement(profile.accounts).features.search_console`. Enquiries also need `isAnalyticsEnabled()` and `features.analytics`. Never `getPlanFeatures`.
- **Tenancy:** every SQL statement names `account_id`; composite `(…, account_id)` FKs; never `returning *` on a joined statement. New statements join `__tests__/security/tenancy-inventory.test.ts`.
- **Logging:** never log `error.message` from the Neon driver or any Google body — `name`, `code` and outcome only.
- **Copy:** a new `attribution` namespace in `messages/en.json` and `messages/zh-HK.json` (Traditional Chinese), identical keys. Never "caused by" / "result of". The standing caption is exactly: *"Observed change in the 28 days after delivery compared with the 28 days before. Other changes and seasonality also affect these figures."* No apostrophes in strings tests assert with `toContain`.
- **Separation:** `lib/attribution/**` never imports `lib/localTrust/**`; search and enquiry figures are separate fields.
- **Writes:** a 2xx means the write happened; DB failures are 503.
- **Commits:** end with the `Co-Authored-By` trailer naming the model that wrote them. Run the full `npm run test:unit` before reporting any task done.

### Rulings this plan makes on the spec (approved by the user with the plan)

1. **Gap-free stored history.** Both syncs widen their routine window back to the binding's last `ok` run (capped at 90 days), so a run of failed days leaves no hole; coverage is then one contiguous range starting at `covered_from`. Without this, a week of failed syncs inside a window would read as real zeros.
2. **Readiness by run date, not `data_through`.** A source is ready when it has an `ok` run (since its `bound_at`) whose `ran_at` Hong Kong date is ≥ `D+31`. Search Console's `data_through` is the newest date *with rows*, so a quiet property would never read ready; with ruling 1, an ok run on `D+31` proves the after-window was fetched.
3. **GA4 coverage lives on `analytics_bindings.covered_from`** (added in `056`): set when a backfill clears, reset to null on rebind or event re-pick — rather than inferring it from the ledger.
4. **Copy via `useTranslations('attribution')`**, matching `DeliveryForm` and `OutcomeWorkspace`; presentational pieces take a `t` function so they render-test without a provider.

## Review Focus

1. **Hong Kong date edges.** A delivery at `2026-09-11T16:30:00Z` is `D = 2026-09-12` (HKT 00:30). An off-by-one here shifts both windows. Tested in Task 4.
2. **Zero-activity days.** A covered page with rows on only 3 days in the after-window must compare with the other 25 days as zeros, not as "insufficient". Tested in Task 4.
3. **A page registered after the binding's backfill** must get a 90-day first fetch, so registering on delivery day still covers `D−28`. Tested in Task 2.
4. **Withdraw then re-attest** must measure only the new attestation's choice; the withdrawn one's rows never surface. Tested in Tasks 6 and 7.
5. **A replayed attest request** (same `requestId`) with a *different* `measure` must be `conflict`, never a silent second set of rows. Tested in Task 5.

---

### Task 1: Flag and migration `056`

**Files:**
- Modify: `lib/flags.ts` (`FeatureFlag` gains `'attribution'`; add `isAttributionEnabled()`), `.env.example` (`FEATURE_ATTRIBUTION`)
- Create: `supabase/migrations/056_attribution.sql`
- Test: `__tests__/lib/flags.test.ts` (extend), `__tests__/migrations/attribution-migration.test.ts`

**Interfaces:**
- Produces: `isAttributionEnabled(): boolean`; tables `work_item_delivery_measures`, `search_console_coverage`; column `analytics_bindings.covered_from date null`.

**`056` contents (spec §4):**
- `work_item_delivery_measures`: `id uuid pk`, `account_id`, `client_id`, `work_item_id`, `version_id`, `content_hash`, `attestation_id`, `attestation_kind text not null default 'attest' check (attestation_kind = 'attest')`, `scope text check in ('site','page')`, `asset_id uuid null`, `recorded_at timestamptz default clock_timestamp()`. CHECK `(scope = 'site') = (asset_id is null)`. FK `(account_id, client_id, work_item_id, version_id, content_hash, attestation_id, attestation_kind)` → `work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, id, kind)` on delete restrict. FK `(account_id, client_id, asset_id)` → `client_assets (account_id, client_id, id)` on delete restrict. `unique nulls not distinct (account_id, attestation_id, asset_id)`. Index `(account_id, client_id, attestation_id)`.
- A `constraint trigger … deferrable initially deferred` per row, calling `work_item_delivery_measures_shape()`, which raises `check_violation` (`23514`) unless the attestation has exactly one `site` row and no `page` rows, or 1–20 `page` rows and no `site` row.
- `search_console_coverage`: `account_id`, `client_id`, `scope check in ('property','page')`, `page_url text null` (`(scope = 'property') = (page_url is null)`), `covered_from date not null`, `covered_at timestamptz default clock_timestamp()`; `unique nulls not distinct (account_id, client_id, scope, page_url)`; FK `(client_id, account_id)` → `clients (id, account_id)` on delete cascade.
- `alter table analytics_bindings add column covered_from date`.
- Grants: revoke all from public on both tables, then `aeo_app`: measures `select, insert`; coverage `select, insert, update, delete`. EXECUTE on the trigger function to `aeo_app`.
- Header states: applied to no persistent database, like `054`/`055`.

- [ ] **Step 1: Write failing tests.** Flags: `isAttributionEnabled()` false unless both `FEATURE_ATTRIBUTION` and `FEATURE_SEARCH_CONSOLE` are exactly `'1'` (cases: neither, each alone, both, `'true'`). Migration static test (copy the shape of `__tests__/migrations/analytics-migration.test.ts`): file exists after `055`; both tables and the column are created; the two composite FKs and `attestation_kind` check are present; the trigger is `deferrable initially deferred`; `aeo_app` gets no `update`/`delete` on measures; no `create policy`.
- [ ] **Step 2: Run** `npx vitest run __tests__/lib/flags.test.ts __tests__/migrations/attribution-migration.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the flag, `.env.example` block (needs `FEATURE_SEARCH_CONSOLE`; dark by default) and `056`.
- [ ] **Step 4: Verify** the two files pass, then `npm run test:unit` (the RLS-freeze and migration-order tests must still pass).
- [ ] **Step 5: Commit** `feat(attribution): flag and migration 056`.

---

### Task 2: Search Console coverage and gap-free windows

**Files:**
- Modify: `lib/integrations/search-console/store.ts`, `lib/integrations/search-console/sync.ts`, `app/api/cron/search-console/route.ts` (deps wiring only)
- Test: `__tests__/integrations/search-console-sync.test.ts` (or the existing SC sync test file — extend, do not fork), the SC store unit test

**Interfaces:**
- Produces:
  - `DueBinding` gains `lastOkDate: string | null` — the UTC date of the latest `ok` run for this binding with `ran_at >= bound_at` (one more select column in `loadDueBindings`).
  - `listSyncPages(accountId, clientId, cap): Promise<Array<{ url: string; coveredFrom: string | null }>>` (left join `search_console_coverage` on `scope='page'`).
  - `type CoverageMark = { scope: 'property' | 'page'; pageUrl: string | null; windowStart: string; contiguous: boolean }`.
  - `writeDaily(accountId, clientId, metrics, coverage: CoverageMark[]): Promise<number>` — daily upserts and coverage upserts in **one** `sql.transaction`. Coverage upsert: `contiguous` → `covered_from = least(existing, windowStart)`; not contiguous → `covered_from = windowStart`.
  - `bindProperty` and `unbindProperty` delete the brand's `search_console_coverage` rows in the same transaction (bind: only when the site URL changes, mirroring when it sets `backfill_pending = true`).
- Window rules in `attempt()`:
  - Property window start = `today − 89` when `backfillPending`, else `min(today − 6, lastOkDate)` bounded below by `today − 89`. `contiguous = !backfillPending && lastOkDate !== null && lastOkDate >= start`.
  - A page with `coveredFrom === null` uses `today − 89` and `contiguous = false`; a covered page uses the property's start and `contiguous`.
  - Coverage marks are written only for the property (when its fetch succeeded) and for `completedPages`.

- [ ] **Step 1: Write failing tests:**
  - uncovered page → its query's `startDate` is `today − 89` while a covered page in the same run gets `today − 6`;
  - `lastOkDate` 12 days ago → window starts there; 120 days ago → `today − 89`, `contiguous: false`;
  - coverage marks passed to `writeDaily` name only completed pages; a deferred page gets none;
  - `writeDaily`'s SQL runs daily and coverage writes inside one transaction (assert one `transaction` call);
  - binding to a different site URL deletes coverage; rebinding the same URL does not.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement.** Keep `QUERY_CAP`, `PAGE_CAP`, the deadline handling and the partial-write rule unchanged.
- [ ] **Step 4: Verify** the SC sync, SC store and SC cron tests and full `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(search-console): keep coverage and backfill newly registered pages`.

---

### Task 3: GA4 coverage and gap-free windows

**Files:**
- Modify: `lib/integrations/analytics/store.ts`, `lib/integrations/analytics/sync.ts`
- Test: the analytics sync and store unit tests (extend)

**Interfaces:**
- Produces: `DueAnalyticsBinding` gains `lastOkDate: string | null` (latest `ok` run with `ran_at >= bound_at`); `recordAnalyticsRun` input gains `windowStart: string` and, where it clears `backfill_pending`, sets `covered_from = windowStart` in the same statement; on an ok routine run it leaves `covered_from` alone. `bindStream` (when connection/property/stream change) and `updateKeyEvents` set `covered_from = null`. `AnalyticsBinding` gains `coveredFrom: string | null`.
- Window: backfill → `today − 89`; routine → `min(today − 6, lastOkDate)` bounded below by `today − 89`; if `lastOkDate` is null or older than `today − 89` on a routine run, the run uses the 90-day window and, when `ok`, sets `covered_from = windowStart` (the old range is no longer contiguous with the new one). A contiguous routine `ok` run leaves `covered_from` unchanged.

- [ ] **Step 1: Write failing tests:** routine window reaches back to `lastOkDate`; a 100-day gap behaves as a backfill and resets `covered_from`; clearing backfill writes `covered_from`; re-pick and rebind null it; the existing `eventsChosenAt` guard still blocks clearing after a mid-sync re-pick.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** analytics sync/store/cron tests and full `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(analytics): record coverage and close gaps after failed syncs`.

---

### Task 4: Pure windows and comparison

**Files:**
- Create: `lib/attribution/windows.ts`, `lib/attribution/compare.ts`, `lib/attribution/types.ts`
- Test: `__tests__/lib/attribution-windows.test.ts`, `__tests__/lib/attribution-compare.test.ts`

**Interfaces:**
- Produces:
  - `deliveryDay(deliveredAt: string): string` (YYYY-MM-DD, Asia/Hong_Kong); `windowsFor(day: string): { before: { from: string; to: string }; after: { from: string; to: string } }`; `readyOn(day: string): string`; `hkToday(now: Date): string`.
  - `type Figure = { before: number | null; after: number | null; change: number | null; changePct: number | 'new' | null }`.
  - `type SourceState = { boundAt: string | null; coveredFrom: string | null; okRunDates: string[]; latestOutcome: string | null }` (`okRunDates` are HK dates of ok runs since `boundAt`).
  - `type SearchDay = { date: string; clicks: number; impressions: number; position: number }`; `type EnquiryDay = { date: string; sourceClass: SourceClass; count: number }`.
  - `compareTarget(input: { day: string; today: string; withdrawn: boolean; schemaVersion: number; measured: boolean; scope: 'site' | 'page'; search: SourceState | null; searchDays: SearchDay[]; enquiries: { enabled: boolean; state: SourceState | null; days: EnquiryDay[] } | null }): TargetResult`.
  - `type TargetResult = { status: TargetStatus; reason?: string; readyOn?: string; missingFrom?: string; missingTo?: string; search?: { clicks: Figure; impressions: Figure; ctr: Figure; position: Figure }; enquiries?: EnquiryResult }`, with `EnquiryResult = { status: TargetStatus; reason?: string; total?: Figure; organic_search?: Figure; ai_assistant?: Figure; other?: Figure }`.
- Rules: spec §3.2–§3.3 exactly, plus rulings 1–2. `unavailable/rebound` when `boundAt` (HK date) > `D−28`; `unavailable/sync_failing` when `latestOutcome !== 'ok'` and no ok run date ≥ `D+31`; `not_ready` when `today < readyOn` or no ok run date ≥ `D+31`; `insufficient_history` when `coveredFrom` is null or > `D−28` (`missingFrom = D−28`, `missingTo = min(coveredFrom − 1, D−1)`).

- [ ] **Step 1: Write failing tests:**
  - `deliveryDay('2026-09-11T16:30:00Z') === '2026-09-12'`; `deliveryDay('2026-09-11T15:59:59Z') === '2026-09-11'`; `windowsFor('2026-09-12')` → before `2026-08-15…2026-09-11`, after `2026-09-13…2026-10-10`; `readyOn('2026-09-12') === '2026-10-13'`.
  - Each status in order, one test each, including that `withdrawn` beats everything and `not_measured` beats `unavailable`.
  - Zero-fill: rows on 3 after-days → sums over those only, status `comparable`.
  - `changePct`: 140 → 210 is `0.5`; 0 → 5 is `'new'`; 0 → 0 is `0`.
  - Position: days `(pos 2, imp 100)` and `(pos 10, imp 300)` → `8`; zero impressions → `ctr` and `position` null.
  - Site target with GA4 `enabled: false` → `enquiries.status 'unavailable', reason 'not_enabled'` and search figures still present; page target never has `enquiries`.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement** (no I/O, no `Date.now()` inside `compareTarget` — `today` is an input).
- [ ] **Step 4: Verify** both files and full `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(attribution): pure delivery windows and comparison`.

---

### Task 5: Recording measures at attest

**Files:**
- Modify: `lib/delivery/types.ts`, `lib/delivery/input.ts`, `lib/delivery/store.ts`, `lib/delivery/service.ts`
- Test: the delivery input, store and service unit tests (extend)

**Interfaces:**
- Produces: `type MeasureInput = { scope: 'site' } | { scope: 'page'; assetIds: string[] }`; `AttestInput` gains `measure?: MeasureInput`; `parseAttest` accepts an optional `measure` key and validates it (unknown scope, duplicate ids, 0 or > 20 ids, non-UUID id, `assetIds` with `site` → the existing `invalid()` → 400).
- `attestAuthenticatedDelivery` drops `measure` (does not fail) unless `isAttributionEnabled()` and the profile's `resolveCommercialEntitlement(profile.accounts).features.search_console`.
- `attestDelivery` adds data-modifying CTEs to its existing single statement: `assets AS MATERIALIZED (select id from client_assets where account_id = … and client_id = … and id = any(…))`, then `measured AS (INSERT INTO work_item_delivery_measures … SELECT … FROM inserted …)`. Its `CASE` gains, before `'created'`: `WHEN <page measure> AND (SELECT count(*) FROM assets) <> <n> THEN 'unknown_page'`, and the insert of the attestation itself is guarded by the same count, so nothing is written. `'unknown_page'` maps to a new `DeliveryResult` kind and to 422 `{ error: 'DELIVERY_VALIDATION_FAILED', reason: 'unknown_page' }`.
- **Replay:** the `replay` CTE also requires the stored measures to equal the request's (both absent, or same scope and same id set); otherwise the request is `conflict` (Review Focus 5).

- [ ] **Step 1: Write failing tests:** parse cases above (each → 400); flag off → `measure` silently dropped and the attest still 201; foreign asset id → 422 and no insert (assert the guarded statement); site and page measures reach the SQL parameters; replay with identical measure → 200 replayed; replay with a different measure → 409.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the delivery suites and full `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(attribution): record what to measure with the delivery attestation`.

---

### Task 6: Store, guard and route

**Files:**
- Create: `lib/attribution/store.ts`, `lib/attribution/guard.ts`, `lib/attribution/service.ts`, `app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/attribution/route.ts`
- Modify: `__tests__/security/outcome-layer-separation.test.ts` (add the `lib/attribution` ↛ `lib/localTrust` rule), `__tests__/security/tenancy-inventory.test.ts`
- Test: `__tests__/lib/attribution-store.test.ts`, `__tests__/api/attribution.test.ts`

**Interfaces:**
- Consumes: `compareTarget`, `deliveryDay`, `windowsFor`, `readyOn`, `hkToday` (Task 4).
- Produces:
  - `authorizeAttribution(clientId, itemId, versionId): Promise<{ ok: true; profile; accountId: string } | { ok: false; response: Response }>` — 404 when `isAttributionEnabled()` is false, 401 no session, 403 `{ error: 'UPGRADE_REQUIRED' }` without `search_console`, 404 malformed id or a version not in the session's account, 503 on lookup failure.
  - `loadAttributionInput(accountId, clientId, itemId, versionId)` reads: the version's `schemaVersion`; the latest attestation and whether it is withdrawn; its measure rows joined to `client_assets` (`id, url, label`); the SC binding's `bound_at`, coverage rows and ok-run dates since `bound_at`, latest outcome; `search_console_daily` for the measured targets over `D−28 … D+28` with `synced_at >= bound_at`; and, for a site measure when analytics is enabled and entitled, the analytics binding (`bound_at`, `events_chosen_at`, `covered_from`, `key_events`), ok-run dates, and `analytics_daily` over the windows for the chosen events with `synced_at >= greatest(bound_at, events_chosen_at)`.
  - `GET` returns the spec §5.2 shape; no active attestation → `{ deliveredOn: null, windows: null, readyOn: null, targets: [] }`.
- Every DB failure → 503, logged as `error.name` only.

- [ ] **Step 1: Write failing tests:** each gate in order with the right status; GET maps a `comparable` page target, a site target with enquiries, and a withdrawn attestation; withdraw-then-re-attest reads only the new attestation's measures (Review Focus 4); DB throw → 503 with no driver text in body or `console.error`; every store statement names `account_id`; the separation test fails with a temporary `lib/attribution → lib/localTrust` import (prove it bites, then remove).
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the new suites, the tenancy and separation tests, the route-gate inventory, full `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(attribution): measured-change route behind auth, plan and ownership`.

---

### Task 7: Real-Postgres suite

**Files:**
- Create: `__tests__/integration/attribution.test.ts`, `vitest.attribution-integration.config.ts` (copy `vitest.analytics-integration.config.ts`)
- Modify: `scripts/ci/run-exact-target-suites.mjs` (`EXACT_TARGET_CONFIGS`), `vitest.integration.config.ts` (exclude the file), `__tests__/ci/exact-target-suites.test.ts` (`SUITES`, header comment "Twelve")

- [ ] **Step 1: Write the suite** (fixtures as in `__tests__/integration/delivery-attestations.test.ts`: two accounts, approved versions, registered pages; store calls as `aeo_app`):
  - `056` applies after `055`; both tables and the column exist.
  - A measure naming another account's attestation or another brand's page fails `23503`.
  - The deferred trigger rejects a site row plus a page row, and 21 page rows (`23514`), at commit.
  - `aeo_app` cannot UPDATE or DELETE measures (`42501`).
  - `attestDelivery` with an unknown page writes no attestation and no measures.
  - Withdraw then re-attest: `loadAttributionInput` returns only the new measures.
  - Coverage: `covered_from` only moves earlier on contiguous marks and resets on a non-contiguous one; binding a different site deletes it.
  - The store excludes another account's daily rows and rows with `synced_at < bound_at`.
- [ ] **Step 2: Run** `node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"` — expect `12/12 suites`.
- [ ] **Step 3: Run** `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration 2>&1 | grep -v "postgresql://"` — green, the attribution file not run twice.
- [ ] **Step 4: Commit** `test(attribution): prove 056, tenancy and coverage on real Postgres`.

---

### Task 8: Delivery form — what to measure

**Files:**
- Create: `lib/attribution/options.ts` (server-only loader)
- Modify: `app/[lang]/dashboard/[clientId]/work-items/[workItemId]/versions/page.tsx`, `components/change-sets/VersionWorkspace.tsx`, `components/delivery/DeliveryWorkspace.tsx`, `components/delivery/DeliveryForm.tsx`, both catalogues (`attribution` namespace), `__tests__/lib/message-catalogue-parity.test.ts`
- Test: `__tests__/components/delivery-render.test.tsx` (extend), `__tests__/lib/attribution-options.test.ts`

**Interfaces:**
- Produces: `loadMeasureOptions(clientId: string): Promise<MeasureOptions | null>` — null when the feature is off or not entitled, or on a lookup failure (logged `error.name`); otherwise `{ pages: Array<{ id: string; url: string; label: string }> }` for the session account's brand. `VersionWorkspace` and `DeliveryWorkspace` gain `measureOptions: MeasureOptions | null`; `DeliveryForm` gains `measureOptions` and its `onSubmit` input may carry `measure`.
- Form: radio *Specific pages* / *Whole site* / *Don't measure* (default); page checkboxes (label + URL, distinct `aria-label`, max 20 enforced client-side); *Specific pages* disabled with an assets-page link when `pages` is empty; the whole field absent when `measureOptions` is null.

- [ ] **Step 1: Write failing tests:** null options → no field and the submitted body has no `measure`; *Whole site* → `measure: { scope: 'site' }`; two pages → `{ scope: 'page', assetIds: [a, b] }`; empty pages → *Specific pages* disabled and the link targets `/{lang}/dashboard/{clientId}/assets`; both languages render; catalogue parity includes `attribution`.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the render, options and parity tests, the orphaned-components test, full `npm run test:unit`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(attribution): choose what to measure when recording a delivery`.

---

### Task 9: Measured change block

**Files:**
- Create: `components/attribution/MeasuredChangeBlock.tsx` (with exported `TargetRow`, `FigureTable`, `TargetStatusNotice`)
- Modify: `components/change-sets/VersionWorkspace.tsx` (render beside `OutcomeWorkspace` when `measureOptions` is non-null, sharing its `refreshKey`), both catalogues
- Test: `__tests__/components/attribution-render.test.tsx`

**Interfaces:**
- Consumes: Task 6's GET shape.
- Produces: `MeasuredChangeBlock({ clientId, itemId, versionId, refreshKey })`; presentational pieces take `t: (key: string, values?: Record<string, string | number>) => string`.

- [ ] **Step 1: Write failing render tests,** in both languages: each status renders its own copy (`readyOn` date, missing range, each unavailable reason, re-record to measure, not supported); a comparable page row shows clicks/impressions/CTR/position with before, after and change; `'new'` renders as the "new" copy, never "Infinity"; a site row shows enquiries by source; the standing caption appears on every comparable row exactly as in Global Constraints; no rendered string contains "caused" or "result of"; a fetch failure shows the unavailable copy while `OutcomeWorkspace` still renders.
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement**, following `OutcomeWorkspace`'s fetch/abort/retry pattern.
- [ ] **Step 4: Verify** the render, parity and orphaned-components tests, full `npm run test:unit`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(attribution): measured change beside the technical outcomes`.

---

### Task 10: Docs, full verification, PR

**Files:**
- Modify: `CLAUDE.md` (a Database bullet for `056`; the coverage and gap-free window rules under Search Console and GA4; `FEATURE_ATTRIBUTION` needs `FEATURE_SEARCH_CONSOLE`), `docs/implementation/aiso-owner-platform/04-ACCEPTANCE-MATRIX.md` (add AC-16 at PARTIAL with the spec §9 wording; correct AC-13's "No external provider connector exists")

- [ ] **Step 1: Write the docs.** Every claim must match the code.
- [ ] **Step 2: Full verification**, each must pass:
```bash
npm run typecheck
npm run lint
npm run test:unit
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration 2>&1 | grep -v "postgresql://"
node scripts/ci/run-exact-target-suites.mjs 2>&1 | grep -v "postgresql://"
```
  Expected: clean, green, `12/12 suites`.
- [ ] **Step 3: Commit** `docs(attribution): rules, flag and AC-16`.
- [ ] **Step 4: Push and open the PR only after the user approves**, based on `claude/phase2-analytics`. The body states: dark by default and needs both flags; `056` applied nowhere; depends on #65 and #66; the two connector-sync changes (coverage, gap-free windows) and that they change Search Console and GA4 sync behaviour; AC-16 PARTIAL until a pilot. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
