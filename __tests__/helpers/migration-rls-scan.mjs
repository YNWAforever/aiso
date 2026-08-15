/**
 * Find row-level-security policy statements in a migration's SQL.
 *
 * Dependency-free and side-effect-free, matching migration-role-guards.mjs
 * beside it: these run under plain node in the unit project with no database.
 *
 * Line comments are stripped first, so prose or a commented-out statement does
 * not register as a real one. Policy names in this repo are always
 * double-quoted; table names appear both bare (`clients`) and schema-qualified
 * (`public.clients`), so the schema is normalised away and every result is
 * reported as `table.policy name`.
 */

const CREATE_POLICY = /create\s+policy\s+"([^"]+)"\s+on\s+([a-z0-9_."]+)/gi
const DROP_POLICY = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z0-9_."]+)/gi

function stripLineComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function bareTable(name) {
  return name.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
}

function collect(sql, pattern) {
  const stripped = stripLineComments(sql)
  return [...stripped.matchAll(pattern)].map((match) => `${bareTable(match[2])}.${match[1]}`)
}

export function findCreatedPolicies(sql) {
  return collect(sql, CREATE_POLICY)
}

export function findDroppedPolicies(sql) {
  return collect(sql, DROP_POLICY)
}
