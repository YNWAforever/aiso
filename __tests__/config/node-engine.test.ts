import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(repoRoot, path), 'utf8')) as T
}

describe('Vercel Node engine', () => {
  it('keeps the package engine aligned with the Vercel project Node setting', () => {
    const pkg = readJson<{ engines?: { node?: string } }>('package.json')
    const lock = readJson<{
      packages?: {
        '': {
          engines?: { node?: string }
        }
      }
    }>('package-lock.json')

    expect(pkg.engines?.node).toBe('24.x')
    expect(lock.packages?.[''].engines?.node).toBe('24.x')
  })
})
