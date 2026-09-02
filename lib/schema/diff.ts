import type { ClassDiff, SchemaClass, SchemaDiff, SchemaSnapshot } from './types'
// scripts/schema-equivalence.mjs imports this module under plain node (no
// bundler), where a relative import of a .ts file needs the explicit extension.
// The type-only import above is erased before node resolves anything, so only
// this value import needs it. tsc rejects the extension under moduleResolution
// "bundler" without repo-wide allowImportingTsExtensions; suppress narrowly
// instead of widening it, exactly as scripts/migrate.ts does.
// @ts-expect-error -- see comment above; node requires the extension, tsc forbids it
import { SCHEMA_CLASSES } from './types.ts'

/**
 * Compares one class of objects. Keys are sorted so a report is byte-stable
 * across runs — a diff that reorders itself is unreadable when you are running
 * it after every authoring slice.
 */
function diffClass(
  legacy: Record<string, string>,
  baseline: Record<string, string>,
): ClassDiff {
  const onlyInLegacy: string[] = []
  const onlyInBaseline: string[] = []
  const changed: ClassDiff['changed'] = []

  for (const key of Object.keys(legacy).sort()) {
    if (!(key in baseline)) onlyInLegacy.push(key)
    else if (legacy[key] !== baseline[key]) {
      changed.push({ key, legacy: legacy[key]!, baseline: baseline[key]! })
    }
  }
  for (const key of Object.keys(baseline).sort()) {
    if (!(key in legacy)) onlyInBaseline.push(key)
  }

  return { onlyInLegacy, onlyInBaseline, changed }
}

/**
 * Proves (or disproves) that replaying migrations 001-037 and applying the
 * greenfield baseline converge on the same application-owned schema.
 *
 * Pure: give it two snapshots, get a verdict. All database access lives in
 * lib/schema/introspect.ts.
 */
export function diffSchemas(legacy: SchemaSnapshot, baseline: SchemaSnapshot): SchemaDiff {
  const classes = {} as Record<SchemaClass, ClassDiff>
  let equivalent = true

  for (const name of SCHEMA_CLASSES) {
    const result = diffClass(legacy[name], baseline[name])
    classes[name] = result
    if (result.onlyInLegacy.length || result.onlyInBaseline.length || result.changed.length) {
      equivalent = false
    }
  }

  return { equivalent, classes }
}
