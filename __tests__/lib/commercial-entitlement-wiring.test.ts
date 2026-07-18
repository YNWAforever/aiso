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
})
