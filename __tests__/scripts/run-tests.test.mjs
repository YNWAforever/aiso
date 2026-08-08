import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  applyIntegrationGate,
  buildTestRunPlan,
  classifyTestArgs,
  createVitestInvocation,
  main,
  probeIntegrationCapability,
  runTestPlan,
} from '../../scripts/run-tests.mjs'

const unitBase = ['run', '--exclude', '__tests__/integration/**']
const integrationBase = ['run', '--config', 'vitest.integration.config.ts']

function fullSuitePlan(sharedArgs) {
  return [
    { runner: 'unit', args: [...unitBase, ...sharedArgs] },
    { runner: 'integration', args: [...integrationBase, ...sharedArgs] },
  ]
}

describe('classifyTestArgs', () => {
  it('separates unit paths, integration paths, and shared flags', () => {
    expect(classifyTestArgs([
      '--reporter=dot',
      '__tests__/api/scan.test.ts',
      '__tests__\\integration\\brand-creation.test.ts',
    ])).toEqual({
      sharedArgs: ['--reporter=dot'],
      unitPaths: ['__tests__/api/scan.test.ts'],
      integrationPaths: ['__tests__\\integration\\brand-creation.test.ts'],
    })
  })

  it('keeps space-separated reporter values shared so flags-only runs use both runners', () => {
    expect(buildTestRunPlan(['--reporter', 'verbose'])).toEqual(
      fullSuitePlan(['--reporter', 'verbose']),
    )
  })

  it('keeps short test-name-pattern values shared so flags-only runs use both runners', () => {
    expect(buildTestRunPlan(['-t', 'claim flow'])).toEqual(
      fullSuitePlan(['-t', 'claim flow']),
    )
  })

  it('keeps path-like output-file values shared so flags-only runs use both runners', () => {
    expect(buildTestRunPlan(['--outputFile', '__tests__/integration/report.json'])).toEqual(
      fullSuitePlan(['--outputFile', '__tests__/integration/report.json']),
    )
  })

  it('keeps the short root option value shared before routing test paths', () => {
    expect(buildTestRunPlan(['-r', 'fixtures', '__tests__/api/scan.test.ts'])).toEqual([
      { runner: 'unit', args: [...unitBase, '-r', 'fixtures', '__tests__/api/scan.test.ts'] },
    ])
  })
})

describe('buildTestRunPlan', () => {
  it('runs unit then integration for no arguments', () => {
    expect(buildTestRunPlan([])).toEqual([
      { runner: 'unit', args: unitBase },
      { runner: 'integration', args: integrationBase },
    ])
  })

  it('routes unit-only paths to unit without a false integration run', () => {
    expect(buildTestRunPlan(['__tests__/api/scan.test.ts'])).toEqual([
      { runner: 'unit', args: [...unitBase, '__tests__/api/scan.test.ts'] },
    ])
  })

  it('routes integration-only paths to integration', () => {
    expect(buildTestRunPlan(['__tests__/integration/brand-creation.test.ts'])).toEqual([
      { runner: 'integration', args: [...integrationBase, '__tests__/integration/brand-creation.test.ts'] },
    ])
  })

  it('keeps shared flags and partitions mixed paths in unit-first order', () => {
    expect(buildTestRunPlan([
      '--reporter=dot',
      '__tests__/api/scan.test.ts',
      '__tests__/integration/brand-creation.test.ts',
    ])).toEqual([
      { runner: 'unit', args: [...unitBase, '--reporter=dot', '__tests__/api/scan.test.ts'] },
      { runner: 'integration', args: [...integrationBase, '--reporter=dot', '__tests__/integration/brand-creation.test.ts'] },
    ])
  })
})

describe('runTestPlan', () => {
  it('stops after the first non-zero runner result', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(0)

    await expect(runTestPlan([
      { runner: 'unit', args: unitBase },
      { runner: 'integration', args: integrationBase },
    ], execute)).resolves.toBe(7)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('createVitestInvocation', () => {
  it('uses Node and Vitest\'s JavaScript entry without a shell on Windows', () => {
    expect(createVitestInvocation(
      { runner: 'unit', args: [...unitBase, 'path with spaces.test.ts', '&'] },
    )).toEqual({
      executable: process.execPath,
      args: [expect.stringMatching(/[\\/]vitest[\\/]vitest\.mjs$/), ...unitBase, 'path with spaces.test.ts', '&'],
      options: { shell: false, stdio: 'inherit' },
    })
  })
})

const available = { available: true, reason: null, remedy: null }
const missing = {
  available: false,
  reason: 'neonctl is not on PATH',
  remedy: 'npm i -g neonctl && neonctl auth',
}

describe('probeIntegrationCapability', () => {
  it('reports availability when neonctl answers --version', () => {
    const execFile = vi.fn()
    expect(probeIntegrationCapability({ execFile, env: {} })).toEqual(available)
    expect(execFile).toHaveBeenCalledWith('neonctl', ['--version'], expect.any(Object))
  })

  it('reports the install remedy when neonctl is not on PATH', () => {
    const execFile = vi.fn(() => {
      throw Object.assign(new Error('spawnSync neonctl ENOENT'), { code: 'ENOENT' })
    })
    expect(probeIntegrationCapability({ execFile, env: {} })).toEqual(missing)
  })

  it('does not leak raw error detail when neonctl is present but unusable', () => {
    const execFile = vi.fn(() => {
      throw Object.assign(new Error('sensitive-path-detail'), { code: 'EACCES' })
    })
    const capability = probeIntegrationCapability({ execFile, env: {} })

    expect(capability.available).toBe(false)
    expect(capability.reason).toBe('neonctl is present but unusable (EACCES)')
    expect(JSON.stringify(capability)).not.toContain('sensitive-path-detail')
  })

  it('honours an explicit SKIP_INTEGRATION_TESTS opt-out without probing', () => {
    const execFile = vi.fn()
    const capability = probeIntegrationCapability({
      execFile,
      env: { SKIP_INTEGRATION_TESTS: '1' },
    })

    expect(capability.available).toBe(false)
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('applyIntegrationGate', () => {
  const plan = () => [
    { runner: 'unit', args: unitBase },
    { runner: 'integration', args: integrationBase },
  ]

  it('leaves the plan untouched when neonctl is available', () => {
    expect(applyIntegrationGate(plan(), available)).toEqual({
      plan: plan(),
      skipped: null,
      blocked: null,
    })
  })

  it('drops an implicitly included integration run when neonctl is missing', () => {
    expect(applyIntegrationGate(plan(), missing)).toEqual({
      plan: [{ runner: 'unit', args: unitBase }],
      skipped: missing,
      blocked: null,
    })
  })

  it('blocks rather than skips when an integration path was named explicitly', () => {
    expect(applyIntegrationGate(plan(), missing, { explicit: true })).toEqual({
      plan: [],
      skipped: null,
      blocked: missing,
    })
  })

  it('blocks rather than skips under REQUIRE_INTEGRATION_TESTS', () => {
    expect(applyIntegrationGate(plan(), missing, { strict: true })).toEqual({
      plan: [],
      skipped: null,
      blocked: missing,
    })
  })

  it('leaves a unit-only plan untouched even when neonctl is missing', () => {
    const unitOnly = [{ runner: 'unit', args: unitBase }]
    expect(applyIntegrationGate(unitOnly, missing)).toEqual({
      plan: unitOnly,
      skipped: null,
      blocked: null,
    })
  })
})

describe('main integration gating', () => {
  function harness({ capability = missing, env = {}, exitCode = 0 } = {}) {
    const sequence = []
    const execute = vi.fn(async (run) => {
      sequence.push(`execute:${run.runner}`)
      return exitCode
    })
    const write = vi.fn((text) => { sequence.push(`write:${text.split('\n')[1]?.trim()}`) })
    return { sequence, execute, write, probe: () => capability, env }
  }

  it('runs only the unit project and still succeeds when neonctl is missing', async () => {
    const { execute, write, probe, env } = harness()

    await expect(main([], { probe, execute, env, stderr: { write } })).resolves.toBe(0)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0].runner).toBe('unit')
  })

  it('prints the skip banner after the run, not only before it', async () => {
    const { sequence, execute, write, probe, env } = harness()

    await main([], { probe, execute, env, stderr: { write } })

    // The load-bearing assertion: an up-front-only notice scrolls out of view
    // behind the unit output, which is how a skip becomes a false pass.
    expect(sequence).toEqual([
      'write:INTEGRATION TESTS DID NOT RUN — THIS IS NOT A FULL PASS',
      'execute:unit',
      'write:INTEGRATION TESTS DID NOT RUN — THIS IS NOT A FULL PASS',
    ])
  })

  it('still reports the skip when the unit run failed', async () => {
    const { execute, write, probe, env } = harness({ exitCode: 3 })

    await expect(main([], { probe, execute, env, stderr: { write } })).resolves.toBe(3)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('fails without running anything under REQUIRE_INTEGRATION_TESTS', async () => {
    const { execute, write, probe } = harness()

    await expect(main([], {
      probe,
      execute,
      env: { REQUIRE_INTEGRATION_TESTS: '1' },
      stderr: { write },
    })).resolves.toBe(1)

    expect(execute).not.toHaveBeenCalled()
    expect(write.mock.calls[0][0]).toMatch(/REQUIRE_INTEGRATION_TESTS=1 is set/)
  })

  it('fails rather than skipping when an integration test was named explicitly', async () => {
    const { execute, write, probe, env } = harness()

    await expect(main(['__tests__/integration/migrate.test.ts'], {
      probe,
      execute,
      env,
      stderr: { write },
    })).resolves.toBe(1)

    expect(execute).not.toHaveBeenCalled()
    expect(write.mock.calls[0][0]).toMatch(/requested explicitly/)
  })

  it('runs both projects and prints nothing when neonctl is available', async () => {
    const { execute, write, probe, env } = harness({ capability: available })

    await expect(main([], { probe, execute, env, stderr: { write } })).resolves.toBe(0)
    expect(execute.mock.calls.map((call) => call[0].runner)).toEqual(['unit', 'integration'])
    expect(write).not.toHaveBeenCalled()
  })
})

describe('executeVitest', () => {
  it('reports a sanitized child-process error and returns non-zero', async () => {
    const { executeVitest } = await import('../../scripts/run-tests.mjs')
    expect(executeVitest).toBeTypeOf('function')

    const child = new EventEmitter()
    const spawnProcess = vi.fn(() => child)
    const write = vi.fn()
    const result = executeVitest(
      { runner: 'unit', args: unitBase },
      { spawnProcess, stderr: { write } },
    )

    child.emit('error', Object.assign(new Error('sensitive-process-detail'), { code: 'EACCES' }))

    await expect(result).resolves.toBe(1)
    expect(write).toHaveBeenCalledWith('Vitest failed to start (EACCES).\n')
    expect(write).not.toHaveBeenCalledWith(expect.stringContaining('sensitive-process-detail'))
  })
})
