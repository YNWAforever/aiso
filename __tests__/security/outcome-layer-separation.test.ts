import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The observed layer (GA4 enquiries, lib/integrations/analytics) and the modelled
 * layer (the Local Trust scenario, lib/localTrust) are shown side by side but must
 * never feed one another. If the scenario read observed counts, the "modelled"
 * figure would silently become a mix of measurement and assumption; if the observed
 * layer read the scenario, a counted number could inherit an estimate. The owner's
 * own lead value and close rate reach the observed side through analytics' own SQL
 * (loadAnalyticsPanel), so the two products share a table, not a module.
 *
 * This walks every source file under each directory and refuses any import of the
 * other one, whatever the specifier looks like.
 */

const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Module specifiers a file imports, re-exports or dynamically imports (comments are not code). */
function specifiersIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const found: string[] = []
  for (const m of code.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) found.push(m[1]!)
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) found.push(m[1]!)
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]!)
  return found
}

function offenders(dir: string, forbidden: RegExp): string[] {
  const bad: string[] = []
  for (const file of sourceFiles(dir)) {
    for (const spec of specifiersIn(readFileSync(join(ROOT, file), 'utf8'))) {
      if (forbidden.test(spec)) bad.push(`${file} imports ${spec}`)
    }
  }
  return bad
}

describe('the modelled and observed outcome layers stay separate', () => {
  it('finds files to check on both sides', () => {
    expect(sourceFiles('lib/localTrust').length).toBeGreaterThan(3)
    expect(sourceFiles('lib/integrations/analytics').length).toBeGreaterThan(3)
  })

  it('reads imports the way the walk needs to', () => {
    expect(specifiersIn(`import { a } from '@/lib/integrations/analytics/store'`)).toEqual(['@/lib/integrations/analytics/store'])
    expect(specifiersIn(`import type { A } from "../localTrust/store"`)).toEqual(['../localTrust/store'])
    expect(specifiersIn(`export * from './x'\nconst m = await import('@/lib/localTrust/y')`)).toEqual(['./x', '@/lib/localTrust/y'])
    expect(specifiersIn(`// import x from '@/lib/localTrust/store'\n/* import y from 'localTrust' */`)).toEqual([])
  })

  it('lib/localTrust imports nothing from integrations/analytics', () => {
    expect(offenders('lib/localTrust', /integrations\/analytics/)).toEqual([])
  })

  it('lib/integrations/analytics imports nothing from localTrust', () => {
    expect(offenders('lib/integrations/analytics', /localTrust/)).toEqual([])
  })
})
