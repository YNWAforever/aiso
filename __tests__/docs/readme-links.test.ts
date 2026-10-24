import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The README points at docs instead of holding them (UX Phase 8), so a moved
 * or renamed file would leave it pointing at nothing. Every relative link in
 * the README and in the pages it sends people to must resolve.
 */
const PAGES = [
  'README.md',
  'AGENTS.md',
  'docs/project-status.md',
  'docs/configuration.md',
  'docs/runbooks/public-scan-prerequisites.md',
  'docs/runbooks/runtime-readiness.md',
  'docs/runbooks/schema-equivalence.md',
]

function relativeLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map(match => match[1]!)
    .filter(target => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
    .map(target => target.split('#')[0]!)
}

describe('README and the docs it points to', () => {
  it.each(PAGES)('%s links only to files that exist', page => {
    const links = relativeLinks(readFileSync(page, 'utf8'))
    for (const target of links) expect({ page, target, exists: existsSync(join(dirname(page), target)) }).toEqual({ page, target, exists: true })
  })

  it('keeps the README a front page, not a store of notes', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme.split('\n').length).toBeLessThan(130)
    expect(readme.startsWith('# Fimmick AISO\n')).toBe(true)
  })
})
