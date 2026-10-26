import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Synthetic, deliberately unresolvable target: startup and dry-run must never
// instantiate a real database client or send a write.
function run(args: string[], expectedProject = 'fixture-project') {
  return spawnSync(process.execPath, ['scripts/seed-packs.ts', ...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH, DATABASE_URL: 'postgresql://fixture:synthetic@fixture.invalid/db', EXPECTED_NEON_PROJECT_ID: expectedProject },
  })
}

describe('native Node pack seeding entrypoint', () => {
  it.each([{ args: [] }, { args: ['--dry-run'] }])('resolves imports and previews without database access: $args', ({ args }) => {
    const result = run(args)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Dry run:')
    expect(result.stdout).toContain('No database connection or writes')
    expect(result.stdout).not.toContain('synthetic@')
  })

  it('reaches the required target guard before any write', () => {
    const result = run(['--yes'], '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('EXPECTED_NEON_PROJECT_ID is not set')
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(result.stderr).not.toContain('fixture.invalid')
  })

  it('rejects unknown arguments instead of accidentally seeding', () => {
    const result = run(['--dryrun'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Use --dry-run or --yes')
    expect(result.stdout).not.toContain('Seeding')
  })
})
