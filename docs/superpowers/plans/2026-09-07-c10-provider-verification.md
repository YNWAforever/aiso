# C10 provider and scheduler verification matrix

Date: 2026-09-07. Candidate application/source d13110f on codex/c10-readiness-audit. Status: local contract checks passed; live acceptance incomplete. This document and its C11 companion supersede older inventory status only where fresh evidence is stated.

## Evidence levels

Local tests use mocked SQL/provider interfaces and dummy environment values. They are not real issuer, Stripe, email or AI execution. Cloudflare/Vercel/GitHub reads below inspect control-plane metadata only. No authenticated cron endpoint was invoked.

## Checks actually run

All commands used `node .superpowers/sdd/local-run.cjs` followed by the installed Vitest entry point, `run`, the paths below and `--maxWorkers=2`:

| Group | Exact paths | Result |
| --- | --- | --- |
| Auth, billing, email, cron, cleanup | __tests__/lib/auth.test.ts; __tests__/lib/auth-client.test.ts; __tests__/api/auth-route.test.ts; __tests__/api/stripe-checkout.test.ts; __tests__/api/stripe-webhook-full.test.ts; __tests__/api/stripe-entitlement-integrity.test.ts; __tests__/lib/pricing-billing-truth.test.ts; __tests__/lib/resend.test.ts; __tests__/api/cron; __tests__/api/cron-pulse.test.ts; __tests__/api/cron-ledger-wiring.test.ts; __tests__/lib/cron-ledger.test.ts; __tests__/helpers/neon-branch.test.ts; __tests__/helpers/neon-branch-config.test.ts; __tests__/scripts/prune-preview-branches.test.ts | 16 files,202 passed,6.77s |
| AI execution and alert controls | __tests__/api/pulse-run.test.ts; __tests__/api/authenticated-scan-entitlement.test.ts; __tests__/lib/alerts/evaluate.test.ts | 3 files,62 passed,1.88s |
| Worker dispatch | cloudflare/cron-worker/test/scheduled.test.ts with --config cloudflare/cron-worker/vitest.config.ts | 1 file,6 passed,0.36s |

Total270 tests. Expected negative-fixture diagnostics included unset secrets, unavailable Stripe/SQL and failed producer requests. No test failure occurred. A subsequent file search named a nonexistent __tests__/schema directory; this was discovery-only, not a test failure. Full app build/lint/types from d13110f's preceding handoff remain dated evidence, not rerun here.

## Fresh control-plane observations

- Cloudflare account e387dfbeded3deb5b8f0023a78a660b5 / aiso-cron-worker: schedules[], bindings[], compatibility2026-08-22; deployment9ee2db8b-fc56-4ff9-a8cf-32eacbe3172b, version2546d97d-edb8-4a16-a257-2b7750ef8af8. No job can be claimed active from this evidence. Public/preview access disabled is the earlier creation readback, not rechecked here.
- Local dedicated config proposes APP_BASE_URL=https://aiso-kappa.vercel.app; live Worker has no such binding. This is deliberate pending activation.
- Vercel selected AISO project prj_f9sxRkT1gxcBSYgT7ELIwHWqUDDV, team team_qvzlsFmfCsLkgItSypqHjw3z. Production alias resolves to READY deployment dpl_3NeDiY6mEEVp4iYcUiwDGz5ygKHE, SHA10d9a17cd6292a0534edf4fd532760a8de9ea454. It does not serve the local C9/C10 candidate.
- GitHub main is also10d9a17. Branch-protection endpoint returned404 Branch not protected; applicable branch rules endpoint returned[]. No enforcement change performed.
- Latest returned PR-gate run34051377075 passed on12ec30d23654d9c8206d80935a1b7173647fd1d8 (C9d). It is not CI evidence for d13110f or current C9e/f. [Run](https://github.com/YNWAforever/aiso/actions/runs/34051377075).
- Vercel connector responses do not expose cron definitions or environment bindings. No n8n workflow connector was available in tool discovery. Their scheduling/credential state remains unknown.

Automatic approval review initially rejected the opaque Cloudflare helper launch. Its full source was inspected: GET-only API calls, allowlisted output, no filesystem/provider writes, no-echo credentials. The scoped retry was approved and succeeded. No ACL was changed or denial bypassed; no unresolved approval-review blocker remains. The helper exited and did not persist the token.

## Exact next evidence per boundary

| Boundary | Required target/input | Authorized next read-only proof | Additional action requiring approval |
| --- | --- | --- | --- |
| Neon Auth | AISO isolated deployment, issuer URL, callback origins, synthetic user | Verify deployed SHA/environment identity and issuer metadata, without token/session values | Synthetic signup/login/logout/session expiry exercise; define email delivery behavior before sending anything |
| Stripe | Stripe account ID, test-mode prices, isolated webhook URL and owner | Confirm account/mode and price mapping without credential values | Test-mode checkout plus duplicate/out-of-order/replayed webhook cases on synthetic accounts; no live-mode payment |
| AI | Provider account, allowed models, budget ceiling, isolated client | Record configured provider/model mapping and local entitlement/timeouts | Explicitly bounded paid request only if separately approved; no scan from opening a dashboard |
| Email | Provider account, verified sender, isolated recipient/sink | Verify sender/account metadata and approved sink mode | Real email only to an explicitly approved address/count; existing send-then-persist duplicate risk remains |
| Scheduler | Exact Worker plus Vercel project and n8n instance/workflow IDs | Inventory each producer and per-route schedules; inspect sanitized completion evidence | Transfer one job at a time, approved secret mapping, isolated validation and per-job rollback |
| Cleanup | Exact project, disposable branch IDs, expiry policy and owner | Inspect TTL/orphans/default/protected state | Delete only explicitly approved branches; retained C9 proof branch is not automatic cleanup scope |

Never use a real cron GET as a read-only probe. HTTP2xx does not prove all chained Pulse work completed. Missing ledger rows can mean recording failed. A source configuration, missing API field, local mock or historical success cannot close an unknown live gate.

## Execution package requirements

Each mutation package must pin target IDs, current state, source/config/SQL diff, test credentials by source name (never values), maximum side effects/cost, acceptance/abort criteria and rollback. No product connector is selected; adding GSC or another integration still requires its own ownership/scopes/revocation contract. This matrix does not authorize provider writes or retirement of legacy workflows.
