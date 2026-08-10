import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJobSummary } from './write-job-summary.mjs'

function nonNegativeInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function countsFrom(report) {
  const stats = report?.stats
  if (!stats || typeof stats !== 'object') return null

  const expected = nonNegativeInteger(stats.expected)
  const unexpected = nonNegativeInteger(stats.unexpected)
  const flaky = nonNegativeInteger(stats.flaky)
  const skipped = nonNegativeInteger(stats.skipped)
  if ([expected, unexpected, flaky, skipped].some(value => value === null)) return null

  const executed = expected + unexpected + flaky
  if (executed + skipped === 0) return null
  return { executed, skipped }
}

export function classifyPlaywrightReport({ report, exitCode, artifactPaths, commitSha }) {
  const counts = countsFrom(report)
  const invalidReport = !counts
  const skipped = counts?.skipped ?? 0
  const executed = counts?.executed ?? 0
  const blocking = invalidReport || Number(exitCode) !== 0 || skipped > 0
  const summary = createJobSummary({
    job: 'e2e-accessibility',
    status: blocking ? 'failure' : 'success',
    executed,
    skipped,
    priorities: blocking ? ['P0'] : [],
    artifacts: artifactPaths,
    commitSha,
  })
  return { exitCode: blocking ? 1 : 0, summary }
}

function parseArguments(args) {
  const values = { artifacts: [] }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${flag ?? ''}`)
    if (flag === '--artifact') values.artifacts.push(value)
    else values[flag.slice(2)] = value
  }
  return values
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const report = await readJson(args.report).catch(() => undefined)
  const result = classifyPlaywrightReport({
    report,
    exitCode: Number(args['exit-code'] ?? 1),
    artifactPaths: args.artifacts.length > 0
      ? args.artifacts
      : ['e2e-accessibility/playwright-results.json', 'e2e-accessibility/playwright.junit.xml'],
    commitSha: process.env.GITHUB_SHA ?? '',
  })
  const output = args.output ?? 'artifacts/e2e-accessibility-summary.json'
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(result.summary, null, 2)}\n`, 'utf8')
  process.exitCode = result.exitCode
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
