import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { redactSecrets } from '@/lib/security/redact-secrets'

const MIGRATE = readFileSync(join(process.cwd(), 'scripts/migrate.ts'), 'utf8')
const BRANCH_HELPER = readFileSync(join(process.cwd(), '__tests__/helpers/neon-branch.ts'), 'utf8')
const OVERVIEW_ROUTE = readFileSync(
  join(process.cwd(), 'app/api/clients/[clientId]/overview/route.ts'),
  'utf8',
)
const SEED_PACKS = readFileSync(join(process.cwd(), 'scripts/seed-packs.ts'), 'utf8')
const DASHBOARD_PAGE = readFileSync(
  join(process.cwd(), 'app/[lang]/dashboard/[clientId]/page.tsx'),
  'utf8',
)
const DASHBOARD_RESULT_PAGE = readFileSync(
  join(process.cwd(), 'app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx'),
  'utf8',
)

describe('no hand-rolled credential redaction survives', () => {
  it('the migration runner uses the shared redactor', () => {
    expect(MIGRATE).toContain('redactSecrets')
  })

  it('the Neon branch helper uses the shared redactor', () => {
    // It shells out to neonctl directly, so it is the one place that can print
    // a raw connection URI without going through scripts/neon.
    expect(BRANCH_HELPER).toContain('redactSecrets')
  })

  it('the clients overview route uses the shared redactor', () => {
    expect(OVERVIEW_ROUTE).toContain('redactSecrets')
  })

  it('the pack seeder uses the shared redactor', () => {
    expect(SEED_PACKS).toContain('redactSecrets')
  })

  it('the dashboard workspace page uses the shared redactor', () => {
    expect(DASHBOARD_PAGE).toContain('redactSecrets')
  })

  it('the dashboard result page uses the shared redactor', () => {
    expect(DASHBOARD_RESULT_PAGE).toContain('redactSecrets')
  })

  it('none of the files still carry their own postgres-URI regex', () => {
    // The exact class the security review found failing open: a URI-shaped
    // pattern misses a credential containing a raw '/', a space, or an empty
    // username, and passes the whole line through byte-identical.
    for (const [name, source] of [
      ['migrate.ts', MIGRATE],
      ['neon-branch.ts', BRANCH_HELPER],
      ['overview/route.ts', OVERVIEW_ROUTE],
      ['seed-packs.ts', SEED_PACKS],
      ['dashboard/[clientId]/page.tsx', DASHBOARD_PAGE],
      ['dashboard/[clientId]/result/[scanId]/page.tsx', DASHBOARD_RESULT_PAGE],
    ] as const) {
      expect(source, name).not.toMatch(/postgres\(\?:ql\)\?:\\\/\\\//)
      expect(source, name).not.toMatch(/postgresql:\\\/\\\/\\S\+/)
    }
  })

  it('the shared redactor covers what those regexes missed', () => {
    // Raw slash inside the credential — the old patterns returned this intact.
    expect(redactSecrets('postgres://neondb_owner:npg/yxgMD67vcGVS@ep-x.neon.tech/db'))
      .not.toContain('npg/yxgMD67vcGVS')
    // Empty username — likewise a total miss before.
    expect(redactSecrets('postgres://:password123@host/db')).not.toContain('password123')
    // A bare token outside any URI, which no URI-shaped regex can match.
    expect(redactSecrets('npg_ABCDEFGH12345')).not.toContain('npg_ABCDEFGH12345')
  })
})
