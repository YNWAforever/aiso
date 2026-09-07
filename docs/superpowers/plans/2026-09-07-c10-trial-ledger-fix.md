# C10 trial-email ledger correction

Date: 2026-09-07. Base:307d985, codex/c10-readiness-audit.

## Changed behavior

Trial-email runs with one or more failed send/persist attempts now finish their cron ledger row with status error, matching the existing HTTP502 response. Successful/no-op runs retain status ok. Counters, authentication, send-then-persist order, remaining-attempt continuation and HTTP body/status are unchanged. No retry, deduplication or delivery guarantee was added. Existing ledger write failures remain best-effort and can leave missing/incomplete records.

One runtime expression changed in app/api/cron/trial-emails/route.ts. The runbook now reflects that behavior. Existing tests assert exact ledger completion for successful/no-op/partial/all-failed outcomes, and a new regression covers a successful send followed by persistence failure with one send attempt in that invocation.

## Evidence

Read the installed Next16 route-handler guide before editing. Graph discovery located the cron ledger boundary; source inspection established the constant-ok defect.

Initial test instrumentation produced5failures because the new spy was not wired to the route mock. Corrected the test mock before changing runtime code. Valid RED:3failed/10passed; partial send, all sends and persistence failure each recorded actual ok instead of expected error. GREEN after the one-expression repair:4files/45tests passed.

Commands through the stripped dummy-local runner:

```text
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/api/cron/trial-emails.test.ts __tests__/api/cron-ledger-wiring.test.ts __tests__/lib/cron-ledger.test.ts __tests__/api/cron-pulse.test.ts --maxWorkers=2
node .superpowers/sdd/local-run.cjs node_modules/eslint/bin/eslint.js app/api/cron/trial-emails/route.ts __tests__/api/cron/trial-emails.test.ts
node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit
node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next build
```

Scoped lint and TypeScript emitted no diagnostics. Next16.2.4 production build exited0, compiled16.7s, TypeScript21.2s,15static pages. Expected negative-fixture diagnostics appeared in the cron tests. No browser test was run for this server ledger-only change.

Independent source review:APPROVED, no actionable findings. Reviewer confirmed only status selection changes and regression assertions preserve HTTP/counters/delivery behavior; test execution evidence was inspected by the parent, not independently rerun by the reviewer. git diff --check passed.

## Remaining phases and rollback

This completes the bounded trial-email reporting defect, not C10/C11. Remaining: isolated Auth/Stripe/provider verification, live scheduler ownership/activation acceptance, connector selection/scope, C1 equivalence and C11 release/rollback/recovery readiness. The selected AISO origin remains recorded, the Worker remains inactive, and prior disposable C9 SQL evidence remains valid at its recorded application source.

No external API call, database write, real email, paid scan, migration, deployment, push or merge occurred this turn. Local source rollback reverts this one status expression and its associated tests/docs; it cannot rewrite historical ledger rows. Do not backfill or reclassify live history without separate scope.
