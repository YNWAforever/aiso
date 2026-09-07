# Dedicated AISO Worker creation - 2026-09-07

## Result and authorization

The user explicitly authorized creating a new Worker dedicated to AISO. Created only `aiso-cron-worker` in account `e387dfbeded3deb5b8f0023a78a660b5`. No application deployment, cron invocation, email, scan, database write, or other Worker mutation was performed.

This supersedes the missing dedicated Worker finding in the earlier C10 live discovery. It does not resolve scheduler activation readiness.

## Deployment evidence

- Created: 2026-09-07T04:14:29.757204Z.
- Deployment: `9ee2db8b-fc56-4ff9-a8cf-32eacbe3172b`.
- Version: `2546d97d-edb8-4a16-a257-2b7750ef8af8`, 100% of this inactive Worker's deployment.
- Handler: `scheduled` only.
- Compatibility date: `2026-08-22`.
- Readback: schedules `[]`; bindings `[]`; subdomain `enabled: false`, `previews_enabled: false`.
- Existing scheduler source reused without changes: `cloudflare/cron-worker/src/index.ts`.
- Transpiled ES2022/ESNext module SHA256: `a178d5b14fd16bac26bf5def39c1e16445c7595573ba2ac5c6dcc33a5a8048bf`.
- Dedicated config: `cloudflare/aiso-worker/wrangler.jsonc`. Existing legacy config unchanged.

Wrangler was not installed. Creation used the Cloudflare REST multipart upload API with `main_module: worker.mjs`, empty bindings, and module MIME type `application/javascript+module`. The initial upload and diagnostic reproduction failed with HTTP 400 / 10021, `Unexpected token 'export'`, because plain `application/javascript` was used. Worker absence was checked before each attempt. Correcting the upload MIME type resolved the failure; application code did not change.

The temporary credential was supplied through no-echo process input, kept in process memory, and not written to a file, environment configuration, or git. The credential process exited after readback.

## Checks actually run

- TypeScript transpilation: no diagnostics.
- `node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run cloudflare/cron-worker/test/scheduled.test.ts --config cloudflare/cron-worker/vitest.config.ts --maxWorkers=2`: 6/6 tests passed, using mocked requests.
- Cloudflare settings, schedules, subdomain and deployments readback succeeded after creation.
- Local config assertions and `git diff --check` passed.
- No live scheduled handler test was run. Full app tests were not rerun for this config/document-only change.

## Remaining activation gates

The earlier discovery found `aeo.fimmick.com` NXDOMAIN. Confirm the intended AISO application deployment and working origin, verify the intended project's CRON_SECRET source, and establish exclusive scheduler ownership across Cloudflare, Vercel and n8n before preparing activation. The current resource has neither APP_BASE_URL nor CRON_SECRET. Existing trial-email idempotency and runtime evidence limitations remain open in the C10 audit. C10/C11 are not declared complete.

## Rollback proposal (not executed)

For account `e387dfbeded3deb5b8f0023a78a660b5`, verify `aiso-cron-worker` still has the version above, no schedules, bindings or newly attached dependencies. Then delete only `/accounts/e387dfbeded3deb5b8f0023a78a660b5/workers/scripts/aiso-cron-worker` and confirm absence. If state has changed, inspect dependencies before deletion. No unrelated Worker is a rollback target.

API references: [multipart upload](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/), [subdomain controls](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/).
