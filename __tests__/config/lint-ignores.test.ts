import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * The ignores live as --ignore-pattern flags on package.json's lint script, not
 * in eslint.config.mjs, so `npx eslint .` and `npm run lint` differ. Read them
 * from the script itself so this test follows whatever CI actually runs.
 */
function lintScriptIgnorePatterns(): string[] {
  const script: string = JSON.parse(readFileSync('package.json', 'utf8')).scripts.lint
  return [...script.matchAll(/--ignore-pattern\s+"([^"]+)"/g)].map(match => match[1])
}

// Every kind of directory that has held a full copy of this repo inside the
// checkout -- the same set __tests__/config/vitest-discovery.test.ts pins for
// Vitest. None exists in CI, which is why isPathIgnored is asked about paths
// rather than relying on lint output: a fresh clone would pass either way.
const COPY_ROOTS = ['.worktrees', '.claude/worktrees', '.playwright-ci-server', '.codex']

// Real source that must stay linted, so an over-broad pattern fails here too.
const SOURCE_PATHS = ['lib/db.ts', 'app/api/scan/route.ts', 'components/ui/button.tsx', '__tests__/lib/tier.test.ts', 'scripts/migrate.ts']

describe('npm run lint ignores', () => {
  // The first isPathIgnored call loads eslint.config.mjs and its plugins: ~40s
  // on an idle laptop, hence the 120s ceiling below for 2-core CI runners.
  const eslint = new ESLint({ cwd: process.cwd(), ignorePatterns: lintScriptIgnorePatterns() })

  it.each(COPY_ROOTS)('does not lint the repo copy under %s', async root => {
    // Not hypothetical: `.worktrees/` held 1,538 lintable files and `.codex/`
    // 265, all walked by `npm run lint` and reported as this checkout's errors.
    expect(await eslint.isPathIgnored(join(process.cwd(), root, 'copy', 'lib', 'db.ts'))).toBe(true)
  })

  it.each(SOURCE_PATHS)('still lints %s', async file => {
    expect(await eslint.isPathIgnored(join(process.cwd(), file))).toBe(false)
  })
}, 120_000)
