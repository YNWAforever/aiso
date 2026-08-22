# Alert evaluation release gate

Migrations `supabase/migrations/033_alert_evaluation_hardening.sql`,
`supabase/migrations/034_alert_evaluation_snapshot_refinement.sql`, and
`supabase/migrations/035_alert_email_delivery_ledger.sql` must be applied,
in order, to the target Neon database before deploying
`app/api/cron/evaluate-alerts`.

The route uses direct Neon SQL rather than a Supabase RPC. Migration 033 creates the
notification deduplication constraint required by the `ON CONFLICT` write, migration
034 creates the deterministic aggregate-snapshot index used by keyset pagination, and
migration 035 creates `alert_email_deliveries` with a unique index on
`(client_id, type, scan_week)`, which `claimEmailDelivery` uses to send each alert email
at most once per client, type and week.

**`supabase/migrations/031_pulse_weekly_summary_unique.sql` is also required, but for a
different reason than 033/034/035 above.** Those three are required for the evaluator's
own writes; 031 is required for its *data source*. The evaluator reads
`pulse_weekly_summary` rows that `computeWeeklySummary` (`lib/pulse/summary.ts`) writes
with `on conflict (client_id, scan_week, platform)` — an arbiter that only exists once
031 creates the matching unique index (031's own header names `cron/evaluate-alerts` as
the reason it exists). Without 031, that write 42P10s and no `platform IS NULL`
aggregate row is ever produced. **Before 2026-08-16 this read as a perfect green:** every
configured client would have zero rollup rows, none would be counted `stale` (a client
with no weeks at all is skipped before that counter), the then-only escalation rule
`stale === processed` would read `0 === N` as healthy, and the run would report
`{processed: N, stale: 0, fired: 0, emailed: 0, emailFailures: 0}` while the feature was
entirely dead upstream of the evaluator. `cron/evaluate-alerts`'s `evaluated === 0`
escalation (see "Known limitations" below) now catches exactly this case and returns
`502` instead of `200`. Apply 031 before 033/034/035 regardless; nothing here depends on
ordering it after them.

Verified on 2026-08-15: this is a real hazard but it is **not** why production has no
rollup rows. `prompt_bank` is empty, `selectPendingClients` requires an active prompt, so
no client is ever selected and the producer never reaches the rollup at all. `031` is now
applied; the rollup is unproven in production rather than known-broken, and stays that way
until a workspace has prompts.

Pre-deploy smoke checks:

1. Apply migration 031 through the normal approved Neon migration process.
2. Apply migration 033 through the normal approved Neon migration process.
3. Apply migration 034 through the normal approved Neon migration process after 033.
4. Apply migration 035 through the normal approved Neon migration process after 034.
5. Verify `pg_indexes` contains:
   - the unique `pulse_weekly_summary_client_week_platform_unique` on `(client_id,
     scan_week, platform)`;
   - the unique `notifications_dedup_idx` on `(client_id, type, scan_week)`;
   - the partial `pulse_weekly_summary_alert_snapshot_idx` with the `created_at` and `id`
     tie-break columns.
6. Run a bounded Neon SQL smoke check with a small known client-id sample and verify
   the snapshot returns at most the latest two aggregate (`platform IS NULL`) weeks per
   client in deterministic order.
7. Verify notification insertion remains idempotent for the same
   `(client_id, type, scan_week)`.
8. Verify a second invocation in the same week sends no further email. **Run this against
   a throwaway Neon branch, never production** — it seeds an alert config and two weeks of
   aggregate rows. Procedure, which has been executed and passes:
   - Create a branch off production and derive its DSN by taking the production
     `DATABASE_URL` and replacing only the hostname with the new branch's endpoint.
     **Do not use `neonctl connection-string --branch-id` to get it** — see the tooling
     warning below.
   - Assert the resulting host is *not* the production endpoint before writing anything.
     This assertion is not ceremony; it is what caught the tooling bug below.
   - Seed one client with two consecutive aggregate (`platform IS NULL`) weeks scoring
     60 then 40, and an `alert_configs` row with `sov_threshold` 50 and `wow_threshold`
     10. That fires two independent actions: a threshold crossing and a week-over-week
     drop.
   - Call `runAlertEvaluation` twice with the real `createNeonAlertStore` and a stubbed
     `sendAlertEmail` that records rather than delivers. Nothing is mailed, and the
     property under test — the ledger, not Resend — is exercised for real.
   - Expect run 1 `{fired: 2, emailed: 2, emailFailures: 0}` with two
     `alert_email_deliveries` rows and two `notifications` rows; expect run 2
     `{fired: 2, emailed: 0, emailFailures: 0}` with both counts unchanged. `fired`
     staying at 2 while `emailed` falls to 0 is the healthy-re-run signature; a ledger
     outage instead reports `emailFailures` greater than zero.
9. Verify the Vercel Cron entry point pre-deploy, against the same throwaway branch:
   import the route's `GET` and call it with `Authorization: Bearer $CRON_SECRET`. Expect
   `200` and a JSON body carrying `processed`, `stale`, `evaluated`, `fired`, `emailed`,
   `deferred`, `emailFailures` and `notificationFailures`; expect `401` for a wrong
   token. Run it after check 8 so the week is already delivered —
   the response must then report `emailed: 0`, which also proves the claim short-circuits
   before Resend is ever reached. `cloudflare/cron-worker/wrangler.jsonc` scheduling
   `/api/cron/evaluate-alerts` at `47 7 * * 1` after the Pulse driver's `17 4 * * 1` is pinned
   by `__tests__/config/function-durations.test.ts`, so it needs no manual check.
10. **Post-deploy only:** confirm one `200` for `/api/cron/evaluate-alerts` in the
    deployment logs on the first Monday after release. This is the one step that cannot be
    performed before deploying, and it is an observation rather than a gate.

This note is only a release gate. The numbered checks above are a deliberate pre-deploy
procedure. Checks 1-7 run against the target database; checks 8 and 9 run against a
throwaway branch and must never be pointed at production; check 10 happens after deploy.
Outside that procedure, do not apply production migrations, invoke the cron route, or send
notification/email traffic from local review or a development machine.

### Tooling warnings for this procedure

- **`neonctl connection-string --branch-id <id>` returns the parent's endpoint, not the
  branch's.** Observed directly: asked for a freshly created branch's DSN, it returned the
  production endpoint host. Anything seeded with that DSN lands in production. Derive the
  branch DSN by hostname substitution instead, and keep the not-production assertion in the
  harness.
- **`neonctl branches create` prints the full connection URI, password included, to
  stdout.** Redirect or discard its output. Branch roles are inherited from the parent, so
  that password is the parent's too — treat any such disclosure as a production credential
  exposure and rotate `neondb_owner`.

## Known limitations to accept or mitigate before enabling production traffic

- **The delivery loop is serial and bounded by wall clock, not by row count.**
  `runAlertEvaluation` awaits one notification insert, one ledger claim and one Resend
  send per fired alert, in series. At typical round-trip latencies that truncates
  somewhere around 100-150 fired alerts against the 60s `maxDuration`. The failure is
  silent and threefold: an alert whose claim landed but whose send was in flight when
  the function was killed is stranded for that `scan_week` (the unique index blocks
  re-claiming); configs past the cut are never evaluated, and since ordering is by
  `alert_configs.id`, it is the same suffix of customers every week; and Vercel Cron
  does not retry, so the next firing is seven days later. The correlated case — a
  platform-wide SoV shift pushing many clients below threshold in one week — is exactly
  when this bites. **Mitigated, not solved (2026-08-16).** Delivery now runs 8 clients
  concurrently — per client, not per alert, so one brand's threshold and week-over-week
  alerts stay ordered — and stops itself at a 45s budget against the route's 60s
  `maxDuration`, rather than waiting to be killed by it. That moves the ceiling roughly
  an order of magnitude and, more importantly, makes hitting it loud: the run reports
  `deferred > 0` and the route answers 502, so a truncated run is recorded instead of
  vanishing mid-loop with nothing reported. The residual risk `deliverEmail` already
  documents — a process death between a successful claim and the send strands that
  alert for the week, because the unique index then blocks re-claiming it — is
  unaffected: the budget makes hitting Vercel's own timeout unlikely, but a redeploy or
  host crash can still trigger it. The underlying serial-per-client shape is otherwise
  unchanged, so at genuine scale the answer is still the chunk-and-chain shape
  `cron/pulse` already uses, or a lease/TTL on the claim. There are zero `alert_configs`
  rows today, so that work would be speculative.
- **The evaluator now refuses to read a stale week (2026-08-16).** Nothing still
  enforces that the week's Pulse rollup lands before this cron runs — the ordering still
  rests on two independent cron times three and a half hours apart (`17 4 * * 1` for
  `cron/pulse`, then `47 7 * * 1` for this route, both in `cloudflare/cron-worker/wrangler.jsonc`)
  — but the
  consequence has changed. Previously, when a client's rollup had not landed, nothing
  errored: the evaluator re-derived last week's action, whose ledger row last week's run
  had already claimed, so the claim returned `false`, the outcome was `suppressed`, and
  the run reported `emailed: 0` with `emailFailures: 0` — indistinguishable from a
  healthy idempotent re-run, while that client's genuine current-week alert was silently
  dropped. `runAlertEvaluation` now compares each client's latest aggregate `scan_week`
  against `snapshot.currentScanWeek`, which `lib/alerts/neon-store.ts` reads via
  `SELECT date_trunc('week', now())::date` on Postgres itself — never the app clock,
  since a JS clock reading `now()` could disagree with Postgres's own and make a healthy
  client look stale, or worse, the reverse. A client whose latest week is behind is
  skipped, counted in `stale`, and logged per-client with `console.warn` (a lagging
  rollup 3.5 hours after schedule is an expected transient, not a fault). A client with
  **no** rollup rows at all is not counted `stale` either — it is skipped before the
  staleness check even runs, and a new workspace is not a fault. Partial staleness stays
  a `200`, relying on that per-client warn line rather than failing the whole cron for
  one lagging client. The escalation that matters is `evaluated === 0` (when
  `processed > 0`), added after this guard: it supersedes an earlier `stale === processed`
  rule that missed the case production is actually in. `prompt_bank` is empty, so
  `selectPendingClients` never selects a client and the Pulse rollup has never written a
  row in production (see `CLAUDE.md`); every client then has zero rollup rows, which are
  skipped *before* the `stale` counter, so on the first Monday after anyone creates an
  `alert_config` that run reports `stale: 0` and `evaluated: 0` together. `stale ===
  processed` would have read `0 === 1` as healthy and returned `200`; `evaluated === 0`
  (with `processed` now `1`) catches it and returns `502` instead.
- **`emailed: 0, emailFailures: 0` has a third meaning this doc did not previously cover:
  no email was ever attempted.** `buildAction` (`lib/alerts/evaluate.ts`) only builds an
  `email` when `config.notify_email` is true *and* a recipient address resolves *and* a
  dashboard URL resolves. The recipient comes from `emailsByAccount`, keyed off a join
  through `profiles` to `neon_auth."user"` — a missing `profiles` row for the account, or
  a `profiles` row whose `neon_auth."user"` join misses, resolves to no address. When
  that happens the action's `email` and `emailKey` are both `null`, `deliverEmail` is
  never called, and the alert is dropped with no counter movement at all: not `emailed`,
  not `emailFailures`. This is silent by design (`notify_email` false is the same shape,
  and a customer legitimately opted out looks identical to one whose join is broken), so
  do not treat a run with zero email counts as proof every fired alert reached an inbox —
  cross-check against `fired` and, if it looks wrong, against `emailsByAccount` directly.
