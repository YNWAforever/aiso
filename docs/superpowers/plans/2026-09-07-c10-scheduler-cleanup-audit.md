# C10 scheduler and cleanup source audit

Date: 2026-09-07. Read-only source audit at C9f handoff 8c3ecf82d39b4ab5c24583ced05a40d308d56902; application source a7cae4fd. C9f is complete and unchanged. This document is not a deployment, scheduler invocation, provider proof or approved repair design.

## Verified findings

1. Retry-safety wording is too broad. cloudflare/cron-worker/src/index.ts says all three downstream routes are idempotent. docs/runbooks/deploy-cron-worker.md repeats that assertion. app/api/cron/trial-emails/route.ts:69-78 explicitly sends before persisting the sent bit and acknowledges a later resend if persistence fails. The Worker throws for non-2xx; the trial route returns502 when any send/persist attempt fails. Therefore the source does not establish exactly-once email effects or blanket safe retries. This audit does not change the deliberately documented email behavior. A possible documentation-only repair should state the route-specific limitation. Changing delivery guarantees requires a separate design; do not silently add claims, retries or provider calls.

2. Local configuration is not deployed-state proof. Wrangler names fimmick-aeo-cron-worker, sets APP_BASE_URL to https://aeo.fimmick.com and maps three schedules: Pulse Monday04:17UTC, alerts Monday07:47UTC, trial emails daily09:00UTC. vercel.json has duration configuration and no crons key. These are repository values only. Neither proves which Worker/version is deployed, whether Vercel still owns schedules, or whether legacy n8n remains active. The runbook's historical statement that nothing schedules jobs until deployment is not a current observation. The six Worker tests mock fetch and exceptions; they do not establish Cloudflare platform retry behavior.

3. A2xx scheduler response alone is insufficient proof of completed downstream work. Pulse drives bounded producer chunks and can chain further work. Operational acceptance must correlate trigger time with safe ledger outcomes and relevant completion state, not just HTTP success. Do not invoke the authenticated cron routes as a read-only probe: they can write data, make paid provider calls and send email.

4. Preview cleanup selection has explicit safeguards: preview-name allowlist, protected ID/default/primary exclusions, parseable age and finite-clock requirements. No prune-preview invocation or schedule reference was found in the checked .github/workflows files. That absence does not rule out a provider-side or external scheduler. Live expiry settings, orphan recovery and sterile parent identity remain unverified. Do not run the cleanup script, including a dry-run that uses an unverified project identity, as an incidental audit step.

## Checks actually run

Commands used existing stripped dummy-local runner; no .env loaded:

```text
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/api/cron/trial-emails.test.ts __tests__/scripts/prune-preview-branches.test.ts --maxWorkers=2
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run cloudflare/cron-worker/test/scheduled.test.ts --config cloudflare/cron-worker/vitest.config.ts --maxWorkers=2
```

Both commands exited0: trial route12 + cleanup selector12 + Worker6 =30 tests passed. The missing-CRON_SECRET negative test prints its expected server-misconfiguration diagnostic; it is not a live environment failure. Worker tests use the already installed root Vitest and mocked fetch. These results do not prove runtime Worker types/deployment, live database roles, provider retry semantics, cleanup execution or email deduplication. No new tests or application changes were made. Graph queries for these cron symbols returned no matches; verified runbook/config paths and targeted file reads supplied the fallback.

## Next exact-target evidence package

Required identifiers before live inspection: Cloudflare account ID and Worker name/environment; Vercel team/project and production/preview target; legacy n8n instance/workflow IDs if still relevant. Do not supply secrets. Current repository names/origins are candidates, not verified bindings.

Once identifiers are supplied, prepare read-only inspection of deployed versions, trigger definitions, configured origin metadata and redacted execution summaries. Record each producer/route/schedule and timestamps, classify duplicate or missing ownership, correlate completion evidence, and identify a named operator. Avoid secret-value reads and raw customer/email payloads. Read-only metadata inspection has no deployment diff and no rollback mutation; stop on target mismatch or sensitive output.

Any proposed change must then carry exact target, reviewed configuration/source diff, isolated validation, abort conditions and rollback that avoids overlapping producers. Do not automatically apply the runbook's Vercel rollback snippet: it covers only two routes and does not by itself prove safe ownership transfer for all three. Branch deletion, secret rotation, schedule mutation, real email/provider requests and deployments remain outside current authority.

Migration043 remains user-reported applied with exact Neon project/branch/database and live proof unknown. C10 auth/billing/connector choices and C11 release/cutover/recovery gates remain open. This bounded audit does not close them or repeat completed C10 source repairs.
