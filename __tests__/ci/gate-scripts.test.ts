import { describe, expect, it } from 'vitest'
import { classifyVitestReport } from '../../scripts/ci/classify-vitest.mjs'
import { aggregateGate } from '../../scripts/ci/aggregate-gate.mjs'
import { createJobSummary } from '../../scripts/ci/write-job-summary.mjs'

const manifest = {
  schemaVersion: 1,
  requiredLayers: ['static', 'unit-contract', 'e2e-accessibility', 'build'],
  entries: [
    {
      id: 'UNIT-P0',
      priority: 'P0',
      fixture: 'unit-contract-fixture',
      roles: ['authenticated'],
      files: ['__tests__/unit/p0.test.ts'],
    },
    {
      id: 'UNIT-P1',
      priority: 'P1',
      fixture: 'unit-contract-fixture',
      roles: ['authenticated'],
      files: ['__tests__/unit/p1.test.ts'],
    },
  ],
}

function vitestReport(testFile: string, assertionResults: Array<Record<string, unknown>>) {
  const failed = assertionResults.filter(({ status }) => status === 'failed').length
  const skipped = assertionResults.filter(({ status }) => status === 'pending').length

  return {
    numTotalTests: assertionResults.length,
    numPassedTests: assertionResults.length - failed - skipped,
    numFailedTests: failed,
    numPendingTests: skipped,
    testResults: [{ name: testFile, assertionResults }],
  }
}

describe('PR merge-gate evidence contracts', () => {
  it('preserves the summary schema and fixture-only artifact paths on success', () => {
    const summary = createJobSummary({
      job: 'unit-contract',
      status: 'success',
      executed: 1,
      skipped: 0,
      artifacts: ['unit-contract/vitest.json', 'unit-contract/vitest.junit.xml'],
      commitSha: 'fixture-sha',
    })

    expect(summary).toEqual({
      schemaVersion: 1,
      job: 'unit-contract',
      commitSha: 'fixture-sha',
      status: 'success',
      executed: 1,
      skipped: 0,
      failurePriorities: [],
      artifacts: ['unit-contract/vitest.json', 'unit-contract/vitest.junit.xml'],
    })
  })

  it('records a P1 test failure as advisory', () => {
    const result = classifyVitestReport({
      report: vitestReport('__tests__/unit/p1.test.ts', [{ status: 'failed', title: 'advisory', fullName: 'advisory' }]),
      exitCode: 1,
      manifest,
      artifactPaths: ['unit-contract/vitest.json'],
      commitSha: 'fixture-sha',
    })

    expect(result.exitCode).toBe(0)
    expect(result.summary.failurePriorities).toEqual(['P1'])
    expect(result.summary.status).toBe('success')
  })

  it('blocks a P0 test failure', () => {
    const result = classifyVitestReport({
      report: vitestReport('__tests__/unit/p0.test.ts', [{ status: 'failed', title: 'P0 failure', fullName: 'P0 failure' }]),
      exitCode: 1,
      manifest,
      artifactPaths: ['unit-contract/vitest.json'],
      commitSha: 'fixture-sha',
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.failurePriorities).toEqual(['P0'])
    expect(result.summary.status).toBe('failure')
  })

  it('fails closed when the Vitest report is missing', () => {
    const result = classifyVitestReport({
      report: undefined,
      exitCode: 1,
      manifest,
      artifactPaths: ['unit-contract/vitest.json'],
      commitSha: 'fixture-sha',
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.status).toBe('failure')
    expect(result.summary.failurePriorities).toContain('P0')
  })

  it('blocks and counts a skipped required test once', () => {
    const result = classifyVitestReport({
      report: vitestReport('__tests__/unit/p1.test.ts', [{ status: 'pending', title: 'required coverage', fullName: 'required coverage' }]),
      exitCode: 0,
      manifest,
      artifactPaths: ['unit-contract/vitest.json'],
      commitSha: 'fixture-sha',
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.status).toBe('failure')
    expect(result.summary.skipped).toBe(1)
    expect(result.summary.failurePriorities).toContain('P0')
  })

  it('blocks an aggregate when a required job is not successful', () => {
    const result = aggregateGate({
      results: {
        STATIC_RESULT: 'success',
        UNIT_CONTRACT_RESULT: 'failure',
        E2E_ACCESSIBILITY_RESULT: 'success',
        BUILD_RESULT: 'success',
      },
      summaries: [],
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.failurePriorities).toContain('P0')
  })

  it('fails closed when a required job summary is unavailable', () => {
    const result = aggregateGate({
      results: {
        STATIC_RESULT: 'success',
        UNIT_CONTRACT_RESULT: 'success',
        E2E_ACCESSIBILITY_RESULT: 'success',
        BUILD_RESULT: 'success',
      },
      summaries: [
        createJobSummary({ job: 'static', status: 'success', executed: 1, skipped: 0, artifacts: [], commitSha: 'fixture-sha' }),
        createJobSummary({ job: 'unit-contract', status: 'success', executed: 1, skipped: 0, artifacts: [], commitSha: 'fixture-sha' }),
        createJobSummary({ job: 'e2e-accessibility', status: 'success', executed: 1, skipped: 0, artifacts: [], commitSha: 'fixture-sha' }),
      ],
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.failurePriorities).toContain('P0')
  })

  it('blocks an aggregate that contains a skipped required test', () => {
    const result = aggregateGate({
      results: {
        STATIC_RESULT: 'success',
        UNIT_CONTRACT_RESULT: 'success',
        E2E_ACCESSIBILITY_RESULT: 'success',
        BUILD_RESULT: 'success',
      },
      summaries: [
        createJobSummary({
          job: 'unit-contract',
          status: 'success',
          executed: 3,
          skipped: 1,
          artifacts: [],
          commitSha: 'fixture-sha',
        }),
      ],
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.failurePriorities).toContain('P0')
  })
})
