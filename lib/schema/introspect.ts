import type { Client } from '@neondatabase/serverless'
import type { SchemaSnapshot } from './types'

/** The role whose grants are load-bearing (migration 037). */
const APP_ROLE = 'aeo_app'

async function rows(client: Client, sql: string, params: unknown[] = []) {
  const result = await client.query(sql, params)
  return result.rows as Record<string, string>[]
}

function index<T extends Record<string, string>>(
  list: T[],
  key: (row: T) => string,
  value: (row: T) => string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of list) out[key(row)] = value(row)
  return out
}

/**
 * Reads one database's application-owned schema into a comparable snapshot.
 *
 * Deliberately thin: no branching logic, no normalization beyond joining fields
 * into a single string. Anything clever belongs in lib/schema/diff.ts, which is
 * unit-tested; this file's correctness is demonstrated by the equivalence
 * runner's diff converging to empty.
 */
export async function introspectSchema(client: Client): Promise<SchemaSnapshot> {
  // pg_attribute + format_type, NOT information_schema.columns: the latter
  // reports bare `numeric` for numeric(4,2) and bare `ARRAY` for text[], so a
  // wrong precision or element type would pass this gate silently — and the
  // schema is dense with numeric(n,m) (authority scores, pulse metrics, local
  // trust). format_type renders the exact declared type.
  //
  // Column ordinal position is deliberately NOT compared: the legacy chain
  // appends columns via ALTER across 35 migrations while the baseline declares
  // them inline, so ordinals legitimately differ and comparing them would
  // report guaranteed false failures.
  const columns = index(
    await rows(client, `
      select cls.relname as table_name,
             att.attname as column_name,
             format_type(att.atttypid, att.atttypmod) as data_type,
             case when att.attnotnull then 'NO' else 'YES' end as is_nullable,
             coalesce(pg_get_expr(def.adbin, def.adrelid), '') as column_default
      from pg_attribute att
      join pg_class cls on cls.oid = att.attrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      left join pg_attrdef def on def.adrelid = att.attrelid and def.adnum = att.attnum
      where nsp.nspname = 'public'
        and cls.relkind = 'r'
        and att.attnum > 0
        and not att.attisdropped
    `),
    (r) => `${r.table_name}.${r.column_name}`,
    (r) => `${r.data_type}|${r.is_nullable}|${r.column_default}`,
  )

  const constraints = index(
    await rows(client, `
      select rel.relname as table_name, con.conname as constraint_name,
             pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
    `),
    (r) => `${r.table_name}.${r.constraint_name}`,
    (r) => r.definition,
  )

  const indexes = index(
    await rows(client, `
      select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
    `),
    (r) => `${r.tablename}.${r.indexname}`,
    (r) => r.indexdef,
  )

  // Presence AND the function each trigger calls: a pg_proc-only check would
  // report success while a trigger silently stopped being attached.
  const triggers = index(
    await rows(client, `
      select rel.relname as table_name, tg.tgname as trigger_name,
             proc.proname as function_name, tg.tgtype::text as tgtype
      from pg_trigger tg
      join pg_class rel on rel.oid = tg.tgrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_proc proc on proc.oid = tg.tgfoid
      where nsp.nspname = 'public' and not tg.tgisinternal
    `),
    (r) => `${r.table_name}.${r.trigger_name}`,
    (r) => `${r.function_name}|${r.tgtype}`,
  )

  const functions = index(
    await rows(client, `
      select proc.proname,
             pg_get_function_identity_arguments(proc.oid) as args,
             pg_get_function_result(proc.oid) as returns,
             proc.provolatile::text as volatility,
             proc.prosecdef::text as security_definer
      from pg_proc proc
      join pg_namespace nsp on nsp.oid = proc.pronamespace
      where nsp.nspname = 'public'
    `),
    (r) => `${r.proname}(${r.args})`,
    (r) => `${r.returns}|${r.volatility}|${r.security_definer}`,
  )

  const grantRows = await rows(client, `
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = $1
    order by table_name, privilege_type
  `, [APP_ROLE])
  const grants: Record<string, string> = {}
  for (const row of grantRows) {
    grants[row.table_name] = grants[row.table_name]
      ? `${grants[row.table_name]},${row.privilege_type}`
      : row.privilege_type
  }

  const rls = index(
    await rows(client, `
      select t.tablename,
             t.rowsecurity::text as rowsecurity,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = t.tablename)::text as policies
      from pg_tables t
      where t.schemaname = 'public'
    `),
    (r) => r.tablename,
    (r) => `rowsecurity=${r.rowsecurity}|policies=${r.policies}`,
  )

  const extensions = index(
    await rows(client, `
      select ext.extname, nsp.nspname
      from pg_extension ext
      join pg_namespace nsp on nsp.oid = ext.extnamespace
    `),
    (r) => r.extname,
    (r) => r.nspname,
  )

  return { columns, constraints, indexes, triggers, functions, grants, rls, extensions }
}
