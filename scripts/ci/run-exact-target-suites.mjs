import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@neondatabase/serverless'
import { provisionBranch, teardown } from '../../__tests__/integration/setup.ts'
import { PROJECT_ID } from '../../__tests__/helpers/neon-branch.ts'
import { redactSecrets } from '../../lib/security/redact-secrets.ts'

/**
 * Runs the five exact-target integration suites, so the release gate covers them.
 *
 * They were excluded from `vitest.integration.config.ts` because each demands a
 * pre-approved disposable target named through C9_/C9C_/C9D_/C9E_ variables, and
 * each is deliberately written with no globalSetup — so nothing provisioned one
 * for them, no npm script named their configs, and no CI job ran them. They were
 * runnable and never run.
 *
 * This provisions ONE branch through the single audited path and derives every C9
 * value from it.
 *
 * THE LOAD-BEARING RULE: this file never reads a C9 value from the environment.
 * Not as a default, not as a "local convenience" fallback. Those variables name
 * the database that five suites then write fixtures into and delete rows from; a
 * single `?? process.env.C9D_TEST_DATABASE_URL` would turn a provisioning script
 * into a way to aim destructive writes at any database an operator can reach.
 * `__tests__/ci/exact-target-suites.test.ts` asserts this source contains no such
 * read, because a comment saying so would not survive the next edit.
 *
 * What is lost and what replaces it, stated plainly: before this, the branch and
 * project ids were typed by a human who had separately approved that target, and
 * each suite compared them against the in-band GUCs — an independent approval.
 * Now one process both creates the branch and declares the expectation, so that
 * comparison becomes a self-consistency check. What replaces it is structural
 * rather than procedural: `createTestBranch` proves the target is a fresh,
 * non-default, non-primary, TTL-expiring child of the AISO project whose
 * connection uri matches one of its own endpoints, and `assertDisposableTestBranch`
 * refuses any branch this process did not create. The in-band check still runs
 * inside every suite and still fails closed.
 */

/** One config per excluded suite. `__tests__/ci/exact-target-suites.test.ts` pins that this stays exhaustive. */
export const EXACT_TARGET_CONFIGS = [
  'vitest.entity-integration.config.ts',
  'vitest.work-items-integration.config.ts',
  'vitest.change-sets-integration.config.ts',
  'vitest.change-set-stores-integration.config.ts',
  'vitest.delivery-integration.config.ts',
]

const REPORT_DIR = join('artifacts', 'exact-target')
const OWNER_ROLE = process.env.NEON_TEST_OWNER_ROLE?.trim() || 'neondb_owner'

const say = (line) => process.stdout.write(`${redactSecrets(String(line))}\n`)

/**
 * An aeo_app connection to the disposable branch, derived exactly as
 * `least-privilege-role.test.ts` derives its own: set a fresh password on the
 * role migration 037 created, then rewrite the credentials on the branch's own
 * uri. Two of the five suites assert that this url reports
 * `current_user = 'aeo_app'` while the owner url does not, which is the whole
 * point — they prove the append-only GRANT posture against the role the
 * application actually runs as.
 *
 * The DIRECT endpoint, never the pooled one: Neon's pooler authenticates against
 * the control plane's stored credential, so a password set with `alter role`
 * works on the direct endpoint and fails on the pooled one.
 */
async function deriveAppUrl(ownerUri) {
  const password = randomBytes(24).toString('base64url')
  const owner = new Client(ownerUri)
  await owner.connect()
  try {
    // DDL takes no bind parameters, and the password is generated here rather
    // than supplied, so no caller-controlled text reaches this statement.
    await owner.query(`alter role aeo_app login password '${password}'`)
  } finally {
    await owner.end()
  }
  const url = new URL(ownerUri)
  url.username = 'aeo_app'
  url.password = password
  return url.toString()
}

/** Every C9 value, derived from the branch this process created and from nothing else. */
function suiteEnv(branch, appUrl) {
  return {
    TEST_DATABASE_URL: branch.connectionUri,

    C9_ENTITY_DISPOSABLE_BRANCH_ID: branch.id,
    C9_ENTITY_PROJECT_ID: PROJECT_ID,
    C9_ENTITY_OWNER_ROLE: OWNER_ROLE,

    C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID: branch.id,
    C9C_WORK_ITEMS_PROJECT_ID: PROJECT_ID,
    C9C_WORK_ITEMS_OWNER_ROLE: OWNER_ROLE,

    C9D_DISPOSABLE_PROJECT_ID: PROJECT_ID,
    C9D_DISPOSABLE_BRANCH_ID: branch.id,
    C9D_TEST_DATABASE_URL: branch.connectionUri,
    C9D_TEST_APP_DATABASE_URL: appUrl,

    C9E_DISPOSABLE_PROJECT_ID: PROJECT_ID,
    C9E_DISPOSABLE_BRANCH_ID: branch.id,
    C9E_TEST_DATABASE_URL: branch.connectionUri,
    C9E_TEST_APP_DATABASE_URL: appUrl,
    // A refusal list, not a selector. The real parent, so the suite rejects it by
    // identity — a guessed value there would protect nothing.
    C9E_PARENT_BRANCH_ID: branch.parentId,
  }
}

function runSuite(config, env) {
  const name = config.replace(/^vitest\./, '').replace(/\.config\.ts$/, '')
  const reportPath = join(REPORT_DIR, `${name}.json`)
  // shell:false — the env carries two DSNs, one with a live password, and a
  // shell would put them one interpolation away from a log line.
  const child = spawnSync(process.execPath, [
    'node_modules/vitest/vitest.mjs', 'run',
    '--config', config,
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
  ], { env: { ...process.env, ...env }, encoding: 'utf8', shell: false })

  // @neondatabase/serverless echoes the full connection url, password included,
  // in its own error messages, and this repo is public.
  if (child.stdout) say(child.stdout)
  if (child.stderr) process.stderr.write(`${redactSecrets(child.stderr)}\n`)

  // The JSON reporter writes straight to disk, bypassing the streams above. A
  // PASSING run carries no error text and looks harmless; a failing one embeds
  // the DSN in every assertion message — which is exactly the run whose report
  // someone pastes into an issue. Redacted here rather than only in CI, so it is
  // true wherever this runs.
  try {
    writeFileSync(reportPath, redactSecrets(readFileSync(reportPath, 'utf8')))
  } catch {
    // No report to redact is a failure readReport will name; it is not this
    // function's job to decide that, and throwing here would hide it.
  }
  return { name, reportPath, status: child.status }
}

/**
 * A report is only evidence if it proves tests ran. Zero files, zero tests, or a
 * pending test all mean the suite did not assert what it claims to — the exact
 * shape of failure these five spent months in.
 *
 * No expected total is asserted. Four different counts (117, 114, 109, 103)
 * circulate in the docs for these same suites, and pinning one here would either
 * be wrong today or become a number someone lowers to make a run pass. What is
 * pinned is the property that matters: every suite ran, and nothing was skipped.
 */
function readReport({ name, reportPath, status }) {
  const problems = []
  if (status !== 0) problems.push(`vitest exited ${status}`)

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch {
    problems.push('wrote no readable JSON report')
    return { name, problems, tests: 0 }
  }

  const files = Array.isArray(report.testResults) ? report.testResults : []
  const tests = files.reduce((sum, file) => sum + (file.assertionResults?.length ?? 0), 0)
  const pending = files.reduce(
    (sum, file) => sum + (file.assertionResults ?? []).filter(a => a.status === 'pending').length, 0,
  )
  if (!files.length) problems.push('ran no test file')
  if (!tests) problems.push('ran no test')
  if (pending) problems.push(`skipped ${pending} test(s)`)
  return { name, problems, tests }
}

async function main() {
  rmSync(REPORT_DIR, { recursive: true, force: true })
  mkdirSync(REPORT_DIR, { recursive: true })

  try {
    const branch = await provisionBranch()
    say(`Exact-target suites: provisioned ${branch.id} in project ${PROJECT_ID}`)
    const env = suiteEnv(branch, await deriveAppUrl(branch.connectionUri))

    const outcomes = EXACT_TARGET_CONFIGS.map(config => readReport(runSuite(config, env)))
    const failed = outcomes.filter(o => o.problems.length)
    const total = outcomes.reduce((sum, o) => sum + o.tests, 0)

    for (const outcome of outcomes) {
      say(outcome.problems.length
        ? `  FAIL ${outcome.name}: ${outcome.problems.join('; ')}`
        : `  ok   ${outcome.name}: ${outcome.tests} tests`)
    }
    say(`Exact-target suites: ${outcomes.length - failed.length}/${outcomes.length} suites, ${total} tests`)
    if (failed.length) throw new Error(`${failed.length} exact-target suite(s) did not pass`)
  } finally {
    // Always, including a mid-run throw: an orphaned branch outlives the job and
    // costs money until its 2h TTL expires.
    await teardown()
  }
}

/**
 * Only when run as a script. `__tests__/ci/exact-target-suites.test.ts` imports
 * EXACT_TARGET_CONFIGS from this file, and an unguarded `main()` at module scope
 * meant that importing one constant provisioned a real Neon branch — which the
 * test process then exited out from under, before the `finally` could delete it.
 * Three live branches were leaked that way before this guard existed. A module
 * that does its work on import cannot safely export anything.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error))}\n`)
    process.exitCode = 1
  })
}
