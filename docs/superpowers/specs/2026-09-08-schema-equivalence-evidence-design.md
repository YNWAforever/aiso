# Slice C: schema-equivalence safeguards and evidence

Date: 2026-09-08
Status: design approved in conversation; written spec awaiting user review.
Source baseline: 222cf875721e4db4af0db6c08a40d67b16ab7c3c on codex/release-readiness-design.
Parent design: 2026-09-08-release-readiness-design.md.

## Objective and authorization

Harden the existing schema-equivalence rehearsal and add structured, locally
validated evidence. Reuse its reviewed migration-chain-to-head and
baseline-to-head comparison. Implementation and verification are local with
synthetic inputs and injected effects. This design does not authorize executing
the real rehearsal, creating/deleting Neon branches, resetting schemas, migrations,
credential retrieval, provider operations, deployment, publication or promotion.
No prior target IDs, synthetic-parent statement or credential approval is inherited.

The user approved local tooling/synthetic tests, the existing-runner approach,
and the execution/evidence rules in conversation. Writing an implementation plan
follows separate review of this written spec; this document is not implementation.

## Existing evidence and gaps

At the pinned source, scripts/schema-equivalence.mjs already advances both paths
to head, prepares the legacy auth shim after disposable/session identity checks,
and requires a successful migration dry-run containing its no-pending result.
Keep this behavior and lib/schema/introspect.ts and diff.ts semantics.

Confirmed source gaps:
- __tests__/helpers/neon-branch.ts creates without an explicit parent and only
  checks that parent_id exists. A changed project default can select another parent.
- Connection acquisition names a role but not an explicit database; the rehearsal
  session reset currently verifies project/branch only.
- Deletion errors in finally are logged without reliably failing overall success;
  a successful deletion command has no independent absence readback.
- The runner auto-executes on import and emits human-readable output without a
  versioned proof binding source, manifests and cleanup outcome.

These are source findings, not a live divergent-schema or cleanup experiment.
The September 7 rehearsal proposal remains historical, prepared-only evidence.

## Approaches considered

1. Harden the existing runner and add evidence validation (selected): preserves
   reviewed comparison behavior and fixes execution plus evidence gaps together.
2. Add evidence validation alone: smaller but leaves unsafe rehearsal prerequisites.
3. Replace the runner: duplicates working comparison logic and increases risk.

## Architecture and compatibility

Use three bounded responsibilities:
1. Rehearsal target/lifecycle guards: validate explicit inputs, child creation
   identity, disposable-session proof and cleanup/readback.
2. Existing comparison orchestration: execute the two paths through injected
   filesystem, subprocess, database and control-plane boundaries; assemble proof.
3. Pure schema-evidence contract and validator: parse strict bounded records,
   derive outcome, compare expected identities/hashes and evaluate freshness.

Keep the schema comparison model unchanged. Reuse and narrowly extend shared
branch safety primitives where appropriate; the rehearsal must opt into strict
explicit-parent/database behavior without silently changing unrelated integration
suite defaults. Never weaken the existing same-process child registry, endpoint
binding, protected-target checks or secret redaction.

Expose a callable orchestration boundary and guard the Node CLI entry point so
importing it does not create branches or run SQL. Resolve explicit rehearsal
configuration at invocation, not module import. Retain the existing command entry
point; missing required rehearsal inputs fail before any effects. No production
fallback, dotenv autoload or embedded historical target is acceptable for this path.
Do not alter Slice A/B APIs or add schema work to the readiness HTTP probe.

## Explicit execution contract

A future invocation must provide exact project, parent, database, migration role,
protected branch identities, protected endpoint policy, approved parent-sterility
reference, expected source/manifests and output directory. Reject malformed,
missing, duplicate or unknown options before control-plane or database effects.
Credentials remain separately environment-injected from an approved source, never
CLI arguments, artifacts or logs. Validate complete inputs without printing secrets.

A sterile parent is an external prerequisite. A name, default flag, historical
synthetic-only statement or caller boolean does not prove sterility. Record its
reviewed evidence reference and observed parent identity; this slice cannot
independently prove that the parent contains no customer data. Missing trusted
sterility evidence blocks live execution approval.

Creation selects that exact parent explicitly. Verify returned project, parent,
unique requested name, child ID, nondefault/nonprimary status and two-hour expiry.
Reject parent/protected/retained IDs and endpoint substitution. Obtain the exact
requested database and owner-role connection. Before each destructive reset,
verify session project, branch, current_database and current_user against the
approved child context, in addition to existing registry/URI protections.

Run exactly one newly created child; never reuse a retained branch. Preserve:
reset public, prepare legacy auth prerequisites, replay migrations to head and
inspect; reset public, prepare prerequisites, load baseline, advance remaining
migrations to the same head and inspect; run bootstrap dry-run and compare.
Stop on failure. Do not rewrite migrations, alter grants, invent numbering gaps,
change baseline SQL or patch differences to obtain a passing comparison.
No automatic rehearsal retry or expanded target scope.

Creation responses may be ambiguous. Never infer a cleanup candidate from a name
prefix or delete an unproven foreign/default/protected branch. Report possible
orphan status with sanitized identity information and fail. A known safe child
created by this process remains eligible for exact cleanup if later steps fail.

## Cleanup and outcome

Track comparison, bootstrap, execution and cleanup separately. Attempt cleanup
in finally only for the exact child whose disposable identity is proven.
After deletion, require a fresh project-scoped control-plane observation proving
that exact child is absent. A delete command exit alone is insufficient.

Only an authoritative absence result counts as confirmed deletion. Authentication,
transport, parser errors, incomplete pagination and unavailable responses are
unknown/failure, never absence. The implementation plan must verify the installed
CLI/API's supported readback shape; unsupported or ambiguous behavior fails closed.
No automatic repeated deletion. Failed or unverified cleanup forces overall exit 1,
even if comparison and bootstrap passed. Preserve the original failure as well as
cleanup failure. TTL is recorded but is not deletion confirmation.

Exit 0 requires both paths at the pinned head, zero differences across the existing
comparison classes, successful bootstrap with nothing pending, complete identity
proof, unchanged manifests and confirmed cleanup. Otherwise exit 1. Artifact-write
failure also fails the command and cannot erase cleanup evidence.

## Evidence contract

Produce versioned JSON and concise Markdown with fixed check IDs/status codes,
not raw SDK/subprocess errors or SQL/customer rows. Include:
- Evidence kind/version, unique run ID and explicit synthetic/live origin label.
- enforced:false and productionReady:false; neither output authorizes release.
- Source SHA, runner/harness manifest hash, ordered migration manifest with each
  file path/hash, baseline hash and combined manifest hash.
- Expected project/parent/database/role and observed parent/child/session identities,
  protected-target policy digest and sterility evidence reference.
- Start/completion times, child expiry, path/head outcomes, schema-class difference
  counts, bootstrap result, cleanup attempted/confirmed status and readback time.
- Sanitized failure codes and aggregate outcome derived from constituent checks.

Hash exact file bytes; preserve actual migration order and historical gaps. Pin the
manifest before effects and reject relevant file drift before final acceptance.
The harness manifest includes every repository file that determines provisioning,
reset, migration, introspection, comparison or evidence interpretation. Its explicit
file list and hashing algorithm are part of the versioned contract and tested.
No secret or credential digest belongs in any manifest.

Use bounded primitive fields, finite enums, safe relative manifest paths, canonical
hash serialization, duplicate rejection and unknown-field rejection. Do not coerce
arrays/null to strings. Runtime input/output byte limits and collection bounds must
be explicit in the implementation plan. Write nonce/run-qualified artifacts
exclusively in the requested directory; never overwrite or delete existing output.
If only one artifact can be written, report failure and document that partial state.

## Validation, freshness and trust

The pure validator accepts evidence, explicit expected proof context and a clock.
Reject malformed, failed, incomplete, future-dated, inconsistent or mismatched proof.
Reuse requires exact expected source identity, target/sterility context and migration,
baseline and relevant harness hashes, with completion no more than 30 days old.
Relevant input changes invalidate earlier proof immediately. An unrelated source
change may be reconsidered only under a separately designed policy; this slice
uses exact matching rather than silently relaxing it.

Validate identity/check/aggregate relationships and require cleanup readback before
completion. Synthetic proof can exercise validation and render sample reports but
cannot qualify as live proof. Do not accept a trusted:true flag as provenance.
Local JSON parsing establishes consistency only, not authenticity: a later
promotion controller must obtain evidence from an authorized workflow/run and
independently validate its origin. No signatures, artifact trust store, promotion
controller or CI enforcement are introduced in this slice.

Schema equivalence is not candidate database migration/grant readiness, tenant
isolation, Neon Auth equivalence, provider acceptance or production readiness.
Those remain separate gates even when this proof is valid.

## Testing and local completion

Use injected effects; importing modules, malformed input and unauthorized target
cases must perform no subprocess, SQL or provider calls. Never run the actual
schema:equivalence command or integration harness during local implementation.

Focused regressions cover:
- Explicit parent forwarded and checked; changed default cannot change selection.
- Wrong/protected/foreign child, URI, database or role rejected before reset.
- Both paths retain order, auth shim and head; migration or dry-run failure blocks.
- Compare-pass/delete-fail, absence unavailable, wrong-project readback and ambiguous
  creation cannot produce success; exact safe cleanup still occurs after failure.
- Manifest drift, missing/extra/duplicate files, tampered hashes, stale/future proof,
  missing checks, forged aggregates, malformed primitive types and synthetic origin.
- Secret sentinels absent from all reports/errors; exclusive writes and partial output.
- Real output assembled by the runner is accepted by the shared evidence contract
  for success and remains diagnostically valid for failure; no duplicate evaluator.

Run focused schema-equivalence/bootstrap/baseline-guard and new evidence tests,
relevant existing branch-helper tests, scoped lint, typecheck and diff checks.
Broaden checks only for changed shared boundaries or concrete integration risk.
Obtain independent review, resolve findings and record exact tested source/results.
Update the readiness handoff and C11 evidence dossier narrowly, retaining historical
claims as dated evidence. Add clearly synthetic examples and an exact future action
proposal template with no guessed live identifiers.

## Future live action gate and exclusions

A future live rehearsal requires separate approval of exact project, sterile parent,
new-child policy, protected identities, database/role, source/manifest hashes,
credential source, cost/TTL, cleanup/readback mechanism and evidence ownership.
Prepare those concrete details before requesting approval. Unknown fields block
execution, including child creation. Rollback is exact disposable-child cleanup;
no parent mutation, production migration or automatic down-migration is proposed.

Local completion means reviewed tooling, synthetic regression evidence and a
reviewable handoff. Actual schema equivalence remains unproved until an authorized
live rehearsal succeeds with confirmed cleanup. Slice D promotion and next product
features remain outside this scope.

## Spec self-review

Checked against the pinned rehearsal and branch helper. Explicit target/database
selection, same-process cleanup safety, failed-cleanup exit handling, proof freshness
and provenance limits are consistent with the parent design. No live target is
selected; this is an intentional execution gate, not a missing local design decision.
Exact platform command/readback syntax remains a bounded implementation-discovery
step and must fail closed if unsupported. No implementation or external action was
performed while preparing this specification.
