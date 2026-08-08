import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function runtimeFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return runtimeFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('commercial entitlement runtime wiring', () => {
  it('keeps the pricing upgrade path visible for effective free accounts', () => {
    const settings = readFileSync('app/[lang]/dashboard/settings/page.tsx', 'utf8')

    expect(settings).toContain("free: 'Upgrade to Basic →'")
    expect(settings).toContain("basic: 'Upgrade to Pro →'")
    expect(settings).toContain("pro: 'Upgrade to Enterprise →'")
  })

  it('does not derive commercial access from the raw stored plan', () => {
    const legacyPatterns = [
      /\bgetPlanFeatures\s*\(/,
      /\bplanAllows\s*\(/,
      /\bmaxBrandsForPlan\s*\(/,
      /accounts\?\.plan\s*\?\?\s*['"]basic['"]/,
    ]

    const offenders = runtimeFiles('app')
      .concat(runtimeFiles('components'))
      .filter(path => legacyPatterns.some(pattern => pattern.test(readFileSync(path, 'utf8'))))
      .map(path => relative(process.cwd(), path).replaceAll('\\', '/'))

    expect(offenders).toEqual([])
  })

  it('loads the admin override columns so resolveCommercialEntitlement can see them', () => {
    // resolveCommercialEntitlement's override branch is inert unless getProfile()
    // actually selects these columns and forwards them onto the returned
    // `accounts` object — lib/auth.ts casts that object `as unknown as
    // ProfileWithAccount`, so a dropped field here fails silently at runtime,
    // not at compile time. Pin the source text so a future edit to this query
    // can't quietly kill the feature while every other test stays green.
    const auth = readFileSync('lib/auth.ts', 'utf8')

    expect(auth).toContain('a.override_plan')
    expect(auth).toContain('a.override_expires_at')
    expect(auth).toContain('override_plan: row.override_plan')
    expect(auth).toContain('override_expires_at: row.override_expires_at')
  })

  it('loads the admin override columns on the public report path too', () => {
    // The second place an account object is built for resolveCommercialEntitlement.
    // Drop these and a comped account's published report silently resolves
    // client_reports_online: false — the same silent regression as above, on a
    // path getProfile() does not cover.
    const store = readFileSync('lib/reports/store.ts', 'utf8')

    expect(store).toContain('override_plan')
    expect(store).toContain('override_expires_at')
  })
})
