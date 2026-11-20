/**
 * Pure verification helpers for the read-only release receipt.
 *
 * Everything in this module takes already-collected evidence (GitHub API JSON,
 * Vercel CLI JSON, build log text, git output) and returns a status plus one
 * human sentence. Nothing here starts a process, reads a file or touches the
 * network, so every rule below is unit-testable against a fixture, including
 * the tampered ones.
 *
 * Status vocabulary is deliberately small:
 *   verified - the evidence positively proves the dependency.
 *   failed   - the evidence contradicts the release.
 *   unknown  - the evidence could not be obtained or is inconclusive. A receipt
 *              with an unknown dependency is not a pass unless the operator has
 *              named that dependency in --allow-unknown.
 */

import { createHash } from 'node:crypto'

export const DEPENDENCY_IDS = Object.freeze([
  'ci_checks',
  'tested_merge_tree',
  'deployment',
  'schema_gate',
  'worker_schedules',
])

const STATUSES = new Set(['verified', 'failed', 'unknown'])

/** A git object name, lower-cased. Returns null for anything that is not a full SHA. */
export function normalizeSha(value) {
  if (typeof value !== 'string') return null
  const sha = value.trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

export function shortSha(value) {
  return typeof value === 'string' && value.length >= 12 ? value.slice(0, 12) : String(value ?? 'unknown')
}

export function dependency(id, status, detail) {
  if (!DEPENDENCY_IDS.includes(id)) throw new Error(`unknown dependency id: ${id}`)
  if (!STATUSES.has(status)) throw new Error(`unknown dependency status: ${status}`)
  return { id, status, detail: String(detail) }
}

/* ------------------------------------------------------------------ CI checks */

export function summarizeCheckRuns(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : []
  const total = Number.isInteger(payload?.total_count) ? payload.total_count : runs.length
  const failures = []
  let success = 0
  let completed = 0
  for (const run of runs) {
    const name = typeof run?.name === 'string' && run.name.trim() ? run.name.trim() : 'unnamed check'
    if (run?.status === 'completed') completed += 1
    if (run?.status === 'completed' && run?.conclusion === 'success') success += 1
    else failures.push(`${name} (${run?.status ?? 'unknown'}${run?.conclusion ? `/${run.conclusion}` : ''})`)
  }
  return { total, completed, success, failures, allSuccess: total > 0 && failures.length === 0 }
}

export function evaluateCiChecks({ payload, source }) {
  const summary = summarizeCheckRuns(payload)
  if (summary.total === 0) return dependency('ci_checks', 'unknown', `no check runs are recorded for ${source}`)
  if (!summary.allSuccess) {
    const shown = summary.failures.slice(0, 6).join(', ')
    const rest = summary.failures.length > 6 ? ` and ${summary.failures.length - 6} more` : ''
    return dependency('ci_checks', 'failed', `${summary.failures.length} of ${summary.total} check run(s) for ${source} were not successful: ${shown}${rest}`)
  }
  return dependency('ci_checks', 'verified', `all ${summary.total} check runs for ${source} are successful`)
}

/* ------------------------------------------------------------ tested source tree */

export function evaluateGateRun({ run, summary, runId, repo }) {
  const id = 'ci_checks'
  if (!run) return dependency(id, 'unknown', 'a PR gate run ID is required')
  if (String(run.id) !== runId || run.repository?.full_name?.toLowerCase() !== repo.toLowerCase()
    || run.path !== '.github/workflows/pr-gate.yml' || !['pull_request', 'workflow_dispatch'].includes(run.event)) {
    return dependency(id, 'failed', 'the run does not belong to the expected repository and PR gate workflow')
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return dependency(id, 'failed', `PR gate run ${runId} is ${run.conclusion ?? run.status}`)
  }
  if (!summary || !normalizeSha(summary.commitSha) || !normalizeSha(summary.treeSha)
    || !summary.runId || !Number.isInteger(summary.runAttempt)) {
    return dependency(id, 'unknown', `PR gate run ${runId} has no complete checkout evidence`)
  }
  if (summary.schemaVersion !== 1 || summary.runId !== runId || summary.runAttempt !== run.run_attempt
    || summary.job !== 'pr-gate' || summary.status !== 'success' || summary.executed !== 6
    || summary.skipped !== 0 || !Array.isArray(summary.failurePriorities) || summary.failurePriorities.includes('P0')) {
    return dependency(id, 'failed', `PR gate run ${runId} has an invalid aggregate or evidence from a different attempt`)
  }
  return dependency(id, 'verified', `PR gate run ${runId}, attempt ${run.run_attempt}, passed all required jobs`)
}

export function evaluateTestedMergeTree({ appSha, appTree, parents, run, summary, checkedTree, checkedParents }) {
  const id = 'tested_merge_tree'
  const testedSha = normalizeSha(summary?.commitSha)
  const testedTree = normalizeSha(summary?.treeSha)
  if (!appTree || !testedSha || !testedTree || !checkedTree) {
    return dependency(id, 'unknown', 'the CI artifact or its checked-out Git object is unavailable')
  }
  if (testedTree !== checkedTree || testedTree !== appTree) {
    return dependency(id, 'failed', `the tested tree ${testedTree} does not match the CI Git object ${checkedTree} and released tree ${appTree}`)
  }
  const runHead = normalizeSha(run?.head_sha)
  const correctRevision = run?.event === 'workflow_dispatch'
    ? testedSha === runHead && testedSha === appSha
    : run?.event === 'pull_request' && runHead && parents[1] === runHead && checkedParents[1] === runHead
  if (!correctRevision) return dependency(id, 'failed', 'the workflow run is not bound to the release commit or its tested PR head')
  return dependency(id, 'verified', `CI checked out ${shortSha(testedSha)} with released tree ${testedTree}`)
}

/* ---------------------------------------------------------------- deployment */

function normalizeHost(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
}

/** Newest READY production deployment whose Vercel metadata names the app SHA. */
export function selectProductionDeployment(listPayload, appSha) {
  const deployments = Array.isArray(listPayload)
    ? listPayload
    : Array.isArray(listPayload?.deployments)
      ? listPayload.deployments
      : []
  return (
    deployments
      .filter(entry => entry && entry.state === 'READY' && entry.target === 'production' && entry.meta?.githubCommitSha === appSha)
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0] ?? null
  )
}

export function evaluateDeployment({ appSha, listed, inspected, canonicalAlias }) {
  if (!listed) return dependency('deployment', 'unknown', `no READY production deployment is recorded for ${shortSha(appSha)}`)
  if (!inspected) return dependency('deployment', 'unknown', `deployment ${listed.url} was listed but could not be inspected`)
  if (inspected.readyState !== 'READY') {
    return dependency('deployment', 'failed', `deployment ${inspected.id ?? listed.url} is ${inspected.readyState ?? 'unknown'}, not READY`)
  }
  if (inspected.target !== 'production') {
    return dependency('deployment', 'failed', `deployment ${inspected.id ?? listed.url} targets ${inspected.target ?? 'unknown'}, not production`)
  }
  const aliases = (Array.isArray(inspected.aliases) ? inspected.aliases : []).map(normalizeHost)
  const wanted = normalizeHost(canonicalAlias)
  if (wanted && !aliases.includes(wanted)) {
    return dependency('deployment', 'failed', `deployment ${inspected.id ?? listed.url} is not assigned the canonical alias ${wanted} (aliases: ${aliases.join(', ') || 'none'})`)
  }
  return dependency('deployment', 'verified', `production deployment ${inspected.id ?? listed.url} is READY and assigned ${normalizeHost(canonicalAlias) || 'its aliases'}`)
}

/* --------------------------------------------------------------- schema gate */

/** The last `schema gate: all N shipped migrations are recorded.` line in a build log. */
export function parseSchemaGateLog(logText) {
  const matches = [...String(logText ?? '').matchAll(/schema gate: all (\d+) shipped migrations are recorded/g)]
  if (matches.length === 0) return null
  const value = Number(matches[matches.length - 1][1])
  return Number.isInteger(value) ? value : null
}

/** Only real migration files count; a directory or a README must not inflate the total. */
export function countShippedMigrations(filePaths) {
  return (Array.isArray(filePaths) ? filePaths : []).filter(path => /^supabase\/migrations\/[^/]+\.sql$/.test(path)).length
}

export function evaluateSchemaGate({ logText, shippedCount }) {
  const recorded = parseSchemaGateLog(logText)
  if (!Number.isInteger(shippedCount) || shippedCount <= 0) {
    return dependency('schema_gate', 'unknown', 'the shipped migration count could not be read from the release tree')
  }
  if (recorded === null) {
    return dependency('schema_gate', 'unknown', 'the deployment build log has no schema gate line (the build log may have expired or the build was skipped)')
  }
  if (recorded !== shippedCount) {
    return dependency('schema_gate', 'failed', `the build log recorded ${recorded} migration(s) but the release tree ships ${shippedCount}`)
  }
  return dependency('schema_gate', 'verified', `all ${shippedCount} shipped migrations are recorded (build log: ${recorded})`)
}

/* ----------------------------------------------------------- worker schedules */

export function evaluateWorkerSchedules({ payload, error }) {
  if (!payload) {
    const reason = typeof error === 'string' && error.trim() ? error.trim().split(/\r?\n/)[0] : 'the Cloudflare schedule readback did not return JSON'
    return dependency('worker_schedules', 'unknown', reason)
  }
  if (payload.drift) {
    const missing = Array.isArray(payload.missing) && payload.missing.length ? payload.missing.join(', ') : 'none'
    const extra = Array.isArray(payload.extra) && payload.extra.length ? payload.extra.join(', ') : 'none'
    return dependency('worker_schedules', 'failed', `the deployed Worker schedules drifted from the config (missing: ${missing}; extra: ${extra})`)
  }
  const configured = Array.isArray(payload.configured) ? payload.configured.join(', ') : 'unknown'
  return dependency('worker_schedules', 'verified', `the deployed Worker schedules match the config (${configured})`)
}

/* -------------------------------------------------------------------- receipt */

/** Deterministic JSON (recursively sorted object keys) so a receipt hash is stable. */
export function canonicalJson(value) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input && typeof input === 'object') {
      const sorted = {}
      for (const key of Object.keys(input).sort()) sorted[key] = normalize(input[key])
      return sorted
    }
    return input
  }
  return JSON.stringify(normalize(value))
}

/** Hash covers the whole receipt except the hash itself. */
export function receiptHash(receipt) {
  const evidence = { ...receipt }
  delete evidence.receiptHash
  return createHash('sha256').update(canonicalJson(evidence)).digest('hex')
}

export function overallStatus(dependencies) {
  const list = Array.isArray(dependencies) ? dependencies : []
  if (list.some(entry => entry.status === 'failed')) return 'failed'
  if (list.some(entry => entry.status === 'unknown')) return 'unknown'
  return 'verified'
}

/**
 * 0 only when every dependency is verified, or every unknown dependency was
 * named with --allow-unknown. A failure can never be allowed away.
 */
export function verifyExitCode({ dependencies, allowUnknown }) {
  const list = Array.isArray(dependencies) ? dependencies : []
  const allowed = Array.isArray(allowUnknown) ? allowUnknown : []
  if (list.some(entry => entry.status === 'failed')) return 2
  if (list.some(entry => entry.status === 'unknown' && (entry.id !== 'worker_schedules' || !allowed.includes(entry.id)))) return 2
  return 0
}
