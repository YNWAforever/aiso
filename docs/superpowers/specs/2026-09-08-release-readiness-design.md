# AISO release reliability: readiness checks and controlled promotion

Date: 2026-09-08
Status: design approved in conversation; written spec awaiting user review. No implementation or external workflow change authorized by this document.

## Problem and evidence

PR19 merged to main at 8d285cc890fd087fccc04f7d5bc10613f927a0a1 with passing CI. Production nevertheless lacked usable auth, database, rate-limit and database-identity configuration. These failed sequentially at runtime because auth/db clients are lazy and CI uses fixture values. Production settings were repaired with explicit approvals. One subsequent www.fimmick.com scan returned200 and saved result08355c71-fbe2-415d-91fb-822b95c42218, score73, gradeB; its public page returned200. This proves that observed scan flow, not every provider, customer journey or C9 schema gate.

The C11 dossier predates these repairs and needs evidence reconciliation. The local checkout is clean and this design starts from the merged main SHA. Current vercel.json specifies function durations; it does not establish controlled promotion. Existing PR gate remains required source-quality evidence and will not be replaced.

## Selected approach and alternatives

Use two stages: deterministic configuration validation, followed by candidate-runtime verification and a readiness report tied to immutable source/deployment identity. Begin in report-only mode, validate fault detection, then enforce promotion through a separately approved workflow/platform change.

A documentation-only checklist is cheaper but would not prevent the observed omissions. Blocking builds on every environment variable conflates optional features and fixture builds with production readiness and cannot establish runtime identity. The selected design preserves lazy framework initialization and existing product/security behavior while checking real deployment prerequisites explicitly.

## Scope and boundaries

Deliver configuration contracts, candidate read-only probes, schema-equivalence evidence validation, readiness report generation, regression coverage and an enforcement activation package. No new product slice, UI redesign, provider activation, broad refactor, authentication bypass, schema mutation or scheduler activation.

Implementation and tests use synthetic fixtures. Live branch creation/reset/deletion, deployment creation/promotion, production environment changes, CI enforcement changes and paid/provider acceptance each retain their explicit action approvals. The previously approved single scans do not authorize more scans.

## Component responsibilities

### Configuration contract

A pure validator accepts environment values in memory plus an explicit release capability manifest. It returns stable check IDs, pass/fail/unknown states and actionable variable names. Missing, whitespace-only, invalid-format and inconsistent values fail. No value, credential hash, cookie, connection URI or raw SDK exception is emitted or persisted.

Core public-scan readiness includes DATABASE_URL, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET (at least32 characters), PUBLIC_SCAN_RATE_LIMIT_SECRET (at least32 characters), production origin and supported hosting identity. Require explicit expected project, branch, role and database in the release policy, even where current runtime guards permit optional expectations. Match the already approved AISO target without hardcoding it as a universal default. Preserve forbidden-target precedence and existing db-binding checks.

Map dependent capabilities from actual call sites before implementation: report sharing/claiming, AI-assisted checks, billing, email and scheduled jobs. A reachable capability cannot be marked disabled merely to obtain a passing report. Disabled is valid only with verified existing gating; otherwise missing configuration fails that capability's release requirement. AI check degradation must be reported explicitly, never relabeled complete because the scan returned200. Report provider configuration readiness separately from live execution acceptance. Migration-owner credentials are never a runtime requirement and must not be copied into new runtime tooling.

Update stale setup prose describing auth construction at build time. Keep optional-feature policy declarative; do not introduce feature fences or change product behavior in this slice.

### Candidate-runtime probes

Run probes against the exact candidate deployment, not an arbitrary alias or the current production deployment. Establish project, commit SHA, deployment ID and environment scope first. The runtime probe checks values inside the candidate process: Vercel metadata listing a sensitive key is insufficient because its value is omitted.

Proposed interface: one internal readiness handler authenticated by a dedicated operator credential, with a narrow configuration/identity response. It is inaccessible anonymously, uncached, bounded by timeout, and never returns secret values. The implementation plan must pin the credential source and deployment-protection access method before any live configuration. Local tests use synthetic credentials. Read installed Next16 guidance before framework work.

The handler performs an explicit read-only identity query using the candidate DATABASE_URL, reusing the existing binding contract. Check project, branch, database, least-privilege role and required schema/grants via metadata only. Query no customer rows. SQL/permission errors are redacted and fail closed. Do not create tables, alter grants, migrate, consume quota, execute cron routes or call scan handlers.

Auth verification checks configuration, public issuer metadata and anonymous session resolution; it creates no user, login session or email. Report limitations: this does not verify signup, authenticated sessions, billing or provider writes. Probes cannot automatically expand their scope following a failure.

### Schema-equivalence evidence

The existing reviewed runner compares replay-to-head with baseline-to-head. Keep it separate from ordinary readiness probes because it creates and deletes a disposable branch and resets public twice. First close the documented explicit-parent enforcement gap, with focused local tests and independent review. Require a sterile parent; historical synthetic-only statements are not permanent proof.

A live rehearsal requires an exact approved project, parent, child-creation policy, migration/baseline hashes, role, cleanup and cost scope. Never use the retained C9 proof branch or runtime production branch for resets. Require no schema differences, successful bootstrap dry-run, runner success and explicit child-deletion readback. Cleanup failure fails acceptance even if the existing runner exits0. Evidence must include runner/harness version and migration/baseline manifest hashes.

Reuse equivalence evidence only when these inputs match exactly and the rehearsal was performed within30 days. Any migration/baseline or relevant harness change invalidates it. Schema equivalence is distinct from actual candidate database migration/grant readiness; both are required.

### Report and promotion decision

Produce versioned JSON and a concise Markdown report. Include source SHA, deployment/project IDs, capability policy hash, migration manifest hash, schema-proof reference, observed database identity, check IDs/statuses, timestamps and redacted failure reasons. No secret values or raw runtime logs.

Runtime/configuration evidence expires after30 minutes. Require current head/deployment identity, configuration revision metadata and policy consistency at promotion; missing revision evidence is unknown. Probe again immediately before promotion. An environment update, new deployment or changed policy invalidates the prior report. Fixture reports are explicitly labeled and can never authorize production.

Pass requires all required checks and compatible schema proof. Failed, missing, stale, untrusted or mismatched evidence blocks the enforcement decision. Treat user-edited reports as untrusted: the promotion controller consumes artifacts from the authorized workflow execution, validates identities and reruns the final probe. It must not trust a locally supplied JSON file claiming success.

## Report-only rollout and enforcement

1. Implement pure contracts/reporting and mocked adapters locally. Add focused CI tests without live credentials or provider calls.
2. Validate candidate probes in a separately approved isolated deployment using synthetic data. Exercise configuration failures and identity mismatches without mutating production settings.
3. Reconcile the C10/C11 dossier: separate merged source, current deployment, repaired configuration, single scan evidence and remaining schema/provider/recovery gates.
4. Prepare an exact activation proposal for Vercel/GitHub: suppress automatic production alias promotion, create an unpromoted candidate using the intended environment, run checks and promote only the exact validated deployment. Inspect supported Vercel controls during implementation; do not invent a workflow claiming enforcement while Git integration can bypass it.
5. Enable enforcement only after explicit approval of those platform/workflow changes and successful failure drills. Until then reports clearly say REPORT ONLY / NOT ENFORCED.

The promotion controller must serialize promotions, verify the previous production deployment, recheck candidate/head immediately before changing aliases and reject stale concurrent runs. Restrict who can invoke promotion and document platform bypass permissions. An emergency override is an explicit operator action with recorded reason; do not provide an automatic fallback that promotes after a failed check.

## Rollback

Keep the previous deployment and a sanitized configuration revision record. A deployment rollback does not restore environment values, schema or sent/provider effects. Check schema compatibility before rollback; preserve immutable C9 history. No automatic down-migrations. If compatibility is unknown, halt promotion and escalate. Report-only code rollout can be reverted without changing runtime application behavior; enforcement rollback requires an approved exact workflow/platform diff rather than silently re-enabling automatic promotion.

## Validation and completion

Tests must reproduce missing/empty/malformed configuration, optional capability misclassification, unauthorized probe calls, secret redaction, read-only query boundaries, timeout and issuer failure, wrong project/branch/role/database, stale hashes/reports, fixture evidence rejection and concurrent/stale promotion decisions. Assert no write/provider operations in readiness probes. Mock external APIs and exercise representative failure contracts rather than snapshotting implementation details.

Completion of the local slice means reviewed code/tests, deterministic fixture reports, updated evidence dossier and a concrete enforcement activation package. Completion of enforced release readiness additionally requires live isolated acceptance, matching schema proof, approved platform settings, verified no-bypass promotion behavior and rollback ownership. A passing build, ready deployment or successful scan alone cannot close those gates.

## Self-review

Checked against current pr-gate.yml, vercel.json, lib/db.ts, lib/security/db-binding.ts and .env.example. The design preserves runtime guards and distinguishes fixture, configuration, schema and live acceptance evidence. External settings changes and destructive rehearsal remain separate approved operations. Remaining implementation-discovery items are the exact Vercel promotion controls and protected runtime-probe access; unresolved support blocks activation rather than changing the safety contract.
