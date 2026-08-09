import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredLayers = ['static', 'unit-contract', 'e2e-accessibility', 'build']
const requiredLayerSet = new Set(requiredLayers)
const requiredP0Domains = ['ENTITLEMENT', 'AUTH-TENANT', 'ALERT-INTEGRITY', 'MIGRATION']
const validPriorities = new Set(['P0', 'P1', 'P2'])
const validRoles = new Set(['anonymous', 'authenticated', 'admin'])
const entryIdPattern = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const requiredEntries = new Map([
  ['ENTITLEMENT-P0', 'P0'],
  ['AUTH-TENANT-P0', 'P0'],
  ['ALERT-INTEGRITY-P0', 'P0'],
  ['MIGRATION-P0', 'P0'],
  ['CITATION-P1', 'P1'],
  ['ACCESSIBILITY-P0', 'P0'],
])

export async function validateManifestFilePath({ file, repositoryRoot, lstatFile = lstat }) {
  if (typeof file !== 'string' || !file.trim()) return 'invalid test file'

  const resolvedFile = resolve(repositoryRoot, file)
  const repositoryRelativePath = relative(repositoryRoot, resolvedFile)
  const pathSegments = file.replaceAll('\\', '/').split('/')
  if (
    isAbsolute(file)
    || pathSegments.includes('..')
    || repositoryRelativePath === ''
    || repositoryRelativePath === '..'
    || repositoryRelativePath.startsWith(`..${sep}`)
    || isAbsolute(repositoryRelativePath)
  ) {
    return `referenced manifest file must be a relative path inside the repository: ${file}`
  }

  try {
    const fileStatus = await lstatFile(resolvedFile)
    if (fileStatus.isSymbolicLink()) return `referenced manifest file must not be a symbolic link: ${file}`
    if (!fileStatus.isFile()) return `referenced test path is not a regular file: ${file}`
  } catch {
    return `missing referenced test file: ${file}`
  }

  const testRelativePath = repositoryRelativePath.replaceAll('\\', '/')
  if (!testRelativePath.startsWith('__tests__/') && !testRelativePath.startsWith('tests/')) {
    return `referenced manifest file is not under __tests__/ or tests/: ${file}`
  }
}

export async function validateTestManifest({ manifestPath = 'ci/pr-gate-manifest.json', cwd = process.cwd() } = {}) {
  const errors = []
  const repositoryRoot = resolve(cwd)
  let manifest

  try {
    manifest = JSON.parse(await readFile(resolve(cwd, manifestPath), 'utf8'))
  } catch (error) {
    return [`Unable to read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`]
  }

  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!Array.isArray(manifest.requiredLayers)) {
    errors.push('requiredLayers must be an array')
  } else {
    if (manifest.requiredLayers.length === 0) errors.push('requiredLayers must be a nonempty array')
    const layers = new Set()
    for (const layer of manifest.requiredLayers) {
      if (layers.has(layer)) {
        errors.push(`duplicate required layer: ${String(layer)}`)
      } else {
        layers.add(layer)
      }
      if (!requiredLayerSet.has(layer)) errors.push(`unknown required layer: ${String(layer)}`)
    }
    for (const layer of requiredLayers) {
      if (!layers.has(layer)) errors.push(`missing required layer: ${layer}`)
    }
  }

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    errors.push('entries must be a nonempty array')
    return errors
  }

  const ids = new Set()
  for (const entry of manifest.entries) {
    if (typeof entry?.id !== 'string' || !entryIdPattern.test(entry.id)) {
      errors.push(`invalid entry ID: ${String(entry?.id)}`)
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate entry ID: ${entry.id}`)
    } else {
      ids.add(entry.id)
    }

    if (!validPriorities.has(entry?.priority)) errors.push(`invalid priority for ${entry?.id ?? 'unknown'}: ${entry?.priority ?? 'missing'}`)
    if (typeof entry?.fixture !== 'string' || !entry.fixture.trim()) errors.push(`empty fixture for ${entry?.id ?? 'unknown'}`)
    if (!Array.isArray(entry?.roles) || entry.roles.length === 0) {
      errors.push(`empty roles for ${entry?.id ?? 'unknown'}`)
    } else {
      for (const role of entry.roles) {
        if (typeof role !== 'string' || !validRoles.has(role)) {
          errors.push(`invalid role for ${entry?.id ?? 'unknown'}: ${String(role)}`)
        }
      }
    }
    if (!Array.isArray(entry?.files) || entry.files.length === 0) {
      errors.push(`empty files for ${entry?.id ?? 'unknown'}`)
      continue
    }

    for (const file of entry.files) {
      const fileError = await validateManifestFilePath({ file, repositoryRoot })
      if (fileError) errors.push(`${fileError}${fileError === 'invalid test file' ? ` for ${entry?.id ?? 'unknown'}` : ''}`)
    }
  }

  for (const [id, priority] of requiredEntries) {
    const entry = manifest.entries.find(candidate => candidate?.id === id)
    if (!entry) {
      errors.push(`missing required manifest entry: ${id}`)
    } else if (entry.priority !== priority) {
      errors.push(`required manifest entry must have priority ${priority}: ${id}`)
    }
  }

  for (const domain of requiredP0Domains) {
    if (!manifest.entries.some(entry => entry?.id === `${domain}-P0` && entry?.priority === 'P0')) {
      errors.push(`missing required P0 domain: ${domain}`)
    }
  }

  return errors
}

async function main() {
  const errors = await validateTestManifest()
  if (errors.length) {
    process.stderr.write(`${errors.map(error => `test manifest: ${error}`).join('\n')}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
