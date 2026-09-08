# Schema-equivalence evidence: local handoff

Date: 2026-09-08. Implementation source: `b866f14e97c203852f9143699c35d2cb698a094a`.
Whole-Slice C independent final review: **PENDING**. Tasks 1–5 have individual reviews;
this document does not close Task 6 or authorize a live rehearsal.

## Scope and result

The guarded CLI now requires an explicit request, clean pinned checkout and raw-byte
manifest before credential access. Its injected runner verifies the exact parent,
creates one disposable child, binds its direct endpoint and proves the actual session
project/branch/database/role before each reset. Path A replays migrations; Path B loads
the baseline then advances migrations. Both preserve the legacy auth shim and existing
schema comparison model. Successful no-pending migration dry-run, all eight zero-diff
classes, unchanged final manifest and confirmed cleanup are required for exit 0.

All new implementation verification was local and synthetic. No actual
`schema:equivalence` command, integration harness, provider operation, database
connection, environment-file/credential inspection, migration, push or deployment ran.
Actual schema equivalence remains **UNPROVED**. `enforced:false` and
`productionReady:false` always remain; schema evidence does not establish candidate
migration/grant readiness, tenancy, Neon Auth equivalence or provider acceptance.

## Invocation and exact request

Only after separate approval of a complete live proposal, the Node 24 invocation is:

```text
node scripts/schema-equivalence.mjs --request ABSOLUTE_REQUEST_JSON_PATH --output-dir ABSOLUTE_OUTPUT_DIRECTORY
```

The package entry remains `npm run schema:equivalence -- --request ... --output-dir ...`.
Neither command was run during implementation. Exactly these two options are required;
unknown, duplicate, missing, positional, empty and equals-form options are rejected.
Credentials, origins and API roots cannot be supplied as CLI flags.

Request is a regular UTF-8 JSON file of at most 65,536 bytes, with exactly these fields:

| Field | Required value and source |
| --- | --- |
| version | Integer 1 |
| sourceSha | Exact approved clean HEAD, 40 lowercase hex |
| manifestHash | Fresh manifest hash for that exact SHA, 64 lowercase hex |
| projectId | Explicitly approved Neon project ID; 1–60 lowercase letters/digits/hyphens |
| parentId | Explicitly approved sterile parent ID, `br-` followed by lowercase letters/digits/hyphens, at most 60 total characters |
| database, role | Approved database and migration owner role; lowercase SQL identifiers, at most 63 characters |
| protectedBranchIds | 1–64 exact protected production/retained branch IDs; excludes selected parent, which is additionally protected by construction |
| protectedHosts | 1–64 exact lowercase DNS hosts; no URL, userinfo, port or path |
| sterilityReference | Approved external sterility evidence reference, 1–128 letters/digits/underscore/hyphen |

Duplicate JSON keys, unknown fields and coercion are rejected. A reference records
external evidence; it does not prove absence of customer data. No historical parent,
project, retained branch, default selection or synthetic-only assertion is inherited.

Keep operator request and output paths outside the checkout or in an explicitly
ignored directory. All tracked and untracked nonignored changes fail clean-HEAD
preflight. The CLI derives the repository root from its own entry location, checks
HEAD and rebuilt manifest before reading the token, and the local adapter repeats
these guards. It rebuilds again after cleanup; dirty files, changed HEAD, membership
or bytes fail final acceptance. No dotenv autoload or production fallback exists.

## Variable-to-source map

| Input | Source and use |
| --- | --- |
| NEON_API_KEY | Separately approved operator credential source, injected into the invocation environment; used only by the fixed Neon control-plane port. The source and credential have not been selected or retrieved. Never place it in the request, CLI arguments, reports or hashes. |
| MIGRATE_DATABASE_URL | Generated internally from the exact newly created child's verified direct connection URI, requested database and role; passed only in memory to bounded migration subprocesses. Do not supply an existing owner connection as a substitute. |
| DATABASE_URL | Not a rehearsal input or fallback; not inherited into migration subprocesses. |

Migration subprocesses inherit only allowed OS fields, fixed test/telemetry values
and the child URI. They do not inherit the API key, NODE_OPTIONS or unrelated secrets.
The valid local adapter import retains Node's existing `MODULE_TYPELESS_PACKAGE_JSON`
warning for unchanged TypeScript imports; Task 4's plain-Node import exited 0. Missing
CLI arguments fail before these imports. No package setting was changed to silence it.

## Manifest, ledger and cleanup limits

The manifest binds exact baseline bytes, ordered actual migration membership (including
historical gaps), required harness files and every immediate rehearsal `.mjs` module.
Its SHA-256 hashes canonical JSON with sorted keys and preserved array order, excluding
its own hash. Per-file hashes use raw bytes. At the implementation source above,
read-only filesystem discovery found **41 migrations and 14 harness files**, baseline
`supabase/baseline/000_baseline_2026-08-31.sql`, combined hash
`17aeec788c21d91f370b77dddd6b47b170f58395bc1f496320012068832f6ff4`.
This is a dated local fingerprint, not live proof or the hash for a later docs commit.
Any later approved HEAD requires rebuilding the manifest, even for documentation-only
commits, because sourceSha is included in the aggregate hash.

The ordinary migration ledger deliberately stores NULL checksums. Path A requires
exactly all migration basenames with NULL checksums. Path B adds the baseline basename
with its raw-byte SHA-256. Missing/extra/duplicate names or unexpected checksums fail.
This ledger proves applied membership, not individual migration-byte hashes; bounded
successful execution and pre/post filesystem manifests provide that binding. No ledger
schema, runner SQL, baseline or migration was changed to add per-file checksums.

Direct REST mutations are attempted once, with no retry or list-based absence inference.
Read-only operation polling is bounded separately: 20-second HTTP deadlines, at most
120 polls at 1-second intervals within 120 seconds. Subprocess limits are 600 seconds
and 1 MiB output. The API root is fixed to `https://console.neon.tech/api/v2`.
Child expiry is `floor((startedAt + 7200000) / 1000) * 1000`, normalized to UTC ISO;
the observed instant must match. **TTL is not deletion confirmation.**

Cleanup runs in finally only for the exact positively identified same-process child.
Ordinary DELETE is **recoverable**, not irreversible erasure; no `hard_delete` exists
in this proposal. After successful deletion operations, exact project-scoped active
branch lookup must independently confirm absence. Authentication, transport and parse
errors never count as absence. Failed/unverified cleanup forces exit 1 even when both
paths compare equal. Identity revocation retains diagnostics without restoring mutation
authority. Ambiguous creation can leave a possible orphan: do not retry creation or
infer a delete target from a name prefix; require separately authorized manual inspection.

## Evidence and trust

JSON and Markdown use fixed `schema-{runId}.json` / `.md` filenames and exclusive writes;
existing artifacts are never overwritten or removed. Both are validated/rendered after
cleanup and final manifest observation. JSON is written and its path reported first;
a Markdown failure may leave JSON alone with exit 1. A first-write failure may leave
no artifact. Preserve partial evidence and inspect cleanup status; failure output is
sanitized and does not justify retrying the rehearsal or deleting unknown branches.

The shared parser derives fixed checks and aggregate status, retains canonical failure
and unknown evidence, and rejects forged relationships. `assessEvidence` needs the
explicit expected request, manifest and clock. Exact source/target/sterility/hash context
must match, completion must not be in the future, and maximum age is 30 days inclusive.
Relevant drift invalidates proof immediately. No unrelated-source-change exception is
implemented. Local consistency cannot authenticate origin: even consistent successful
live-labeled JSON has `reusable:false`, `provenance:'unverified'` and
`productionReady:false`. No caller trust flag, signatures, trust store, promotion
controller or CI enforcement is introduced.

The [synthetic JSON](../examples/2026-09-08-schema-equivalence-synthetic.json) and
[rendered Markdown](../examples/2026-09-08-schema-equivalence-synthetic.md) were generated
through real `buildEvidence`/`renderEvidence` from the existing synthetic fixture.
Their fake identifiers, placeholder file hashes and generic synthetic manifest are
not an operational request or production manifest. Round-trip parsing and renderer
byte equality passed; assessment at the fixture completion clock returned status pass,
consistent true, reusable false, provenance unverified and productionReady false.

## Exact local verification

Controller ran these commands at the implementation SHA above, using the existing
local wrapper with synthetic environment and injected effects; Task 6 documentation
work read the logs and did not repeat the checks:

```text
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/scripts/schema-contract.test.mjs __tests__/scripts/schema-manifest.test.mjs __tests__/scripts/schema-target.test.mjs __tests__/scripts/schema-neon-port.test.mjs __tests__/scripts/schema-equivalence.test.mjs __tests__/scripts/schema-cli.test.mjs __tests__/scripts/bootstrap-project.test.mjs __tests__/scripts/migrate-baseline-guard.test.ts __tests__/helpers/neon-branch.test.ts __tests__/helpers/neon-branch-config.test.ts --maxWorkers=2
node .superpowers/sdd/local-run.cjs node_modules/eslint/bin/eslint.js scripts/schema-equivalence.mjs scripts/schema-equivalence __tests__/scripts/schema-contract.test.mjs __tests__/scripts/schema-manifest.test.mjs __tests__/scripts/schema-target.test.mjs __tests__/scripts/schema-neon-port.test.mjs __tests__/scripts/schema-equivalence.test.mjs __tests__/scripts/schema-cli.test.mjs --max-warnings=0
node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen
node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit
```

Results: **421 tests / 10 files passed**, lint exit 0 with zero diagnostics,
Next typegen exit 0 and TypeScript exit 0. Logs are
`.superpowers/sdd/schema-task-6-{tests,lint,typegen,tsc}.log`; manifest discovery is
`schema-task-6-manifest.log`. Bootstrap tests emitted the expected refusal for absent
BOOTSTRAP_PROJECT_ID, BOOTSTRAP_BRANCH_ID and BOOTSTRAP_DATABASE_URL; all 20 passed,
with no bootstrap database operation. These are selected regressions, not a full-suite
or live integration claim. No build ran: standalone MJS tooling introduced no
runtime/shared application import changes and type generation exposed no concern.

Whole-slice review from approved-plan baseline
`917db1206896f001a1daf74afeaffc41dbf2f9fe` through final docs HEAD remains **PENDING**.
The controller will record final review, any coordinated repairs and final source.
No next phase or publication follows implicitly from local completion.

## Unexecuted live proposal — all selections blocked

This is a preparation template, not executable request JSON. Every unselected value
below is UNKNOWN and blocks execution, including child creation. Populate the exact
values and evidence first, then obtain separate approval; September 7 targets and
permissions cannot fill this template by inference.

| Approval item | Current value / required evidence |
| --- | --- |
| Exact project ID and observed ownership | UNKNOWN — BLOCKED |
| Exact sterile parent ID and fresh sterility evidence/reference/owner | UNKNOWN — BLOCKED |
| Exact protected production/retained branch IDs and endpoint hosts | UNKNOWN — BLOCKED |
| Exact database and migration owner role | UNKNOWN — BLOCKED |
| Final approved source SHA, baseline/migration/harness inventories and hashes | UNKNOWN — BLOCKED; rebuild at final clean approved HEAD |
| Operator credential source and authority | UNKNOWN — BLOCKED; no credential retrieval approved |
| New-child name policy, cost ceiling and accepted two-hour TTL | UNKNOWN — BLOCKED; one new child only, no retained child reuse |
| Recoverable deletion/retention acknowledgement and cleanup operator | UNKNOWN — BLOCKED; active-branch absence is not erasure |
| Approved exact deletion-operation and fresh absence-readback evidence procedure | UNKNOWN — BLOCKED |
| Possible-orphan/manual-inspection escalation owner | UNKNOWN — BLOCKED |
| Absolute request/output locations and evidence ownership/provenance workflow | UNKNOWN — BLOCKED |
| Execution window, explicit one-run authorization and stop criteria | UNKNOWN — BLOCKED |

Stop on identity mismatch, unknown sterility, drift, failed execution/comparison or
unconfirmed cleanup. Rollback is exact proven disposable-child cleanup only; no parent
mutation, production migration, automatic down-migration or hard deletion is proposed.
A rerun requires new approval. Slice D and release remain separate gates.
