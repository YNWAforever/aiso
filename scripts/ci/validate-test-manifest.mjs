import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredLayers = ['static', 'unit-contract', 'e2e-accessibility', 'build']
const requiredP0Domains = ['ENTITLEMENT', 'AUTH-TENANT', 'ALERT-INTEGRITY', 'MIGRATION']
const validPriorities = new Set(['P0', 'P1', 'P2'])

export async function validateTestManifest({ manifestPath = 'ci/pr-gate-manifest.json', cwd = process.cwd() } = {}) {
  const errors = []
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
    for (const layer of requiredLayers) {
      if (!manifest.requiredLayers.includes(layer)) errors.push(`missing required layer: ${layer}`)
    }
  }

  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    errors.push('entries must be a nonempty array')
    return errors
  }

  const ids = new Set()
  for (const entry of manifest.entries) {
    if (!entry?.id || typeof entry.id !== 'string') {
      errors.push('entry has no ID')
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate entry ID: ${entry.id}`)
    } else {
      ids.add(entry.id)
    }

    if (!validPriorities.has(entry?.priority)) errors.push(`invalid priority for ${entry?.id ?? 'unknown'}: ${entry?.priority ?? 'missing'}`)
    if (typeof entry?.fixture !== 'string' || !entry.fixture.trim()) errors.push(`empty fixture for ${entry?.id ?? 'unknown'}`)
    if (!Array.isArray(entry?.roles) || entry.roles.length === 0) errors.push(`empty roles for ${entry?.id ?? 'unknown'}`)
    if (!Array.isArray(entry?.files) || entry.files.length === 0) {
      errors.push(`empty files for ${entry?.id ?? 'unknown'}`)
      continue
    }

    for (const file of entry.files) {
      if (typeof file !== 'string' || !file.trim()) {
        errors.push(`invalid test file for ${entry?.id ?? 'unknown'}`)
        continue
      }
      try {
        await access(resolve(cwd, file))
      } catch {
        errors.push(`missing referenced test file: ${file}`)
      }
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
