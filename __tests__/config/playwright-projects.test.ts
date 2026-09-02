import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type PlaywrightTest = { projectName?: string }
type PlaywrightSpec = { file?: string; tests?: PlaywrightTest[] }
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
 *
 * `extraEnv` is merged over `process.env` for the child process only -- e.g.
 * to set `PLAYWRIGHT_CLIENT_REPORT_FIXTURE` for a listing that needs the
 * root `e2e/` tree to be reachable at all, without mutating this process's
 * own environment for other tests in the file.
 */
function listAllProjects(extraEnv: Partial<NodeJS.ProcessEnv> = {}): PlaywrightListReport {
  let stdout: string
  let stderr = ''
  try {
    stdout = execFileSync(
      process.execPath,
      [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json'],
      {
        encoding: 'utf8',
        cwd: process.cwd(),
        env: { ...process.env, ...extraEnv },
        // ~64 KB measured for this repo's six projects (`wc -c` on the raw
        // stdout). 8 MiB is deliberate headroom for a much larger future
        // project matrix, not a cargo-culted default.
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        // execFileSync is synchronous and blocks the worker's event loop, so
        // Vitest's own (timer-based) test timeout can never preempt it -- a
        // hung child would wedge the test forever without this. Same guard,
        // same reasoning, as neonctl() in __tests__/helpers/neon-branch.ts.
        timeout: 60_000,
      },
    )
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; killed?: boolean; code?: string; signal?: string }
    if (err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      // On a timeout, `stdout` may hold partial JSON from the killed process.
      // Report the timeout explicitly rather than falling through to
      // JSON.parse, which would otherwise surface it as a confusing syntax
      // error instead of naming the actual cause.
      throw new Error(
        'playwright --list timed out after 60s; project discovery cannot be verified. ' +
        `Partial stderr: ${(err.stderr ?? '').trim() || '(none)'}`,
      )
    }
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
  }
  if (!stdout.trim()) {
    // stderr is exactly where a genuine failure (missing entry point, a
    // config that throws during evaluation) leaves its diagnostic -- fold it
    // in so the failure is self-diagnosing instead of just "no output".
    throw new Error(
      'playwright --list produced no output; project discovery cannot be verified.' +
      (stderr.trim() ? ` stderr: ${stderr.trim()}` : ' (stderr was also empty)'),
    )
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

// Maps project name -> the set of spec files it discovered, normalised to
// forward slashes. Empirically (this repo, this Playwright version) the
// report's `spec.file` is already a POSIX-style path relative to `cwd`, but
// that shape is not a documented contract of the JSON reporter -- it has
// been an absolute, backslash-joined path in other observed configurations.
// Normalise defensively and compare by suffix rather than trust today's
// observed format, exactly per the same "ask Playwright, don't parse text"
// principle as listAllProjects itself.
function filesByProject(report: PlaywrightListReport): Record<string, Set<string>> {
  const files: Record<string, Set<string>> = {}
  const walk = (suite: PlaywrightSuite): void => {
    for (const spec of suite.specs ?? []) {
      const file = spec.file?.replace(/\\/g, '/')
      if (!file) continue
      for (const test of spec.tests ?? []) {
        if (!test.projectName) continue
        ;(files[test.projectName] ??= new Set()).add(file)
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)
  return files
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

  // This is the guard that replaces a deleted regex assertion in
  // __tests__/lib/product-facts.test.ts. That test required the source text
  // `testIgnore: [...testIgnore, 'e2e/**/*.spec.ts'` to appear for the
  // `mobile` project -- but that literal string was exactly the bug: because
  // testIgnore globs are matched against the ABSOLUTE path, 'e2e/**/*.spec.ts'
  // also matched the tail of every path under tests/e2e/, so `mobile`
  // discovered nothing. A comment above that assertion said "assert the
  // intent, not the syntax" and then asserted syntax that pinned the very
  // defect the intent forbids. Reading playwright.config.ts can never catch
  // this class of bug -- only asking Playwright's own project resolution
  // can, which is what this test does instead.
  //
  // The root e2e/ directory is excluded from every project's testIgnore
  // unless PLAYWRIGHT_CLIENT_REPORT_FIXTURE is set (see playwright.config.ts),
  // so the invariant is unobservable without it. Setting it isn't enough on
  // its own, either: e2e/client-reports.spec.ts reads the same env var at
  // module scope and throws if it isn't a real JSON file with `pro` and
  // `ineligible` arrays, and a throw during discovery empties the whole
  // report rather than just that file -- so a syntactically valid (if empty)
  // fixture file is written to a temp dir for the duration of this test.
  it('mobile discovers tests/e2e specs but not the root e2e/ tree', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'playwright-client-report-fixture-'))
    const fixturePath = join(fixtureDir, 'fixture.json')
    writeFileSync(fixturePath, JSON.stringify({ pro: [], ineligible: [] }))
    try {
      const report = listAllProjects({ PLAYWRIGHT_CLIENT_REPORT_FIXTURE: fixturePath })
      const files = filesByProject(report)

      const chromiumFiles = [...(files.chromium ?? [])]
      const mobileFiles = [...(files.mobile ?? [])]

      expect(chromiumFiles.some(f => f.endsWith('e2e/client-reports.spec.ts'))).toBe(true)
      expect(mobileFiles.some(f => f.endsWith('e2e/client-reports.spec.ts'))).toBe(false)
      expect(mobileFiles.some(f => f.endsWith('tests/e2e/scan-flow.spec.ts'))).toBe(true)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 60_000)
})
