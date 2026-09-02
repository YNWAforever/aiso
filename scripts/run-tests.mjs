import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Relative, with the explicit .ts extension, as scripts/schema-equivalence.mjs
// already imports this same module: `npm test` runs this file under plain node,
// which resolves neither tsconfig path aliases nor extensionless .ts.
import { neonctlCommand } from '../__tests__/helpers/neon-branch.ts'

const UNIT_BASE_ARGS = ['run', '--exclude', '__tests__/integration/**']
const INTEGRATION_BASE_ARGS = ['run', '--config', 'vitest.integration.config.ts']
const VITEST_ENTRY = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const OPTIONS_WITH_REQUIRED_VALUE = new Set([
  '-r',
  '--root',
  '-c',
  '--config',
  '-t',
  '--testNamePattern',
  '--dir',
  '--reporter',
  '--outputFile',
  '--mode',
  '--browser',
  '--pool',
  '--execArgv',
  '--vmMemoryLimit',
  '--maxWorkers',
  '--environment',
  '--shard',
  '--testTimeout',
  '--hookTimeout',
  '--bail',
  '--retry',
  '--diff',
  '--exclude',
  '--project',
  '--slowTestThreshold',
  '--teardownTimeout',
  '--maxConcurrency',
  '--attachmentsDir',
  '--configLoader',
  '--mergeReports',
  '--tagsFilter',
  '--experimental',
])

export function classifyTestArgs(args) {
  const sharedArgs = []
  const unitPaths = []
  const integrationPaths = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('-')) {
      sharedArgs.push(arg)
      if (OPTIONS_WITH_REQUIRED_VALUE.has(arg) && index + 1 < args.length) {
        sharedArgs.push(args[index + 1])
        index += 1
      }
      continue
    }

    const normalized = arg.replaceAll('\\', '/')
    if (normalized.includes('__tests__/integration/')) {
      integrationPaths.push(arg)
    } else {
      unitPaths.push(arg)
    }
  }

  return { sharedArgs, unitPaths, integrationPaths }
}

export function buildTestRunPlan(args) {
  const { sharedArgs, unitPaths, integrationPaths } = classifyTestArgs(args)
  const plan = []

  if (unitPaths.length > 0 || integrationPaths.length === 0) {
    plan.push({
      runner: 'unit',
      args: [...UNIT_BASE_ARGS, ...sharedArgs, ...unitPaths],
    })
  }

  if (integrationPaths.length > 0 || unitPaths.length === 0) {
    plan.push({
      runner: 'integration',
      args: [...INTEGRATION_BASE_ARGS, ...sharedArgs, ...integrationPaths],
    })
  }

  return plan
}

// ---------------------------------------------------------------------------
// Integration-run gating — READ THIS BEFORE LOOSENING IT.
//
// docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md:293
// is emphatic: "If `TEST_DATABASE_URL` is absent, integration tests **fail
// loudly rather than skip**. A quiet skip is indistinguishable from a pass, and
// that is how this situation arose."
//
// That rule is about a suite that is already running finding no database, and
// it is preserved verbatim — __tests__/integration/setup.ts still throws, and
// every integration suite still does neon(process.env.TEST_DATABASE_URL!).
//
// What is gated here is a different, strictly upstream condition: `neonctl`,
// the tool that provisions the branch in the first place, is not installed on
// this machine at all. Without this gate `npm test` cannot pass in a clean
// checkout, which makes the repo's only release gate (there is no CI) useless.
//
// The spec's real requirement is that a skip must never read as a pass. Three
// things enforce that here, and none of them is decorative:
//   1. the banner is printed AFTER the run, because 1000+ passing tests scroll
//      an up-front notice out of view;
//   2. it states the negative outright, not merely the reason;
//   3. REQUIRE_INTEGRATION_TESTS=1 turns any unavailability into a hard
//      failure, and is the command that proves the full suite ran.
// An explicitly named integration path is never skipped either — the caller
// asked for exactly that run, so doing nothing instead would be the silent pass
// the spec warns about.
// ---------------------------------------------------------------------------

const BANNER_RULE = '='.repeat(64)

const absent = () => ({
  available: false,
  reason: 'neonctl is not on PATH',
  remedy: 'npm i -g neonctl && neonctl auth',
})

export function probeIntegrationCapability({
  execFile = execFileSync,
  env = process.env,
  resolveCommand = neonctlCommand,
  fileExists = existsSync,
} = {}) {
  if (env.SKIP_INTEGRATION_TESTS === '1') {
    return {
      available: false,
      reason: 'SKIP_INTEGRATION_TESTS=1 is set',
      remedy: 'Unset SKIP_INTEGRATION_TESTS to run integration tests.',
    }
  }

  // Spawn neonctl exactly as the harness that will provision the branch does.
  // A bare execFile('neonctl', ...) here was wrong on Windows: the global
  // install is a .cmd shim, execFile without shell: true refuses to run one, so
  // this preflight reported "not on PATH" on machines where neonctl was
  // installed and authenticated -- taking REQUIRE_INTEGRATION_TESTS=1 npm test,
  // the command that is supposed to prove the full suite ran, down with it.
  let command
  let leadingArgs
  try {
    ;[command, leadingArgs] = resolveCommand()
  } catch {
    // Windows with APPDATA unset: the global npm prefix cannot be derived, so
    // neonctl cannot be located at all. That is an absence, not a
    // misconfiguration -- neon-branch.ts's own message says "Install neonctl".
    return absent()
  }

  // On Windows `command` is this node binary, which always exists, so a missing
  // neonctl no longer surfaces as ENOENT: node starts fine and exits 1 with
  // "Cannot find module". That would be classified below as "present but
  // unusable" and answered with `neonctl auth`, which cannot fix an install
  // that isn't there. Test the resolved entry point instead, so absence stays
  // absence on both platforms.
  if (leadingArgs.length > 0 && !fileExists(leadingArgs[0])) return absent()

  try {
    // `--version` rather than a network call on purpose: an installed but
    // unauthenticated neonctl is a misconfiguration, not an absence, and
    // __tests__/helpers/neon-branch.ts already fails loudly with the right
    // hint for that case. Probing auth here would swallow it into a skip.
    execFile(command, [...leadingArgs, '--version'], { stdio: 'ignore', timeout: 20_000 })
    return { available: true, reason: null, remedy: null }
  } catch (error) {
    // Same sanitisation as formatSpawnError — the raw error can carry paths.
    const rawCode = typeof error?.code === 'string' ? error.code : 'unknown'
    const code = rawCode.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'
    return code === 'ENOENT'
      ? absent()
      : {
          available: false,
          reason: `neonctl is present but unusable (${code})`,
          remedy: 'Run `neonctl auth`, or set NEON_API_KEY.',
        }
  }
}

export function applyIntegrationGate(plan, capability, { explicit = false, strict = false } = {}) {
  const wantsIntegration = plan.some((run) => run.runner === 'integration')
  if (!wantsIntegration || capability.available) {
    return { plan, skipped: null, blocked: null }
  }
  if (strict || explicit) {
    return { plan: [], skipped: null, blocked: capability }
  }
  return {
    plan: plan.filter((run) => run.runner !== 'integration'),
    skipped: capability,
    blocked: null,
  }
}

export function formatIntegrationSkipBanner(capability) {
  return [
    BANNER_RULE,
    '  INTEGRATION TESTS DID NOT RUN — THIS IS NOT A FULL PASS',
    `  Reason:  ${capability.reason}`,
    `  Fix:     ${capability.remedy}`,
    '  Enforce: REQUIRE_INTEGRATION_TESTS=1 npm test',
    BANNER_RULE,
    '',
  ].join('\n')
}

export function formatIntegrationBlockedBanner(capability, { strict = false } = {}) {
  const because = strict
    ? 'REQUIRE_INTEGRATION_TESTS=1 is set'
    : 'an integration test path was requested explicitly'
  return [
    BANNER_RULE,
    '  INTEGRATION TESTS CANNOT RUN AND WILL NOT BE SKIPPED',
    `  Because: ${because}`,
    `  Reason:  ${capability.reason}`,
    `  Fix:     ${capability.remedy}`,
    BANNER_RULE,
    '',
  ].join('\n')
}

export async function runTestPlan(plan, execute) {
  for (const run of plan) {
    const exitCode = await execute(run)
    if (exitCode !== 0) return exitCode
  }
  return 0
}

export function createVitestInvocation(run) {
  return {
    executable: process.execPath,
    args: [VITEST_ENTRY, ...run.args],
    options: { shell: false, stdio: 'inherit' },
  }
}

function formatSpawnError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'unknown'
  const sanitizedCode = code.replace(/[^a-zA-Z0-9_-]/g, '') || 'unknown'
  return `Vitest failed to start (${sanitizedCode}).\n`
}

export function executeVitest(run, { spawnProcess = spawn, stderr = process.stderr } = {}) {
  const invocation = createVitestInvocation(run)
  return new Promise((resolve) => {
    const child = spawnProcess(invocation.executable, invocation.args, invocation.options)
    child.once('error', (error) => {
      stderr.write(formatSpawnError(error))
      resolve(1)
    })
    child.once('close', (code) => resolve(code ?? 1))
  })
}

export async function main(args = process.argv.slice(2), {
  probe = probeIntegrationCapability,
  execute = executeVitest,
  env = process.env,
  stderr = process.stderr,
} = {}) {
  // buildTestRunPlan stays pure — the gate is applied to its output rather than
  // folded into it, so the plan remains a plain function of argv.
  const plan = buildTestRunPlan(args)
  const explicit = classifyTestArgs(args).integrationPaths.length > 0
  const strict = env.REQUIRE_INTEGRATION_TESTS === '1'
  const gate = applyIntegrationGate(plan, probe({ env }), { explicit, strict })

  if (gate.blocked) {
    stderr.write(formatIntegrationBlockedBanner(gate.blocked, { strict }))
    return 1
  }

  if (gate.skipped) stderr.write(formatIntegrationSkipBanner(gate.skipped))
  const exitCode = await runTestPlan(gate.plan, execute)
  // Printed again, last: an up-front notice scrolls away behind a thousand
  // passing tests, and a skip nobody sees is the silent pass we are avoiding.
  // Printed even when the unit run failed — the statement is still true.
  if (gate.skipped) stderr.write(formatIntegrationSkipBanner(gate.skipped))
  return exitCode
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
