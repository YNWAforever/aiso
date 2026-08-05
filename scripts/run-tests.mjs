import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const UNIT_BASE_ARGS = ['run', '--exclude', '__tests__/integration/**']
const INTEGRATION_BASE_ARGS = ['run', '--config', 'vitest.integration.config.ts']
const VITEST_ENTRY = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))

export function classifyTestArgs(args) {
  const sharedArgs = []
  const unitPaths = []
  const integrationPaths = []

  for (const arg of args) {
    if (arg.startsWith('-')) {
      sharedArgs.push(arg)
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

function executeVitest(run) {
  const invocation = createVitestInvocation(run)
  return new Promise((resolve) => {
    const child = spawn(invocation.executable, invocation.args, invocation.options)
    child.once('error', () => resolve(1))
    child.once('close', (code) => resolve(code ?? 1))
  })
}

export async function main(args = process.argv.slice(2)) {
  return runTestPlan(buildTestRunPlan(args), executeVitest)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
