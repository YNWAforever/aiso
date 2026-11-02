# Conversation Studio Stage 6d — in-answer GSC (Hong Kong + Pacific bounds)

- Brief: `/workspace/aiso-brief-stage-6d-gsc-in-answer.md`
- Design: `docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md` §3 table row **6d** + §4 Wave 3 / 6d
- Wave trigger: GM continuous-plan **t335u**; Wave 3 ordered by GM ~11:41 HKT 2026-11-02
- ClickUp: [z8qgvca4pj](https://app.clickup.com/t/z8qgvca4pj)
- Base: `dc9bc31e0973e2a3eb64efb29b793147b5a7c016` (`origin/main`, Stage 6c #135 squash)
- Branch: `codex/conversation-studio-stage-6d` — draft PR only

## Outcome

On an entitled and bound brand, one Studio turn can query the **existing**
Search Console connector on demand. The query always uses the Hong Kong country
filter (`countryEquals: 'hkg'`) and a Pacific (`America/Los_Angeles`) calendar
window. The result is folded into that turn's answer, inspector and research
steps as a small display snapshot. Empty, quota, reconnect and unbound states
are honest; no metrics are invented.

The Studio page itself never calls Google. The request happens only when the
operator submits a turn, for saved and LIVE turns alike.

## Client extension (`lib/integrations/search-console/client.ts`)

- `AnalyticsDimension` gains `'country'`.
- `AnalyticsQuery` gains `countryEquals?: string`. When set, the client appends
  `{ dimension: 'country', operator: 'equals', expression }` to the existing
  `dimensionFilterGroups[0].filters` array, alongside page and search-appearance
  filters.
- `classifyApiFailure`, `DeadlineReachedError`, `MAX_PAGES` and `ROW_LIMIT` keep
  their existing behaviour.
- Every Studio in-answer Query passes `countryEquals: 'hkg'`; there is no path
  that labels unfiltered results as Hong Kong.

## Pacific window (`lib/integrations/search-console/window.ts`)

- `pacificCalendarDate(now)` reads `YYYY-MM-DD` with
  `Intl.DateTimeFormat(..., { timeZone: 'America/Los_Angeles' })`; it does not
  slice a UTC ISO string.
- `gscAnswerWindow({ now, days = 28, lagDays = 3 })` returns
  `{ startDate, endDate, pacificToday, lagDays, completeThrough }`.
- `endDate = pacificToday − lagDays`; `startDate = endDate − (days − 1)`.
- `GSC_DATA_LAG_DAYS = 3`: Search Analytics normally lags 2–3 days, so answers
  stop before the unsettled edge instead of presenting it as complete.
- `completeThrough` is the lag-adjusted `endDate`.
- Date arithmetic uses UTC labels (`T00:00:00Z`) only for calendar-day math;
  the calendar itself is Pacific, so DST does not shift the window.
- **Cron UTC debt:** `app/api/cron/search-console/route.ts` still uses a UTC
  `today()`. Rewriting the cron and backfilling Neon is out of scope here and
  documented as debt.

## Route and module

| Layer | Path |
| --- | --- |
| Server query | `lib/conversation-studio/gsc-query.ts` |
| Types | `lib/conversation-studio/gsc-types.ts` |
| Route | `POST app/api/dashboard/clients/[clientId]/studio/search-console/route.ts` |
| UI chrome | `components/dashboard/StudioGscSnapshot.tsx` |

Auth and tenancy reuse the existing Search Console guard: feature
`search_console` → profile → entitlement → owned client, plus an **active**
brand check matching `answerStudio`. A switched-off feature is `404`, an
unentitled caller `403`, unauthenticated `401`, and a foreign/inactive brand
`404`; none of these call Google.

The route reads no secrets from the body and returns every response with
`Cache-Control: no-store`.

## Query contract

`StudioGscSnapshot`:

```ts
{
  status: 'ok' | 'empty' | 'provisional' | 'unbound' | 'reconnect' | 'rebind'
        | 'quota' | 'unavailable' | 'forbidden' | 'misconfigured'
        | 'unentitled' | 'disabled'
  window?: { startDate: string; endDate: string; timeZone: 'America/Los_Angeles'; lagDays: number }
  country: 'hkg'
  totals?: { clicks: number; impressions: number; ctr?: number; position?: number }
  topQueries?: Array<{ query: string; clicks: number; impressions: number }>
  completeness: 'complete' | 'provisional' | 'unknown'
  messageKey?: string
}
```

- Primary series: `dimensions: ['date']`, `countryEquals: 'hkg'`, PT window,
  `rowLimit ≤ 100`, deadline `turn start + 8 s`.
- Optional second series: `dimensions: ['query']`, same filter/window,
  `rowLimit ≤ 25`.
- **Call cap:** at most **2 Search Analytics series per turn**. The client may
  still page within one series, but the small row limits and short deadline make
  a full-sync budget impossible. The cron keeps its own larger budget.
- Totals are summed only from returned rows. CTR is returned only when total
  impressions are non-zero; position is impression-weighted. If Google returns
  no rows, there are no totals and the status is `empty` — not zeros.
- The optional top-query series is best-effort: if it fails after a good totals
  read, totals remain and `topQueries` is omitted.
- The snapshot is **display-only** for the current turn. 6d adds no migration
  and does not write a snapshot into the 6c thread tables; reloading a saved
  thread shows only its persisted reply/LIVE payload. Persisting a display
  snapshot later is a schema decision outside this PR.

## Failure / completeness matrix

| Situation | Status | `completeness` | UI honesty |
| --- | --- | --- | --- |
| No saved binding | `unbound` | `unknown` | Not connected; no query ran |
| Connection revoked / credential absent | `unbound` / `reconnect` | `unknown` | Not connected / reconnect required |
| Binding no longer matches the brand domain | `rebind` | `unknown` | Binding needs verification |
| Google returns no rows | `empty` | `unknown` | No Hong Kong data this period; missing is not zero |
| Rows returned | `ok` | `complete` | Window, Hong Kong, Pacific, totals/top queries |
| Google quota (`429`/rate reasons) | `quota` | `unknown` | Quota reached; try later |
| Token revoked | `reconnect` | `unknown` | Reconnect required |
| Property forbidden | `forbidden` | `unknown` | Property access denied |
| Our OAuth/Cloud project misconfigured | `misconfigured` | `unknown` | Configuration problem |
| Network/deadline/parse failure | `unavailable` | `unknown` | Unavailable this turn |
| Feature off / plan lacks Search Console | route `404` / `403` | — | Existing gate copy |

Freshness: answers use `dataState: 'all'` through the existing client, but the
window ends at the 3-day lag cutoff, so the snapshot is labelled complete
through that date. The `provisional` status remains available for a future
fresher-window decision; 6d does not silently include unsettled days.

## Neon totals are not Hong Kong

`loadPanelData` / `search_console_daily` are **property-wide** sync totals. They
remain useful for saved sync status / `dataThrough`, but 6d never renders those
numbers as Hong Kong clicks or impressions. In-answer Hong Kong metrics come
only from the live `countryEquals: 'hkg'` Search Analytics call above.

## Honesty copy

`messages/en.json` and `messages/zh-HK.json` gain
`conversationStudio.gsc.*`: Hong Kong country, Pacific calendar, window,
complete-through, pending/empty/failure states, totals labels and a research
step. After a query, the inspector for that turn replaces the unconditional
`notQueried` badge with the snapshot. Page load and connection-only views keep
their existing saved-status and `notQueried` / `savedOnly` copy.

No invented metrics, ranks or zeros. Empty is distinct from failed. Hazel can
polish the copy; behaviour is the contract above.

## Tests

- `__tests__/integrations/search-console-client.test.ts` — `countryEquals: 'hkg'`
  in the request body, country dimension, existing page/appearance filters, quota
  classification unchanged.
- `__tests__/integrations/search-console-window.test.ts` — PT/PDT fixtures,
  evening-HKT/morning-UTC case that differs from a naive UTC slice, lag and
  window length.
- `__tests__/conversation-studio/gsc-query.test.ts` — HK filter, two-series cap,
  row limits, totals/top queries, empty vs failure, no Google on unbound /
  reconnect / rebind.
- `__tests__/conversation-studio/gsc-route.test.ts` — 401/404/403 pass-through,
  inactive brand, honest unbound/quota states, `no-store`.
- `__tests__/components/conversation-studio.test.tsx` — post-query snapshot
  chrome and research step, empty/quota/unbound honesty, inspector no longer
  claims “not queried” when a snapshot exists; existing page-load `notQueried`
  assertions stay green.

No live-Google e2e is added. Fixtures use example domains and no customer data.

## Deploy / vercel

`vercel.json` appends only `"codex/conversation-studio-stage-6d": false` under
`git.deploymentEnabled`, preserving the previous 22 keys (result 23). No
`functions` or environment edits.

## HOLD / NO_GO

- Prod/Preview LIVE ON, `STUDIO_LIVE_ANSWERS_PER_WEEK` changes, any
  `FEATURE_*` or environment flip. FEATURE may already be ON in Prod; that does
  **not** authorize LIVE/cap/env/migrate work here.
- Applying 081 or any migration to hosted Neon (Preview/Prod). **Hosted Neon
  migrate = separate GM Approve; not done in this PR.**
- New migration / tables for 6d (query-only), rewriting the cron to PT, or
  backfilling Neon with HK-filtered history.
- Using Neon property-wide totals as Hong Kong metrics.
- 6e DataForSEO, 6f Firecrawl, any new paid vendor, spend/cap Ask.
- New Studio nav item / parallel GSC page / default-home flip.
- Redesign of 6a/6b/6c/6g/6h; CloudAgent; merge.
- Logging tokens, vault keys or raw OAuth secrets.
