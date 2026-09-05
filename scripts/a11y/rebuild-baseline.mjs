/**
 * Merges the per-cell files left by `A11Y_UPDATE_BASELINE=1 npx playwright test`
 * into tests/e2e/a11y/baseline.json.
 *
 * The a11y guard fails in BOTH directions -- a cell with fewer violations than
 * accepted fails too, because a baseline that only ever grows is an amnesty.
 * That makes re-recording a routine part of every accessibility fix, and hand-
 * editing eighty cells out of error messages is how a ratchet gets abandoned.
 *
 * Record from CI, not from a local run: counts are not fully portable across
 * operating systems (see the header of tests/e2e/a11y/baseline.ts).
 *
 * Usage:
 *   rm -rf tests/e2e/a11y/.observed                             # see below
 *   A11Y_UPDATE_BASELINE=1 npx playwright test tests/e2e/a11y   # all 4 projects
 *   node scripts/a11y/rebuild-baseline.mjs [--dry-run]
 *
 * Clear .observed first. The all-80 check below catches a cell that is MISSING,
 * but a leftover file from an earlier run is not missing -- it still counts
 * toward 80 and merges its stale numbers. Nothing clears the directory on your
 * behalf: the four viewport projects run in parallel, so any worker that wiped
 * it would delete the cells its siblings had already written.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OBSERVED_DIR = join('tests', 'e2e', 'a11y', '.observed')
const BASELINE_PATH = join('tests', 'e2e', 'a11y', 'baseline.json')

/**
 * 5 routes x 2 locales x 2 themes x 4 viewport projects = 80 cells.
 *
 * Stated rather than derived: the routes/locales/themes live in
 * tests/e2e/a11y/matrix.ts and the four viewports in playwright.config.ts, both
 * TypeScript modules whose import graphs reach @playwright/test and lib/, which
 * a plain .mjs script cannot load cleanly. Change this number when the matrix
 * changes -- and treat having to change it as the review prompt it is.
 *
 * This total is the single most important safety property in this script. A
 * partial run must never be written: the cells that did not report would be
 * recorded as accepting no violations at all, and the gate would then wave them
 * through forever. That is strictly worse than no baseline.
 */
const EXPECTED_CELL_COUNT = 80

/**
 * Turns the per-cell files into a Baseline, or explains why it will not.
 *
 * Pure, so the refusal rules can be exercised without a filesystem.
 * `knownCells` is the cell id set of the baseline being replaced; it is used
 * only to name the discrepancy in the failure message, never to decide it.
 */
export function buildBaseline(files, knownCells = []) {
  const errors = []
  const accepted = {}
  const seen = new Map()

  for (const { name, content } of files) {
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      errors.push(`${name}: not valid JSON (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.cell !== 'string' || parsed.cell === '') {
      errors.push(`${name}: expected { "cell": string, "counts": object }`)
      continue
    }
    if (typeof parsed.counts !== 'object' || parsed.counts === null || Array.isArray(parsed.counts)) {
      errors.push(`${name}: "counts" must be an object of rule -> number`)
      continue
    }
    const bad = Object.entries(parsed.counts).find(([, value]) => !Number.isInteger(value) || value < 0)
    if (bad) {
      errors.push(`${name}: count for "${bad[0]}" is not a non-negative integer`)
      continue
    }
    if (seen.has(parsed.cell)) {
      errors.push(`${name}: cell "${parsed.cell}" already written by ${seen.get(parsed.cell)}`)
      continue
    }
    seen.set(parsed.cell, name)
    accepted[parsed.cell] = parsed.counts
  }

  const cells = Object.keys(accepted).sort()
  if (cells.length !== EXPECTED_CELL_COUNT) {
    errors.push(`found ${cells.length} cell(s), expected ${EXPECTED_CELL_COUNT} -- did every viewport project run?`)
    const missing = knownCells.filter((cell) => !(cell in accepted))
    const unexpected = cells.filter((cell) => !knownCells.includes(cell))
    if (missing.length > 0) errors.push(`missing (present in the current baseline, not observed):\n  ${missing.join('\n  ')}`)
    if (unexpected.length > 0) errors.push(`unexpected (observed, absent from the current baseline):\n  ${unexpected.join('\n  ')}`)
  }

  if (errors.length > 0) return { errors, baseline: null, cells: [], totalNodes: 0 }

  // Sorted cells, and sorted rules within each cell, so the committed diff shows
  // count changes rather than key reordering.
  const sorted = {}
  for (const cell of cells) {
    sorted[cell] = Object.fromEntries(
      Object.entries(accepted[cell]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  }
  const totalNodes = cells.reduce(
    (sum, cell) => sum + Object.values(sorted[cell]).reduce((cellSum, count) => cellSum + count, 0),
    0,
  )
  return { errors: [], baseline: { accepted: sorted }, cells, totalNodes }
}

/** Cell ids of the baseline being replaced, or [] if it is absent/unreadable. */
async function readKnownCells() {
  try {
    const parsed = JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
    return Object.keys(parsed?.accepted ?? {})
  } catch {
    // A first-ever run has no baseline to compare against; that is not an error
    // here, because the count check above is what actually guards the write.
    return []
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  let names
  try {
    names = (await readdir(OBSERVED_DIR)).filter((name) => name.endsWith('.json')).sort()
  } catch {
    process.stderr.write(
      `${OBSERVED_DIR} does not exist. Record it first:\n`
      + '  A11Y_UPDATE_BASELINE=1 npx playwright test tests/e2e/a11y\n',
    )
    process.exitCode = 1
    return
  }

  const files = await Promise.all(names.map(async (name) => ({
    name,
    content: await readFile(join(OBSERVED_DIR, name), 'utf8'),
  })))

  const { errors, baseline, cells, totalNodes } = buildBaseline(files, await readKnownCells())
  if (errors.length > 0) {
    process.stderr.write(`Refusing to write ${BASELINE_PATH}:\n${errors.map((line) => `- ${line}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }

  // Two-space indent and a trailing newline, matching the committed file, so the
  // diff is the count changes and nothing else.
  const serialised = `${JSON.stringify(baseline, null, 2)}\n`
  if (dryRun) {
    process.stdout.write(`--dry-run: would write ${cells.length} cell(s), ${totalNodes} violating node(s)\n`)
    return
  }

  await writeFile(BASELINE_PATH, serialised, 'utf8')
  process.stdout.write(`Wrote ${BASELINE_PATH}: ${cells.length} cell(s), ${totalNodes} violating node(s)\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
