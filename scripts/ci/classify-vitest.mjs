import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJobSummary } from './write-job-summary.mjs'

function priorityForFile(manifest, testFile) {
  return manifest.entries?.find((entry) => entry.files?.includes(testFile))?.priority
}

function normalizeTestFile(testFile, repoRoot = process.cwd()) {
  if (typeof testFile !== 'string') return testFile
  return relative(repoRoot, resolve(repoRoot, testFile)).split(sep).join('/')
}

function failuresFrom(report) {
  return (report.testResults ?? []).flatMap((testResult) =>
    (testResult.assertionResults ?? [])
      .filter((assertion) => assertion.status === 'failed')
      .map(() => normalizeTestFile(testResult.filepath ?? testResult.name)),
  )
}

function skippedFrom(report) {
  const skippedAssertions = (report.testResults ?? []).flatMap((testResult) =>
    (testResult.assertionResults ?? []).filter((assertion) => assertion.status === 'pending'),
  )
  return skippedAssertions.length || Number(report.numPendingTests ?? 0)
}

export function classifyVitestReport({ report, exitCode, manifest, artifactPaths, commitSha }) {
  const invalidInputs = !report || !manifest || manifest.schemaVersion !== 1
  const failures = report ? failuresFrom(report) : []
  const priorities = failures.map((testFile) => priorityForFile(manifest, testFile))
  const unmatchedFailure = failures.length > 0 && priorities.some((priority) => !priority)
  const unexplainedFailure = Number(exitCode) !== 0 && failures.length === 0
  const skipped = report ? skippedFrom(report) : 0
  const p0Failure = priorities.includes('P0')
  const blocking = invalidInputs || skipped > 0 || unmatchedFailure || unexplainedFailure || p0Failure
  const failurePriorities = blocking && (invalidInputs || skipped > 0 || unmatchedFailure || unexplainedFailure) && !p0Failure
    ? ['P0', ...priorities.filter(Boolean)]
    : priorities.filter(Boolean)
  const summary = createJobSummary({
    job: 'unit-contract',
    status: blocking ? 'failure' : 'success',
    executed: report ? Number(report.numTotalTests ?? 0) : 0,
    skipped,
    priorities: failurePriorities,
    artifacts: artifactPaths,
    commitSha,
  })
  return { exitCode: blocking ? 1 : 0, summary }
}

function parseArguments(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 2) values[args[index]?.slice(2)] = args[index + 1]
  return values
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const [report, manifest] = await Promise.all([
    readJson(args.report).catch(() => undefined),
    readJson(args.manifest ?? 'ci/pr-gate-manifest.json').catch(() => undefined),
  ])
  const result = classifyVitestReport({
    report,
    manifest,
    exitCode: Number(args['exit-code'] ?? 1),
    artifactPaths: args.artifact ? [args.artifact] : ['unit-contract/vitest.json', 'unit-contract/vitest.junit.xml'],
    commitSha: process.env.GITHUB_SHA ?? '',
  })
  const output = args.output ?? 'artifacts/unit-contract-summary.json'
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
