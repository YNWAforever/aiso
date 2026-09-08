# Runtime readiness implementation checkpoint

> Historical snapshot: implementation-status statements below describe their dated checkpoint. See the [runtime readiness handoff](2026-09-08-runtime-readiness-handoff.md) for current local Slice B evidence and remaining live/review gates.

Date: 2026-09-08
Status: PARTIAL - Tasks 1 and 2 implemented; remaining Slice B is not complete.
Branch: codex/release-readiness-design
Slice base: bd0571e

## Implemented behavior

- Strict bounded policy/request contracts with canonical policy hashing and finite check vocabulary.
- Runtime reports bind interpretation to the validated policy, validate each relation index/privilege, preserve unknown evidence, and cannot claim production readiness or enforcement.
- Orchestration validates injected port results, rejects cross-category evidence, suppresses resources for unavailable/mismatched candidate identity, and independently gates database/auth dependencies.
- Shared 15-second deadline and at most 5 seconds per probe, cancellation signals, listener/timer cleanup, no retries, and safe late-rejection handling.
- Existing configuration-only API and 40 foundation tests remain unchanged.

## Pending material decision

The approved runtime probe plan says to reject BYPASSRLS. CLAUDE.md and migration 037 explicitly require aeo_app to retain BYPASSRLS for existing zero-policy RLS tables. The controller asked whether readiness should accept the documented aeo_app posture while continuing to reject superuser/owner roles. No answer has arrived. No role repair or database mutation is proposed or performed.

Until that decision is resolved, Task 3 database adapter is pending. Tasks 4 protected handler, 5 manual runner, and 6 final build/sample/live-proposal verification remain pending. This checkpoint is not an endpoint or runnable candidate CLI.

## Evidence limits

Only synthetic port/contract tests have run. No live provider calls, credential retrieval/provisioning, database query, scan, email, deployment, schema rehearsal or production write occurred.

Observed runtime team ID is explicitly unavailable when not independently supplied. Current orchestration fails closed on that missing identity. The later adapter/runner work must resolve the documented configured-team versus control-plane/runtime observation distinction without copying an expectation into observed evidence. Live acceptance is not established.

## Review and verification

Task 1 received independent approval after identity/completeness/index/unknown-status fixes. Task 2 is independently approved after correcting the TypeScript inference error. Both task reviews have no remaining blocking findings. Application source: 29ec1b7d187910e8453af2ddf561912dee2c81fa.

Controller at 9bce0b7: 105/105 readiness tests, scoped ESLint and Next type generation passed. Full tsc failed with TS2345 in the new bounded Promise helper. Correction 29ec1b7 explicitly types the Promise outcome union. The implementer reran 20/20 orchestration tests, TypeScript and lint successfully; the controller independently reran full TypeScript successfully at that commit. The full Slice B diff check passed and the worktree was clean. A production build and route/runner tests have not run because those tasks remain unimplemented.

Automatic approval review rejected removing the canonical 16 KiB policy-size guard as a security-constraint weakening. The accepted safer alternative retained the guard unchanged and completed the other contract repairs. The actual HTTP body stream boundary remains a Task 4 test obligation.