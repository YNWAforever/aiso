import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkedOutSource } from './write-job-summary.mjs'

const REQUIRED_RESULTS = ['STATIC_RESULT', 'UNIT_CONTRACT_RESULT', 'INTEGRATION_RESULT', 'E2E_ACCESSIBILITY_RESULT', 'BUILD_RESULT', 'CLOUDFLARE_WORKER_RESULT']
const REQUIRED_JOBS = ['static', 'unit-contract', 'integration', 'e2e-accessibility', 'build', 'cloudflare-worker']
const REQUIRED_SUMMARY_FILES = [
  'static-summary.json',
  'unit-contract-summary.json',
  'integration-summary.json',
  'e2e-accessibility-summary.json',
  'build-summary.json',
  'cloudflare-worker-summary.json',
]

export function aggregateGate({ results, summaries, commitSha = '', treeSha = '' }) {
  const dependencyFailure = REQUIRED_RESULTS.some((name) => results[name] !== 'success')
  const complete = summaries.length === REQUIRED_JOBS.length
    && REQUIRED_JOBS.every(job => summaries.filter(summary => summary.job === job).length === 1)
  const sourceMismatch = !commitSha || !/^[0-9a-f]{40}$/.test(treeSha)
    || summaries.some(summary => summary.commitSha !== commitSha || summary.treeSha !== treeSha)
  const summaryFailure = summaries.some(summary => summary.schemaVersion !== 1
    || summary.status !== 'success' || summary.skipped !== 0 || summary.failurePriorities?.includes('P0'))
  const blocking = dependencyFailure || !complete || sourceMismatch || summaryFailure
  const advisoryPriorities = ['P1', 'P2'].filter((priority) =>
    summaries.some((summary) => summary.failurePriorities?.includes(priority)),
  )
  return {
    exitCode: blocking ? 1 : 0,
    summary: {
      schemaVersion: 1,
      job: 'pr-gate',
      commitSha,
      treeSha,
      status: blocking ? 'failure' : 'success',
      executed: summaries.length,
      skipped: summaries.reduce((count, summary) => count + Number(summary.skipped ?? 0), 0),
      failurePriorities: blocking ? ['P0', ...advisoryPriorities] : advisoryPriorities,
      artifacts: ['gate-summary.json'],
    },
  }
}

export async function readRequiredSummaries(directory) {
  const summaries = await Promise.all(REQUIRED_SUMMARY_FILES.map(async (fileName) => {
    for (const candidate of [join(directory, fileName), join(directory, 'artifacts', fileName)]) {
      try {
        return JSON.parse(await readFile(candidate, 'utf8'))
      } catch {
        // The artifact downloader may preserve the producing job's artifacts/ directory.
      }
    }
    return null
  }))
  return summaries.filter(Boolean)
}

async function main() {
  const result = aggregateGate({
    results: process.env,
    summaries: await readRequiredSummaries('artifacts'),
    ...checkedOutSource(),
  })
  result.summary.runId = process.env.GITHUB_RUN_ID ?? ''
  result.summary.runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT)
  await mkdir('artifacts', { recursive: true })
  await writeFile('artifacts/gate-summary.json', `${JSON.stringify(result.summary, null, 2)}\n`, 'utf8')
  process.exitCode = result.exitCode
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
