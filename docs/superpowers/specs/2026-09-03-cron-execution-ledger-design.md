# Cron execution ledger — design

**Status:** Approved 2026-09-03
**Scope:** Observability for the three scheduled cron routes. No change to what any job does.

## The problem, measured

Three production routes are scheduled by `cloudflare/cron-worker/wrangler.jsonc`:

| cron | route |
|---|---|
| `17 4 * * 1` | `/api/cron/pulse` |
| `47 7 * * 1` | `/api/cron/evaluate-alerts` |
| `0 9 * * *` | `/api/cron/trial-emails` |

`vercel.json` has **no `crons` key at all** — scheduling moved to the Cloudflare Worker on 2026-08-22.
There is no in-repo evidence the worker was ever deployed, and `docs/runbooks/deploy-cron-worker.md`
says that until it runs, nothing schedules these three routes.

**The database cannot answer whether they are running.** Measured read-only against production
(`red-firefly-93523049`) on 2026-09-03:

```
accounts total            : 11
  currently trialing      : 0
  with trial_emails_sent  : 0
pulse_weekly_summary rows : 0
notifications rows        : 0
prompt_bank rows          : 0
```

Every one of those zeros is **equally consistent with "deployed and idle" and "never deployed"**:

- `trial-emails` selects trial accounts and writes `accounts.trial_emails_sent` only for rows it
  finds. With zero trialing accounts it correctly writes nothing.
- `pulse` cannot produce a rollup because `prompt_bank` is empty — documented in CLAUDE.md as the
  upstream cause of six weeks of dead runs.
- `evaluate-alerts` writes notifications derived from the Pulse rollup, which has never existed.

So all three would leave exactly this trace either way. **No cron/run/heartbeat table exists** in any
of the 36 migrations, and the worker's only logging is a `console.error` on an unmapped cron,
visible in Cloudflare's dashboard and nowhere else.

The question "is the worker deployed?" is therefore unanswerable from here — and would be equally
unanswerable next month. That, rather than today's answer, is what this slice fixes.

## Design

### 1. Migration `039`: a `cron_runs` table

```
id           uuid primary key default gen_random_uuid()
route        text        not null      -- '/api/cron/trial-emails'
started_at   timestamptz not null default now()
finished_at  timestamptz                -- null while running
status       text                       -- 'ok' | 'error', null while running
detail       jsonb                      -- route-specific counts
error        text
```

Index on `(route, started_at desc)` — every query is "most recent runs of route X".

**`gen_random_uuid()` needs no extension here.** It has been a core function since PostgreSQL 13, and
production is 16. Do **not** add `create extension pgcrypto` for it: migration `027` had to be
repaired because it called `gen_random_bytes()` without enabling that extension, and reaching for
pgcrypto reflexively is how that recurs. `gen_random_bytes()` does require it; `gen_random_uuid()`
does not.

**Two writes, not one.** A start row is inserted before the job does anything; a completion update
sets `finished_at`, `status` and `detail`. This is the load-bearing decision. A completion-only write
makes a crashed or timed-out run indistinguishable from one that never happened — reproducing the
exact blind spot this slice exists to close. With a start row, a run that dies leaves
`finished_at IS NULL`, which is itself the signal. `vercel.json` caps these functions at 60s, so a
timeout is a real scenario rather than a hypothetical.

**Posture: no RLS.** An earlier draft of this spec said to enable RLS with no policies, "matching the
convention". That was wrong, and the correction matters. Those seven default-deny tables were created
by migrations `023`-`027`; since then `036` dropped all 30 Supabase-era policies and disabled RLS on
21 tables, and `035` -- the most recent migration to create a table -- states plainly: *"No RLS. […]
enabling it here would add a dead policy rather than a control."*

`aeo_app` holds `BYPASSRLS` deliberately (`037`), so a policy here would be inert whichever way it
was written. `cron_runs` is operational data with no tenant column, and
`__tests__/migrations/rls-policy-freeze.test.mjs` fails if any migration after `035` creates a
policy. Follow `035`: no RLS, and say why in the migration header.

**Grants must be verified, not assumed.** Migration `037` sets default privileges in schema `public`
for tables and sequences, so `039`'s table should reach `aeo_app` automatically. Migration `038`
exists precisely because that assumption held for tables and silently failed for functions, leaving
production broken for two weeks. The implementation checks the grant explicitly after applying.

### 2. `lib/cron/recordRun.ts`

Two functions: one that inserts the start row and returns its id, one that closes it out. Kept in its
own module rather than inlined so the wiring assertion below has something to assert against.

### 3. Wire the three scheduled routes

`app/api/cron/pulse`, `evaluate-alerts` and `trial-emails`. **`pulse/run` is out of scope** — it is
not scheduled; the pulse driver calls it internally.

### 4. A wiring assertion, not a unit test

The failure mode is not "the recorder is broken". It is "a route forgot to call it" — a route that
records nothing looks exactly like a route that never ran, which is the bug. So the test asserts that
**every scheduled route records a run**, in the shape of `__tests__/api/scan-security.test.ts`, which
asserts every check received the injected fetcher because that is the level the real bug lived at.

## How this answers the original question

`trial-emails` runs daily at `0 9 * * *`. Once this ships, **a row appears within 24 hours if the
worker is live, and none appears if it is not** — regardless of whether any account is in trial. The
ledger records *invocation*, not *work done*. That is the entire point.

## Error handling

If the ledger write itself fails, the route logs loudly and continues its real work. Observability
must not take down a production job.

**The cost of that choice, stated rather than hidden:** a failed ledger write is indistinguishable
from a run that never happened. It is mitigated by the fact that a database outage would fail the
job's actual work too — but it is not eliminated, and a future liveness alert would need to account
for it.

## Testing

- The wiring assertion above, watched failing by removing the recorder call from one route.
- The migration applied against a disposable branch, with the `aeo_app` grant checked explicitly.
- `npm run lint`, `npm run typecheck`, `npm run test:unit` clean.

## Out of scope

- **Liveness alerting.** Needs its own decisions — what counts as late for a weekly versus a daily
  job, and where the alert goes. Worth doing, but it is a second slice and pretending otherwise would
  make this one unbounded.
- **Retention.** One daily and two weeklies is roughly 470 rows a year. Building cleanup now would be
  premature.
- **Deploying the worker.** That is a human step in `docs/runbooks/deploy-cron-worker.md` requiring
  Cloudflare credentials. This slice makes its success or failure observable; it does not perform it.
- Any change to what the three jobs actually do.
