import { readFileSync } from 'node:fs'

/**
 * Counts executed and skipped tests across one or more vitest JSON reports, so a
 * job summary can state numbers it measured instead of numbers it asserted.
 *
 * The integration job used to write `--executed 1 --skipped 0` literally. The
 * zero is the part that matters: `scripts/ci/aggregate-gate.mjs` blocks the gate
 * on `skipped > 0`, so a hardcoded zero is precisely the mechanism by which a
 * skipped suite reads as a passing one — the failure this repo already had once,
 * when five integration suites reported success while asserting nothing.
 *
 * Semantics match `classify-vitest.mjs` deliberately, so the two jobs' summaries
 * mean the same thing: executed is the report's total test count, skipped is its
 * pending assertions.
 *
 * A missing or unreadable report is NOT counted as zero. Zero is indistinguishable
 * from "nothing ran", which is the claim that must never be made by accident, so
 * an unreadable path exits non-zero and names it.
 */
export function countReports(paths) {
  let executed = 0
  let skipped = 0
  for (const path of paths) {
    const report = JSON.parse(readFileSync(path, 'utf8'))
    const files = Array.isArray(report.testResults) ? report.testResults : []
    const assertions = files.flatMap(file => file.assertionResults ?? [])
    executed += Number(report.numTotalTests ?? assertions.length)
    skipped += assertions.filter(a => a.status === 'pending').length || Number(report.numPendingTests ?? 0)
  }
  return { executed, skipped }
}

const paths = process.argv.slice(2)
if (paths.length === 0) {
  process.stderr.write('count-vitest-reports: no report paths given\n')
  process.exitCode = 1
} else {
  try {
    const { executed, skipped } = countReports(paths)
    process.stdout.write(`${executed} ${skipped}\n`)
  } catch (error) {
    process.stderr.write(`count-vitest-reports: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
