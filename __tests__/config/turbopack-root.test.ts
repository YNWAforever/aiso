import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Next.js workspace root', () => {
  it('pins Turbopack to this checkout instead of an unrelated parent lockfile', () => {
    const config = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')

    expect(config).toMatch(/turbopack:\s*\{[\s\S]*root:\s*process\.cwd\(\)/)
  })
})
