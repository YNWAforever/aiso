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

## Retainer OS (Slices A–C): built, one deployment from live

Everything the 2026-11-06 brief calls for is in `main` and deployed to Vercel:
demand-seeded Pulse with the 10-active-question budget and a stored `prompt_bank.source`
(demand vs profile), the Brand Month record with its month page and cross-brand queue, and the
monthly deliverables report with publish/share, agency branding, the Q1 movement rule
(`lib/monthly-report/movement.ts`), a recorded open/close figures section, and an
operator-approved AI narrative draft.

What is still **not live** is operational, not code:

- **The brand-months tick has never been deployed.** `cloudflare/aiso-worker/wrangler.jsonc`
  configures three crons (`17 4 * * *` Pulse, `47 7 * * 1` alerts, `17 16 * * *` brand-months),
  but the deployed Worker runs only the first two (readback 2026-11-09). So
  `brand_month_snapshots` is empty in production and month pages/reports can only say
  "not recorded" until a Worker deployment includes the third tick. Verify with
  `npm run worker:schedules`; deploy is the separately approved step in
  [the cron-worker runbook](runbooks/deploy-cron-worker.md).
- **Q1's thresholds are provisionally confirmed.** The rule refuses a direction unless three
  consecutive weekly comparisons move the same way with at least five answers behind each
  week. Production has four weekly Pulse rollups for one brand with the 19 Oct week missing, so
  no month yet has four consecutive weeks; the rule correctly claims no movement. Replay the
  first month that does and record whether the thresholds hold.

## Scheduler readback

**Runtime readback, 2026-11-09:** the deployed `aiso-cron-worker` has **two** schedules —
`17 4 * * *` (Pulse, modified 2026-10-23) and `47 7 * * 1` (alerts, modified 2026-10-12) — and
`APP_BASE_URL` is set. The third configured tick, `17 16 * * *` (brand-months, 00:17 HKT), is
**not deployed**, and the deployed script predates the route that serves it. Weekly Pulse and
alert evaluation are running; month snapshots are not. Re-run `npm run worker:schedules` before
relying on this line, and see the [cron-worker runbook](runbooks/deploy-cron-worker.md) for the
activation and rollback gates. The 2026-10-03 observation (no schedules, no `APP_BASE_URL` at
all) is superseded.

