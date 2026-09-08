# Schema-Equivalence Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing schema rehearsal and produce bounded, hash-bound evidence without executing live operations during implementation.

**Architecture:** Separate pure request/evidence contracts and manifests from a strict disposable-child lifecycle adapter and the existing comparison sequence. Keep the public CLI entry but guard imports and inject all effects. Use one evidence builder/validator for runner output and later consistency checks; authenticity remains outside this slice.

**Tech Stack:** Node 24, plain ESM scripts, existing Neon serverless Client and schema introspection/diff modules, Vitest, existing TypeScript/ESLint configuration. No new package.

## Global Constraints

- Approved spec: docs/superpowers/specs/2026-09-08-schema-equivalence-evidence-design.md, approved after commit0da6d33.
- Source baseline: 222cf875721e4db4af0db6c08a40d67b16ab7c3c; continue the current isolated codex/release-readiness-design checkout and preserve unrelated work.
- Implementation and verification are local with synthetic inputs and injected effects.
- Never run the actual schema:equivalence command or integration harness during local implementation.
- No prior target IDs, synthetic-parent statement or credential approval is inherited.
- Keep the schema comparison model unchanged.
- Never weaken the existing same-process child registry, endpoint binding, protected-target checks or secret redaction.
- No production fallback, dotenv autoload or embedded historical target is acceptable for this path.
- Do not alter Slice A/B APIs or add schema work to the readiness HTTP probe.
- No automatic rehearsal retry or expanded target scope.
- TTL is recorded but is not deletion confirmation.
- Failed or unverified cleanup forces overall exit 1, even if comparison and bootstrap passed.
- enforced:false and productionReady:false; neither output authorizes release.
- Local JSON parsing establishes consistency only, not authenticity.
- No signatures, artifact trust store, promotion controller or CI enforcement are introduced in this slice.
- Read AGENTS.md/CLAUDE.md. Read relevant installed Next guides before framework changes; none are planned. No Supabase imports.

## Verified discovery and implementation decisions

Read scripts/schema-equivalence.mjs, __tests__/helpers/neon-branch.ts,
lib/schema/{types,introspect,diff}.ts, scripts/migrate.ts and existing tooling tests.
The current runner auto-executes on import. Preserve its exact auth shim, two-path
ordering and successful dry-run requirement; replace import-side-effect tests with
calls to the explicit orchestration function.

Installed neonctl4.13.0 wraps neon/cli. Its source supports --parent and
--database-name, but branches create/delete call retryOnLock, while branches list
extracts branches without preserving pagination evidence. Therefore use a small
injected direct REST port for the strict rehearsal; do not change the shared
integration helper, its environment defaults, or ordinary tests' lifecycle.
Reuse existing introspection, comparison and redaction. The new rehearsal registry
must preserve all positive identity checks of the old helper, without importing
its module-level defaults or reading .env.local.

Official reference endpoints inspected (no API calls):
- https://api-docs.neon.tech/reference/createprojectbranch
- https://api-docs.neon.tech/reference/getprojectbranch
- https://api-docs.neon.tech/reference/getconnectionuri
- https://api-docs.neon.tech/reference/deleteprojectbranch

Use https://console.neon.tech/api/v2 only. Exact project/branch paths; no list-based
absence inference. Ordinary DELETE is recoverable under current Neon semantics:
confirm absence from active branch lookup after operations complete; do not claim
irrecoverable erasure or add hard_delete. Future live approval must explicitly
acknowledge that retention behavior. No live call is authorized by this plan.

## File map

Create scripts/schema-equivalence/contract.mjs: strict request/evidence parsing,
canonical hashing, evidence builder/rendering and reuse assessment.
Create scripts/schema-equivalence/manifest.mjs: exact file inventory/byte hashing.
Create scripts/schema-equivalence/target.mjs: positive identity/registry guards.
Create scripts/schema-equivalence/neon-port.mjs: bounded no-retry REST lifecycle.
Create scripts/schema-equivalence/runner.mjs: injectable comparison orchestration.
Create scripts/schema-equivalence/local-ports.mjs: filesystem/git/subprocess/Client
bindings, reusing current SQL/introspection/diff behavior.
Modify scripts/schema-equivalence.mjs: guarded CLI parsing and wiring only.
Create __tests__/scripts/schema-{contract,manifest,target,neon-port,cli}.test.mjs.
Modify __tests__/scripts/schema-equivalence.test.mjs for explicit injected runner.
Create __tests__/fixtures/schema-evidence.json: clearly synthetic shared fixture.
Modify README.md, the current runtime-readiness handoff and C11 dossier narrowly.
Create docs/superpowers/plans/2026-09-08-schema-equivalence-handoff.md and synthetic
JSON/Markdown examples under docs/superpowers/examples/.

## Contract constants and interfaces shared by all tasks

Use exact values; do not silently enlarge limits:

```js
export const LIMITS = Object.freeze({
  requestBytes: 65536, evidenceBytes: 1048576, apiBytes: 1048576,
  migrations: 512, harnessFiles: 64, protectedBranches: 64, protectedHosts: 64,
  relativePath: 240, reference: 128, sqlName: 63,
  ttlMs: 7200000, freshnessMs: 2592000000,
  httpMs: 20000, operationMs: 120000, operationPollMs: 1000,
  operationPolls: 120, subprocessMs: 600000, subprocessBytes: 1048576,
})
export const CLASSES = ['columns','constraints','indexes','triggers','functions','grants','rls','extensions']
export const CHECKS = ['parent','child','sessionA','pathA','sessionB','pathB','comparison','bootstrap','manifest','cleanup']
export const CODES = ['matched','completed','equivalent','nothing_pending','unchanged','absent',
  'invalid_input','identity_mismatch','identity_unavailable','protected_target','possible_orphan',
  'operation_failed','timeout','schema_diff','bootstrap_failed','manifest_drift',
  'cleanup_failed','cleanup_unverified','dependency_failed','artifact_failed']
```

JSON request has exactly version1, sourceSha (40 lowercase hex), manifestHash
(64 lowercase hex), projectId, parentId, database, role, protectedBranchIds,
protectedHosts, sterilityReference. IDs match provider syntax (project1–60 lowercase
letters/digits/hyphens; branch br- followed by lowercase letters/digits/hyphens,
max60). Database/role use lowercase SQL identifier syntax, max63. References are
opaque letters/digits/underscore/hyphen,1–128. Require at least one protected branch
and host; parent must not be a protected production/retained identity. Parent is
additionally protected against child mutation by construction. No hostname URLs,
credentials, aliases or arbitrary API roots. Protected host strings must be exact
lowercase DNS hosts without ports/userinfo/path. Output directory is a separate
required CLI argument, not a hashed target field.

Manifest object: version1, sourceSha, baseline:{path,sha256}, migrations:[{path,sha256}],
harness:[{path,sha256}], hash. Hash canonical JSON of all fields except hash, with
sorted object keys and preserved ordered arrays. Paths are repository-relative
forward-slash paths; no absolute/dot/dotdot/backslash/NUL or duplicate entries.

Evidence object: version1, kind:'schema-equivalence', origin:'synthetic'|'live',
enforced:false, productionReady:false, runId (32 lowercase hex), request, manifest,
startedAt, completedAt, parent, child, sessions:{A,B}, paths:{A,B}, comparison,
bootstrap, cleanup, checks, status. All nested shapes exact. Missing observations
are null; never substitute expected identity as observed. Parent:{projectId,id}.
Child:{projectId,id,parentId,name,expiresAt}; sessions:{projectId,branchId,database,role}.
Paths:{status,headManifestHash}; comparison:{status,classes}, with every class
holding nonnegative safe-integer missing/extra/changed counts. Bootstrap:{status,
nothingPending}; cleanup:{status,attempted,confirmed,checkedAt,deletionMode:'recoverable'}.
Checks contain exactly id/status/code, each required ID once. Status pass/fail/unknown
is derived, not accepted at face value. Parser must retain valid failure evidence.

```js
parseRequest(value) // -> canonical request; throws fixed sanitized error
canonicalJson(value) // -> stable string
buildEvidence(observations) // -> strict complete evidence with derived checks/status
parseEvidence(value) // -> strict canonical evidence; rejects forged relationships
renderEvidence(evidence) // -> allowlisted Markdown from parseEvidence
assessEvidence(evidence, {request, manifest, now})
// -> {status:'pass'|'fail'|'unknown', consistent:boolean,
//     reusable:boolean, provenance:'unverified', productionReady:false, codes:string[]}
```

Synthetic evidence is never reusable. Structurally successful live-labeled evidence
may meet consistency/freshness conditions, but reusable must remain false without
provenance established outside this slice: return consistent:true, status:pass,
provenance:unverified and reusable:false. No caller-supplied trust flag. This avoids
mistaking a local consistency check for live acceptance.

## Task 1: Strict evidence contract and shared synthetic fixture

**Files:** contract.mjs, schema-contract.test.mjs, fixtures/schema-evidence.json.
**Consumes:** constants and shapes above. **Produces:** all contract functions above.

- [ ] Write a canonical synthetic fixture with all eight zero-diff classes and all
  ten required checks. Use fake project/parent/child/host values and fixed clocks.
  Build positive evidence through buildEvidence, not hand-claimed aggregates.
- [ ] Add failing behavior tests before implementing:

```js
it('retains cleanup failure despite equivalent schemas', () => {
  const raw = structuredClone(fixture)
  raw.cleanup = {status:'fail', attempted:true, confirmed:false, checkedAt:null, deletionMode:'recoverable'}
  expect(buildEvidence(raw).status).toBe('fail')
})
it('never treats local provenance claims as reusable proof', () => {
  const e = buildEvidence(fixture)
  const result = assessEvidence(e, {request:e.request,manifest:e.manifest,now:Date.parse(e.completedAt)})
  expect(result).toMatchObject({consistent:true,reusable:false,provenance:'unverified',productionReady:false})
  expect(() => parseEvidence({...e,trusted:true})).toThrow()
})
```

- [ ] Run node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run
  __tests__/scripts/schema-contract.test.mjs --maxWorkers=2; expect missing module
  or failing behavior assertions, not a fixture/environment failure.
- [ ] Implement strict exact-key/type/limit validation, canonical hashing and
  derived statuses. Complete omitted dependent checks as unknown/dependency_failed;
  never replace an explicit failure. Pass codes are bound to IDs and actual fields:
  comparison requires all counts0, bootstrap requires true, cleanup requires
  attempted+confirmed and ordered readback time, sessions match child+request.
  Input status cannot override these relationships. Render only canonical fields.
- [ ] Add table cases for each required check, duplicated/omitted keys, arrays/null
  masquerading as strings, forged pass, protected child, hash mismatch, extra fields,
  source/context mismatch, future/inverted times, exact30-day boundary and one ms
  beyond it. Reject evidence bytes over1MiB and every count/path/collection limit.
- [ ] Run focused GREEN and scoped ESLint. Commit explicit files as
  feat(schema): add bounded equivalence evidence contract. Independent task review.

## Task 2: Source and manifest binding

**Files:** manifest.mjs, schema-manifest.test.mjs.
**Consumes:** parseRequest/canonicalJson/LIMITS. **Produces:**

```js
buildManifest({root, sourceSha, listFiles, readFile, realpath}) // -> manifest
assertManifest(expected, actual) // throws fixed error on any mismatch
```

- [ ] RED tests change one migration byte, add/remove a file, alter baseline,
  change runner/helper byte and supply traversal/symlink paths. All invalidate the
  hash or reject. A numbering gap is preserved rather than synthesized.

```js
it('invalidates evidence when a migration changes', () => {
  const before = buildManifest(ports)
  files['supabase/migrations/043_example.sql'] += '\n-- change'
  const after = buildManifest(ports)
  expect(after.hash).not.toBe(before.hash)
  expect(() => assertManifest(before,after)).toThrow()
})
```

- [ ] Implement inventory from supabase/migrations/*.sql sorted exactly as migrate
  uses lexical filename order. Baseline is supabase/baseline/000_baseline_2026-08-31.sql.
  Require realpaths remain inside root and reject symlinks to external files.
  Hash raw bytes, not normalized text. Require clean source at expected Git HEAD
  in real local ports; tests inject status/identity, never assume repository HEAD.
- [ ] Pin harness inventory: scripts/schema-equivalence.mjs; every .mjs module in
  scripts/schema-equivalence/; scripts/migrate.ts; lib/schema/types.ts,
  introspect.ts,diff.ts; lib/security/redact-secrets.ts; package.json;
  package-lock.json. Include exact membership in the hash. This inventory covers
  the new dedicated lifecycle rather than unchanged integration-helper defaults.
- [ ] Run focused test and lint GREEN; commit feat(schema): bind rehearsal manifests.
  Independent task review before dependent orchestration.

## Task 3: Strict disposable lifecycle and bounded Neon port

**Files:** target.mjs, neon-port.mjs, schema-target.test.mjs, schema-neon-port.test.mjs.
**Consumes:** parseRequest/LIMITS. **Produces:**

```js
createTargetRegistry(request) // {register,assertSession,cleanupCandidate,forget}
createNeonPort({token, fetch, now, sleep})
// {readProject,readParent,createChild,connectionUri,deleteChild,confirmAbsent}
```

No API mutation is performed in tests. Stub fetch with full provider-shaped
responses. Network ports are constructed only after request/manifest validation.

- [ ] RED: changed default does not influence explicit parent payload; wrong
  project/parent/name/expiry/default/protected child rejects; constructed handles
  and substituted URIs fail registry checks. Both session comparisons reject wrong
  database and role before any reset. Cover cleanup after URI acquisition fails.

```js
expect(createBody.branch.parent_id).toBe(request.parentId)
expect(createBody.branch.expires_at).toBe(new Date(Math.floor((now + 7200000) / 1000) * 1000).toISOString())
expect(() => registry.assertSession(forgedHandle, validSession)).toThrow()
expect(deleteRequests).toHaveLength(0) // unproven foreign/protected response
```

- [ ] Use a private Map keyed by proven child ID and exact in-memory URI; register
  cleanable identity only after project/name/parent/nonprotected/TTL verification.
  URI acquisition additionally checks endpoint branch+host and requested user/db.
  A safe registered child can be cleaned if URI retrieval fails; malformed or foreign
  create response only produces possible_orphan, never automatic deletion.
- [ ] Implement exact no-retry REST requests with20s fetch/body abort,1MiB body cap,
  redirect:error, fixed API origin, token only in Authorization, fixed sanitized
  errors. No global SDK configuration or CLI shell. Methods/routes:

```js
// All segments encoded after strict identifier validation.
GET    /projects/{projectId}
GET    /projects/{projectId}/branches/{parentId}
POST   /projects/{projectId}/branches
// body: {branch:{name,parent_id,expires_at},endpoints:[{type:'read_write'}]}
GET    /projects/{projectId}/connection_uri?branch_id=...&database_name=...&role_name=...&pooled=false
DELETE /projects/{projectId}/branches/{childId}
GET    /projects/{projectId}/branches/{childId}
```

- [ ] Observe returned operation IDs through exact project-scoped operation GETs
  before using created child or accepting deletion. Poll reads at1s, at most120
  observations and120s total per operation group; never repeat POST/DELETE.
  Unknown/failed status, malformed operation identity or timeout fails. Require all
  operation IDs belong to the expected project/action response; retain fixed codes.
  API current statuses and response fields must be checked against installed
  generated API definitions/official reference before coding; unknown enums fail.
- [ ] confirmAbsent requires completed deletion operations, then authenticated
  GET project200 matching project and exact child GET404 with API JSON response.
  Any200 child response means present;401/403/network/HTML/othererror means unknown.
  No paginated list and no generic failed GET interpreted as deletion.
- [ ] Test delete200 plus failed/stillpending operation, absent child with wrong
  project,404 HTML,403, stale child200, redirected response, transport timeout,
  credential sentinels and no mutation retries. Polls are reads, not retries of
  creation/deletion. Ordinary recovery-window deletion is explicitly recorded.
- [ ] Run both tests/lint GREEN; commit feat(schema): enforce disposable rehearsal lifecycle.
  Independent task review; do not touch shared integration helper defaults.

## Task 4: Refactor the comparison runner around injected effects

**Files:** runner.mjs, local-ports.mjs, schema-equivalence.test.mjs.
**Consumes:** Tasks1–3. **Produces:**

```js
runEquivalence(request, ports)
// -> {evidence,exitCode}; always cleans a proven child before completion
// ports: now,runId,manifest,registry,neon,reset,applyMigrations,
//        applyBaseline,introspect,diff,dryRun
createLocalPorts({root,token,request,fetch}) // real adapters, lazy Clients
```

- [ ] Convert the existing four tests from import-triggered execution to explicit
  runEquivalence calls. Preserve exact emitted auth shim and original path order.
  Add compare-success/delete-failure, create-ambiguous, postcreate-URI-failure,
  wrong-session-role/database and manifest-drift tests before implementation.

```js
expect(events).toEqual(['parent','create','connection','resetA','shimA','migrateA',
  'inspectA','resetB','shimB','baseline','migrateB','inspectB','dryRun','compare',
  'delete','absence','manifest'])
expect(result.exitCode).toBe(1) // delete or absence failure, even when diff.equivalent
expect(parseEvidence(result.evidence)).toEqual(result.evidence)
```

- [ ] Move the existing SQL/comparison behavior rather than reimplementing it.
  Client errors must be consumed without printing raw URLs. Session checks include
  current_database() and current_user immediately before each reset. Close Client
  in finally after failed connect/query where applicable. Reuse introspectSchema
  and diffSchemas through existing plain-Node-compatible imports.
- [ ] Capture migration subprocess stdout/stderr rather than inheriting potentially
  credential-bearing output. Use process.execPath, args array, shell:false,
  timeout600000,maxBuffer1048576; child env allowlisted OS plus necessary fixed
  runtime variables and only its in-memory MIGRATE_DATABASE_URL. Never inherit a
  production database, API key or unrelated secret into migration subprocesses.
  Do not autoload .env files. Fixed failure code goes into proof, no raw output.
- [ ] Preserve successful dry-run exit AND no-pending content rule. Capture ledger
  head evidence using fixed read-only schema_migrations queries for both paths;
  compare exact ordered migration filenames with NULL checksums; Path A contains only
  those rows, while Path B additionally contains the baseline filename and raw-byte
  SHA-256 checksum. Ordinary ledger rows do not store per-file hashes: successful
  execution plus pre/post byte manifests provides that binding. Do not accept
  migration subprocess exit0 alone as proof of reaching the expected head.
- [ ] Use one outer cleanup finally, then final manifest comparison and buildEvidence.
  Missing dependent observations remain unknown; original and cleanup failures
  coexist. Failures cannot escape before the safe child's cleanup is attempted.
  No return in finally; choose exit only after canonical evidence is assembled.
- [ ] Test runner outputs with actual contract builder for success and each failure;
  verify zero network/SQL on invalid request/manifest. Run existing bootstrap and
  migrate-baseline-guard tests alongside runner tests. Commit refactor(schema):
  produce cleanup-bound equivalence evidence. Independent task review.

## Task 5: Guarded CLI and exclusive evidence artifacts

**Files:** scripts/schema-equivalence.mjs, schema-cli.test.mjs.
**Consumes:** all earlier interfaces. **Produces:** main(args,env,ports) -> exitCode.

- [ ] RED tests import entry with subprocess/fetch/Client spies and require no calls.
  Parse exactly --request PATH and --output-dir PATH; reject unknown, duplicate,
  missing, token/URI flags and oversized request before effects. Test actual child
  Node entry with missing arguments using only synthetic environment.
- [ ] Use the existing repository realpath/fileURLToPath entry guard:

```js
function isEntry() {
  if (!process.argv[1]) return false
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) }
  catch { return false }
}
if (isEntry()) main(process.argv.slice(2), process.env).then(code => {
  process.exitCode = code
}).catch(() => { console.error('Schema rehearsal failed'); process.exitCode = 1 })
```

- [ ] Read request capped64KiB, parse before NEON_API_KEY lookup/port construction;
  token missing/invalid fails with a fixed message. Explicit request source and
  manifest must match local clean checkout. No live credential preflight in tests.
  Real origin is set by real CLI wiring, synthetic by fixture wiring, never a
  --live/--trusted or request property that can manufacture provenance.
- [ ] After runEquivalence returns, validate and exclusively write schema-{runId}.json
  and .md with flag wx. Preserve safe failure evidence with exit1. Never overwrite,
  delete old files or lose cleanup status on second-write failure. No output path
  derived from provider strings. Print only fixed summary plus safe artifact paths.
- [ ] Test serialization/parsing across real runner->CLI, existing-file collision,
  second-write failure, synthetic origin/reuse refusal, redaction and exact request
  counts. Commit feat(schema): expose guarded rehearsal evidence CLI. Review.

## Task 6: Final local verification and handoff

**Files:** README.md; docs/superpowers/plans/2026-09-08-schema-equivalence-handoff.md;
current runtime handoff; docs/superpowers/plans/2026-09-07-c11-release-readiness.md;
clearly synthetic example pair. No application changes.

- [ ] Run the selected synthetic tests, never npm run schema:equivalence:

```text
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/scripts/schema-contract.test.mjs __tests__/scripts/schema-manifest.test.mjs __tests__/scripts/schema-target.test.mjs __tests__/scripts/schema-neon-port.test.mjs __tests__/scripts/schema-equivalence.test.mjs __tests__/scripts/schema-cli.test.mjs __tests__/scripts/bootstrap-project.test.mjs __tests__/scripts/migrate-baseline-guard.test.ts __tests__/helpers/neon-branch.test.ts __tests__/helpers/neon-branch-config.test.ts --maxWorkers=2
node .superpowers/sdd/local-run.cjs node_modules/eslint/bin/eslint.js scripts/schema-equivalence.mjs scripts/schema-equivalence __tests__/scripts/schema-*.test.mjs
node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen
node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit
git diff --check
```

- [ ] Resolve glob expansion with explicit test paths if Windows/tool configuration
  does not support the lint pattern. Record exact invoked command, source SHA,
  counts and failures. A production build is needed only if runtime/shared app
  imports change or typegen exposes an integration concern; do not claim an unrun build.
- [ ] Generate samples through the real builder/renderer with origin:synthetic;
  verify assessEvidence yields reusable:false. No live identifiers or credentials.
- [ ] Document variable-to-source mapping (NEON_API_KEY from separately approved
  operator source), exact request schema, ordinary deletion recovery semantics,
  local trust limitation, drift/freshness rules and partial artifact behavior.
  Retain old dated evidence; append current local status rather than rewriting history.
- [ ] Prepare an unexecuted live proposal template requiring exact IDs, sterile
  evidence, source/manifests, protected hosts, database/role, cost/TTL and cleanup
  readback. Mark every unselected live value unknown and blocking. Do not reuse
  September7's parent or silently authorize hard deletion.
- [ ] Obtain independent whole-slice review from the source baseline through HEAD.
  Send a complete diff, approved spec, task reports and exact verification evidence.
  Fix all findings in one coordinated wave with affected regressions. Update final
  tested source and review verdict. Commit docs, verify clean worktree and preserve
  root user changes. Stop at local handoff; no SliceD/publication/live operation.

## Plan self-review and execution checkpoint

Spec coverage: target/sterility/lifecycle Tasks3–4; hashes Task2; strict evidence,
30-day boundary and untrusted origin Task1; CLI/no side effects/artifacts Task5;
local proof/historical dossier/future gate Task6. The existing comparison and
integration-helper defaults are preserved. No target is selected by this document.
The direct API choice avoids installed CLI retries and incomplete list evidence.
Operation polling is bounded observation, not repeating a mutation. Protected
parent policy must designate a dedicated sterile nonproduction parent; the parent
itself is never a child mutation/cleanup target.

All function names and shared shapes are defined above; implementation must refine
internal helpers without changing these task handoffs. Platform response fixtures
must be verified against official definitions and unknown response shapes fail
closed. Implementation has not started. Execution method selection follows plan
review; prior local task approvals do not authorize a live rehearsal.
