# Project status

Notes that used to open the README (moved in UX Phase 8). Each dated line is
only as fresh as its date: re-verify before relying on it. The architecture
document is [`CLAUDE.md`](../CLAUDE.md).

## Database and migration

**The Supabase → Neon migration is complete.** `db()` from `@/lib/db` is the only database
client: zero files import `lib/supabase.ts` / `lib/supabase-server.ts` (both deleted), no
`@supabase/*` package remains, and an ESLint rule makes re-adding one an error rather than a
convention. The dashboard and admin routes run on Neon.

**Migrations `001`–`100` are recorded on the hosted branch** (`npm run migrate -- --verify`,
2026-11-09). `100_prompt_source.sql` was applied that day under a named approval; it adds
`prompt_bank.source` and backfills `profile` only where `onboarding_seed_key` already recorded
it. The database-and-migration caveats below still hold and are the things to re-check before
touching the database:

- **Run `npm run migrate -- --verify` first, and trust it over any dated line here.** It reports,
  per migration, whether the objects that migration creates actually exist — and it is only as
  fresh as its date. The 2026-08-15 run that settled the long-running `021` dispute (`021` *did*
  run; its three `local_trust_*` tables exist) is the pattern: a `--verify` line beats a header
  comment.
- **RLS is not a backstop.** The app connects as `aeo_app` (migration `037` moved it off
  `neondb_owner` to a least-privilege role, which keeps `BYPASSRLS`), and migration `036`
  dropped the Supabase-era policies. Every query must filter by `account_id` explicitly.
- **A merge is not an applied migration.** The schema gate fails a production build whose code
  ships an unrecorded migration; apply and `--verify` before merging code that needs one.

## Feature fences

**No features are currently fenced.** Routes used to return `503 FEATURE_UNAVAILABLE` via
`lib/unavailable.ts`, and `__tests__/api/fenced-routes.test.ts` is the canonical list (now empty).
Restored: Local Trust, alert *configuration*, the Pulse
producer (`POST /api/pulse/run`), the question bank (including AI question suggestions),
`notifications` (restored), `cron/trial-emails` (restored 2026-08-22), content tools
(`fix/cluster-map`, `fix/content-brief`, restored 2026-08-23), and `agents/*` (`competitors`,
`progress`, `recommendations`, restored 2026-08-23). Alert *evaluation*
has an available producer route (scheduler source in `cloudflare/cron-worker/`) and
emails threshold, week-over-week and recovery alerts, deduped to one per client, type and
week, with in-app notifications written and readable. Migrations `033`–`035` gate its deploy (see
[`docs/alert-evaluation-release.md`](alert-evaluation-release.md)). A fence is not a
gate — restoring one means adding a real auth/entitlement/ownership gate, not just deleting
the `featureUnavailable` call. `lib/localTrust/guard.ts` is the shape to copy.

## Retainer OS (Slices A–C): built and deployed

Everything the 2026-11-06 brief calls for is in `main` and deployed to Vercel:
demand-seeded Pulse with the 10-active-question budget and a stored `prompt_bank.source`
(demand vs profile), the Brand Month record with its month page and cross-brand queue, and the
monthly deliverables report with publish/share, agency branding, the Q1 movement rule
(`lib/monthly-report/movement.ts`), a recorded open/close figures section, and an
operator-approved AI narrative draft.

The cron side went live on 2026-11-09: the Worker now runs all three ticks — Pulse, alerts and
the 00:17 HKT brand-months tick — so `brand_month_snapshots` records automatically from the
next firing. Before that deployment the third tick was configured but never deployed, the
reason every month figure read "not recorded"; `npm run worker:schedules` exists so that drift
cannot be mistaken for a code bug again.

What remains is a data question, not code:

- **Q1's thresholds are provisionally confirmed.** The rule refuses a direction unless three
  consecutive weekly comparisons move the same way with at least five answers behind each
  week. Production has four weekly Pulse rollups for one brand with the 19 Oct week missing, so
  no month yet has four consecutive weeks; the rule correctly claims no movement. Replay the
  first month that does and record whether the thresholds hold.

## Scheduler readback

**Runtime readback after the 2026-11-09 deployment:** the deployed `aiso-cron-worker` runs all
**three** configured schedules, and `npm run worker:schedules` reports no drift:

| Schedule (UTC) | Routes | Status |
| --- | --- | --- |
| `17 4 * * *` | `/api/cron/pulse` (+ `?mode=repair`) | live |
| `47 7 * * 1` | `/api/cron/evaluate-alerts` | live |
| `17 16 * * *` (00:17 HKT) | `/api/cron/brand-months` | live since 2026-11-09 |

Deployment version `f25fd6fc-3de6-4e1e-8ea2-4967980dec7f`; the deployed script was read back
and contains the brand-months route and all three cron keys, and the `CRON_SECRET` secret is
bound. The `0 9 * * *` trigger (trial emails + Search Console) remains unscheduled in the
deployable config — the free tier allows three triggers and all three are now spent. Re-run
`npm run worker:schedules` before relying on this line, and see the
[cron-worker runbook](runbooks/deploy-cron-worker.md) for the activation and rollback gates.

### Expected receipt of the first brand-months firing

Derived on 2026-11-09 from the empty snapshot table and `resolveCommercialEntitlement` (the plan
catalog grants `client_reports_online` to Pro and Enterprise only; a Basic *trial* is Basic
features, and an expired trial is Free features). All seven active brands are due, so the first
00:17 HKT firing should answer **`{due: 3, recorded: 6, notEntitled: 4, failed: 0}`**:

| Brand | Account | Entitled | Rows it should write |
| --- | --- | --- | --- |
| AISO Dev Brand | Basic, admin override Pro (no expiry) | yes | opening 2026-11, closing 2026-10 |
| Harbour Books | Pro, active subscription | yes | opening 2026-11, closing 2026-10 |
| Northwind Coffee | Pro, active subscription | yes | opening 2026-11, closing 2026-10 |
| Fimmick | Basic trial, ends `2026-11-09T09:51Z` — expired by the firing | no | none |
| SUPER DRY | Basic trial, ends `2026-11-15T12:51Z` (Basic features, not Pro) | no | none |
| AISO Onboarding UAT 2026-10-16 / …B | Basic, expired trials | no | none |

Check it with `npm run report:brand-months-receipt`: it must show a `cron_runs` firing and six
snapshot rows. If it shows zero, the schedule exists but did not do its work — read the receipt,
not the absence of errors.

### Pulse ledger and rollups (same readback)

`/api/cron/pulse` has a recorded run every day at 04:17 UTC through 2026-11-08, and aggregate
`pulse_weekly_summary` rows exist for the weeks of 5 Oct, 12 Oct, 26 Oct and 2 Nov (the 19 Oct
week is missing, which is why Q1 has no four-week run). One ledger row is anomalous: the
**2026-11-06** run started and never finished, with no detail and no error
(`cron_runs.id 80ded813-3802-4a75-9d38-726fa87a7270`). A Vercel timeout can kill the route before
`finishCronRun` writes, so an unfinished row is weaker evidence than row coverage — treat the
weekly rollups as the signal that work happened, and the ledger as the signal that it started.


