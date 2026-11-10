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
operator-approved AI narrative draft. The brand's Reports page lists monthly reports beside
scan reports, and each monthly row can publish its latest version or stop sharing without
opening the month; the report page keeps the editor, preview and review link.

The cron side went live on 2026-11-09: the Worker now runs all three ticks — Pulse, alerts and
the 00:17 HKT brand-months tick — and the brand-months route was proven end to end that day
(see “First firing: verified” below). Before that deployment the third tick was configured but
never deployed, the reason every month figure read "not recorded"; `npm run worker:schedules`
exists so that drift cannot be mistaken for a code bug again, and
`npm run report:brand-months-receipt` so a tick that never fires cannot look like a quiet one.

What remains is a data question, not code:

- **Q1's thresholds are provisionally confirmed.** The rule refuses a direction unless three
  consecutive weekly comparisons move the same way with at least five answers behind each
  week. Production has four weekly Pulse rollups for one brand with the 19 Oct week missing, so
  no month yet has four consecutive weeks; the rule correctly claims no movement. Replay the
  first month that does and record whether the thresholds hold. The first month that can
  qualify is **November 2026**: the weeks starting 2, 9, 16 and 23 Nov all sit inside the
  month, so the replay becomes meaningful once the 23 Nov week's rollup lands (around
  30 Nov–1 Dec 2026). October cannot qualify — 19 Oct is missing.
- **The feed is a comp, and it lapsed once already (2026-11-10).** AISO Dev Brand is the only
  brand with a five-platform prompt bank, and it runs on a one-month `pro` override rather
  than a subscription (`override_reason` records it as GEO parity testing requested by the
  account owner on 2026-10-11, set directly because this database has no platform
  administrator). That override expired at `2026-11-10T00:00Z`, which drops the account to
  `basic` with a trial that ended 2026-09-18 — `resolveCommercialEntitlement` then returns
  `free`, so that day's 04:17Z Pulse tick selected SUPER DRY instead of AISO, and later
  brand-months ticks would skip AISO's snapshot rows. It was renewed by direct SQL on
  2026-11-11 (expires `2026-12-05T00:00Z`; the row's reason records the renewal and approval).
  The next scheduled Pulse tick should resume AISO's 9 Nov week — it needs two more chunks —
  then weeks 16 and 23. If the override lapses before the replay, both the November weeks and
  AISO's 1/3-Dec snapshot rows disappear again; check the account's entitlement before
  treating a "not enough weeks" replay as merely too early.

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

**Re-read 2026-11-10: no drift.** `npm run worker:schedules` reports Worker `aiso-cron-worker`
with configured and deployed schedules identical — `17 16 * * *`, `17 4 * * *`, `47 7 * * 1` —
all three modified `2026-11-09T03:47:13.720735Z` (the restore deployment), then
“no drift: the deployed schedules match the config”. That is the readback the plan asked for,
taken after the first scheduled firing rather than relying on the 2026-11-09 reading. Note the
readback needs a live Cloudflare credential: earlier on 2026-11-10 the local `wrangler` OAuth
login had expired (the script now explains that instead of a bare 401), and
`npx wrangler whoami` refreshed it — on a fresh machine, authenticate first or set
`CLOUDFLARE_API_TOKEN`.

### First firing: verified 2026-11-09

Waiting for 00:17 HKT would have left the only unproven link — Worker schedule → route →
`CRON_SECRET` → database — untested for another day. The same Worker source was therefore
deployed for a few minutes with a `*/2 * * * *` trigger mapped to `/api/cron/brand-months`
(version `9f9c96ae-ae1b-47d2-9314-5efdf2bec9d4`), observed, and then the production config was
restored and redeployed (version `de807397-f0f7-4ba8-9930-3c201d6ea1cb`). No repository file was
changed or committed for this; `npm run worker:schedules` reports the three production ticks and
no drift.

Observed:

| Firing (UTC) | Status | Detail |
| --- | --- | --- |
| `2026-11-09T03:44:49Z` | ok | `{due: 3, recorded: 9, notEntitled: 4, failed: 0}` |
| `2026-11-09T03:46:49Z` | ok | `{due: 0, recorded: 0, notEntitled: 4}` |

- The Worker's own log records `cron_worker_response … route /api/cron/brand-months, status 200`,
  which proves the whole chain: a wrong `CRON_SECRET` would have been a 401 and, because the route
  authenticates before it writes its ledger row, an invisible one.
- **Nine rows, not the six predicted here earlier.** October's opening (as-of 30 Sep 16:00Z) had
  also never been recorded, so the first firing fills every snapshot whose as-of instant has
  passed: three brands × (Oct opening + Oct closing + Nov opening) = 9. Later firings write only
  what is still missing.
- The second firing recorded 0, so repeated ticks cannot double-write.
- `brand_month_snapshots` now holds rows for AISO Dev Brand, Harbour Books and Northwind Coffee;
  for 2026-11 the month page's `readRecordedSnapshotKinds` returns `["opening"]` for those three
  and nothing for the other four — the plan-count entitlement list below, confirmed.

| Brand | Account | Entitled | Snapshot rows now present |
| --- | --- | --- | --- |
| AISO Dev Brand | Basic, admin override Pro (no expiry) | yes | Oct opening, Oct closing, Nov opening |
| Harbour Books | Pro, active subscription | yes | Oct opening, Oct closing, Nov opening |
| Northwind Coffee | Pro, active subscription | yes | Oct opening, Oct closing, Nov opening |
| Fimmick | Basic trial, ends `2026-11-09T09:51Z` | no | none |
| SUPER DRY | Basic trial, ends `2026-11-15T12:51Z` (Basic features, not Pro) | no | none |
| AISO Onboarding UAT 2026-10-16 / …B | Basic, expired trials | no | none |

Check the tick any time with `npm run report:brand-months-receipt`: after a firing it must show a
`cron_runs` entry and the snapshot rows. If it shows zero, the schedule exists but did not do its
work — read the receipt, not the absence of errors.

### Scheduled firing: verified 2026-11-10 (00:17 HKT)

The 2026-11-09 proof used a temporary `*/2` trigger. The production schedule has since fired on
its own: `npm run report:brand-months-receipt` on 2026-11-10 reports the tick's third `cron_runs`
entry at `2026-11-09T16:17:09.088Z` — 00:17:09 HKT on 10 November, the configured minute —
answering `{due: 0, failed: 0, recorded: 0, notEntitled: 5}`.

`recorded: 0` is the expected idempotent result, not a failure: the 2026-11-09 backfill already
wrote every snapshot whose as-of instant had passed (9 rows), so the scheduled tick found nothing
left to write. It also confirms the entitlement list stays current — Fimmick's trial ended
`2026-11-09T09:51Z`, so `notEntitled` moved from 4 to 5. The next genuinely new rows are written
by the 1 Dec 00:17 HKT tick (December opening + November closing).

The recorded figures are real, not placeholders. For the 2026-11 opening and 2026-10 closing
snapshots (as-of `2026-10-31T16:00:00Z` = 1 Nov 00:00 HKT):

- **AISO Dev Brand** — `scan.score 14.17` (scan `dea51489`, recorded 2026-10-14),
  `pulse.week 2026-10-12` with five platform rows (perplexity-sonar 12.5, perplexity-sonar-pro
  12.5, the other three 0, on 8 answers each), `search.state not_connected`.
- **Northwind Coffee** — `scan.score 72` (recorded 2026-09-02), `search.state not_connected`.
- **Harbour Books** — every figure `state: none`, i.e. an honest 未記錄 rather than a fabricated
  row.

Pulse's week selection is deliberate: `computeFigures` picks the latest rollup whose
`scan_week + 7` has passed the boundary, so the 26 Oct week (which spans into November) is
excluded from an as-of-1-Nov snapshot and the 12 Oct week is the latest complete one in the
month. The month page's `readBrandMonth` reads exactly these rows
(`readRecordedSnapshotKinds` → `["opening"]` for November), so the page now shows recorded
figures where they exist and 未記錄 where none was recorded — the failure mode this phase
existed to fix.

Q1 replay on the same day (`npm run report:movement-replay`): 2 brand-months, **0 with four
consecutive weeks**, 0 platform verdicts. AISO Dev Brand's October platforms each have 3 weeks,
longest run 2 (the 19 Oct week is missing), and November has 1 week so far. The rule correctly
reports `insufficient_weeks`; the replay stays a decision tool that must say nothing until the
data arrives, not a test that "passes" on absence.

### Pulse ledger and rollups (same readback)

`/api/cron/pulse` has a recorded run every day at 04:17 UTC through **2026-11-10**, and aggregate
`pulse_weekly_summary` rows exist for the weeks of 5 Oct, 12 Oct, 26 Oct and 2 Nov (the 19 Oct
week is missing, which is why Q1 has no four-week run; the 9 Nov week is still being collected
across the week and has no rollup yet — that is expected, not a gap). Two ledger rows are
anomalous: **2026-11-06** and **2026-11-09** started and never finished, with no detail and no
error. Normal runs finish in 45–55 s of the 60 s `maxDuration`, so an unfinished row is most
likely a function killed near that ceiling; a Vercel timeout can kill the route before
`finishCronRun` writes, so an unfinished row is weaker evidence than row coverage — treat the
weekly rollups as the signal that work happened, and the ledger as the signal that it started.


