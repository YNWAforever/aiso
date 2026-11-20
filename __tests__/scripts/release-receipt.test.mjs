/**
 * Unit tests for the pure release-receipt verification rules.
 *
 * These fixtures are synthetic shapes of the real GitHub/Vercel/git evidence.
 * The important cases are the tampered ones: a mismatched tree, a failed check
 * run, a missing alias, a schema-gate count below the shipped migration count,
 * and a missing credential. Each must never read as `verified`.
 */

import { describe, expect, it } from 'vitest'

import {
  DEPENDENCY_IDS,
  canonicalJson,
  countShippedMigrations,
  dependency,
  evaluateCiChecks,
  evaluateGateRun,
  evaluateDeployment,
  evaluateSchemaGate,
  evaluateTestedMergeTree,
  evaluateWorkerSchedules,
  normalizeSha,
  overallStatus,
  parseSchemaGateLog,
  receiptHash,
  selectProductionDeployment,
  summarizeCheckRuns,
  verifyExitCode,
} from '../../scripts/release/verify.mjs'

const APP_SHA = '06d86af5483f7a59f0e11efdcbf3a95aa9c527ea'
const APP_TREE = '9b2a8cf7a11f5d3e6b3c2b1e5f4a29d8c7b6a5e4'
const BASE_SHA = '83e02e50ed173fd81dd56b7e0074b6870cff13e0'
const HEAD_SHA = 'ea48a1e9334ee98cec748dc03bf88e298bed9962'
const TESTED_SHA = '1f63e4057db0a9ea5e8f3069c285509b698516d6'
const OTHER_TREE = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567'

function checkRun(name, status = 'completed', conclusion = 'success') {
  return { name, status, conclusion }
}

function deploymentList(entries) {
  return { deployments: entries }
}

function listedDeployment({ url = 'aiso-4keiti4oz.vercel.app', state = 'READY', target = 'production', sha = APP_SHA, createdAt = 1794801698537 } = {}) {
  return { url, state, target, createdAt, meta: { githubCommitSha: sha } }
}

function inspectedDeployment({ readyState = 'READY', target = 'production', aliases = ['aiso-kappa.vercel.app', 'aiso-4keiti4oz.vercel.app'] } = {}) {
  return { id: 'dpl_6R57S6R2b8ZPejbkiL5eQXKCu5YJ', readyState, target, aliases }
}

const BUILD_LOG = [
  '2026-11-16T04:01:41.000Z  build started',
  '2026-11-16T04:01:46.812Z  schema gate: all 107 shipped migrations are recorded.',
  '2026-11-16T04:02:05.226Z  deployment completed',
].join('\n')

describe('normalizeSha', () => {
  it('accepts a trimmed, lower-cased 40-character SHA', () => {
    expect(normalizeSha(`  ${APP_SHA.toUpperCase()}  `)).toBe(APP_SHA)
  })

  it('rejects anything that is not a full SHA', () => {
    expect(normalizeSha('06d86af')).toBeNull()
    expect(normalizeSha(undefined)).toBeNull()
    expect(normalizeSha('z'.repeat(40))).toBeNull()
  })
})

describe('dependency', () => {
  it('rejects unknown ids and statuses', () => {
    expect(() => dependency('not_a_dependency', 'verified', 'x')).toThrow(/unknown dependency id/)
    expect(() => dependency('ci_checks', 'probably', 'x')).toThrow(/unknown dependency status/)
  })

  it('lists exactly the dependencies the receipt reports', () => {
    expect(DEPENDENCY_IDS).toEqual(['ci_checks', 'tested_merge_tree', 'deployment', 'schema_gate', 'worker_schedules'])
  })
})

describe('CI checks', () => {
  it('verifies when every check run completed successfully', () => {
    const payload = { total_count: 3, check_runs: [checkRun('static'), checkRun('unit-contract'), checkRun('build')] }
    const result = evaluateCiChecks({ payload, source: 'PR #276 head 1f63e4051a2b' })
    expect(result.status).toBe('verified')
    expect(result.detail).toContain('all 3 check runs')
  })

  it('fails when one check run failed and names it', () => {
    const payload = { total_count: 2, check_runs: [checkRun('static'), checkRun('unit-contract', 'completed', 'failure')] }
    const result = evaluateCiChecks({ payload, source: 'PR #276 head' })
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('unit-contract')
  })

  it('fails on an unfinished check run instead of treating it as pending-success', () => {
    const payload = { total_count: 1, check_runs: [checkRun('e2e', 'in_progress', null)] }
    expect(evaluateCiChecks({ payload, source: 'PR #276 head' }).status).toBe('failed')
  })

  it('treats a skipped conclusion as not successful', () => {
    const payload = { total_count: 1, check_runs: [checkRun('integration', 'completed', 'skipped')] }
    expect(evaluateCiChecks({ payload, source: 'PR #276 head' }).status).toBe('failed')
  })

  it('is unknown when no check runs are recorded', () => {
    const payload = summarizeCheckRuns({})
    expect(payload.total).toBe(0)
    const result = evaluateCiChecks({ payload: { total_count: 0, check_runs: [] }, source: APP_SHA })
    expect(result.status).toBe('unknown')
  })
})

describe('PR gate evidence and tested tree', () => {
  const repo = 'owner/repo'
  const runId = '123'
  const run = {
    id: 123, run_attempt: 2, repository: { full_name: repo },
    path: '.github/workflows/pr-gate.yml', status: 'completed', conclusion: 'success',
    event: 'pull_request', head_sha: HEAD_SHA,
  }
  const summary = {
    schemaVersion: 1, runId, runAttempt: 2, job: 'pr-gate', status: 'success',
    executed: 6, skipped: 0, failurePriorities: [], commitSha: TESTED_SHA, treeSha: APP_TREE,
  }
  const common = {
    appSha: APP_SHA, appTree: APP_TREE, parents: [BASE_SHA, HEAD_SHA],
    run, summary, checkedTree: APP_TREE, checkedParents: [BASE_SHA, HEAD_SHA],
  }

  it('requires a successful gate artifact for the same workflow attempt', () => {
    expect(evaluateGateRun({ run, summary, repo, runId }).status).toBe('verified')
    expect(evaluateGateRun({ run, summary: { ...summary, runAttempt: 1 }, repo, runId }).status).toBe('failed')
    expect(evaluateGateRun({ run: { ...run, path: '.github/workflows/unrelated.yml' }, summary, repo, runId }).status).toBe('failed')
    expect(evaluateGateRun({ run, summary: { ...summary, treeSha: undefined }, repo, runId }).status).toBe('unknown')
  })

  it('verifies the actual tested merge with the released tree', () => {
    expect(evaluateTestedMergeTree(common).status).toBe('verified')
  })

  it('rejects a changed base with the same successfully tested PR head', () => {
    expect(evaluateTestedMergeTree({ ...common, appTree: OTHER_TREE }).status).toBe('failed')
  })

  it('rejects different PR lineage and a tree that disagrees with the Git object', () => {
    expect(evaluateTestedMergeTree({ ...common, parents: [BASE_SHA, TESTED_SHA] }).status).toBe('failed')
    expect(evaluateTestedMergeTree({ ...common, checkedTree: OTHER_TREE }).status).toBe('failed')
  })

  it('accepts a manual run of the exact release without a PR', () => {
    expect(evaluateTestedMergeTree({
      ...common, parents: [BASE_SHA], run: { ...run, event: 'workflow_dispatch', head_sha: APP_SHA },
      summary: { ...summary, commitSha: APP_SHA },
    }).status).toBe('verified')
  })

  it('leaves the result unknown when CI evidence is missing', () => {
    expect(evaluateTestedMergeTree({ ...common, summary: undefined }).status).toBe('unknown')
  })
})

describe('production deployment', () => {
  it('selects the newest READY production deployment for the app SHA', () => {
    const payload = deploymentList([
      listedDeployment({ url: 'older.vercel.app', createdAt: 1 }),
      listedDeployment({ url: 'newer.vercel.app', createdAt: 2 }),
      listedDeployment({ url: 'other-sha.vercel.app', sha: TESTED_SHA, createdAt: 3 }),
      { ...listedDeployment({ url: 'preview.vercel.app', createdAt: 4 }), target: 'preview' },
    ])
    expect(selectProductionDeployment(payload, APP_SHA)?.url).toBe('newer.vercel.app')
  })

  it('returns null when production has not deployed the commit yet', () => {
    expect(selectProductionDeployment(deploymentList([listedDeployment({ sha: TESTED_SHA })]), APP_SHA)).toBeNull()
    expect(selectProductionDeployment(null, APP_SHA)).toBeNull()
  })

  it('verifies READY, production and the canonical alias', () => {
    const result = evaluateDeployment({
      appSha: APP_SHA,
      listed: listedDeployment(),
      inspected: inspectedDeployment(),
      canonicalAlias: 'aiso-kappa.vercel.app',
    })
    expect(result.status).toBe('verified')
  })

  it('fails when the alias belongs to another deployment', () => {
    const result = evaluateDeployment({
      appSha: APP_SHA,
      listed: listedDeployment(),
      inspected: inspectedDeployment({ aliases: ['aiso-4keiti4oz.vercel.app'] }),
      canonicalAlias: 'aiso-kappa.vercel.app',
    })
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('canonical alias')
  })

  it('fails when the deployment is not READY or not production', () => {
    expect(
      evaluateDeployment({
        appSha: APP_SHA,
        listed: listedDeployment(),
        inspected: inspectedDeployment({ readyState: 'ERROR' }),
        canonicalAlias: 'aiso-kappa.vercel.app',
      }).status,
    ).toBe('failed')
    expect(
      evaluateDeployment({
        appSha: APP_SHA,
        listed: listedDeployment(),
        inspected: inspectedDeployment({ target: 'preview' }),
        canonicalAlias: 'aiso-kappa.vercel.app',
      }).status,
    ).toBe('failed')
  })

  it('is unknown when there is no listing to inspect', () => {
    const result = evaluateDeployment({ appSha: APP_SHA, listed: null, inspected: null, canonicalAlias: 'aiso-kappa.vercel.app' })
    expect(result.status).toBe('unknown')
  })
})

describe('schema gate', () => {
  it('reads the recorded count from the real build log line', () => {
    expect(parseSchemaGateLog(BUILD_LOG)).toBe(107)
  })

  it('uses the last gate line when a log contains several builds', () => {
    const log = 'schema gate: all 106 shipped migrations are recorded.\n...\nschema gate: all 107 shipped migrations are recorded.'
    expect(parseSchemaGateLog(log)).toBe(107)
  })

  it('returns null when the log has no gate line', () => {
    expect(parseSchemaGateLog('build started')).toBeNull()
    expect(parseSchemaGateLog(null)).toBeNull()
  })

  it('counts only supabase/migrations/*.sql files', () => {
    const files = [
      'supabase/migrations/107_phase_4_per_fix_billing.sql',
      'supabase/migrations/README.md',
      'supabase/migrations/nested/108_ignored.sql',
      'app/api/scan/route.ts',
    ]
    expect(countShippedMigrations(files)).toBe(1)
  })

  it('verifies when the build log recorded every shipped migration', () => {
    const result = evaluateSchemaGate({ logText: BUILD_LOG, shippedCount: 107 })
    expect(result.status).toBe('verified')
    expect(result.detail).toContain('107')
  })

  it('fails when the build log recorded fewer migrations than the tree ships', () => {
    const result = evaluateSchemaGate({ logText: 'schema gate: all 106 shipped migrations are recorded.', shippedCount: 107 })
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('106')
  })

  it('is unknown without a build log or shipped count', () => {
    expect(evaluateSchemaGate({ logText: null, shippedCount: 107 }).status).toBe('unknown')
    expect(evaluateSchemaGate({ logText: BUILD_LOG, shippedCount: 0 }).status).toBe('unknown')
  })
})

describe('worker schedules', () => {
  it('verifies when deployed schedules match the config', () => {
    const result = evaluateWorkerSchedules({
      payload: { configured: ['17 4 * * *', '47 7 * * 1'], deployed: ['17 4 * * *', '47 7 * * 1'], missing: [], extra: [], drift: false },
      error: null,
    })
    expect(result.status).toBe('verified')
  })

  it('fails on drift and names the missing cron', () => {
    const result = evaluateWorkerSchedules({
      payload: { configured: ['17 4 * * *', '47 7 * * 1'], deployed: ['17 4 * * *'], missing: ['47 7 * * 1'], extra: [], drift: true },
      error: null,
    })
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('47 7 * * 1')
  })

  it('is unknown with no payload and echoes the reason without a credential', () => {
    const result = evaluateWorkerSchedules({
      payload: null,
      error: 'No Cloudflare credential: set CLOUDFLARE_API_TOKEN or run `wrangler login`',
    })
    expect(result.status).toBe('unknown')
    expect(result.detail).toContain('CLOUDFLARE_API_TOKEN')
  })
})

describe('receipt hash and status', () => {
  const base = {
    schemaVersion: 1,
    appSha: APP_SHA,
    appTree: APP_TREE,
    generatedAt: '2026-11-16T12:00:00.000Z',
    status: 'verified',
    allowedUnknown: [],
    dependencies: [dependency('ci_checks', 'verified', 'all checks successful')],
    receiptHash: null,
  }

  it('canonicalises object keys so the same evidence hashes identically', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}')
  })

  it('hashes the whole receipt except the hash itself', () => {
    const first = { ...base, receiptHash: null }
    const second = { ...base, receiptHash: 'not-covered' }
    expect(receiptHash(first)).toBe(receiptHash(second))
  })

  it('changes the hash when any evidence changes', () => {
    const changed = { ...base, appTree: OTHER_TREE }
    expect(receiptHash(changed)).not.toBe(receiptHash(base))
  })

  it('treats failed as overriding everything and unknown as a real gap', () => {
    expect(overallStatus([dependency('ci_checks', 'verified', 'ok'), dependency('schema_gate', 'unknown', 'no log')])).toBe('unknown')
    expect(overallStatus([dependency('ci_checks', 'unknown', 'no log'), dependency('schema_gate', 'failed', 'mismatch')])).toBe('failed')
  })

  it('exits 2 unless every unknown dependency was explicitly allowed', () => {
    const dependencies = [dependency('ci_checks', 'verified', 'ok'), dependency('worker_schedules', 'unknown', 'no token')]
    expect(verifyExitCode({ dependencies, allowUnknown: [] })).toBe(2)
    expect(verifyExitCode({ dependencies, allowUnknown: ['worker_schedules'] })).toBe(0)
  })

  it('never exits 0 over a failed dependency, even when allowed', () => {
    const dependencies = [dependency('schema_gate', 'failed', 'missing migration')]
    expect(verifyExitCode({ dependencies, allowUnknown: ['schema_gate'] })).toBe(2)
  })
})
