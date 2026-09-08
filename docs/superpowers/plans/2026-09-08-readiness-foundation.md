# AISO Readiness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch missing or inconsistent release configuration in one local report without exposing secrets, contacting providers or claiming production readiness.

**Architecture:** Pure TypeScript contracts validate an explicitly supplied environment and capability policy. A report builder emits only fixed check identifiers/statuses and marks every report as unenforced. No runtime adapter or promotion authority is present in this first independently testable slice.

**Tech Stack:** Node24, TypeScript5.9, Vitest4; existing repository toolchain and no new dependencies.

## Global Constraints

- Approved design: docs/superpowers/specs/2026-09-08-release-readiness-design.md at297dc5e.
- Work from codex/release-readiness-design, based on merged main8d285cc. Preserve unrelated edits; explicitly stage paths.
- No deployment, environment write, credentials retrieval, database access, scan, email, migration or branch provision/deletion during implementation/tests.
- No modification to runtime db()/getProfile(), auth semantics, quotas or product capability availability.
- No new dependency. No framework code in this slice; later framework tasks must read installed Next16 guides first.
- Secret values, hashes of secrets, connection strings and raw provider exceptions never enter reports.
- A configuration pass is not live acceptance. Reports always say REPORT ONLY / NOT ENFORCED and productionReady:false.
- Tests pass environment fixtures explicitly. No automatic .env loading and no reading process.env inside pure validators.

## Scope decomposition

This plan implements the approved design's first sub-project: deterministic configuration/report contracts. The next dependent plans cover (B) protected candidate-runtime probes and trusted evidence, (C) explicit-parent rehearsal hardening and schema evidence, and (D) controlled promotion activation. Do not silently start B-D when A passes.

B must establish exact deployment identity, protected probe authentication, read-only SQL/grants and auth metadata/session checks; C must enforce explicit sterile parent and cleanup acceptance; D must validate30-minute runtime/30-day schema freshness, hash consistency, trusted artifact provenance, serialized promotion and actual Vercel bypass controls. These are scope boundaries, not claims that this plan implements full release readiness. Any production activation remains separately approved.

## Files and interfaces

Create:
- lib/readiness/config.ts: rules, explicit release policy and pure configuration validation.
- lib/readiness/report.ts: allowlisted report serialization; no live readiness authority.
- __tests__/readiness/config.test.ts: failures, contradictory policy and secret safety.
- __tests__/readiness/report.test.ts: fail-closed report and redaction boundaries.
- docs/superpowers/plans/2026-09-08-readiness-foundation-handoff.md: actual checks, limitations and next slice.

Modify .env.example and README.md only to correct stale auth/build claims and describe report semantics. Do not add an executable CLI that reads arbitrary environment files in this slice.

## Task1: Pure configuration and capability checks

Consumes explicit Readonly<Record<string,string|undefined>> and ReleasePolicy. Produces ConfigCheck[] via validateConfiguration(env,policy). No imports with side effects.

- [ ] Write __tests__/readiness/config.test.ts with this initial regression:

```ts
import { describe, expect, it } from 'vitest'
import { validateConfiguration, type ReleasePolicy } from '@/lib/readiness/config'
const policy: ReleasePolicy = {
  expected: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' },
  capabilities: { claims: 'unknown', ai: 'unknown', billing: 'unknown', email: 'unknown', scheduler: 'unknown' },
}
describe('configuration readiness', () => {
  it('collects all absent core requirements without echoing input', () => {
    const checks = validateConfiguration({ DATABASE_URL: 'credential-sentinel' }, policy)
    expect(checks.find(c => c.id === 'config.DATABASE_URL')?.status).toBe('fail')
    expect(checks.find(c => c.id === 'config.NEON_AUTH_COOKIE_SECRET')?.status).toBe('fail')
    expect(checks.find(c => c.id === 'config.PUBLIC_SCAN_RATE_LIMIT_SECRET')?.status).toBe('fail')
    expect(checks.find(c => c.id === 'capability.ai')?.status).toBe('unknown')
    expect(JSON.stringify(checks)).not.toContain('credential-sentinel')
  })
})
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/readiness/config.test.ts --maxWorkers=2`. Expect failure resolving the absent module, not a provider/setup failure.
- [ ] Create lib/readiness/config.ts with this core implementation:

```ts
export const capabilityNames = ['claims', 'ai', 'billing', 'email', 'scheduler'] as const
export type Capability = typeof capabilityNames[number]
export type ReleasePolicy = {
  expected: { project: string; branch: string; role: string; database: string }
  capabilities: Record<Capability, 'required' | 'verified-disabled' | 'unknown'>
}
export type ConfigCheck = { id: string; status: 'pass' | 'fail' | 'unknown'; code: string }
type Env = Readonly<Record<string, string | undefined>>
type Rule = (value: string) => boolean
const nonempty: Rule = value => value.length > 0
const secret: Rule = value => value.length >= 32
const https: Rule = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search }
  catch { return false }
}
const database: Rule = value => {
  try { const u = new URL(value); return ['postgres:', 'postgresql:'].includes(u.protocol) && !!u.hostname && !!u.username && !!u.password && u.pathname.length > 1 }
  catch { return false }
}
const core: Record<string, Rule> = {
  DATABASE_URL: database, NEON_AUTH_BASE_URL: https, NEON_AUTH_COOKIE_SECRET: secret,
  PUBLIC_SCAN_RATE_LIMIT_SECRET: secret, NEXT_PUBLIC_APP_URL: https, VERCEL: value => value === '1',
}
const requirements: Record<Capability, Record<string, Rule>> = {
  claims: { REPORT_SHARE_SECRET: secret },
  ai: { OPENROUTER_API_KEY: nonempty },
  billing: { STRIPE_SECRET_KEY: nonempty, STRIPE_WEBHOOK_SECRET: nonempty,
    STRIPE_PRICE_BASIC: value => value.startsWith('price_'), STRIPE_PRICE_PRO: value => value.startsWith('price_'),
    STRIPE_PRICE_ENTERPRISE: value => value.startsWith('price_') },
  email: { RESEND_API_KEY: nonempty, RESEND_FROM_EMAIL: nonempty, RESEND_TRIAL_FROM_EMAIL: nonempty },
  scheduler: { CRON_SECRET: secret },
}
export function validateConfiguration(env: Env, policy: ReleasePolicy): ConfigCheck[] {
  const checks: ConfigCheck[] = []
  const value = (key: string) => (env[key] ?? '').trim()
  const add = (id: string, ok: boolean, code: string) => checks.push({ id, status: ok ? 'pass' : 'fail', code: ok ? 'valid' : code })
  const checkRules = (rules: Record<string, Rule>) => {
    for (const [key, rule] of Object.entries(rules)) add(`config.${key}`, rule(value(key)), value(key) ? 'invalid' : 'missing')
  }
  checkRules(core)
  const expected = {
    EXPECTED_NEON_PROJECT_ID: policy.expected.project, EXPECTED_NEON_BRANCH_ID: policy.expected.branch,
    EXPECTED_DB_ROLE: policy.expected.role, EXPECTED_DB_NAME: policy.expected.database,
  }
  for (const [key, target] of Object.entries(expected)) add(`binding.${key}`, !!target.trim() && value(key) === target, 'expectation_mismatch')
  let parsed: URL | undefined
  try { parsed = new URL(value('DATABASE_URL')) } catch { /* database rule reports invalid input */ }
  add('binding.connection_role', !!parsed && decodeURIComponent(parsed.username) === policy.expected.role && policy.expected.role === 'aeo_app', 'application_role_required')
  add('binding.connection_database', !!parsed && decodeURIComponent(parsed.pathname.slice(1)) === policy.expected.database, 'database_mismatch')
  const blocked = (key: string, candidate: string) => value(key).split(',').map(x => x.trim()).filter(Boolean).includes(candidate)
  add('binding.forbidden_target', !blocked('FORBIDDEN_NEON_PROJECT_IDS', policy.expected.project)
    && !blocked('FORBIDDEN_NEON_BRANCH_IDS', policy.expected.branch)
    && !blocked('FORBIDDEN_DB_HOSTS', parsed?.hostname ?? ''), 'forbidden_target')
  for (const name of capabilityNames) {
    const mode = policy.capabilities[name]
    checks.push({ id: `capability.${name}`, status: mode === 'unknown' ? 'unknown' : 'pass', code: mode })
    if (mode === 'required') checkRules(requirements[name])
  }
  return checks
}
```

- [ ] Add fault cases before further implementation changes. Use a valid fixture with fake credentials, HTTPS fixture.invalid URLs, VERCEL1, exact expected values and all optional capabilities unknown. Assert core keys pass but unknown capability checks remain. Table-test empty/whitespace and31-character secrets, invalid URLs, missing identity fields, owner role, unexpected database and forbidden project/branch/host. Malformed percent encoding in DSN usernames/database must return failure instead of throwing: reproduce first, then use a local safeDecode helper returning undefined on decode failure in the two comparisons.

```ts
it.each(['', ' ', 'x'.repeat(31)])('rejects an unusable cookie secret', value => {
  const checks = validateConfiguration({ NEON_AUTH_COOKIE_SECRET: value }, policy)
  expect(checks.find(c => c.id === 'config.NEON_AUTH_COOKIE_SECRET')?.status).toBe('fail')
})
it('does not suppress required AI configuration', () => {
  const checks = validateConfiguration({}, { ...policy, capabilities: { ...policy.capabilities, ai: 'required' } })
  expect(checks.find(c => c.id === 'config.OPENROUTER_API_KEY')?.status).toBe('fail')
})
```

- [ ] Treat verified-disabled as caller-supplied policy metadata only; document that this pure module cannot prove reachability. No default production policy may mark a capability verified-disabled. Later trusted-policy adapters must verify actual gates.
- [ ] Run the focused test command again; expect all cases pass. Run `node node_modules/eslint/bin/eslint.js lib/readiness/config.ts __tests__/readiness/config.test.ts`. Commit only these files as `feat(readiness): validate release configuration without side effects`.

## Task2: Redacted report-only output

Consumes ConfigCheck[] from Task1. Produces buildConfigurationReport(checks) and renderConfigurationReport(report). A report contains no environment or provider objects and cannot authorize promotion.

- [ ] Write __tests__/readiness/report.test.ts:

```ts
import { expect, it } from 'vitest'
import { buildConfigurationReport, renderConfigurationReport } from '@/lib/readiness/report'
it('never claims production readiness even when every input check passes', () => {
  const report = buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }])
  expect(report.productionReady).toBe(false)
  expect(report.enforced).toBe(false)
  expect(report.configurationStatus).toBe('pass')
  expect(renderConfigurationReport(report)).toContain('REPORT ONLY / NOT ENFORCED')
})
it('rejects an empty check list as missing evidence', () => {
  expect(buildConfigurationReport([]).configurationStatus).toBe('unknown')
})
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/readiness/report.test.ts --maxWorkers=2`; expect missing-module failure.
- [ ] Create lib/readiness/report.ts:

```ts
import type { ConfigCheck } from './config'
export function buildConfigurationReport(checks: readonly ConfigCheck[]) {
  const safe = checks.map(({ id, status, code }) => ({ id, status, code }))
  const configurationStatus = safe.some(c => c.status === 'fail') ? 'fail'
    : safe.length === 0 || safe.some(c => c.status === 'unknown') ? 'unknown' : 'pass'
  return { version: 1 as const, kind: 'configuration-only' as const, enforced: false as const,
    productionReady: false as const, configurationStatus, checks: safe }
}
export function renderConfigurationReport(report: ReturnType<typeof buildConfigurationReport>): string {
  return ['# AISO configuration readiness', '', 'REPORT ONLY / NOT ENFORCED', '',
    `Configuration: ${report.configurationStatus}`, 'Production readiness: unverified', '',
    ...report.checks.map(c => `- ${c.id}: ${c.status} (${c.code})`), ''].join('\n')
}
```

- [ ] Add regression proving a sentinel-bearing extra field is dropped from report objects. Test failure precedence over unknown, unknown over pass, and stable output ordering. Reject unknown check IDs/status/code at this boundary rather than rendering arbitrary caller strings: export the finite ID/code vocabulary from config.ts and validate it here, throwing a fixed `Invalid configuration check` error. Add a failing test with a secret sentinel in id/code and confirm neither the error nor Markdown exposes it. No raw JSON parsing or untrusted report import is introduced.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/readiness --maxWorkers=2` and scoped ESLint for both modules and tests; expect pass. Commit explicit task files as `feat(readiness): emit redacted report-only configuration results`.

## Task3: Document boundaries and verify the foundation

Consumes the modules from Tasks1-2. Produces an honest local handoff and corrected setup docs; no provider/CI enforcement change.

- [ ] Correct README.md and .env.example claims that auth cookie secret failure necessarily breaks build. State: `Auth and database clients are lazy. A successful build does not verify runtime configuration. Readiness configuration reports validate supplied values only and are not production acceptance.` Preserve existing variable names and runtime optionality; distinguish stricter release-policy expectations from current runtime requirements.
- [ ] Read these files before documenting current gaps: docs/superpowers/plans/2026-09-07-c10-provider-verification.md, docs/superpowers/plans/2026-09-07-c11-release-readiness.md and the approved design. Do not overwrite historical evidence as if it had been refreshed. Record the production repair and successful single-scan observations as dated conversation evidence in the new handoff.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/readiness --maxWorkers=2`, `node node_modules/eslint/bin/eslint.js lib/readiness __tests__/readiness`, `node node_modules/typescript/bin/tsc --noEmit`, and `git diff --check`. No live integration suite or schema:equivalence command is permitted. Record exact outcomes, including baseline/setup failures separately.
- [ ] Review independently using requesting-code-review. Address actionable findings and rerun only affected checks. Do not claim the approved full design is implemented.
- [ ] Write docs/superpowers/plans/2026-09-08-readiness-foundation-handoff.md with commit identity, changed behavior, checks actually run, unresolved policy/reachability decisions and B-D boundaries. Runtime probe credential provisioning, live schema rehearsal and promotion enforcement remain unexecuted.
- [ ] Commit explicit documentation files as `docs(readiness): record configuration foundation and remaining release gates`. Stop at the local reviewable handoff; do not publish or activate a workflow implicitly.

## Plan self-review

This scoped plan delivers the pure-contract/report foundation and explicitly excludes the other approved design sub-projects from its completion claim. Tasks share ConfigCheck/ReleasePolicy interfaces and concrete test commands. Security review must cover the finite report vocabulary and malformed DSN decoding, not only happy-path validation. There is no live credential source, environment reader, endpoint, database client or promotion function in the implementation surface. Policy statuses do not prove a feature is disabled. Report-only mode cannot be mistaken for enforced readiness because productionReady is always false.
