# C9c Task 1 implementation report

## Status

PARTIAL by controller scope. The common opportunity types, canonical fingerprints, safe snapshot serialization, Pulse rule, and scan-check rule are implemented. Stored recommendation derivation/read/save behavior remains deferred pending the user's paid recommendation read/access decision. The reserved `agent-recommendation` source union is present, but `deriveSuggestions` intentionally produces no recommendation suggestion and does not emit a false source-unavailable state.

## Implemented

- Added `SourceRef`, discriminated `SourceEvidence`, `Suggestion`, and `DraftSnapshotV1` contracts.
- Added explicit safe evidence unions for public suggestions and saved snapshots.
- Added deterministic `opportunityKey` and SHA-256 fingerprints over canonical JSON.
- Canonical JSON sorts object keys by code point, preserves array order, normalizes negative zero, and rejects undefined, non-finite numbers, bigint, functions, symbols, sparse arrays, cyclic structures, and non-plain objects.
- Snapshot serialization enforces strict nested field allowlists and the 65,536-byte UTF-8 cap.
- Added `pulse-brand-absent.v1` for a successful retained Pulse observation with an answer and `brandMentioned=false`.
- Pulse fingerprinting includes the server-computed answer digest internally; the public suggestion evidence omits both digest and raw answer.
- Added `scan-check-gap.v1` using the actual `readScanEvidence` validator. Only complete, applicable warn/fail checks qualify.
- Scan evidence is projected field by field, retains redacted origin descriptors, method/version/comparison fields, selected check details, observations with explicit nullable provenance, and limitations. No whole envelope or runtime source spread is exposed.

## TDD evidence

### RED

Command:

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/rules.test.ts __tests__/opportunities/fingerprint.test.ts`

Result before production modules: 2 failed suites because `@/lib/opportunities/rules` and `@/lib/opportunities/fingerprint` did not exist. This was the expected feature-missing failure.

A later tightened allowlist test was also observed red: 1 failed / 15 passed in `fingerprint.test.ts` because `serializeDraftSnapshot` initially accepted an injected `rawAnswer` property. The serializer was then changed to reject fields outside the explicit allowlist.

### GREEN

Final focused command:

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/rules.test.ts __tests__/opportunities/fingerprint.test.ts`

Result: 2 files passed, 32 tests passed, 0 failed; output pristine.

Full typecheck through the ignored sanitized runner:

- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen`
- `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit`

Result: route types generated successfully; TypeScript exited 0 with no diagnostics.

## Files changed

- `lib/opportunities/types.ts`
- `lib/opportunities/rules.ts`
- `lib/opportunities/fingerprint.ts`
- `__tests__/opportunities/rules.test.ts`
- `__tests__/opportunities/fingerprint.test.ts`
- `.superpowers/sdd/c9c-task1-report.md`

## Self-review

- Confirmed exact rule versions: `pulse-brand-absent.v1` and `scan-check-gap.v1`.
- Confirmed opportunity identity distinguishes source kind, ID, and optional check key.
- Confirmed malformed scan envelopes fail closed through `readScanEvidence` and incomplete/unknown/non-applicable checks do not derive.
- Confirmed path/query source data and injected raw answers do not appear in suggestion output.
- Confirmed changing only the internal Pulse answer digest changes the fingerprint while public evidence remains identical.
- Confirmed all snapshot projections use explicit field allowlists and unknown scan-observation provenance remains explicit as `null`.
- No framework, SQL, migration, provider, environment, customer, deployment, merge, or push work was performed.

## Remaining scope

The original plan described `stored-recommendation.v1`, but controller scope explicitly defers its eligibility, source read, snapshot, and save behavior until the user decides whether paid recommendation content remains readable after downgrade. Later tasks must not interpret the reserved union as implemented eligibility.

## Final review fixes (2026-09-06)

Status remains PARTIAL only at the deferred stored-recommendation boundary.

### Findings fixed

1. Replaced the tautological `snapshot.args` own-key check with strict rule-specific validation. `pulse-brand-absent.v1` requires exactly normalized bounded `question` and `platform` strings. `scan-check-gap.v1` requires exactly a known `checkKey` and `warn|fail` assessment. Missing keys, extra keys such as `rawAnswer`, invalid values, and structured values fail closed.
2. Canonical object construction now uses a null-prototype own-data object, preserving JSON-owned `__proto__` keys in the canonical form and hash.
3. Added bounded scalar and string-array checks for the adjacent snapshot fields so hostile objects cannot hide keys inside expected scalar/limitation positions.
4. Preserved scan scanner/check/method version provenance unchanged, matching the reviewer's retraction and the approved spec.

### TDD evidence

RED command:

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts`

Initial result: 9 failed / 16 passed. The own `__proto__` value hashed identically to `{}`, and eight invalid Pulse/scan argument cases did not throw. After the first fix, an additional focused RED run recorded 2 failed / 27 passed for object values hidden in `initialTitle` and Pulse `evidence.question`; the limitations-object case already failed.

GREEN command:

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts __tests__/opportunities/rules.test.ts`

Final result: 2 files passed, 45 tests passed, 0 failed.

Full typecheck:

- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen` — route types generated successfully.
- `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` — exited 0 with no diagnostics.

### Self-review

- Both supported rule argument shapes have positive coverage.
- Missing, extra, wrong-type, unknown-check, and ineligible-assessment arguments have negative coverage.
- Own `__proto__` values remain distinct from each other and `{}`, while property ordering remains stable.
- The existing scan evidence projection and required provenance versions are unchanged.
- No recommendation rule, source reader, framework, SQL, database, provider, environment, deployment, merge, or push scope was added.

## Nested snapshot validation follow-up (2026-09-06)

### Finding reproduced

Focused RED command:

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts`

Result: 9 failed / 29 passed. Structured hostile values were accepted in Pulse evidence limitations and representative nested source, scan check, URL, comparison, check-version, observation, signal, and limited fields. A final audit test then reproduced 2 failed / 38 passed for mismatched rule/evidence identities.

### Fix and bounded audit

- Added the missing Pulse `evidence.limitations` bounded normalized string-array check.
- Validated source identity, Pulse scalar fields, scan top-level scalars, selected check fields, URL descriptors, comparison fields and complete check-version map, observation fields, and allowlisted signal value types.
- Bound arrays to their safe contract limits and rejected objects in scalar/string-array positions.
- Bound each evidence variant to its exact rule, source kind/check identity, and translation keys.
- Kept scanner/check/method provenance fields unchanged and retained the 65,536-byte UTF-8 cap before structural validation.

No schema decision was missing for this bounded safe-snapshot contract. The existing discriminated union and the authoritative scan evidence vocabulary supplied every required scalar/array constraint.

### Final verification

- `node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts __tests__/opportunities/rules.test.ts` — 2 files passed, 56 tests passed, 0 failed.
- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen` — route types generated successfully.
- `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` — exited 0 with no diagnostics.

Self-review found no remaining nested plain-object position in `DraftSnapshotV1` that bypasses an expected scalar, string-array, or explicit nested-object validator. Stored recommendation derivation remains deferred.

## Snapshot consistency follow-up (2026-09-06)

### RED

`node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts`

The requested regressions produced 7 failed / 40 passed: Pulse question/platform mismatches, scan check-key/assessment mismatches, ineligible applicability, incomplete collection, and selected-check version mismatch were all accepted. The bounded relation audit added duplicated method, evaluated-origin, and Pulse/scan limitation mismatch cases; the combined RED result was 11 failed / 40 passed.

### Fix

- Pulse `args.question` and `args.platform` must exactly equal the normalized evidence question/platform.
- Scan `args.checkKey` and `args.assessment` must exactly equal the selected evidence check.
- The selected scan check must be applicable, complete, warn/fail, and use `CHECK_VERSIONS[evidence.checkKey]`.
- Source/rule/translation-key/evidence identity remains bound from the prior fix.
- Top-level limitations must equal evidence limitations in order.
- Duplicated scanner, headline, and pillar methods must equal their comparison values; evaluated/final origins must equal comparison origins.
- The complete comparison check-version map must equal `CHECK_VERSIONS`.

No missing schema decision was found. Initial localized title/action cannot be recomputed in this pure module without translation resources; their bounded normalized scalar validation remains here, while later save service construction owns localization. This is an existing planned boundary, not an unresolved consistency relation in the source evidence fingerprint.

### GREEN

- `node node_modules/vitest/vitest.mjs run __tests__/opportunities/fingerprint.test.ts __tests__/opportunities/rules.test.ts` — 2 files passed, 67 tests passed, 0 failed.
- `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen` — route types generated successfully.
- `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` — exited 0 with no diagnostics.

Bounded self-review covered every duplicated source/rule/key/evidence relation represented in `DraftSnapshotV1`. Stored recommendation derivation remains deferred.
