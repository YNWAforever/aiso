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
  administrator). That override expired at `2026-11-10T00:00:00Z`, which drops the account to
  `basic` with a trial that ended 2026-09-18 — `resolveCommercialEntitlement` then returns
  `free`, so that day's 04:17Z Pulse tick selected SUPER DRY instead of AISO, and later
  brand-months ticks would skip AISO's snapshot rows. It was renewed by direct SQL on
  2026-11-11 (expires `2026-12-05T00:00:00Z`; the row's reason records the renewal and approval).
  The next scheduled Pulse tick should resume AISO's 9 Nov week — it needs two more chunks —
  then weeks 16 and 23. If the override lapses before the replay, both the November weeks and
  AISO's 1/3-Dec snapshot rows disappear again — which is why `npm run report:movement-replay`
  now prints each brand's plan, source and Pulse platform count, and warns when a brand can no
  longer collect weeks, so a "not enough weeks" replay cannot read as "wait" when it means "no
  more data will arrive".

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



## Phase 4 per-fix billing: built and deployed (2026-11-11)

Design: `docs/superpowers/specs/2026-11-11-per-fix-billing-design.md` (merged #224).
Schema 107 is applied and recorded (`--verify`; production builds log
`schema gate: all 105 shipped migrations are recorded.`). Shipped in five PRs:

- **#226** — migration 107 + the meter writer: `fix_billing_events` is insert-only,
  `unique(fix_pack_id)` prevents double billing, `fixbilling:<uuid>` is minted at
  insert. Enqueue happens only for `account_billing.mode = 'metered'` and never fails
  the fix-pack response; reporting runs in `after()` and a failure leaves the row
  `pending`/`failed`, never charged.
- **#228** — admin open/switch: an existing plan subscription gets the metered price as a
  second item; a subscription-less account needs an explicit `createSubscription:true`
  (a real `send_invoice` plan + metered subscription), linked through the lease and
  `apply_stripe_account_event`; a failed link cancels the new subscription. Unset
  `STRIPE_PRICE_FIX_METERED`/`STRIPE_FIX_METER_EVENT_NAME` fail closed with
  `503 METERED_NOT_CONFIGURED`.
- **#229** — admin one-off invoices: Stripe `send_invoice` invoice + line item +
  finalize + send, mirrored into `billing_invoices`; a Stripe failure voids what it
  created and writes nothing; a mirror-only failure returns 503 **with** the Stripe
  invoice id and hosted URL and the repair path re-reads that invoice instead of issuing a
  second one. Webhook `invoice.finalized/paid/payment_failed/voided` with no
  subscription updates the mirror only.
- **#230** — client view: `/{lang}/dashboard/billing` + `GET /api/billing`
  (session-scoped, `getProfile` + `resolveCommercialEntitlement`); reported and
  pending/failed meter counts are returned and rendered separately with the honest note
  that pending/failed is not billed.
- **#231** — admin console `PerFixBillingPanel` + `GET /api/admin/billing/per-fix`
  (mode, this Hong Kong month's split counts, failed events with retry) and the operator
  runbook `docs/runbooks/per-fix-billing.md`.

Production verification after each merge: deployment Ready, schema gate recorded, and
`GET /api/billing` unauthenticated returns 401 while `/en/dashboard/billing` 307s to
login; `GET /api/admin/billing/per-fix` unauthenticated returns 401 and
`/admin/billing` 307s to the login page. Metering stays fail-closed until the owner
creates the Stripe meter/product/price and sets the two env vars.

## Scheduler: four triggers live, first `0 9` firing fired but delivered no email

The four scheduled triggers were deployed on 2026-11-11 (version
`5cd7efcb-c0e3-46cd-9a94-935de065e2c6`; rollback
`f25fd6fc-3de6-4e1e-8ea2-4967980dec7f`). `npm run worker:schedules` read them back
with no drift at deploy time.

First `0 9 * * *` firing: `2026-11-11T09:01:01Z` (17:01 HKT). The Worker called the
route and the ledger row exists, so the trigger is live, but the run is an error:
`{ sent: 0, failed: 17 }` — all 17 due trial emails were rejected by Resend within
447 ms (six trial accounts with real gmail/hkwtia/fimmick addresses, so this is a
provider-configuration failure, not recipient data). The ledger recorded only the counts,
which is undiagnosable: #232 adds `errorCodes` (`cause.name`, bounded, deduplicated,
capped at 5, never the message because Resend embeds the recipient address) to the failure
detail. The retry mask never advanced, so the same 17 sends retry at the next `0 9`
firing; that run's `cron_runs.detail` will name the cause. Search Console wrote no ledger
row by design: `FEATURE_SEARCH_CONSOLE` is unset in production, so the route returns
`{skipped:'flag_off'}` before `startCronRun`.

Wrangler's OAuth login expired at `2026-11-11T09:07:31Z`, so `npm run worker:schedules`
cannot re-read the deployed schedules until `npx wrangler login` runs again. This does
not affect the deployed triggers; the `0 9` firing above is the evidence they run.
That caveat no longer applies: Wrangler was re-authenticated and on 2026-11-12
`npm run worker:schedules` read all four deployed triggers (`0 9`, `17 16`, `17 4`,
`47 7 * * 1`, modified 2026-11-09/2026-11-11) and reported **no drift** against
`cloudflare/aiso-worker/wrangler.jsonc`.

## Studio LIVE continues the persisted thread (2026-11-12)

#236 (merge `58b2d53e`) makes a LIVE answer a continuation of the Studio thread rather
than a one-shot question. The client persists the turn first, then sends `threadId` +
`position` with the answer request; the server resolves that thread against the caller's
own `(id, account_id, client_id, profile_id)`, then replays up to the previous
`STUDIO_HISTORY_TURNS = 10` turns (8,000-character budget, 2,000 per message) as
user/assistant pairs before the current prompt, per platform. History is labelled as the
operator's earlier context and replayed as data. A thread that is not the caller's is
`404 NOT_FOUND` **before** any quota spend or provider call; a failed turn save leaves no
orphan LIVE panel. `FEATURE_CONVERSATION_STUDIO` is now on for every brand
(`STUDIO_ROLLOUT_CLIENT_IDS` removed) and `FEATURE_CONVERSATION_STUDIO_LIVE=1` enables
the answer route.

Two defects were found and fixed on the way:

- LIVE turn positions are **0-based** — the append statement picks
  `coalesce(max(position) + 1, 0)` — so validation accepts `0..STUDIO_TURN_CAP`, not
  `1..`. The first draft rejected `position: 0` and would have failed every real request
  (`9d10f8b3`).
- The flag value had been stored as `"1\r\n"` by piping through PowerShell, so
  `=== '1'` failed and the route returned 404. `vercel env pull` showed the value,
  `vercel env add ... --value 1` re-set it exactly, and the redeployed build
  (`aiso-6vwe990tc`, commit `58b2d53e`) logs `schema gate: all 106 shipped migrations
  are recorded`; the unauthenticated answer route now returns **401**, not 404.

The first PR-gate run failed on Studio e2e assertions that still compared the live
request body to its old `{prompt, platforms, language}` shape; the assertions now require
`threadId` and the turn `position` (`dfaf22a0`). Locally after that: the full
`conversation-studio` e2e spec passes **76/76** on chromium and mobile, and the unit
suite passes **8,433** tests.

Production evidence (test admin account, test brand `3511d812-2be7-4599-9442-ec4307cc399e`,
thread `17f6c7f1-6869-4de8-93ae-8538c7800756`): two turns were appended at positions
**0** and **1** through the real API, each composed on the server (`request_id` +
`receipts` stored). LIVE answer #1 hit a transient provider failure and stored
`PROVIDER_UNAVAILABLE` honestly; LIVE answer #2 answered **both** 第一問 and 第二問,
which is only possible if the first turn's prompt and answer came back as history. A
thread read returns both turns with their stored live replies. `studio_live_weekly_usage`
holds `answer_count = 2` for that brand in the week of 2026-11-09 (cap remains 10). A
signed-in UI smoke on the same deployment returned 200 for the brand home, Studio,
`reports?kind=monthly` and the month page, with the Studio composer, its continuity copy
and the weekly cap present in the HTML.

## Trial email: the fallback sender domain was never verified in Resend

The first `0 9` firing (`2026-11-11T09:01:01Z`) recorded only `{sent: 0, failed: 17}`;
it predates #232's `errorCodes`. The second firing (`2026-11-12T09:00:59.947Z`, the first
with #232 deployed) recorded `{sent: 0, failed: 17, errorCodes: ["error"]}` — the
bounded code is honest but blunt. Production runtime logs name the cause exactly:

```
[cron/trial-emails] failed to send to account 0749becd-…:
Error: Missing API key. Pass it to the constructor `new Resend("re_123")`
```

**Production's `RESEND_API_KEY` is absent at runtime, not merely wrong.** The Vercel
entry is `sensitive`, so `vercel env pull` writes `""` and the API refuses to decrypt it;
the runtime message is the only reliable reading, and it says the constructor received no
key. `providerErrorCode` therefore recorded the outer `Error.name` (`'Error'` →
`'error'`): `sendTrialEmail` never reached Resend. The helper now recognises that
message and records `missing_api_key` instead, so a recurrence names the fix in the
ledger rather than needing the one-hour runtime log. Nothing about the domain could have
mattered until a key exists.

The sender is a second, independent defect waiting behind it. With no
`RESEND_TRIAL_FROM_EMAIL`, `sendTrialEmail` falls back to `hello@fimmick-aeo.com`, and
DNS on 2026-11-12 shows `fimmick-aeo.com` has **no Resend records at all** —
`resend._domainkey.fimmick-aeo.com` and `send.fimmick-aeo.com` are NXDOMAIN — so that
domain can never be verified. `fimmick.com`, by contrast, has
`resend._domainkey.fimmick.com` TXT, `send.fimmick.com` MX and SPF
`include:amazonses.com`: it is the verified sending domain.

`RESEND_FROM_EMAIL` and `RESEND_TRIAL_FROM_EMAIL` were therefore set to
`business@fimmick.com` with `--value` (exact, no trailing newline; they are `sensitive`
Vercel variables, so `vercel env pull` writes them empty and the API refuses to decrypt
them, which is expected). Sensitive env changes only reach a new deployment, so
production was redeployed as `aiso-367j6s5ld` (commit `58b2d53e`, Ready, schema gate
106). That redeploy did not change the missing-key outcome: the next run still needs a
real `RESEND_API_KEY` supplied by the Resend account owner. Until then the trial drip
remains `{sent: 0, failed: 17}` — and the retry mask never advances, so the same 17
sends are still due.

﻿## SME copilot redesign: spec approved, slice 1 shipped behind a dark-launch flag

Owner approved the SME copilot redesign on 2026-11-12: five brand destinations
(Today / Chat / What AI says / Improve / Reports) plus an avatar account menu, full
redesign delivered slice by slice, spec first. PR #238 merged (`e45a00b1`) the approved
spec plus the missing source-of-truth docs `docs/ux/target-ia.md` and
`docs/ux/visual-system.md`; `lib/dashboard-nav.ts` and
`__tests__/config/design-tokens.test.ts` had referenced files that never existed.

PR #239 merged (`8dfa9c9e`) slice 1 behind `FEATURE_SME_COPILOT_UI`, which is **unset in
production**: the legacy UI is unchanged until a named approval turns it on.

- `lib/dashboard-nav.ts` now builds either the legacy IA or the approved five-destination
  IA; `locateDashboard` learned the account segments (`this-month`, `billing`,
  `visibility`, `outcomes`, `enterprise`, `studio/*`). The sidebar, ⌘K palette and
  breadcrumbs still read one model, and every old URL/tab route still resolves.
- New brand home `components/dashboard/today/BrandToday.tsx` +
  `lib/view-models/today.ts`: one recommended action from the existing
  `ownerPriorities`/`nextStep` projection (no new scoring), an ask composer that carries
  the question to `/studio?ask=` and only prefills the draft (saves, quota and receipts
  keep their existing path), at most three numbers, the month entry, one setup
  disclosure and one details disclosure for trend/priorities/health/monitoring/tools.
- An account with exactly one brand renders that brand's Today; two or more keep the
  portfolio. Studio keeps its own shell until slice 2.
- Dead ends fixed: the first-run questions step now opens the visible What AI says tab
  instead of the hidden, Pro-gated `/prompts`; brand switches and brand cards land on
  Today; sidebar sub-items meet the 44 px target.
- Verification: `npm run lint` clean, `npm run typecheck` clean, `npm run test:unit`
  **8,459 passed / 15 skipped** (656 files); new tests cover the SME nav mapping (12),
  the Today projection (9), the Today landing render (3) and the flag (2). The PR gate
  was green (static, unit-contract, integration, e2e-accessibility ×4, build,
  cloudflare-worker, aggregate `pr-gate`).
- Production deployment `aiso-mk6zredbt` (commit `8dfa9c9e`) is Ready; its build log records
  `schema gate: all 106 shipped migrations are recorded.` Production smoke after the
  merge: `/en` returns 200 and `/en/dashboard` still 307s to login, exactly as before
  (the flag is unset, so this build serves the legacy UI). Because the flag is unset,
  every route serves the pre-redesign UI.
- Next slices: Chat copilot landing and single shell, skill registry +
  `studio_threads.skill`, MCP rate limit/"connect your assistant", What AI says /
  Improve / Reports tab chrome, shared lock/empty/error primitives, and dashboard a11y
  fixtures (the current a11y matrix cannot reach dashboard routes).

## SME copilot: slices 2–3 (Chat landing, single shell, skills + MCP)

The owner set `FEATURE_SME_COPILOT_UI=1` on Vercel **production** on 2026-11-13
02:09 HKT (verified through the Vercel API: one `encrypted` production variable).
Production changes reach users only on a new deployment, so every merge below is
also the rollout step until the flag is removed.

- **PR #241 (merged `b4ea85c4`)** — Chat copilot landing. Question-first copy; the six
  home cards became one-tap sends that compose from **saved records only** (LIVE still
  needs the explicit Send, so a card cannot spend quota); the five filter chips are gone
  from this landing; one `execution-preview` line states what Send will read and how many
  live answers it will request (`lib/conversation-studio/execution-preview.ts`, derived
  from the same conditions that dispatch the reads). The legacy landing is unchanged when
  the flag is off.
- **PR #242** — single shell. Under the flag, `DashboardChrome` no longer takes its
  full-bleed branch for `/studio`; the Studio-owned rail is not rendered (the staff R3
  view keeps `StudioShell` for its live-grant banner and audit context), and the five
  secondary Studio destinations moved into one "More in Chat" disclosure so no route was
  lost. `StudioSessionProvider` and all thread/turn state are unchanged.
- **Slice 3 (this PR)** — skills and MCP hardening.
  - `lib/conversation-studio/skills.ts` is the server-owned registry: nine ids with
    category, run mode, the existing home task they formalise, their read-only MCP tools,
    and optional plan feature/destination. Copy stays in `messages/` (repo i18n
    convention) and the six v1 cards are derived from the registry.
  - **Migration `109_studio_thread_skill.sql`** adds nullable `studio_threads.skill` with
    a CHECK against the registry's closed vocabulary and a per-brand partial index. It was
    applied and `recorded` on the hosted branch **before** this PR merged
    (`npm run migrate -- --verify`: `109_studio_thread_skill.sql  all present  recorded`),
    so the production schema gate cannot block the build. Old threads derive the skill
    from the first turn exactly as before; a new thread stores it at creation and the
    API rejects unknown ids with 400.
  - **MCP rate limit**: every `tools/call` counts this principal's last-60-second rows in
    the insert-only `studio_mcp_calls` ledger and refuses the 31st with JSON-RPC
    `-32000 Rate limit exceeded`, recorded as `denied`/`RATE_LIMITED`, with no tool
    executed. A failed count fails closed (503 `AUDIT_UNAVAILABLE`). No new table or
    counter; `STUDIO_MCP_CALLS_PER_MINUTE = 30`.
  - **"Connect your assistant" card** on Chat → tools mints the existing one-hour session
    token and states the six read-only tools and the 30/min limit. It renders only when
    the transport is enabled for the brand and the signing secret is configured; the
    runbook now carries the skill map, the limit and the card.
- Verification: full unit suite **8,486 passed / 15 skipped** (660 files), `lint` clean
  (0 errors, 0 warnings), `typecheck` clean; new tests cover the registry (5), the MCP
  rate-limit refusal and fail-closed paths, thread skill persistence/validation against
  real Postgres (PGlite), and the connect card copy in both locales.
- Still owed after slice 3: action skills (`scan_brand`, `improve_page`,
  `monthly_report`) need the slice-4 inline confirm + plan gates + idempotency and a named
  approval before they can write; a real-brand authenticated preview run with the flag on;
  slices 5–7 (What AI says / Improve / Reports tabs, account/settings split, funnel and
  copy pass).

## SME copilot: slices 2 polish, 5 and 6 (PRs #244–#246)

- **#244 (merged `6265af5a`)** — polish. `/studio/overview` redirects members to the brand
  Today under the flag (the staff R3 view keeps the page; flag-off keeps the old behaviour),
  and an empty Chat history shows three example asks that prefill and focus the composer.
- **#245 (merged `8462a18a`)** — tab chrome for the two consolidated destinations, rendered
  once in `DashboardChrome` behind the flag. **What AI says**: 能見度 `?step=monitor`,
  AI 回答記錄 `/observations`, 引用來源 `/citations`, 競爭對手 `/competitors`, 監測問題
  `/prompts`. **Improve**: 掃描 `?step=scan`, 檢查結果 `?step=results`, 優化建議
  `?step=improve`, 待辦 `/tasks`. Every tab is an existing URL — no page moved, no
  redirect added — and Today/Chat/Reports/account pages render no bar.
- **#246 (this PR)** — Reports consolidation. The Reports destination gains the same tab
  set: 可分享報告 `/reports`, 月度報告 `/month` (with `/month/report` inside it), 全部品牌
  `/dashboard/this-month`. The two builders are prefaced by one chooser
  ("你想分享邊種報告？" → 掃描報告 / 月度報告) and the old scan-only Create CTA is hidden
  under the flag, so there is one entry point instead of two. Publish/share/review and the
  one-A4-page print behaviour are untouched; the legacy UI is byte-for-byte unchanged.
- Production: #244 deploy `aiso-ojvnmghij` and #245 deploy `aiso-2k3pag3zn` both Ready;
  both build logs read `schema gate: all 107 shipped migrations are recorded.` and `/en`
  answers 200. No migration in these slices.
- Verification: full unit suite **8,498 passed / 15 skipped** (663 files), `lint` clean
  (0 errors, 0 warnings), `typecheck` clean, `node scripts/text-audit.mjs` clean (the
  product-name rule caught a bare "AISO" in the new chooser copy, which was rewritten).
- Still owed: slice 4 (action skills — needs a named approval before any write), slice 7
  (account/settings split, `/entities` first-run, vocabulary pass), a real-brand
  authenticated preview run of the flag-on UI, and the axe fixture for each tab.
