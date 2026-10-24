# Project status

Notes that used to open the README (moved in UX Phase 8). Each dated line is
only as fresh as its date: re-verify before relying on it. The architecture
document is [`CLAUDE.md`](../CLAUDE.md).

## Database and migration

**The Supabase → Neon migration is complete.** `db()` from `@/lib/db` is the only database
client: zero files import `lib/supabase.ts` / `lib/supabase-server.ts` (both deleted), no
`@supabase/*` package remains, and an ESLint rule makes re-adding one an error rather than a
convention. The dashboard and admin routes run on Neon.

Two live caveats worth knowing before you touch the database:

- **All migrations `001`–`035` are applied** as of a `--verify` run against production on
  2026-08-15, which also settled the long-running `021` dispute: it *did* run, its three
  `local_trust_*` tables exist, and `021`'s own "never been applied" header comment (since
  corrected) was the thing that was wrong. Run `npm run migrate -- --verify` against the target database before
  believing any of this — it reports which migrations' objects actually exist, and this line
  is only as fresh as its date.
- **RLS is not a backstop.** The app connects as `aeo_app` (migration `037` moved it off
  `neondb_owner` to a least-privilege role, which keeps `BYPASSRLS`), and migration `036`
  dropped the Supabase-era policies. Every query must filter by `account_id` explicitly.


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

## Scheduler readback

**Runtime readback, 2026-10-03 13:25 HKT:** the deployed `aiso-cron-worker` has no enabled
cron schedules and no `APP_BASE_URL` binding. Weekly operation and job coverage are
unverified; the remediation candidate has not been deployed. See the
[runtime evidence register](runbooks/aiso-runtime-evidence.md) and
[release/rollback runbook](runbooks/aiso-remediation-release.md).
