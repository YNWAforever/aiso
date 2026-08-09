import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const requiredLayers = ['static', 'unit-contract', 'e2e-accessibility', 'build']
const requiredP0Domains = ['ENTITLEMENT', 'AUTH-TENANT', 'ALERT-INTEGRITY', 'MIGRATION']
const validPriorities = new Set(['P0', 'P1', 'P2'])

type ManifestEntry = {
  id: string
  priority: string
  fixture: string
  roles: string[]
  files: string[]
}

type Manifest = {
  schemaVersion: number
  requiredLayers: string[]
  entries: ManifestEntry[]
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(resolve(root, 'ci/pr-gate-manifest.json'), 'utf8')) as Manifest
}

describe('pr-gate test manifest', () => {
  it('declares every required merge-gate layer', async () => {
    const manifest = await readManifest()

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.requiredLayers).toEqual(expect.arrayContaining(requiredLayers))
  })

  it('uses unique IDs, valid priorities, and traceable fixtures and roles', async () => {
    const manifest = await readManifest()
    const ids = manifest.entries.map(entry => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of manifest.entries) {
      expect(validPriorities.has(entry.priority)).toBe(true)
      expect(entry.fixture.trim()).not.toBe('')
      expect(entry.roles.length).toBeGreaterThan(0)
    }
  })

  it('only points at existing test files', async () => {
    const manifest = await readManifest()

    await Promise.all(manifest.entries.flatMap(entry =>
      entry.files.map(file => expect(access(resolve(root, file))).resolves.toBeUndefined()),
    ))
  })

  it('covers every required P0 boundary domain', async () => {
    const manifest = await readManifest()

    for (const domain of requiredP0Domains) {
      expect(manifest.entries.some(entry => entry.id === `${domain}-P0` && entry.priority === 'P0')).toBe(true)
    }
  })
})
