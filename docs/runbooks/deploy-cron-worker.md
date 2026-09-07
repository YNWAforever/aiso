# Runbook: activate the dedicated AISO cron Worker

## Current status and scope

The dedicated `aiso-cron-worker` was created on 2026-09-07 in Cloudflare account
`e387dfbeded3deb5b8f0023a78a660b5`. Its recorded readback has no schedules or
bindings, with workers.dev and preview URLs disabled. See the
[creation evidence](../superpowers/plans/2026-09-07-c10-dedicated-worker-creation.md)
for version and deployment IDs. This is a dated observation; refresh it before changes.

Use `cloudflare/aiso-worker/wrangler.jsonc` for this resource. It reuses
`cloudflare/cron-worker/src/index.ts`. The legacy `cloudflare/cron-worker/wrangler.jsonc`
is not an activation template: it targets a different name and includes an origin
that returned NXDOMAIN during the [live discovery](../superpowers/plans/2026-09-07-c10-live-scheduler-discovery.md).
Do not deploy it to provision AISO.

Creating the Worker did not authorize activating jobs. Activation can cause database
writes, paid AI calls and real email. The steps below are preparation until an exact
activation target, configuration diff, validation and rollback are approved.

## Prepare the activation package

Record the intended Vercel team/project, production or isolated target, deployment
ID and source SHA, working HTTPS origin, database identity/application role, provider
mode and operational owner. A READY preview or a familiar domain does not establish
production suitability. The current AISO and legacy Vercel projects are different
resources; do not switch between them implicitly.

Inventory live producers for each route across Cloudflare, Vercel Cron and legacy
n8n. Record observed timestamps, schedules, enabled state and owner. A missing
`crons` key in local `vercel.json` does not prove deployed jobs were retired.
Establish one producer per enabled job before activation. Unknown ownership blocks
activation; do not retire a workflow based only on repository configuration.

The source supports these schedules; the dedicated config intentionally enables none:

| Route | Supported cron (UTC) | Acceptance evidence |
| --- | --- | --- |
| `/api/cron/pulse` | `17 4 * * 1` | Trigger and ledger correlated with producer completion/rollup state; a 2xx alone is insufficient |
| `/api/cron/evaluate-alerts` | `47 7 * * 1` | Evaluation outcome and relevant completion counters; scheduled later than Pulse, but elapsed time does not prove Pulse finished |
| `/api/cron/trial-emails` | `0 9 * * *` | HTTP status plus sent/failed counters and ledger; investigate partial failures before replay |

Prepare a diff to the dedicated config that adds the approved HTTPS `APP_BASE_URL`
and only the individually approved cron strings. Keep the exact account/name,
`workers_dev: false` and `preview_urls: false`. Do not enable all jobs just because
the route map supports them.

`CRON_SECRET` must match the selected application's secret (at least 16 characters),
transferred through an approved secret-management path. The Cloudflare API credential
is not the application's cron secret. Do not put secret values in git, command
arguments, logs or evidence. Verify presence and source mapping without exposing values.

## Local and isolated validation

Run from the repository root with installed tools:

```text
node node_modules/vitest/vitest.mjs run cloudflare/cron-worker/test/scheduled.test.ts --config cloudflare/cron-worker/vitest.config.ts --maxWorkers=2
```

These tests use mocked requests. They establish route/header dispatch and error
propagation, not Cloudflare retry policy, live origin reachability, database behavior
or email deduplication. Any remote test requires a separately approved isolated target
and fake providers. Do not call authenticated cron routes as a read-only health probe.

Before the approved deployment, inspect the exact config and generated artifact.
Wrangler should always receive the dedicated config explicitly; for example, from
the repository root, the local artifact preparation command is:

```text
wrangler deploy --dry-run --config cloudflare/aiso-worker/wrangler.jsonc
```

Wrangler was unavailable during initial provisioning; that creation used the REST
multipart API instead. Do not treat the command above as a check already run. For a
REST module upload, preserve `main_module` metadata and use the module content type
`application/javascript+module`; the initial plain JavaScript content type was rejected.

## Execution and acceptance after approval

1. Refresh target and current-producer evidence; abort if it differs from the reviewed package.
2. Follow the approved ownership transition, accounting for in-flight executions before enabling the replacement. Do not create overlapping producers.
3. Apply only the reviewed dedicated config and secret mapping to the exact Worker.
4. Read back deployed version, origin metadata, secret binding name, schedules and disabled public/preview access. Never print secret values.
5. Observe the approved scheduled executions and correlate safe ledger/completion summaries for each route. Record skipped, empty, partial and failed outcomes explicitly. A successful trigger alone is not successful product work.

The Worker makes one fetch attempt per invocation and propagates failures. Its source
contains no retry loop. Do not infer platform retries from a thrown exception or the
mock tests. Trial emails send before persisting the sent bit; if persistence fails after
a successful send, another invocation can resend that email. Concurrent invocation safety
and exactly-once delivery are not established. A trial route can return 502 with failed
attempts even when the ledger's completion status is `ok`, so check the counters and HTTP
result together. Changing delivery guarantees is a separate implementation decision.

## Rollback

The pre-activation baseline for the dedicated Worker is no schedules, no bindings and
disabled public/preview access. Prepare a configuration rollback for this exact resource,
including restoration/removal of activation-added origin and secret bindings through the
approved secret-management path. Removing schedules prevents future triggers; it does not
cancel in-flight requests or reverse messages, provider spend or database writes already made.

If a previous producer must resume, restore only its explicitly recorded jobs after
verifying the replacement is disabled and resolving in-flight/partial work. Account for
Pulse, alerts and trial emails separately. Do not paste a generic two-route Vercel cron
array or assume current plan limits allow a particular fallback. If no previous producer
was verified, leave the affected jobs paused and report the gap.

Record the rollback version/configuration, live schedules, ownership and outcome evidence.
Deleting the dedicated Worker is a separate rollback of resource creation, described in
the creation handoff; it is not required merely to pause scheduling.
