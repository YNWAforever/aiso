# AISO runtime readiness local handoff

Date: 2026-09-08
Branch: codex/release-readiness-design
Status: local Slice B implementation and documentation complete; independent whole-branch source review approved at 6054dfc. No live candidate acceptance, Slice C schema rehearsal or Slice D promotion.

## Source and review boundary

Latest verified source, including the authorized DNS repair: `638d5dbc1ea51cbf4d965125f1fa646d4959f1fa`. Prior Slice B source: `6054dfcf6b624b6a0c0ddbfe415b45a331b3beb5`.
The documentation/sample commit follows that source. Whole-branch review base is
`8d285cc890fd087fccc04f7d5bc10613f927a0a1` (verified origin/main merge-base),
not the older local main merge-base. Slice B base is `bd0571e`.
Task 5 independently approved after the policy/evidence contract repair at `27d2a9a`.
All four final source findings were repaired at `6054dfc`; independent whole-branch source re-review approved the local implementation with no remaining actionable source findings. Documentation review confirmed the credential, synthetic-evidence and live-action boundaries; its DNS blocker clarification and command correction are incorporated below.
The earlier checkpoint and foundation handoff retain their dated evidence.

## Implemented behavior and limits

`POST /api/internal/readiness` authenticates the dedicated bearer before parsing
or resource construction. It accepts only the bounded versioned request/policy,
with an exact 16 KiB body ceiling. Candidate/configuration prerequisites suppress
unsafe dependent probes. The shared handler deadline is 15 seconds; each I/O probe
has at most 5 seconds with cancellation and no retries.

Database probes use only fixed metadata queries in read-only transactions with
local 5-second statement timeout. They compare observed Neon project/branch,
role/database and forbidden targets; inspect requested relation privileges without
reading customer rows or performing DML. The approved application posture requires
`aeo_app` with BYPASSRLS (existing zero-policy tables require it), while rejecting
superuser, owner, create-role/create-database/replication and elevated membership.
This does not establish schema equivalence or provide database tenancy enforcement.

Auth checks fetch public issuer JWKS and an anonymous same-candidate session endpoint.
They send no user cookie or readiness bearer to the issuer. Optional protection
bypass reaches only the same-candidate anonymous request. Availability/anonymous
checks do not prove login, token signature correctness, billing, AI, email or cron
execution. Claims of verified-disabled capabilities normalize to unknown without
trusted source gates; unknown evidence never becomes pass.

Vercel is the supported candidate platform. Runtime requires `VERCEL=1`, canonical
`VERCEL_URL`, `VERCEL_PROJECT_ID`, `VERCEL_DEPLOYMENT_ID`, full lowercase
`VERCEL_GIT_COMMIT_SHA`, and preview/production `VERCEL_ENV`. Platform availability
has not been checked live. Observed runtime team is null; `READINESS_EXPECTED_TEAM_ID`
is configured evidence, independently matched against authenticated control-plane
ownership by the runner. Unsupported or missing identity fields block acceptance.

The runner fetches full Vercel deployment metadata before and after exactly one
readiness POST, rejecting redirects, mutable aliases, conflicting SHA sources,
wrong project/team/target/state and metadata drift. Each of the three HTTP
operations has its own 20-second fetch/body deadline and 256 KiB response ceiling,
with no retry. This is not a 20-second total command limit; allow up to 60 seconds
for sequential HTTP deadlines, plus local filesystem work. The handler has its
own tighter deadline. Reports must match nonce, canonical policy hash, explicit
candidate and timing (at most 30 minutes old).

Configuration/runtime pass produces CLI exit 0; failed/unknown valid evidence
produces exit 1. Both remain `enforced:false` and `productionReady:false`.
Invalid metadata/report/transport or artifact failures produce a fixed sanitized
failure and exit 1. JSON/Markdown artifacts use exclusive `wx` writes; neither
existing file is overwritten or deleted. If the second write fails, JSON can
remain alone. Inspect both artifacts and process exit status; there is no atomic
pair or signed promotion attestation. No prior report is loaded as authorization.

## Usage, policy and credential sources

Use Node 24; all options below are mandatory, with no URL or secret flags:

```text
node scripts/readiness/check-candidate.mjs --team TEAM_ID --project PROJECT_ID --deployment DEPLOYMENT_ID --sha FULL_LOWERCASE_SHA --environment preview --policy POLICY_JSON_PATH --output-dir OUTPUT_DIRECTORY
```

The team/project/deployment IDs require `team_`/`prj_`/`dpl_` prefixes. SHA is exactly
40 lowercase hexadecimal characters. Environment is explicitly `preview` or
`production`; unknown, duplicate or missing arguments fail. Placeholder identifiers
are not a selected candidate. The runner does not load dotenv or download environments.

Policy JSON has exactly `version:1`, `expectedDatabase` (project, branch,
role `aeo_app`, database), all five `capabilities` keys (claims, ai, billing,
email, scheduler) with required/unknown/verified-disabled values, and `relations`.
Each relation names public schema, one safe relation identifier and a nonempty,
unique subset of SELECT/INSERT/UPDATE/DELETE. Maximum 32 unique relations;
canonical policy and complete request must each fit 16 KiB. Privilege checks are
metadata inspection, not permission to execute those operations. Relation indexes
in artifacts refer to the ordered policy array. Preserve the approved policy beside
the report; the report hash binds that policy but does not embed its relation names.
The sample wrapper contains an illustrative policy only; never adopt it as a live policy.

| Name | Source and scope |
| --- | --- |
| VERCEL_TOKEN | Approved operator Vercel API credential with full deployment metadata access; control plane only |
| READINESS_PROBE_SECRET | Dedicated candidate server secret, at least 32 characters, securely supplied to operator and candidate; readiness bearer only |
| VERCEL_AUTOMATION_BYPASS_SECRET | Candidate project Deployment Protection automation secret if required; outer protection, separate from both credentials above; approved runtime copy also needed for protected anonymous self-request |
| READINESS_EXPECTED_TEAM_ID | Approved nonsecret Vercel team identifier; configured expectation, not observed runtime identity |
| VERCEL_* identity fields | Vercel system environment, availability to be verified for the concrete deployment |
| DATABASE_URL and EXPECTED_* bindings | Approved Neon candidate app-role connection and project/branch/database policy; never migration-owner connection |
| NEON_AUTH_BASE_URL and application secrets | Approved candidate configuration sources described in .env.example; no provisioning or retrieval in this slice |

No values belong in commands, reports or handoff text. See `.env.example` for the
application variable names and failure behavior.

## Local verification evidence

Earlier checks below are retained as historical evidence; final post-fix checks follow. Documentation edits do not change application/test source:

| Source | Command/check | Observed result |
| --- | --- | --- |
| 27d2a9a0d9cfb95a6211148020c9046f09239500 | `node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/readiness __tests__/api/readiness.test.ts __tests__/api/auth-route.test.ts __tests__/scripts/check-candidate.test.mjs __tests__/lib/public-url.test.ts __tests__/security/db-binding.test.ts --maxWorkers=2` | Exit 0; 13 files, 288 tests passed; 15.23s |
| b7a7d77ecbd3781c1838d5047861fc593aa701bd | Scoped ESLint, Next typegen and full tsc | Passed; after 27d2a9a changed-file lint and full tsc also passed |
| b38b23bfaa0a53595924cc553e6341161de4a906 | `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next build` | Exit 0; compiled 16.0s; TypeScript 21.6s; 15/15 static pages, 166ms |

Build application source is unchanged through 27d2a9a; intervening runner/test
additions are covered by the later tests/typecheck. The helper allowlists OS
variables and supplies explicitly synthetic fixture environment values. No local
credential file exists in this checkout; no environment was downloaded. Logs:
`.superpowers/sdd/runtime-task-6-tests.log` and `runtime-task-6-build.log`.
These are selected deterministic checks, not a full integration/E2E or schema run.

The [synthetic Markdown](../examples/2026-09-08-runtime-readiness-synthetic.md)
and [JSON wrapper](../examples/2026-09-08-runtime-readiness-synthetic.json) were
generated from `__tests__/fixtures/runtime-candidate.json` with the existing
`validateReport` and `renderReport` at 27d2a9a. Injected time is
2026-09-08T01:00:02.000Z. The sample is prominently synthetic; its extra wrapper
fields deliberately fail the strict wire schema. Direct validation and an injected
runner both rejected it: three synthetic HTTP responses, zero artifact writes,
zero live calls. Even extracting its fixture report does not create trusted provenance
or authorize acceptance. Generation transcript is recorded in the local Task 6 report.

## Final post-fix verification

Verified source: `6054dfcf6b624b6a0c0ddbfe415b45a331b3beb5`.

- Selected command above, without a reporter override: **311 tests passed in 14 files**, 14.44s (`.superpowers/sdd/runtime-final-selected.log`).
- Scoped ESLint for the seven changed source/test files: passed with no diagnostics (`runtime-final-lint.log`). Earlier unchanged runner/foundation lint also passed.
- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen`: passed (`runtime-final-typegen.log`).
- `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit`: passed, no diagnostics (`runtime-final-tsc.log`).
- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next build`: exit 0, compiled in 13.3s, 15/15 static pages (`runtime-final-build.log`).
- `git diff --check`: passed; Git line-ending normalization notices are not test failures.

The final regressions first reproduced 18 failures, then passed after repairing
public JWK material validation, missing dependent probe evidence, relation/grant
Markdown labels, and primitive JSON policy validation. Real adapters with injected
I/O now feed orchestration and the runner: connection, identity, read-only,
statement-timeout and auth failures retain diagnostics, produce exit 1, and write
both sanitized artifacts. These are synthetic tests, not live SQL/provider proof.
An earlier runner-policy regression reproduced seven failures and was also fixed.
A delegated fixer hit a usage limit without edits; the controller completed that
repair. Windows sandbox startup ACL failures were handled with scoped command
escalation, without changing ACLs. No unresolved local test/setup blocker remains.

## Blocked live-action proposal template

No live target is known or authorized. Every field below must be concrete and
reviewed before execution; unknown identifiers block action, including candidate creation.

| Required field | Current proposal |
| --- | --- |
| Authorizing operator and explicit scope | UNKNOWN; separate approval required |
| Vercel team/project/deployment IDs and immutable canonical hostname | UNKNOWN |
| Full source SHA and deployment environment | UNKNOWN; no production default |
| Approved policy path/hash and ordered relation privileges | UNKNOWN |
| Neon project/branch/database, aeo_app connection source, forbidden target policy | UNKNOWN |
| Dedicated readiness secret source and candidate configuration state | UNKNOWN |
| Vercel metadata token source/scope and deployment-protection source | UNKNOWN |
| Runtime identity/system-field availability and protection access | UNVERIFIED |
| Readiness DNS cancellation | Established locally with Node Resolver cancellation and loopback proof at 638d5db; concrete deployed runtime still UNVERIFIED |
| Output directory and evidence owner | UNKNOWN |
| Previous deployment and scoped configuration/credential state | UNKNOWN |
| Maximum action | One runner invocation: two read-only metadata GETs and at most one readiness POST; no retries |
| Timeouts | 20 seconds per runner HTTP operation, 15-second handler, 5 seconds per probe; stop on failure, separately approve any rerun |
| Acceptance | Matching pre/post immutable identity, fresh nonce/hash/timing, every approved check pass, exit 0 and complete sanitized artifact pair; still no release approval |
| Rollback | Record prior compatible deployment first; revoke only dedicated readiness access or separately approve probe-deployment rollback after schema compatibility review; never delete data or rotate unrelated credentials |

A separately approved deployment/configuration step is required if the candidate
lacks this endpoint or dedicated secret. No push, provisioning, credential retrieval,
scan, database repair, schema rehearsal, deployment, promotion or live invocation
was performed or authorized by this handoff.

## DNS cancellation repair — local evidence

The user separately authorized fixing DNS locally after the Slice B handoff.
Source `638d5dbc1ea51cbf4d965125f1fa646d4959f1fa` replaces readiness's
uncancellable OS lookup with an isolated `node:dns/promises.Resolver` per lookup.
The existing fetch deadline reaches that resolver; abort cancels its outstanding
queries. Success/error also clean up the listener and resolver. A failing family
cancels a pending sibling. Concurrent probes have independent resolvers.

Readiness resolves A and AAAA directly, waits for both, and validates every address
through the unchanged public-address boundary before pinning the connection.
Only ENODATA is treated as an empty family; other DNS errors fail closed. Resolution
uses system-configured DNS servers with one resolver try, no application retry,
and no fallback to OS lookup. Direct DNS bypasses hosts/NSS and prefers IPv4 when
both families succeed. This behavior is limited to readiness's public issuer and
candidate requests; general scan callers retain their existing lookup semantics.

[Node 24 documents Resolver cancellation](https://nodejs.org/docs/latest-v24.x/api/dns.html#resolvercancel).
A real local test sends A and AAAA only to an ephemeral UDP fixture on 127.0.0.1,
then aborts and observes both underlying query promises reject with ECANCELLED.
The fixture closes its socket and never changes global DNS settings. An adapter
regression exercises the actual five-second readiness deadline and verifies one
cancellation, one query per family, no second lookup, and no OS lookup.
Already transmitted packets cannot be recalled; this establishes cancellation of
outstanding resolver operations, not reversal of prior network traffic.

Verification at the DNS source SHA:

- RED: the original adapter timed out without calling resolver.cancel (one failing test).
- Focused suite: 106 tests in four files passed.
- Selected command documented above: **328 tests in 16 files passed**, 13.52s; `.superpowers/sdd/readiness-dns-selected.log`.
- Scoped ESLint for the five changed source/test files: passed, no diagnostics.
- Next typegen and full TypeScript: passed.
- Synthetic production build: exit 0, compiled in 17.2s, 15/15 static pages.
- `git diff --check`: passed.

Exact commands and remaining logs are in `.superpowers/sdd/readiness-dns-fix-report.md`.
The earlier 311-test results remain historical evidence. Independent source and documentation review approved the DNS repair with no actionable findings. The code-level readiness DNS blocker is repaired with local
evidence; no external DNS/HTTP probe, candidate verification, credential operation,
database action, push or deployment occurred. Concrete platform, target, policy,
and credential prerequisites above remain unverified and require separate approval.

## Slice C update — 2026-09-08 local evidence

The separate [schema-equivalence handoff](2026-09-08-schema-equivalence-handoff.md)
records strict request/clean-HEAD/hash preflight, explicit disposable-child/session
identity, unchanged two-path comparison and recoverable cleanup with exact active-branch
absence readback. At implementation source b866f14e97c203852f9143699c35d2cb698a094a,
421 selected synthetic tests across 10 files, scoped lint, Next typegen and TypeScript
passed. No build or live rehearsal ran. Whole-Slice C final independent review is
PENDING. Slice A/B APIs and the readiness HTTP probe were not changed by Slice C.

Historical evidence above remains dated evidence. No previously named project, parent,
sterility statement or credential approval is inherited. All live schema proposal
selections remain UNKNOWN/BLOCKED. Local evidence is unverified provenance with
reusable:false, enforced:false and productionReady:false. TTL is not deletion proof;
recoverable active-branch absence is not irreversible erasure. No schema equivalence,
release readiness, publication or next-phase authorization is established.


### Slice C final local closure — 2026-09-08

Final source `d8347fa62c3570edf1e0217ea1c5ae9ff1b6c65d` is independently **APPROVED**
with no remaining findings; this supersedes the pending-review status in the dated
update above. One review P2 was reproduced with nine failing tests and repaired:
malformed observed provider identifiers now fail safely while preserving parseable
failure evidence after cleanup. Final selected verification passed **436 tests in
10 files across two runs** (406/8 plus 30/2), and changed-six-file lint passed.
Earlier full scoped lint/typegen/TypeScript results remain dated to b866f14; the final
MJS/test-only repair changed no TypeScript/framework source and did not rerun those
checks or a build. The schema handoff records exact commands and final manifest.

Local tooling handoff is complete. Actual live schema equivalence remains UNPROVED;
all exact live proposal selections remain UNKNOWN/BLOCKED and require separate approval.
No provider, database, credential, deployment, publication or next-phase action occurred.
