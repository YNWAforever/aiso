import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateManifestFilePath, validateTestManifest } from '../../scripts/ci/validate-test-manifest.mjs'

const root = resolve(__dirname, '../..')
const requiredLayers = ['static', 'unit-contract', 'e2e-accessibility', 'build']
const requiredP0Domains = ['ENTITLEMENT', 'AUTH-TENANT', 'ALERT-INTEGRITY', 'MIGRATION']
const validPriorities = new Set(['P0', 'P1', 'P2'])
const validRoles = new Set(['anonymous', 'authenticated', 'admin'])
const requiredEntries = new Map([
  ['ENTITLEMENT-P0', 'P0'],
  ['AUTH-TENANT-P0', 'P0'],
  ['ALERT-INTEGRITY-P0', 'P0'],
  ['MIGRATION-P0', 'P0'],
  ['CITATION-P1', 'P1'],
  ['ACCESSIBILITY-P0', 'P0'],
])

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

async function validateMalformedManifest(transform: (manifest: Manifest) => Manifest) {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'geoscanner-test-manifest-'))
  const manifestPath = resolve(temporaryDirectory, 'manifest.json')

  try {
    await writeFile(manifestPath, JSON.stringify(transform(await readManifest())), 'utf8')
    return await validateTestManifest({ manifestPath, cwd: root })
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
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

  it('uses unique IDs, valid priorities, and evidenced traceable fixtures and roles', async () => {
    const manifest = await readManifest()
    const ids = manifest.entries.map(entry => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of manifest.entries) {
      expect(validPriorities.has(entry.priority)).toBe(true)
      expect(entry.fixture.trim()).not.toBe('')
      expect(entry.roles.length).toBeGreaterThan(0)
      expect(entry.roles.every(role => validRoles.has(role))).toBe(true)
    }
  })

  it('only points at existing regular test files', async () => {
    const manifest = await readManifest()

    for (const file of manifest.entries.flatMap(entry => entry.files)) {
      expect((await stat(resolve(root, file))).isFile()).toBe(true)
    }
  })

  it('covers every required P0 boundary domain', async () => {
    const manifest = await readManifest()

    for (const domain of requiredP0Domains) {
      expect(manifest.entries.some(entry => entry.id === `${domain}-P0` && entry.priority === 'P0')).toBe(true)
    }
  })

  it('declares every required gate entry with its contract priority', async () => {
    const manifest = await readManifest()

    for (const [id, priority] of requiredEntries) {
      expect(manifest.entries.find(entry => entry.id === id)?.priority).toBe(priority)
    }
  })

  it('accepts the checked-in manifest with the standalone validator', async () => {
    await expect(validateTestManifest({ cwd: root })).resolves.toEqual([])
  })

  it('rejects unknown root-level manifest properties', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      unexpectedRootProperty: true,
    }))

    expect(errors).toContain('unknown root manifest property: unexpectedRootProperty')
  })

  it('rejects unknown manifest entry properties', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'CITATION-P1'
        ? { ...entry, unexpectedEntryProperty: true }
        : entry),
    }))

    expect(errors).toContain('unknown manifest entry property for CITATION-P1: unexpectedEntryProperty')
  })

  it('rejects role members outside the evidenced role set', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'AUTH-TENANT-P0'
        ? { ...entry, roles: ['authenticated', 'analyst'] }
        : entry),
    }))

    expect(errors).toContain('invalid role for AUTH-TENANT-P0: analyst')
  })

  it('rejects a whitespace-only entry ID', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'CITATION-P1'
        ? { ...entry, id: '   ' }
        : entry),
    }))

    expect(errors).toContain('invalid entry ID:    ')
  })

  it('rejects a duplicate required layer', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      requiredLayers: [...manifest.requiredLayers, 'build'],
    }))

    expect(errors).toContain('duplicate required layer: build')
  })

  it('rejects an unknown required layer', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      requiredLayers: [...manifest.requiredLayers, 'integration'],
    }))

    expect(errors).toContain('unknown required layer: integration')
  })

  it('rejects directory paths and missing named entry priorities', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries
        .filter(entry => entry.id !== 'CITATION-P1')
        .map(entry => entry.id === 'MIGRATION-P0'
          ? { ...entry, files: ['__tests__'] }
          : entry),
    }))

    expect(errors).toContain('referenced test path is not a regular file: __tests__')
    expect(errors).toContain('missing required manifest entry: CITATION-P1')
  })

  it('rejects a regular non-test file', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'MIGRATION-P0'
        ? { ...entry, files: ['package.json'] }
        : entry),
    }))

    expect(errors).toContain('referenced manifest file is not under __tests__/ or tests/: package.json')
  })

  it('rejects a helper or fixture that does not use a test filename', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'MIGRATION-P0'
        ? { ...entry, files: ['tests/fixtures/auth.ts'] }
        : entry),
    }))

    expect(errors).toContain('referenced manifest file is not a test file: tests/fixtures/auth.ts')
  })

  it('rejects symbolic-link metadata without following the link', async () => {
    const temporaryDirectory = await mkdtemp(resolve(root, '__tests__', '.manifest-link-'))
    const linkedFile = resolve(temporaryDirectory, 'migration-contract.test.ts')
    const manifestFile = relative(root, linkedFile).replaceAll('\\', '/')
    const expectedError = `referenced manifest file must not be a symbolic link: ${manifestFile}`

    try {
      await symlink(resolve(root, '__tests__/supabase/migration-contract.test.ts'), linkedFile, 'file')
      await expect(validateManifestFilePath({ file: manifestFile, repositoryRoot: root })).resolves.toBe(expectedError)
    } catch {
      await expect(validateManifestFilePath({
        file: manifestFile,
        repositoryRoot: root,
        lstatFile: async path => path === linkedFile
          ? { isFile: () => false, isSymbolicLink: () => true }
          : lstat(path),
      })).resolves.toBe(expectedError)
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('rejects symbolic-link metadata on an ancestor directory without following it', async () => {
    const manifestFile = '__tests__/supabase/migration-contract.test.ts'
    const linkedAncestor = resolve(root, '__tests__')

    await expect(validateManifestFilePath({
      file: manifestFile,
      repositoryRoot: root,
      lstatFile: async path => path === linkedAncestor
        ? { isFile: () => false, isSymbolicLink: () => true }
        : lstat(path),
    })).resolves.toBe(`referenced manifest path must not traverse a symbolic link: ${manifestFile}`)
  })

  it('rejects absolute and escaping file paths', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'MIGRATION-P0'
        ? { ...entry, files: [resolve(root, '__tests__/supabase/migration-contract.test.ts'), '../geoscanner/__tests__/supabase/migration-contract.test.ts'] }
        : entry),
    }))

    expect(errors).toContain(`referenced manifest file must be a relative path inside the repository: ${resolve(root, '__tests__/supabase/migration-contract.test.ts')}`)
    expect(errors).toContain('referenced manifest file must be a relative path inside the repository: ../geoscanner/__tests__/supabase/migration-contract.test.ts')
  })

  it('rejects a named entry with the wrong contract priority', async () => {
    const errors = await validateMalformedManifest(manifest => ({
      ...manifest,
      entries: manifest.entries.map(entry => entry.id === 'CITATION-P1'
        ? { ...entry, priority: 'P2' }
        : entry),
    }))

    expect(errors).toContain('required manifest entry must have priority P1: CITATION-P1')
  })
})
