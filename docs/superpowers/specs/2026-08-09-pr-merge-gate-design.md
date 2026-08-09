# PR Merge Gate and Release-Test Design

## Status

Approved design. This specification turns the user-provided deep-research report into an executable pull-request gate for the current repository.

## Context

The research report covers a broad product surface: tier entitlements, role and tenant isolation, alert evaluation, notification delivery, citation analysis, accessibility, performance, and weekly monitoring. A single first implementation slice would be too broad, so this design is intentionally limited to the deterministic PR/merge gate for the highest-risk paths.

At design time, the repository has no GitHub Actions workflow. The available package commands are `lint`, `test`, `build`, and Playwright E2E commands; there is no stable `typecheck` script. The report references additional acceptance, canary, coverage, and verification commands that are not currently present. The implementation must verify those assumptions against repository behavior rather than silently treating the report as already implemented.

## Goals

- Run a full deterministic gate on every pull request.
- Cover core revenue and security paths together with alert evaluation and citation analysis.
- Treat current repository behavior as the baseline; record report mismatches as explicit gap items.
- Block merges on P0, security, tenancy, entitlement, alert-integrity, migration, static-analysis, and build regressions.
- Keep PR validation independent of live Neon databases, AI providers, email/Slack delivery, production secrets, and paid services.
- Produce traceable evidence for every required check without exposing secrets, PII, or customer data.

## Non-goals

- Live staging acceptance, production deployment, or weekly production canaries.
- Live AI-provider, email, Slack, or database calls in the PR workflow.
- Redefining the product tier vocabulary or silently remapping report tiers to repository tiers.
- Full manual WCAG review on every PR.
- Introducing performance/load testing as a merge blocker in this first slice.

Those concerns remain follow-up staging or operational gates and must not be simulated as green PR checks.

## Proposed architecture

Add `.github/workflows/pr-gate.yml` with the following triggers:

- `pull_request` events: `opened`, `synchronize`, and `reopened`.
- Optional manual `workflow_dispatch` for maintainers to reproduce a PR gate.

The workflow uses Node 24, `npm ci`, the committed lockfile, and npm cache reuse. It uses least-privilege read-only repository permissions and `concurrency` cancellation so a superseded commit does not continue consuming runner time.

The workflow has four parallel required jobs and one aggregate job:

| Job | Responsibility | Required result |
|---|---|---|
| `static` | Lint and TypeScript validation | Zero lint errors and successful typecheck |
| `unit-contract` | Full deterministic Vitest suite, migration contracts, security boundaries, alert/citation domain tests | All required tests pass |
| `e2e-accessibility` | Critical user journeys and focused automated accessibility checks | Critical journeys and accessibility checks pass |
| `build` | Production build with sanitized fixture environment | Build succeeds |
| `pr-gate` | Depends on all four jobs and exposes the single branch-protection check | Every dependency succeeds |

The aggregate job must not mask failed dependencies with unconditional success. Diagnostic artifact upload may use `if: always()`, but the gate itself passes only when every required job succeeds.

## Deterministic test environment

Every test job creates a sanitized fixture environment. No production or user-provided secrets are required.

External boundaries use deterministic adapters or test doubles:

- Neon/database access uses an in-memory or mocked adapter for unit and API contract tests.
- AI provider responses use versioned fixtures covering success, empty, malformed, partial, timeout, quota, and provider-error cases.
- Notification delivery uses deterministic success, failure, retry, and malformed-destination fakes.
- Time is injected or fixed for threshold periods, cooldown windows, week rollovers, and retention boundaries.
- Fixture identifiers are stable and represent at least two isolated tenants, multiple tiers, and multiple roles.

Tests must fail if they unexpectedly call the network. Missing required fixtures or test layers must fail the job rather than being silently skipped. Unit tests run without retries; PR E2E runs also use no retries so a flaky test cannot appear green. Retry-based diagnosis belongs in a separate operational workflow.

## Test coverage model

### Unit and domain contracts

Cover the smallest independently testable rules:

- Tier and entitlement resolution, including positive and negative boundaries.
- Quota limit, limit-minus-one, limit, and limit-plus-one cases.
- Alert threshold crossing, week-over-week changes, cooldown suppression, recovery, and idempotent deduplication.
- Notification persistence before delivery, delivery failure recovery, malformed destinations, and safe error classification.
- Citation URL normalization, entity matching, canonical deduplication, aggregation, and ranking.
- Provider schema variation and deterministic fallback behavior.

### API and security contracts

Every high-risk route must cover:

- Anonymous access and authenticated access.
- Correct tier and insufficient tier.
- Owner, admin, analyst, and viewer behavior where those roles exist in the repository.
- Same-tenant and foreign-tenant identifiers.
- Expired or revoked access.
- Malformed input, database failure, provider failure, and notification failure.
- No mutation or data leakage after a rejected request.

The plan does not invent missing roles or capabilities. If the report names a role or tier that the repository does not implement, the evidence records a repository/report gap and the test is not rewritten to imply support.

### Migration contracts

Migration tests verify ordering, SQL portability, expected indexes/constraints, and protection of already-applied history. They must catch duplicate migration identifiers, unsafe transaction control, accidental legacy-provider grants, and destructive changes outside the approved scope.

### E2E and accessibility

The E2E job covers the smallest critical journeys for the selected scope: scan/revenue entry, entitlement boundary, alert configuration/evaluation surface, notification/error state, and citation-related user flow where the route is live in the repository.

Accessibility coverage in PRs is automated and focused on changed or critical UI: semantic structure, accessible names, keyboard reachability, focus behavior, and the applicable automated WCAG checks. Full manual WCAG 2.2 review remains a staging gate.

## Command contract

Add a stable `typecheck` script that runs `tsc --noEmit`. The workflow then invokes repository-owned commands rather than embedding undocumented command details:

```text
npm ci
npm run lint
npm run typecheck
npm test -- --coverage
npm run e2e
npm run build
```

The exact E2E fixture bootstrap and sanitized build environment are part of the implementation plan. They must not require a live database or provider credentials. Coverage is uploaded during this slice, but a numeric coverage threshold is not made a merge blocker until the baseline is measured and reviewed.

## Pass/fail policy

The following are hard merge blockers:

- Any P0 test failure.
- Any authentication, authorization, entitlement, or tenant-isolation regression.
- Any alert duplicate, cooldown, recovery, persistence-boundary, or notification-boundary regression.
- Any migration-history or schema-contract regression.
- Any Critical or High security finding.
- Any lint, typecheck, build, or required workflow failure.
- Any silent test skip, missing fixture, unexpected network access, or missing required test layer.

P1 and P2 failures are reported with owner and artifact metadata but do not block initially. Promoting a P1/P2 category to blocking requires a separate baseline decision; the workflow must not encode an arbitrary 98% threshold as a substitute for that decision.

## Evidence and artifact policy

Each job uploads failure-focused evidence:

- Static-analysis logs.
- Unit/contract JUnit output and coverage report.
- Playwright HTML report, screenshots, and traces only when needed for diagnosis.
- Build logs.
- An aggregate machine-readable summary containing commit SHA, job status, executed/skipped counts, failure priorities, and artifact links.

Artifacts must be scrubbed or fixture-only. Tokens, connection strings, email addresses, customer content, raw provider payloads, and PII must not be included. A test that cannot produce safe evidence should emit a sanitized error class instead.

## Repository/report reconciliation

The implementation must maintain a small reconciliation table in the plan or workflow documentation for report claims that do not match the repository. At minimum it records:

- Tier names and entitlement mapping.
- Implemented roles and permission semantics.
- Live versus fenced routes.
- Available package scripts versus report-referenced commands.
- Database/provider assumptions.
- Which requirements are P0 merge gates versus staging-only or operational requirements.

The repository is the current behavior baseline. The report remains the source of candidate requirements and risks, not proof that a capability exists.

## Acceptance criteria

The design is implemented successfully when:

1. A pull request automatically runs all four required jobs on every commit update.
2. Branch protection can require the single `pr-gate` check.
3. The workflow passes without live Neon, AI, notification, or production credentials.
4. A deliberate P0/security/tenancy/entitlement/alert failure blocks the aggregate job.
5. A deliberate P1/P2 failure is reported with evidence without incorrectly passing as an unobserved skip.
6. Static, unit, E2E/accessibility, and build evidence is available from the workflow run.
7. The repository exposes the documented `typecheck` command.
8. The workflow and tests contain no hardcoded customer data or secrets.
9. Staging/live-provider/weekly-canary work is explicitly outside this PR-gate implementation and has a follow-up design boundary.

## Handoff

After this specification is reviewed and approved, the next step is an implementation plan covering the workflow file, command additions, fixture adapters, test tagging, artifact handling, and branch-protection setup.
