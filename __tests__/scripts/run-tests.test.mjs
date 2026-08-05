import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { buildTestRunPlan, classifyTestArgs, createVitestInvocation, runTestPlan } from '../../scripts/run-tests.mjs'

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
