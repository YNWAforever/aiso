import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

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

export async function main(args = process.argv.slice(2)) {
  return runTestPlan(buildTestRunPlan(args), executeVitest)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
