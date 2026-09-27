import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const VITEST_CLI = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

// Distinct from playwright-projects.test.ts's `__ignore_probe__`, which plants
// under `.claude/worktrees/` too: sharing the name would let one file's cleanup
// delete the other's probe mid-run.
const PROBE = '__vitest_ignore_probe__'

// Every kind of directory that has held a full copy of this repo inside the
// checkout. `.playwright-ci-server/` is created by
// scripts/start-playwright-ci-server.cjs, so it comes back on every e2e run.
const COPY_ROOTS = ['.worktrees', join('.claude', 'worktrees'), '.playwright-ci-server', '.codex']

/**
 * Ask Vitest itself which files the unit config collects.
 *
 * Not a string assertion over vitest.config.ts: what matters is the resolved
 * file set, and that is only knowable from Vitest's own globbing. Invoked
 * through `process.execPath` and the CLI's real path rather than `npx`, which
 * is a `.cmd` shim on Windows. VITEST_* variables are dropped so the child does
 * not believe it is a worker of this run.
 */
function listCollectedFiles(): string[] {
  // A copy rather than Object.fromEntries, which would lose the ProcessEnv type
  // (Next declares NODE_ENV as required on it) and fail typecheck.
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('VITEST')) delete env[key]
  const stdout = execFileSync(process.execPath, [VITEST_CLI, 'list', '--filesOnly'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
    .split(/\r?\n/)
    .map(line => line.trim().replaceAll('\\', '/'))
    .filter(line => TEST_FILE.test(line))
    .sort()
}

function testFilesOnDisk(): string[] {
  return (readdirSync('__tests__', { recursive: true, encoding: 'utf8' }) as string[])
    .map(file => `__tests__/${file.replaceAll('\\', '/')}`)
    .filter(file => TEST_FILE.test(file))
    .sort()
}

describe('vitest test discovery', () => {
  it('collects exactly the test files under __tests__/, and no copy of them', () => {
    // Not hypothetical. With a sibling worktree, the e2e launcher's isolated
    // workspaces and a few patch folders present, `npm run test:unit` collected
    // 3,980 files of which 353 belonged to this checkout, and reported 954
    // failing files that were all somebody else's code. The copies are
    // gitignored (or ignored per-clone), which Vitest does not consult, and CI
    // never has them, so the gate stayed green while local runs were unreadable.
    //
    // CI has no copies at all, so without these probes the assertions below
    // would pass there with the allow-list deleted.
    const probes = COPY_ROOTS.map(root => join(process.cwd(), root, PROBE))
    for (const probe of probes) {
      mkdirSync(join(probe, '__tests__'), { recursive: true })
      writeFileSync(
        join(probe, '__tests__', 'probe.test.ts'),
        "import { it } from 'vitest'\nit('probe', () => {})\n",
      )
    }
    try {
      const collected = listCollectedFiles()

      expect(collected.filter(file => file.includes(PROBE))).toEqual([])
      expect(collected.filter(file => !file.startsWith('__tests__/'))).toEqual([])
      // The other half: an allow-list that drops a real test is the same class
      // of silent failure as one that admits a copy.
      expect(collected).toEqual(testFilesOnDisk())
    } finally {
      for (const probe of probes) rmSync(probe, { recursive: true, force: true })
    }
  }, 180_000)
})
