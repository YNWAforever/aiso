import { describe, expect, it, vi } from 'vitest'

import { buildTestRunPlan, classifyTestArgs, createVitestInvocation, runTestPlan } from '../../scripts/run-tests.mjs'

const unitBase = ['run', '--exclude', '__tests__/integration/**']
const integrationBase = ['run', '--config', 'vitest.integration.config.ts']

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
