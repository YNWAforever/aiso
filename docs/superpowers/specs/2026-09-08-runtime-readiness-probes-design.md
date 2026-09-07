# Slice B: manual candidate runtime readiness probes

Date: 2026-09-08
Status: design approved in conversation; written spec awaiting user review.
Parent design: docs/superpowers/specs/2026-09-08-release-readiness-design.md.
Foundation:41735af on codex/release-readiness-design; implementation source e313499.

## Outcome and scope

An operator can inspect one named candidate deployment and obtain a redacted report of its actual configuration, database identity/permissions and anonymous auth availability. The report stays advisory: enforced:false and productionReady:false. No deployment creation, promotion, configuration repair or retry follows automatically.

The approved first version is manually invoked. Local implementation uses synthetic fixtures and injected adapters; live credential provisioning, deployment and a live probe run require separately pinned targets and explicit approval. No paid scan, email, login/signup, customer row read/write, quota consumption, scheduled-job execution or schema mutation belongs to a readiness probe.

## Existing contracts

Reuse validateConfiguration from lib/readiness/config.ts and the canonical configuration report builder/renderer in lib/readiness/report.ts. Keep the configuration-only API unchanged. Reuse the pure checkBinding rules in lib/security/db-binding.ts, including forbidden-target precedence; do not weaken the existing query-path guard in lib/db.ts.

Add a separate runtime report envelope and finite runtime-check vocabulary. Never accept caller-supplied aggregate status as authoritative. Configuration checks, runtime reachability and release readiness remain distinct evidence categories.

proxy.ts currently excludes top-level api routes. The new handler must enforce its own authorization; neither locale middleware nor the normal user session is a security boundary for it. Next16 route.md has been read during design. Re-read applicable installed guides before implementation; no middleware.ts or new Supabase dependency.

## Chosen approach and alternatives

Use a protected internal HTTP handler plus a manual local runner. An external CLI-only check could validate its own credentials while missing broken deployment values; a public health endpoint would expose operational metadata. The protected handler tests the candidate's actual runtime settings and keeps diagnostics independent of normal login availability.

## Operator input and deployment identity

The runner requires explicit Vercel team/project IDs, deployment ID, expected full commit SHA and environment scope. The operator selects a reviewed, versioned release policy by file; the runner computes its SHA256. This is a policy-input hash, never a hash of secrets. The policy contains capability requirements, expected database project/branch/role/name and required schema/grants. There is no implicit current-production or current-branch default.

Before sending any readiness credential, resolve deployment metadata using authenticated Vercel read-only access. Confirm project, exact source SHA, READY state and environment. Derive the immutable deployment URL from that response. Reject aliases, arbitrary user-provided origins, redirects, non-HTTPS URLs and metadata mismatches. Do not send tokens to a URL obtained from an unchecked report.

The handler checks runtime-provided deployment identity against the request expectation and returns only validated identifiers. Missing runtime identity is unknown/failure, not a default. Implementation must verify supported Vercel system fields and availability in the actual configured environment; inability to prove identity blocks live acceptance. The response nonce and policy hash must match the request. The runner rereads deployment metadata after the request and fails on drift.

An operator-supplied policy is not independent proof of feature disablement. Unknown capabilities remain unknown; verified-disabled is accepted as evidence only when the policy includes a reviewed source-gate reference and the runner verifies its pinned source revision. Until that adapter exists, normalize such claims to unknown. No reachable capability can be silently omitted to get an all-clear result.

## Internal handler and credential boundary

Proposed route: POST /api/internal/readiness. It runs on Node, is dynamic and uncached. All responses use Cache-Control:no-store; error responses do not echo request data. No CORS opt-in. Unsupported methods do not run probes.

Use a dedicated READINESS_PROBE_SECRET, at least32 characters, with no reuse of CRON_SECRET, auth cookie secret or user bearer token. Compare a bounded Bearer credential in constant time after validating format/length. Authenticate before parsing policy or constructing auth/database clients. Missing server credential returns a generic503; missing/invalid caller credential returns a generic401 with no configuration or identity details. Normal user login cannot grant access.

Credentials come from the operator process environment or an approved secret-manager injection, never CLI arguments, URL parameters, committed files or report content. Vercel deployment protection is a separate outer layer: if present, use its approved bypass credential through the documented header on the verified deployment origin only. Do not disable protection to run readiness. Do not forward either credential, inbound cookies or arbitrary headers into DB/auth probes.

Live provisioning must specify the exact candidate scope and credential source. No credential is generated/provisioned by local tests or by this design. Candidate token changes require a redeploy if the platform's environment model requires one; the runner must not make that change itself.

## Request and bounded execution

The JSON body includes schemaVersion1, random request nonce, expected deployment identity, reviewed release policy and policy hash. Reject unknown top-level fields, invalid enums, malformed identifiers, oversized input and policy/hash mismatch. Limit the body to16KiB using bounded stream reading; reject rather than buffer unbounded data. Accept no SQL, arbitrary probe URLs, environment overrides or customer IDs.

The total handler budget is15 seconds, including configuration and identity checks. Each network/SQL probe gets at most5 seconds and observes a shared cancellation deadline. The runner has a20-second HTTP deadline and performs no automatic retry. Timeouts become fixed check codes. A Promise.race that leaves I/O running is not adequate: adapters must implement driver/fetch cancellation and cleanup using installed-library-supported APIs. If cancellation cannot be established, the live adapter is not ready.

Only after successful authorization, payload validation and candidate identity checks may probes run. Invalid core configuration skips dependent probes and records a dependency failure instead of attempting them. A database identity mismatch stops further database metadata checks; do not inspect a wrong target. Independent auth availability may still be reported within the same deadline. No repeated background polling or scheduled execution.

## Probe contracts

### Runtime configuration

Read only the required allowlisted keys inside the candidate process and validate them with the existing pure foundation. Values remain in memory. Do not serialize process.env or expose variable lengths, fingerprints or raw validation input. Include fixed check IDs/statuses/codes only. Pin expected database project, branch, role and name through the policy; no universal production target is baked into code.

### Database

Use the candidate DATABASE_URL, never MIGRATE_DATABASE_URL or an operator database credential. Prove project/branch with Neon in-band identity fields and role/database with current_user/current_database, then apply checkBinding. Require the selected least-privilege application role; explicitly reject elevated owner/superuser/bypass-RLS privileges where metadata permits inspection.

After identity succeeds, use fixed metadata queries to confirm the declared relations and required privileges. Relation names and privilege lists come from a bounded reviewed policy, are validated, and are passed as tagged-template parameters; there is no arbitrary SQL endpoint. Check each required privilege independently, not an OR interpretation of a comma-separated privilege string. Do not read customer rows, mutate counters or invoke application functions with unknown effects.

The adapter establishes a read-only transaction/session and verifies its mode before metadata queries; connection/transaction options must follow the installed Neon driver API. Return only expected/observed safe identities and check outcomes. Raw SQL/driver errors and DSNs are discarded in favor of fixed codes. No migration, grants repair or branch operation is allowed on failure. Missing schema is an honest failed check and is distinct from schema-equivalence evidence.

### Auth

Validate the configured issuer URL and existing server auth configuration first. Check the issuer's public JWKS response with strict shape and response-size limits; report validity/key presence without storing key material. Use existing public-URL security controls and reject redirects/private destinations. No provider secret or readiness bearer accompanies this request.

Then check the candidate's existing /api/auth/get-session path through an explicit anonymous request to the verified deployment origin. Forward no user cookies, authorization header or readiness credential. If deployment protection requires its separate bypass header, allow it only on that verified same origin. An HTTP200 JSON null session is success; a user/session response, malformed data, redirect, 4xx/5xx or timeout fails. Do not persist or print Set-Cookie headers; no cookie jar is retained. Do not call signup, password reset, OAuth exchange or any email-triggering path.

This verifies anonymous resolution only. A green probe cannot establish signup, authenticated sessions, billing, AI, email or scheduler execution acceptance.

## Report and trust limits

The runtime report includes schema version, nonce, policy hash, requested/observed safe deployment identity, start/end timestamps, the existing configuration report, finite runtime checks and safe observed database identity. Derive all aggregates from validated checks. Whitelist all rendered fields; reject unknown enums and injected top-level metadata, extending the foundation's renderer regressions.

Transport/authentication errors exit1; a complete report with any fail/unknown required check also exits1. Exit0 means only the selected manual runtime checks passed. JSON and Markdown always state REPORT ONLY / NOT ENFORCED and productionReady:false. Never claim a schema rehearsal or release gate passed without separate evidence.

A timestamp older than30 minutes, inconsistent nonce/hash/identity, impossible timing or failed final metadata readback makes the report invalid. The runner stores only sanitized output in an explicit operator-selected artifact directory and never loads a prior report as authorization. No signed promotion attestation is created in this slice; Slice D must establish trusted workflow provenance before using evidence to permit promotion.

## Proposed module boundaries

- lib/readiness/runtime-contract.ts: request/policy validation, safe identifiers and finite runtime result vocabulary.
- lib/readiness/runtime.ts: orchestration over injected configuration, identity, database and auth ports; shared deadline and no-retry behavior.
- lib/readiness/runtime-adapters.ts: candidate-only read-only SQL and bounded auth fetch adapters.
- lib/readiness/runtime-report.ts: canonical report construction and rendering, preserving existing configuration-only APIs.
- app/api/internal/readiness/route.ts: thin authorization/body/status boundary.
- scripts/readiness/check-candidate.mjs: manual runner with Vercel metadata pre/post verification, protected request and safe artifacts.
- __tests__/readiness/runtime-*.test.ts and __tests__/api/readiness.test.ts: deterministic pure/port/route coverage.
- __tests__/scripts/check-candidate.test.mjs: mock external API/HTTP and artifact boundaries, no credentials or live execution.

No additional library is required unless implementation demonstrates a concrete missing capability. Check installed APIs before writing adapters; document unsupported platform behavior as a blocker instead of weakening the contract.

## Validation and delivery

Use TDD for missing/invalid readiness credentials, auth-before-I/O, payload size/shape rejection, candidate mismatch, secret sentinel redaction, unsafe origins and redirect refusal, policy hash/nonce mismatch, unknown capability claims, wrong database/role, forbidden targets, missing permissions, read-only query contract, timeout cancellation, failed dependency suppression, malformed JWKS/session output and no automatic retries. Assert no credential forwarding to issuer URLs and no SQL beyond the read-only allowlist.

Validate report precedence and forged top-level fields, stale/tampered reports, fixed error responses and absence of secret output. Use fixtures and injected ports. Run focused tests, lint, TypeScript and appropriate route/build checks; independently review both source and evidence. Do not repeat live scans as a readiness test.

Local completion: reviewed implementation/tests, a synthetic sample report, updated handoff and a precise live candidate proposal. Live acceptance: separately approved deployment and credential setup, explicit protected candidate URL/identity, one bounded read-only invocation, recorded sanitized output and known runtime limitations. Keep Slice C rehearsal and Slice D promotion separate.

## Rollback and operational limits

Before any live activation, record previous deployment and scoped credential/configuration state. Disable access by revoking the dedicated readiness credential or roll back the probe deployment with schema compatibility checked. Do not delete data or rotate unrelated credentials. The probe has no authority to repair or promote.

## Self-review

Checked against the approved parent design, existing pure readiness APIs, db-binding guard, proxy matcher and installed Next16 route conventions. Normal user auth is not required to diagnose an outage; readiness authorization is enforced before resource access. Safe request origin resolution precedes secret transmission. Database queries remain read-only and identity-bound. Reports do not claim full release acceptance. Live platform-field availability, bypass access and credential source must be pinned during implementation/live proposal and remain explicit activation gates.
