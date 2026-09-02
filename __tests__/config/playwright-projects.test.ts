import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type PlaywrightTest = { projectName?: string }
type PlaywrightSpec = { tests?: PlaywrightTest[] }
type PlaywrightSuite = { specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] }
type PlaywrightListReport = {
  config?: { projects?: { name: string }[] }
  suites?: PlaywrightSuite[]
}

const PLAYWRIGHT_CLI = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js')

/**
 * Ask Playwright itself which tests each project resolves to.
 *
 * Deliberately NOT a string assertion over playwright.config.ts. The `mobile`
 * project discovered zero tests for its entire existence while the config said
 * exactly what its author intended -- the surprise was that `testIgnore` globs
 * are matched against the ABSOLUTE path, so a root-relative-looking pattern
 * also matched the tail of '.../tests/e2e/scan-flow.spec.ts'. No amount of
 * reading the config text reveals that; only Playwright's own resolution does.
 *
 * Invoked through `process.execPath` and the CLI's real path rather than `npx`,
 * which is a `.cmd` shim on Windows and would need a shell.
 *
 * `--list` exits 1 when a project resolves to nothing but still writes a valid
 * JSON report to stdout, so a non-zero exit is caught and the stdout parsed
 * rather than treated as a crash.
 */
function listAllProjects(): PlaywrightListReport {
  let stdout: string
  try {
    stdout = execFileSync(
      process.execPath,
      [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json'],
      {
        encoding: 'utf8',
        cwd: process.cwd(),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? ''
  }
  if (!stdout.trim()) {
    throw new Error('playwright --list produced no output; project discovery cannot be verified')
  }
  return JSON.parse(stdout) as PlaywrightListReport
}

function countByProject(report: PlaywrightListReport): Record<string, number> {
  const counts: Record<string, number> = {}
  const walk = (suite: PlaywrightSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (!test.projectName) continue
        counts[test.projectName] = (counts[test.projectName] ?? 0) + 1
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return counts
}

describe('playwright project discovery', () => {
  // A configured-but-empty project is invisible: the suite goes green because
  // it ran nothing. `mobile` was in that state from the day it was added.
  it('every configured project discovers at least one test', () => {
    const report = listAllProjects()
    const configured = (report.config?.projects ?? []).map(project => project.name)
    expect(configured.length).toBeGreaterThan(0)

    const counts = countByProject(report)
    const empty = configured.filter(name => (counts[name] ?? 0) === 0)

    // Asserting "none are empty", never an exact count: pinning the number
    // would fail on every legitimately added spec, which is how a guard gets
    // deleted rather than fixed.
    expect(empty).toEqual([])
  }, 60_000)
})
