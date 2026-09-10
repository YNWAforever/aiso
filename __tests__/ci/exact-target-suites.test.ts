import { spawnSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXACT_TARGET_CONFIGS } from '@/scripts/ci/run-exact-target-suites.mjs'

/**
 * The canonical list that stops the five exact-target suites falling out of the
 * gate again.
 *
 * They were runnable and never run: excluded from the default integration
 * project, targeted by five dedicated configs, and named by no npm script and no
 * CI job. Nothing failed, because nothing ran. A wrapper alone does not prevent a
 * recurrence — a sixth config, or a quietly deleted invocation, would restore the
 * same silence. These assertions are the part that notices.
 *
 * `__tests__/config/{entity,work-item,change-set,delivery}-integration.test.ts`
 * already pin each config's include, its absence of globalSetup/setupFiles, and
 * the C9 names it requires. Nothing here restates those.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/**
 * Source with comments stripped, the idiom `dashboard-sidebar.test.ts` uses.
 * Two of the assertions below forbid a construct, and the wrapper's own docblock
 * names every construct it forbids — as it should, since a rule nobody can read
 * is a rule nobody keeps. Matching the prose would fail on the explanation
 * rather than on the behaviour.
 */
const code = (path: string) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const SUITES = [
  '__tests__/integration/client-entities.test.ts',
  '__tests__/integration/evidence-work-items.test.ts',
  '__tests__/integration/change-set-approvals.test.ts',
  '__tests__/integration/change-set-stores.test.ts',
  '__tests__/integration/delivery-attestations.test.ts',
]

describe('the exact-target suites are wired into the gate', () => {
  it('runs every dedicated integration config that exists on disk', () => {
    // A sixth config cannot be added without either being wired in or failing
    // here. Discovering them by glob is the point: a hand-kept list would let a
    // new one be added silently, which is how these five were lost.
    const discovered = globSync('vitest.*.config.ts', { cwd: root })
      .filter(name => name !== 'vitest.config.ts' && name !== 'vitest.integration.config.ts')

    expect(discovered.sort()).toEqual([...EXACT_TARGET_CONFIGS].sort())
  })

  it('covers every suite the default integration project excludes', () => {
    // The two lists live in different files for different reasons. If they
    // drift, a suite is excluded from the default project and run by nothing —
    // the original failure exactly.
    const excluded = read('vitest.integration.config.ts')
      .match(/exclude:\s*\[([^\]]*)\]/s)?.[1]
      ?.match(/'([^']+)'/g)
      ?.map(quoted => quoted.slice(1, -1)) ?? []

    expect(excluded.sort()).toEqual([...SUITES].sort())

    const covered = EXACT_TARGET_CONFIGS.flatMap(config =>
      SUITES.filter(suite => read(config).includes(suite)),
    )
    expect(covered.sort()).toEqual([...SUITES].sort())
  })

  it('is invoked by the release gate', () => {
    // Without this the wrapper can exist, pass locally, and run nowhere — the
    // state it was written to end.
    expect(read('.github/workflows/pr-gate.yml')).toContain('scripts/ci/run-exact-target-suites.mjs')
  })
})

describe('the guards the wrapper must not quietly retire', () => {
  it.each(SUITES)('%s still refuses to report success without an approved target', suite => {
    // Once the wrapper always supplies the C9 variables this guard is
    // permanently green — so deleting it would be invisible. The wrapper's own
    // zero-pending check does not catch it either: removing the guard removes a
    // PASSING test, not a pending one.
    expect(read(suite)).toContain('assertApprovedTarget(')
  })

  it('never lets a C9 target come from the environment', () => {
    // The load-bearing rule. Those variables name the database five suites write
    // fixtures into and delete rows from; one `?? process.env.C9D_TEST_DATABASE_URL`
    // fallback would turn a provisioning script into a way to aim destructive
    // writes at any database an operator can reach. Asserted against the source,
    // because a comment saying so would not survive the next edit.
    expect(code('scripts/ci/run-exact-target-suites.mjs')).not.toMatch(/process\.env\.C9/)
  })

  it('does nothing when imported rather than run', () => {
    // Found the expensive way: this very test file imports EXACT_TARGET_CONFIGS,
    // and an unguarded `main()` at module scope meant importing one constant
    // provisioned a real Neon branch — which vitest then exited out from under,
    // before the wrapper's `finally` could delete it. Three branches leaked
    // before the guard existed. A module that works on import cannot export.
    const wrapper = code('scripts/ci/run-exact-target-suites.mjs')

    // Column 0 is the test: an unindented `main()` is a module-scope call, which
    // runs on import. The indented one inside the direct-execution guard is the
    // whole point and must survive.
    expect(wrapper).not.toMatch(/^main\(\)/m)
    expect(wrapper).toMatch(/import\.meta\.url/)
    expect(wrapper).toMatch(/^\s+main\(\)/m)
  })

  it('provisions through the one audited path rather than its own', () => {
    // resetPublicSchema's `drop schema public cascade` is guarded by
    // assertDisposableTestBranch, which accepts only a branch the SAME process
    // created. A second provisioning path would be a way around that.
    const wrapper = code('scripts/ci/run-exact-target-suites.mjs')

    expect(wrapper).toContain("from '../../__tests__/integration/setup.ts'")
    expect(wrapper).toContain('provisionBranch')
    expect(wrapper).not.toMatch(/createTestBranch|neonctl/)
  })
})

describe('the wrapper can actually load its dependencies', () => {
  it('imports the integration harness under plain node', () => {
    // Not hypothetical: setup.ts imported '../helpers/neon-branch' with no
    // extension, which Vitest resolves and plain node does not. Under `node` the
    // wrapper died ERR_MODULE_NOT_FOUND before provisioning anything, and the
    // only symptom was a CI step failing for a reason naming no test. Without
    // this assertion the next extensionless import re-breaks it silently.
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', "await import('./__tests__/integration/setup.ts')"],
      { cwd: root, encoding: 'utf8' },
    )

    expect(child.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(child.status).toBe(0)
  }, 30_000)
})
