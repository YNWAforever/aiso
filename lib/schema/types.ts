/**
 * A normalized view of one database's application-owned schema.
 *
 * Every class is a flat map: the key identifies an object, the value is its
 * definition rendered as a single comparable string. Keeping all eight classes
 * the same shape lets diffSchemas() be one generic loop rather than eight
 * bespoke comparators.
 */
export interface SchemaSnapshot {
  /** "table.column" -> "type|nullable|default" */
  columns: Record<string, string>
  /** "table.constraint" -> pg_get_constraintdef output (body, not just presence) */
  constraints: Record<string, string>
  /** "table.index" -> full indexdef */
  indexes: Record<string, string>
  /** "table.trigger" -> "function|tgtype" */
  triggers: Record<string, string>
  /** "name(argtypes)" -> "returns|volatility|security_definer" */
  functions: Record<string, string>
  /** "table" -> comma-joined sorted privilege list for aeo_app */
  grants: Record<string, string>
  /** "table" -> "rowsecurity=<bool>|policies=<count>" */
  rls: Record<string, string>
  /** "extension" -> schema it is installed into */
  extensions: Record<string, string>
}

export type SchemaClass = keyof SchemaSnapshot

export interface ClassDiff {
  /** Keys present in the legacy path but missing from the baseline path. */
  onlyInLegacy: string[]
  /** Keys present in the baseline path but missing from the legacy path. */
  onlyInBaseline: string[]
  /** Keys in both whose definitions differ. */
  changed: Array<{ key: string; legacy: string; baseline: string }>
}

export interface SchemaDiff {
  equivalent: boolean
  classes: Record<SchemaClass, ClassDiff>
}

export const SCHEMA_CLASSES: SchemaClass[] = [
  'columns', 'constraints', 'indexes', 'triggers',
  'functions', 'grants', 'rls', 'extensions',
]
