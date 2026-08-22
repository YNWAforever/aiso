# Move Cron Triggering to a Cloudflare Worker, and Restore trial-emails Design

**Goal:** Stop relying on Vercel Cron to schedule `cron/pulse` and `cron/evaluate-alerts`, and
schedule them (plus a newly-restored `cron/trial-emails`) from a Cloudflare Worker instead.
Cloudflare's free tier allows 3 triggers per Worker; Vercel's Hobby plan caps at 2 crons at
daily granularity, which is what has kept `trial-emails` fenced with nowhere to be scheduled
even after it's restored.

**Context:** `cron/pulse` and `cron/evaluate-alerts` are both `GET` routes gated by
`Authorization: Bearer $CRON_SECRET` — the exact shape Vercel Cron sends automatically when
`CRON_SECRET` is set on the project (`app/api/cron/pulse/route.ts:55-61`,
mirrored in `evaluate-alerts`). Both already validate the secret defensively: reject if unset
or under 16 characters (500), then compare against a known-present value so an absent header
can never match an unset var (401 otherwise) — this guards specifically against the bug the
pre-fence `trial-emails` route had, where comparing against `` `Bearer ${process.env.CRON_SECRET}` ``
with an unset var produced the literal string `Bearer undefined`, which an attacker could send
verbatim.

`app/api/cron/trial-emails/route.ts` is currently `featureUnavailable('trial-emails')`. Its
pre-fence implementation exists in git history at `71abd27~1` — a complete, working 4-stage
drip campaign (day 1/5/7/10 emails via Resend, deduplicated with a bitmask on
`accounts.trial_emails_sent`, added by migration `016_trial_columns.sql`). It was historically
scheduled at `0 9 * * *` in `vercel.json`, before being fenced during the Supabase-to-Neon
migration.

## Approach

**One Cloudflare Worker, three cron triggers, zero code changes to the two existing routes.**
The Worker's `scheduled()` handler switches on `controller.cron` and makes one `fetch()` call
to the matching Vercel route with `Authorization: Bearer $CRON_SECRET` — the identical header
shape Vercel Cron already sends. `cron/pulse` and `cron/evaluate-alerts` don't need to change
at all; only `vercel.json` (remove the `crons` array) and their pinning test need to.

Two alternatives considered and rejected:
- **Three separate Workers, one per job.** Needless deployment surface — each job's
  Worker-side logic is a single `fetch()` call; splitting them triples the config/deploy
  surface for no isolation benefit worth having here.
- **Move the DB/Resend logic into the Worker itself** (e.g. via Hyperdrive), eliminating the
  extra HTTP hop. This duplicates business logic across two runtimes and is a bigger rewrite
  than what was asked for — Cloudflare is meant to be the clock, not a second copy of the app.

All three downstream routes are already idempotent (pulse via derived progress state,
evaluate-alerts via `claimEmailDelivery`, trial-emails via its bitmask), so Cloudflare Cron
Triggers' at-least-once delivery needs no new dedup mechanism on the Worker side.

## Components

### 1. `cloudflare/cron-worker/` (new)

Self-contained Worker, sibling to `app/`/`lib/`, with its own `package.json` and
`wrangler.jsonc` — a separate deployable unit, not part of the Next.js build.

- `wrangler.jsonc`: `triggers.crons` holds the three schedules, matching `vercel.json`'s
  current two exactly plus trial-emails' historical one:
  - `"17 4 * * 1"` → `cron/pulse`
  - `"47 7 * * 1"` → `cron/evaluate-alerts`
  - `"0 9 * * *"` → `cron/trial-emails`
- `src/index.ts`: `scheduled(controller, env, ctx)` maps `controller.cron` to a target path,
  does `fetch(`${env.APP_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })`,
  and throws on a non-2xx response so Cloudflare's built-in retry applies — no custom retry
  logic needed. `env.CRON_SECRET` is a Wrangler secret; `env.APP_BASE_URL` is a plain var.
- Tests: plain Vitest (not `@cloudflare/vitest-pool-workers` — the handler has no bindings
  beyond `fetch` and two env values, so mocking `env`/`ctx`/`global.fetch` as plain objects,
  the same shape the Cloudflare docs' own examples use, is sufficient and avoids a new heavy
  dev dependency). Assert each of the three cron strings dispatches to the right path with the
  right header.

### 2. Restore `app/api/cron/trial-emails/route.ts`

Ported to `db()`, reusing the original's exact email copy and day thresholds.

- **New `lib/trial-emails.ts`** — pure logic, no I/O: given `daysSinceStart: number` and
  `sentMask: number`, returns which of the 4 emails (day 1/5/7/10, each with its bit, subject,
  and body text) are newly due. Independently unit-testable without a DB or Resend, which is
  where the original's threshold/bitmask logic is most likely to hide an off-by-one.
- **Route logic**: same `CRON_SECRET` validation as `cron/pulse` (length-checked, safe
  comparison — the exact defense the original route was missing). Query joins `accounts` →
  `profiles` → `neon_auth."user"`, mirroring `lib/alerts/neon-store.ts`'s `loadEmailRows`
  shape: `SELECT DISTINCT ON (a.id) a.id, a.trial_started_at, a.trial_emails_sent, u.email`,
  never selecting both `accounts.id` and `profiles.id` in the same result (only `profiles.id`
  in the `ORDER BY`, not the `SELECT` list) — `accounts` and `profiles` both have a plain
  `id` column, and the Neon-driver duplicate-column hazard CLAUDE.md documents (last column
  silently wins via `Object.fromEntries`) triggers on two *selected* columns sharing an output
  name, not merely two tables sharing a column name. For each account with a resolved
  email, compute due emails via `lib/trial-emails.ts`, send each via a new `sendTrialEmail`
  in `lib/resend.ts` (alongside the existing `sendAlertEmail`), and update the bitmask with
  `UPDATE accounts SET trial_emails_sent = ${mask} WHERE id = ${accountId}` after each
  successful send. A per-account `try/catch` logs and continues rather than aborting the
  whole batch — matching the original's behavior, since one account's Resend failure
  shouldn't block the rest of the drip run for everyone else.
- `vercel.json` gets `"app/api/cron/trial-emails/route.ts": { "maxDuration": 60 }`, matching
  `evaluate-alerts`'s precedent (a route that isn't an LLM caller but awaits a Resend send
  per recipient, serially).

### 3. `vercel.json`

Remove the `crons` array entirely. Keep all three `functions` maxDuration entries — those
govern execution time regardless of what invokes the route, Cloudflare included.

### 4. `__tests__/config/function-durations.test.ts`

The three tests that currently pin `vercel.json.crons` get rewritten against
`cloudflare/cron-worker/wrangler.jsonc`'s `triggers.crons` instead, preserving the same
safety properties against the new source of truth:
- every scheduled path still resolves to a route file that exports `GET`
- evaluate-alerts still runs after pulse on the same day
- entry count stays at 3, matching (and pinning against regressing past) the Cloudflare free
  tier's per-Worker limit

The existing "no wildcard minute/hour" assertion is Vercel-Hobby-specific (that plan's
per-minute schedules require Pro) and has no Cloudflare equivalent — Cloudflare's only
per-schedule constraint is a 1-minute minimum interval, which none of these three approach.
That assertion is dropped, not ported.

### 5. `__tests__/api/fenced-routes.test.ts`

Remove the `trial-emails` entry.

### 6. New runbook: `docs/runbooks/deploy-cron-worker.md`

Human-executed, matching this session's established shape for credential-touching steps:
1. Copy `CRON_SECRET`'s existing value (from Vercel's project env) into
   `wrangler secret put CRON_SECRET` yourself — never typed, read, or logged by an agent.
2. Set `APP_BASE_URL` to the production deployment URL.
3. `wrangler deploy`.
4. Verify via Cron Events (dashboard) or `wrangler tail` that each of the three schedules
   fires and the downstream Vercel route responds `2xx`. Cloudflare's deploy propagation can
   take up to 15 minutes, so allow for that before concluding a schedule "didn't fire."
5. Only once verified: remove `vercel.json`'s `crons` array and redeploy on Vercel, so
   Vercel stops attempting to schedule these routes itself.
- **Rollback**: the three routes are unchanged and still accept Vercel Cron's exact request
  shape, so reverting is restoring the 3-line `crons` array in `vercel.json` and redeploying —
  no route code is coupled to which scheduler calls it.

## What this design deliberately does not do

- Does not change `cron/pulse` or `cron/evaluate-alerts`'s route code at all — only their
  trigger source changes.
- Does not touch any Cloudflare account settings, DNS, or other Cloudflare products — Workers
  + Cron Triggers only.
- Does not add a KV-backed idempotency layer on the Worker side — unnecessary given all three
  downstream routes already dedupe themselves.
- Does not migrate any business logic (DB queries, Resend calls) into the Worker — Next.js
  remains the only place that logic lives.

## Testing

- `lib/trial-emails.ts`: unit tests for the pure due-email logic — each day threshold, the
  bitmask correctly suppressing an already-sent email, multiple emails due at once (e.g. a
  cron that missed several days).
- `app/api/cron/trial-emails/route.ts`: mirror the existing route-test shape used for
  `cron/pulse`/`cron/evaluate-alerts` (mocked `db()`, mocked Resend) — CRON_SECRET
  validation (missing/short/wrong/correct), the join query, per-account failure isolation,
  bitmask update.
- `cloudflare/cron-worker/src/index.ts`: unit tests per cron string → correct path + header,
  and the throw-on-non-2xx behavior.
- `npm run test:unit`, `npm run lint`, `npm run typecheck` after all changes.
