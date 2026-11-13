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

## SME copilot: slice 6 merged, slice 7 account/settings (PR #247)

- **#246 (merged `e8bd9a24`)** — Reports consolidation: 可分享報告 / 月度報告 /
  全部品牌 tabs over existing routes, one chooser ("你想分享邊種報告？") replacing the
  scan-only CTA under the flag. Publish/share/review/print untouched.
- **Slice 7 (this PR)** — account and brand setup for an SME:
  - **Settings split**: plan, billing link and members stay first; staff grants,
    Search Console connections and report branding move behind one **進階** disclosure
    under the flag. Both branches render the same panels (one `advancedPanels` value),
    so flag-off HTML is unchanged; the settings/sources route tests now walk the element
    tree instead of assuming a flat child list.
  - **`/entities` is the start-here page** for the copilot: a plain-language intro explains
    that brand identity (names/spellings) and the domain feed every scan, answer and report;
    the editor and domain verification are unchanged.
  - **`/sources` gains a plain-language intro** ("verified facts only support answers,
    never published; advanced — skip unless something is wrong"); the workspace, review
    destination and tenancy gates are unchanged.
  - Account menu destinations are unchanged (`/entities`, `/sources`, `/assets`,
    `/dashboard/settings`, `/dashboard/billing`); every URL still resolves.
- Verification: full unit **8,502 passed / 15 skipped** (669 files), `lint` clean (0/0),
  `typecheck` clean, `scripts/text-audit.mjs` clean. No migration.
- Remaining: slice 4 action skills (needs a named approval before any write), the real-brand
  authenticated preview run with the flag on, per-tab axe fixtures, and the vocabulary pass.

## Authenticated production preview (real brand, flag on) — 2026-11-13

The owner captured a real session once (`npm run e2e:auth:capture` against
`https://aiso-kappa.vercel.app`, zh-HK) so the flag-on UI could be checked in a browser
for the first time. Read-only: 27 page visits (22 desktop at 1440×900 + 5 mobile at
390×844), no clicks that mutate, brand `2fd186d8-c989-4eed-8e34-eb81841008a8` (FOTOMAX).

- **Result: every page 200.** No login redirect, no `Application error`, no 404 copy, no
  console errors, `h1` present on the content pages, and the section tabs render with the
  right active item: AI 這樣說 (能見度 / AI 回答記錄 / 引用來源 / 競爭對手 / 監測問題) and
  改善 (掃描 / 檢查結果 / 優化建議 / 待辦), Reports (可分享報告 / 月度報告 / 全部品牌).
  Today has no tabs, as intended.
- **Two findings fixed in this PR:**
  1. **Duplicate navigation.** The sidebar still expanded destination children (AI 能見度/
     觀察/問題庫/…, 掃描/結果/修復建議/…, 可分享報告/月度報告/全部品牌) under the same
     sections whose new tab bar already lists them. The copilot sidebar now renders no
     child list (the destination link itself is current); breadcrumbs and the command
     palette keep using `section.items`, so no trail was lost.
  2. **Contrast on the results step.** Axe found two serious colour-contrast failures on
     `?step=results` — `text-dash-muted/80` (3.46:1) for the scan domain and
     `text-dash-muted/60` (2.4:1) for the date. `ScanSummary` now uses the token at full
     strength (5.19:1 light, 5.10:1 dark); re-running axe is part of this PR's evidence.
- Honest limits of this run: screenshots capture the dashboard's scroll viewport rather
  than the whole inner scroll region, and the check is read-only (no scan/publish/save
  submitted against the real brand). The flag-off UI is not exercised here.

## SME copilot Slice 4 — action skills — 2026-11-13

Approved slice 4 ships behind the existing `FEATURE_SME_COPILOT_UI=1` flag only. It adds
three one-tap actions to the Studio landing; each opens an inline confirm and then calls a
**write route that already existed**. No new write API, no migration, no new flag.

- **Registry** (`lib/conversation-studio/skills.ts`): `StudioSkill.action` names the write
  path and its plan feature. `scan_brand` → `POST /api/scan`; `improve_page` →
  `POST /api/clients/{clientId}/agents/generate` (`agent_recs`); `monthly_report` →
  `POST /api/clients/{clientId}/months/{month}` (`client_reports_online`). Context skills
  keep no action; the six one-tap cards are unchanged.
- **Gates** (`lib/conversation-studio/skill-actions.ts`, unit-tested): no domain → scan asks
  for one; no completed scan → improve asks for a scan; missing plan feature or missing
  features → `planRequired` (the browser gate fails closed, and the server re-checks
  entitlement on the real route, so a 403 is reported as a plan limit rather than a generic
  failure). Bare saved domains are normalised with `https://`; the report month is the Hong
  Kong calendar month, not UTC.
- **Confirm and idempotency** (`components/dashboard/ConversationStudio.tsx`): the card
  button only opens the confirm (`role="group"`, title, what will be written, Cancel /
  確認執行). A ref guard plus disabled buttons stop a double tap while a run is in flight;
  success shows 完成 with a link to the destination, failure shows `role="alert"` copy and
  never turns green. Actions are hidden for staff views and outside the copilot flag.
- **Funnel** (`lib/observability/funnel.ts` + client list): `skill_action_confirmed`,
  `skill_action_completed`, `skill_action_failed` — name and locale only, no prompt, brand or
  scan data.
- **Saved turn:** every completed action writes a saved Studio turn (new thread in
  Continue). The client sends the skill prompt and a `requestId` only; the server
  composes the stored reply and receipts from the records the action just wrote, so the
  turn never claims a read that did not happen. A 202 "generation already running" is
  shown as pending and writes no completed-sounding turn; failures write no turn.
- **Verification:** unit **8,517 passed / 15 skipped**, `npm run typecheck` clean,
  `npm run lint` clean (0/0), `node scripts/text-audit.mjs` clean (the first pass caught a
  bare "AISO" in the new action note; both locales were reworded), `npm run build` passed.
  New tests: `skills.test.ts` action metadata, `skill-actions.test.ts` gates/URL/month,
  `studio-action-skills.test.ts` confirm/limit wiring. Re-running the authenticated
  production preview (axe on Chat) is the post-deploy check.

### Slice 4 — post-deploy verification (2026-11-13, production after #250/#251)

- Authenticated preview (real FOTOMAX session, zh-HK, read-only): 27 pages, **all 200**, no
  login redirect, no app error, no console errors, and **axe reports no serious/critical
  violations** — the `?step=results` contrast pair fixed in #249 is confirmed gone live.
- The duplicate sidebar children are gone live too: the observations page now lists only
  `AI 這樣說` + `AI 回答記錄` as navigation labels, reports only `報告` + its three tabs.
- Action UI probe on `/studio` at 1440 and 390 wide: the 動作 section renders three cards
  (生成優化建議 / 記錄本月數字 / 掃描品牌網站), the inline confirm opens with 確認執行 /
  取消, and the console stays clean. **No action was executed** against the real brand in
  this pass, so no scan quota, generation allowance or month record was spent; each write
  path is the existing route already covered by its own tests.
- The saved turn from #251 is code-verified (server-composed `{prompt, task, requestId}`
  append with receipts); watching a live action create it is left to the owner because that
  writes to the real brand.

## SME copilot — AI 回答記錄 simplified for the owner — 2026-11-13

Owner feedback: the observations page was too dense to use ("make it more simple and easy
to understand to use"). Rectified behind the same `FEATURE_SME_COPILOT_UI` flag, so the
flag-off page is byte-identical.

- **One clear purpose.** Header answers what this page is (AI 回答記錄), what it means
  (AI 答過你嘅問題，我哋逐條記錄低…) and where to manage questions.
- **Three plain stats** replace the raw row counters: 監察緊 N 條問題 / 已記錄 N 個回答 /
  最新一次記錄 (date, or 未有記錄 when empty).
- **Answer cards lead with the question**, then plain tags (platform · week · 完整回答 /
  未完整回答 · 有冇提及品牌) and one action 睇完整回答. Model, market and timestamps move
  into a 記錄詳情 disclosure instead of ten labelled rows.
- **The raw monitored-question list is gone.** The flat list that printed 啟用/停用 +
  目前分類: category_query + 目前語言: zh-HK is now a collapsed 監察緊嘅問題 section with
  監察中／已暫停 badges; no category or language codes are shown to the SME.
- **Filters live behind a 篩選 disclosure**, with a count chip when active and 清除篩選.
- **Empty states are explicit and truthful.** No recording yet: 未有 AI 回答記錄 + "you
  monitor N questions; answers appear after the next monitoring run". Filtered empty:
  呢個篩選未有記錄 + clear filters. Nothing invents an answer or treats zero as success.
- **Detail modal**: saved answer first, key points next, and the evidence fields (model,
  classification, links, limitations) folded into 技術資料.
- **Verification**: unit **8,524 passed / 15 skipped**, lint 0/0, typecheck clean, text
  audit clean, build passed. New `observation-sme.test.tsx` covers both locales, the
  honest empty state, the flag-off legacy branch and the evidence-first detail order.

### Observations final clarity pass — 2026-11-13

PR #253 merged as `568d3454`; its full CI gate passed. Authenticated read-only checks of
that production release returned HTTP 200 on desktop (1440px) and mobile (390px), with no
console/page errors or axe violations. The real FOTOMAX brand currently has 10 active
questions and zero records in the returned observation window; no monitoring or AI
collection was triggered to manufacture an answer for the preview.

The follow-up keeps the simplified layout and corrects the remaining ambiguity:

- Two compact side-by-side stats on mobile, with the selected week always visible above
  the records. Removed the page-slice date that could be mistaken for a brand-wide latest
  recording. Counts now follow the selected result filter as well as question/platform/week.
- Unknown question activity is not counted as active; truncated lists show a lower-bound
  `+`. The disclosure is named **Your questions / 你嘅問題** because it includes paused ones.
- A successful record means an answer and brand classification were saved, not proof of a
  complete provider response. The badges and action now say that; missing-answer records
  offer **View record**, never promise a full answer. Unknown mentions stay unknown.
- Empty copy describes the selected week and offers next steps, without claiming a pending
  run or promising that the next run will succeed. No claim that every question has an answer.
- Native disclosure arrows are visible for filters, question lists and technical details.
  Removed the technical maintenance footer from the SME branch only.
- **Clear filters** preserves the selected run, week and limit. The saved-answer dialog
  retains a plain-language test-response caveat; technical provenance remains available.
- Added bilingual unit coverage and keyboard/browser checks at 390px and 1440px for filters,
  run context, counters, plain-text answer safety, evidence disclosure, Escape/focus restore,
  overflow and accessibility.
- Local verification: lint 0 errors/warnings, typecheck and text audit clean, full unit
  **8,528 passed / 15 skipped**, production build passed. Observations browser suite:
  **16/16 passed**, including the four new SME locale/viewport cases. Full axe checks
  found a duplicate nested landmark in the new view; removed the redundant inner region
  and reran the entire observations browser suite with zero violations.

## SME daily workflow — PR 1: truthful next steps — 2026-11-13

The owner approved the next five-PR phase in [the daily workflow plan](ux/sme-daily-workflow.md).
This first change preserves Today action labels/reasons and exact scoped links rather
than replacing monitoring tasks with “Run a new scan”. It also normalizes the workspace
projector's `__locale__` prefix, which previously leaked through scoped saved-work links.
Existing website-fix prioritization is retained; no new priority score is introduced.
Empty SME observations gain a read-only monitoring-status link, preserving an explicit
run without implying that an empty historical week is the current monitoring period.
Configured brands blocked by pause/model/quota conditions get a status refresh rather
than a misleading question-edit CTA. Flag-off observations remain unchanged; the shared
monitoring wait-state correction applies to both layouts.

Authenticated canonical GET diagnosis at **2026-11-13 07:59 UTC (15:59 HKT)**, FOTOMAX
`2fd186d8-c989-4eed-8e34-eb81841008a8`:

- Both `pulse-runs` options and observations returned 200 using the saved owner session.
- Options: week `2026-11-09`, 10 active questions, 5 configured model variants, expected
  workload 50, context confirmed, remaining/cap 1500/1500; current canonical ID and
  latest run null, no current-week legacy answers or legacy repair IDs.
- **`enabled: false`, availability `paused`, action `wait`, `canStart: false`.** This
  establishes a current collection-availability blocker, not the historical cause of
  every missing answer and not proof that a scheduler is running or stopped.
- Schedule state unknown, next due null. Observations selected week null, no returned
  records, 10 explicitly active questions, list not truncated.
- No flag, model, schedule, plan or brand setting was changed. No monitoring, repair,
  generation, scan, email or other write endpoint was invoked. A live write test still
  requires separate approval; fixtures do not establish actual provider delivery.

Local candidate verification: lint 0 errors/warnings, typecheck and text audit clean;
full unit **8,531 passed / 15 skipped** (666 passed files, 1 skipped), production
build clean on Node 24.22.2. Component fixture generation: **204/204 passed**.
Browser fixtures: **84/84 passed**, no skipped/flaky/unexpected cases, covering
first-monitoring plus observations in Chromium and Pixel 5/mobile, including new
bilingual paused/model/quota read-only refresh and empty-answer status-link/axe
checks. The final Today priority-preservation adjustment was rechecked with all
10 Today unit tests and typecheck. CI integration and deployed acceptance remain
separate gates; local fixtures do not prove live providers.

CI on the initial PR #255 head found two older `audit-final-edges` cases still
asserted the deliberately removed configured-paused question-review link (both
locales, desktop/mobile). These assertions now require read-only saved-status
refresh and no misleading review link; recovery still asserts a second GET and
zero POSTs. All **8/8** focused browser cases pass locally. No production action
was invoked and no failing gate was bypassed; the updated PR head must pass CI.

## SME daily workflow — PR 2: guided monitoring — 2026-11-13

- The existing server-controlled SME flag selects a focused monitoring card on
  Today and the Monitor step. Saved charts/questions, alerts and extra tools stay
  available in disclosures; the flag-off layout remains available.
- The card separates expected answers, saved answers and completed brand checks.
  A paused collector does not erase saved records or prevent existing run-backed
  classification repair. No provider/customer AI-interface completeness is claimed.
- Start, collection repair, separate retest and saved-answer classification ask
  for confirmation with brand, frozen/current workload, allowance and possible
  model cost. Cancel/Escape starts nothing. Changed settings invalidate the
  confirmation; summary-only finalization retains its no-model existing path.
- The shared controller retains intent keys, duplicate-write lock, backoff and
  cancellation. It validates remote counts and acknowledgements, fails unknown
  reads closed, times out a GET after 15 seconds, and remounts per brand/locale.
  Pending leased work keeps polling even when no new item is retryable.
- Current canonical monitoring is selected ahead of a newer retest unless an
  explicit saved-run link was requested. Result links preserve run/week and the
  latest-record link does not overwrite that selection. Question editing remains
  on the existing editor with an SME-only return-to-monitoring link.

Local verification on Node 24.22.2: lint 0 errors/warnings, typecheck/text audit,
production build, **8,552 unit tests passed / 15 skipped** (668 passed files /
1 skipped), **204/204** fixture-generation tests, and **144/144** Chromium/mobile
browser cases with zero skips/flakes/unexpected failures. The guided matrix covers
en/zh-HK, 320/390/768/1440px, light/dark, keyboard focus/cancel, axe, lost-write-reply
GET recovery without rerunning collection, access/plan/outage/invalid reads,
paused saved-classification repair, and canonical/explicit-run scope versus a
newer retest. Existing first-monitoring and observations browser coverage also ran.
CI integration and canonical deployed verification are still separate release
gates. No production monitoring, paid generation or repair was invoked.

Release update (2026-11-13 09:02 UTC): PR #255 passed every job class plus the
aggregate gate at exact head `44d36980` and merged as `3431e7d7`. PR #256 was
retargeted to main after that merge; its gate and canonical acceptance remain
required. A merge alone is not evidence of a successful production deployment.

Canonical verification update (2026-11-13 09:06–09:15 UTC): PR #255's merge
`3431e7d7` reached production deployment `dpl_3qp2PhjtUdpAhyGfuxn5Jr3rT2Qo`,
Ready with the canonical alias. PR #256 subsequently passed every job class and
aggregate gate at exact head `bc7c2ab1`, merged as `e02288de`, and reached Ready
production `dpl_4QsnrVjMtsaK5KENjhuGMcgmpbXk` at the same alias. Each inspected
production build log names the corresponding main commit and records all 107
shipped migrations; no migration was added or applied for this phase.

Authenticated, read-only canonical checks passed for English at 1440px and zh-HK
at 390px: Monitor and empty observations returned 200; the empty-state link
retained the monitoring anchor; the guided card displayed the paused collector,
one visible refresh action, no start action, and the saved 10 × 5 = 50 workload
behind its disclosure. All non-GET/HEAD/OPTIONS browser requests were blocked by
the acceptance harness; none was attempted. Screenshots were inspected. This is
acceptance of the actual paused/read-only state, not a live provider-run test.
Read-only diagnostic API checks still show no saved run or answer, collector
`enabled:false`, schedule state unknown and no next due time; they do not establish
a historical root cause or scheduler health. The full four-width/theme journey
and paid-operation acceptance remain separate; paid production actions are not
authorized or exercised.

## SME daily workflow — PR 3: action outcome versus conversation save — 2026-11-13

- SME Studio actions now retain independent per-skill outcomes behind the same
  existing flag. A shared synchronous write lock prevents another action from
  stealing an in-flight result or starting a duplicate request.
- Confirmation freezes scan/domain/Hong Kong month identity. A successful scan
  links to its returned scan ID, Improve keeps the submitted scan ID, and monthly
  recording keeps the confirmed month even across a calendar rollover.
- A 202 response remains pending and creates no completed conversation. Lost
  transport replies, failed responses and malformed success bodies remain
  unconfirmed, with record-checking links rather than a safe-to-rerun claim.
- Action completion and conversation persistence have distinct status messages.
  An acknowledged server thread permits append-only retry using the identical
  request body and request ID. A lost create acknowledgement cannot recreate the
  thread or append to a local ID; it asks the user to check saved history instead.
  Local recovery state is retained. This is not durable exactly-once execution.
- The conversation is explicitly a separate summary of evidence loaded by the
  existing composer; it may read newer records. The frozen action scope in prompt
  text does not pretend to select a structured scan/month source for that composer.
- Confirmation/result copy no longer claims month snapshots are overwritten,
  that completed generation necessarily produced suggestions, or that a failed
  save acknowledgement proves no server record exists. No API/schema, tenant,
  entitlement, MCP, generation provider or server composition contract changed.

Local verification on Node 24.22.2: lint 0 errors/warnings, typecheck/text audit,
production build, **8,561 unit tests passed / 15 skipped** (669 passed files /
1 skipped), **204/204** fixture-generation tests, and **184/184** Chromium/mobile
browser cases, zero skips/flakes/unexpected failures. This includes 24 new bilingual
action outcome cases and existing Studio conversation/shell regressions. Tests
cover exact result scope, deferred cross-card locking, identical append retry,
lost create acknowledgement, pending generation, HKT rollover, lost paid-action
reply and malformed success bodies. They use intercepted offline transports, not
production paid actions. CI integration and canonical deployed acceptance are
completed for this slice as follows; final phase-wide accessibility adds the
explicit 320/390/768/1440px action-panel matrix and keyboard focus verification.

Release verification: PR #257 passed every exact-head CI class and aggregate
`pr-gate` at `5d7893fc05abd23153bcf283c903478fbe4ca842`, then merged as
`be51657524889f4addffc0bc2a7122a05b35dee9` at 2026-11-13 09:32:26Z. Vercel
production `dpl_62cAC9ERA5bwRt1H1Vp33cGXUTW8` is Ready and aliased to
`https://aiso-kappa.vercel.app`; its production build log names main `be51657`,
records all 107 shipped migrations, and completed at 09:33:09Z. Authenticated
canonical en/1440px and zh-HK/390px Studio checks returned 200, displayed all three
action cards and opened/cancelled the scan confirmation. Every non-read request
was blocked by the acceptance browser, and none was attempted. Both captured
confirmation screenshots were inspected; they are bounded viewport checks, not
proof of the full matrix or actual paid execution/persistence. The acceptance
script waits for the client thread-index GET before interacting, rather than
clicking server-rendered controls before hydration.

## SME daily workflow — PR 4: saved evidence to private work draft — 2026-11-13

- The existing server-controlled SME flag now selects a focused presentation on
  Opportunities, including the owned-source-unavailable fallback. Legacy
  presentation remains the default when the flag is off.
- The first existing display unit remains first: returned explicit monitoring
  groups before returned individual findings, in their existing order. A blocked
  first unit is never silently replaced by another. Other findings and full
  evidence/window details remain mounted in native disclosures.
- Partial, unavailable, truncated, unknown-saved, limited-evidence and conflict
  notices remain explicit. The primary card shows one source-specific reason and
  its existing save-or-open action. Group save handlers retain their single
  mounted state, duplicate-write lock and acknowledged draft IDs while details
  are collapsed or reopened; no grouping is inferred from matching text.
- Selected-scan Improve gains a read-only bridge to the separate saved-evidence
  workflow. It does not map generated recommendations to eligible work items or
  redirect the selected scan to the latest one. Generation remains explicit and
  secondary; no generation or draft write starts on render.
- Eligibility, source/rule/fingerprint/locale write bodies, re-derivation/CAS,
  tenant/entitlement checks, per-key conflicts, selection epochs, saved-ID reads,
  dirty editor, versions, approval and delivery contracts remain unchanged.
  Saving organizational-private work does not publish, approve or verify it.

Read-only independent review found no introduced regression in the scoped diff.
The focused 128-case Chromium/mobile run passed, including grouped historical
conflicts, blocked first findings, exact grouped save inputs and retained IDs,
feature-off refusal without individual fallback, no inferred grouping, SME on/off
503/409/late-read/known-limited-draft behavior, and en/zh-HK light/dark
320/390/768/1440px reflow/axe/keyboard disclosure and 44px summary targets.
Full candidate verification on Node 24.22.2: lint 0 errors/warnings, typecheck and
text audit clean, **8,569 unit tests passed / 15 skipped** (669 passed files /
1 skipped), production build passed, **208/208** fixture-generation tests and
**256/256** Chromium/mobile browser cases with zero skips/flakes/unexpected
failures. The latter also reruns saved draft list/restoration, unsaved editor,
version submission/review/approval and delivery/attestation regressions. CI
integration and exact-head aggregate gate plus canonical read-only deployment
acceptance remain required. All action transports in browser tests are
intercepted fixtures; production paid operations are not authorized or exercised.

Release verification: PR #258 passed every exact-head CI class and aggregate
`pr-gate` at `b7dd6bbfa67a1421eb4e44e328cabfb9dff1b9cc`, then merged as
`7b281370fe93f1ebc14acfcb8af19c7137f1b3d9` at 2026-11-13 09:56:50Z. Ready
production `dpl_375siTPKxbbwh7gUjiswm4LansPH` is aliased to the canonical host;
its build names main `7b28137`, all 107 shipped migrations recorded, and
Build Completed 09:57:23Z. Canonical authenticated Opportunities checks in
en/1440px and zh-HK/390px returned 200, displayed the new one-draft heading and
at most one visible finding, and keyboard-opened the evidence disclosure.
Both cases passed axe/reflow with no page errors and no non-read requests
attempted (the browser blocks them). Both bounded viewport screenshots were
inspected. Saving/editing/reopening/version/approval/delivery remain fixture and
CI evidence, not a claim of production write acceptance.

## SME daily workflow — PR 5 candidate: keyboard and bilingual acceptance

- Studio confirmations now receive focus when opened, support Escape and Cancel
  returning to the newly mounted opener, and move focus to their action heading
  after explicit Confirm or append-only retry. Async completion does not steal
  focus from the owner's next question. Card headings and visible focus outlines
  are semantic and keyboard-tested.
- All three Studio confirmations are exercised in en/zh-HK, light/dark and
  320/390/768/1440px, with 44px action controls, reflow and axe. Cancelling writes
  nothing; unknown thread creation offers history instead of creating a duplicate.
  Deferred append retry additionally proves heading focus, identical original
  save input and preserved composer focus when the save reply arrives.
- SME monitoring uses a saved-AI-answer heading, not a ranking claim. The paused
  state and primary Refresh are no longer repeated; all distinct model/question/
  context/allowance blockers remain visible and secondary Refresh is retained when
  another primary action is shown. Flag-off heading/presentation remain unchanged.
- Existing save/list/reload/dirty-draft browser journeys now run in both SME and
  legacy modes using actual hydrated component variants.
- Full regression exposed an existing missing ICU `{answers}` argument in the
  private monthly report page. Pass the raw localized rule-note template to the
  existing view, which inserts the report's frozen answer threshold. Two strict
  translator regressions prove both report locales with a non-default saved
  threshold, including a Chinese report inside English dashboard chrome. This is
  a one-line read-only copy fix, not a report/schema/movement/publishing change.

Read-only independent review found no introduced correctness/security blocker;
its suggested append-focus coverage and existing report-template correction are
included. Release requires every exact-head CI class plus aggregate `pr-gate`,
then independent canonical Ready deployment/schema-gate verification and the
64-case read-only matrix (four destinations, two locales/themes, four widths).
The final deployment identity and matrix results are recorded in this slice's PR
release-verification comment after merge, not inferred from local fixtures. Paid
production and brand writes remain outside the approved acceptance scope.

Final candidate local gates on Node 24.22.2 passed: lint 0 errors/warnings,
typecheck and text audit clean, **8,573 unit tests passed / 15 skipped** (669
passed files / 1 skipped), production build, **208/208** fixture-generation tests,
and **700/700** Chromium/mobile browser cases across the twelve daily-workflow
and downstream regression specs, **zero skips/flakes/unexpected failures**.
The final run includes the strict report-copy and deferred append-focus checks.
A preliminary local browser invocation omitted an onboarding fixture directory;
all twelve setup failures were identified and the complete fixture environment
was restored for the passing rerun. No product assertions or lint rules were
weakened to pass validation.

A fresh canonical GET-only diagnosis at 2026-11-13 10:11Z still confirms 10 active
questions × 5 variants, 50 expected answers, 1,500 allowance remaining, collection
paused, no canonical/latest run and zero saved answers. Schedule/next-due remain
unknown; this establishes the current blocker, not a historical root cause or
scheduler-health claim. No configuration was changed to make acceptance pass.

## SME execution workflow — PR 1 candidate: resume saved work

The [approved five-PR execution phase](ux/sme-execution-workflow.md) continues from
saved drafts to explicit review, delivery and verification. It does not authorize
production brand writes, audited exports, website handoffs or paid workloads.

- The existing SME flag now selects a next-step presentation for Tasks. Returned
  order, concrete draft/review URLs, the 200-item cap, ownership and unavailable
  reads are unchanged. Recorded delivery is not presented as verified impact.
- Saved draft editors receive that same serialized flag. SME edits and save are
  prominent; review navigation appears only when edits are clean and not saving.
  A clean SME save is disabled instead of sending an unchanged PATCH. Legacy
  presentation and all edit/revision inputs remain unchanged.
- Saved evidence and recording metadata use native disclosures, without unmounting
  fields or operation state. Pulse uncertainty and scan redaction/limited-evidence
  warnings stay visible above the editor. Conflict reload still explicitly replaces
  local edits; a failed save does not expose a review link for dirty work.
- New owner-page/SSR tests cover flag modes, returned ordering, concrete links,
  delivery wording, ownership denial and unavailable reads. Hydrated journeys add
  pending acknowledgement, confirmed save, preserved conflict edits, explicit reload
  and keyboard evidence disclosure in both locales and flag modes.

Focused unit checks passed **28/28**. Read-only independent review found no
introduced actionable issue. Full candidate gates on Node 24.22.2 passed: lint
0 errors/warnings, typecheck, text audit, **8,581 unit tests / 15 skipped** (670
passed files / 1 skipped), production build, **210/210 fixture tests**, and
**708/708 Chromium/mobile browser cases**, zero skips/flakes/unexpected failures.
A preliminary browser run found twelve obsolete SME heading expectations; the
assertions now check the new heading and keyboard-open the saved evidence before
checking its exact original content. Duplicate-write/focus/conflict assertions
remain intact; the complete suite was rerun, not only the failures.
Exact-head complete CI and canonical read-only release acceptance remain pending;
no production draft persistence or real SME usability acceptance is claimed.
