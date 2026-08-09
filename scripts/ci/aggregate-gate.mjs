import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_RESULTS = ['STATIC_RESULT', 'UNIT_CONTRACT_RESULT', 'E2E_ACCESSIBILITY_RESULT', 'BUILD_RESULT']
const REQUIRED_JOBS = ['static', 'unit-contract', 'e2e-accessibility', 'build']
const REQUIRED_SUMMARY_FILES = [
  'static-summary.json',
  'unit-contract-summary.json',
  'e2e-accessibility-summary.json',
  'build-summary.json',
]

export function aggregateGate({ results, summaries, commitSha = '' }) {
  const dependencyFailure = REQUIRED_RESULTS.some((name) => results[name] !== 'success')
  const missingRequiredSummary = REQUIRED_JOBS.some((job) => !summaries.some((summary) => summary.job === job))
  const commitShaMismatch = REQUIRED_JOBS.some((job) =>
    summaries.some((summary) => summary.job === job && summary.commitSha !== commitSha),
  )
  const summaryFailure = summaries.some((summary) =>
    summary.status !== 'success' || summary.skipped > 0 || summary.failurePriorities?.includes('P0'),
  )
  const blocking = dependencyFailure || missingRequiredSummary || commitShaMismatch || summaryFailure
  const advisoryPriorities = ['P1', 'P2'].filter((priority) =>
    summaries.some((summary) => summary.failurePriorities?.includes(priority)),
  )
  return {
    exitCode: blocking ? 1 : 0,
    summary: {
      schemaVersion: 1,
      job: 'pr-gate',
      commitSha,
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
    try {
      return JSON.parse(await readFile(join(directory, fileName), 'utf8'))
    } catch {
      return null
    }
  }))
  return summaries.filter(Boolean)
}

async function main() {
  const result = aggregateGate({
    results: process.env,
    summaries: await readRequiredSummaries('artifacts'),
    commitSha: process.env.GITHUB_SHA ?? '',
  })
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
