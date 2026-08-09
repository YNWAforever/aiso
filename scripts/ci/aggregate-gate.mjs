import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_RESULTS = ['STATIC_RESULT', 'UNIT_CONTRACT_RESULT', 'E2E_ACCESSIBILITY_RESULT', 'BUILD_RESULT']
const REQUIRED_JOBS = ['static', 'unit-contract', 'e2e-accessibility', 'build']

export function aggregateGate({ results, summaries }) {
  const dependencyFailure = REQUIRED_RESULTS.some((name) => results[name] !== 'success')
  const missingRequiredSummary = REQUIRED_JOBS.some((job) => !summaries.some((summary) => summary.job === job))
  const summaryFailure = summaries.some((summary) =>
    summary.status !== 'success' || summary.skipped > 0 || summary.failurePriorities?.includes('P0'),
  )
  const blocking = dependencyFailure || missingRequiredSummary || summaryFailure
  return {
    exitCode: blocking ? 1 : 0,
    summary: {
      schemaVersion: 1,
      job: 'pr-gate',
      status: blocking ? 'failure' : 'success',
      executed: summaries.length,
      skipped: summaries.reduce((count, summary) => count + Number(summary.skipped ?? 0), 0),
      failurePriorities: blocking ? ['P0'] : [],
      artifacts: ['gate-summary.json'],
    },
  }
}

async function readSummaries(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  return Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('-summary.json'))
    .map(async (entry) => JSON.parse(await readFile(join(directory, entry.name), 'utf8'))))
}

async function main() {
  const result = aggregateGate({ results: process.env, summaries: await readSummaries('artifacts') })
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
