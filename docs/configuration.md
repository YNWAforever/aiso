# Configuration notes

The README lists the variables you need to start; [`.env.example`](../.env.example) is the
authoritative list. These are the details behind it (moved from the README in UX Phase 8).

Auth and database clients are lazy. A successful build does not verify runtime configuration.
The readiness configuration report applies a stricter, explicit release policy to supplied
values, including values that current runtime paths only require when used. It is report-only:
it validates configuration shape and consistency, but does not contact providers, prove runtime
reachability, enforce promotion or establish production acceptance.

`CRON_SECRET` (≥16 chars) authenticates the weekly Pulse chain: the Cloudflare Worker
(`cloudflare/cron-worker/`, not Vercel Cron) calls `GET /api/cron/pulse` with
`Authorization: Bearer`, and that driver calls `POST /api/pulse/run` with `x-cron-secret`.
Both return 500 rather than running when it is unset. `/api/cron/trial-emails` is restored
(2026-08-22) and validates the same `Authorization: Bearer` shape; `/api/cron/evaluate-alerts`
is Neon-backed, accepting both header shapes on its own handlers. Scheduling requires
verified control-plane configuration.

Dead — read by nothing, listed so nobody re-adds them expecting an effect:
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (checkout is server-side only). `RESEND_API_KEY`
is used by the Neon alert evaluator. The legacy `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the Neon migration is complete
and no application code reads them.

E2E only: `BASE_URL`, `START_DEV_SERVER`, `CI`, `PLAYWRIGHT_STORAGE_STATE`.
`PLAYWRIGHT_TEST_EMAIL` and `PLAYWRIGHT_TEST_PASSWORD` are dead: the product has no
password sign-in. The authenticated journey replays a captured session
(`npm run e2e:auth:capture`, then `npm run e2e:authenticated`); see `CLAUDE.md`.

The optional `N8N_SCAN_WEBHOOK_URL` now also requires
`N8N_SCAN_WEBHOOK_SECRET` (at least 32 characters). The same value must be
configured in n8n's **AISO Scan Webhook** Header Auth credential as
`Authorization: Bearer <secret>`. The app skips optional enrichment when the
secret is missing or short and refuses HTTP redirects so the credential stays
at the configured destination. The core scan still saves and returns its result.
See [the secured webhook runbook](runbooks/secure-n8n-scan-webhook.md) before
changing a deployed integration.
