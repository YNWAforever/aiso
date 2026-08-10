import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = resolve(__dirname, '../../supabase/migrations')
const alertSnapshotFunction = 'public.get_alert_weekly_snapshot'
const alertSnapshotRpc = `${alertSnapshotFunction}(uuid[])`
const alertSnapshotTarget = /^(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:"get_alert_weekly_snapshot"|get_alert_weekly_snapshot)\s*\(\s*uuid\s*\[\s*]\s*\)$/i

export function alertSnapshotGrants(sql: string) {
  const functionGrantStatements = sql.matchAll(/GRANT\s+(.+?)\s+ON\s+FUNCTION\s+(.+?)\s+TO\s+([^;]+);/gis)
  const broadPublicSchemaGrantStatements = sql.matchAll(/GRANT\s+(.+?)\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+(?:public|"public")\s+TO\s+([^;]+);/gis)

  return [
    ...[...functionGrantStatements].filter(([, , functions]) => (
      (functions ?? '').split(',').some(functionTarget => alertSnapshotTarget.test(functionTarget.trim()))
    )),
    ...[...broadPublicSchemaGrantStatements].map(([, privileges, grantee]) => ['', privileges, '', grantee]),
  ]
}

function expectOnlyServiceRoleAlertSnapshotGrants(sql: string) {
  const grants = alertSnapshotGrants(sql)
  expect(grants).toHaveLength(1)
  expect(grants[0]?.[1]?.trim()).not.toMatch(/^ALL(?:\s+PRIVILEGES)?$/i)
  expect(grants[0]?.[3]?.trim()).toBe('service_role')
}

async function migrationFiles() {
  return (await readdir(migrationsDirectory)).filter(file => file.endsWith('.sql'))
}

async function migrationSql(prefix: string) {
  const file = (await migrationFiles()).find(name => name.startsWith(`${prefix}_`))
  if (!file) throw new Error(`Missing migration ${prefix}`)
  return readFile(resolve(migrationsDirectory, file), 'utf8')
}

describe('Supabase migration contracts', () => {
  it('uses unique, numerically sorted migration prefixes', async () => {
    const files = await migrationFiles()
    const prefixes = files.map(file => Number.parseInt(file.match(/^(\d+)_/)?.[1] ?? '', 10))

    expect(prefixes.every(Number.isFinite)).toBe(true)
    expect(new Set(prefixes).size).toBe(prefixes.length)
    expect(prefixes).toEqual([...prefixes].sort((left, right) => left - right))
  })

  it('keeps the Neon alert index migrations checked in', async () => {
    await expect(migrationSql('033')).resolves.toMatch(/notifications_dedup_idx/i)
    await expect(migrationSql('033')).resolves.toMatch(/pulse_weekly_summary_alert_snapshot_idx/i)
    await expect(migrationSql('034')).resolves.toMatch(/created_at DESC NULLS LAST/i)
  })

  it('does not add privilege-bearing alert RPCs to migrations', async () => {
    for (const prefix of ['033', '034']) {
      const sql = await migrationSql(prefix)
      expect(sql).not.toMatch(/get_alert_weekly_snapshot|CREATE\\s+OR\\s+REPLACE\\s+FUNCTION|\\bGRANT\\b|\\bREVOKE\\b|\\bSECURITY\\s+DEFINER\\b/i)
    }
  })

  it('rejects an unauthorized GRANT ALL on the alert snapshot RPC', () => {
    expect(() => expectOnlyServiceRoleAlertSnapshotGrants(
      `GRANT EXECUTE ON FUNCTION ${alertSnapshotRpc} TO service_role;
       GRANT ALL PRIVILEGES ON FUNCTION ${alertSnapshotRpc} TO authenticated;`,
    )).toThrow()
  })

  it('rejects GRANT ALL PRIVILEGES even for service_role', () => {
    expect(() => expectOnlyServiceRoleAlertSnapshotGrants(
      `GRANT ALL PRIVILEGES ON FUNCTION ${alertSnapshotRpc} TO service_role;`,
    )).toThrow()
  })

  it('rejects an alert snapshot grant when it follows another function in the same grant list', () => {
    const sql = `GRANT EXECUTE ON FUNCTION public.refresh_alert_cache(), ${alertSnapshotRpc} TO authenticated;`

    expect(alertSnapshotGrants(sql)).toHaveLength(1)
    expect(() => expectOnlyServiceRoleAlertSnapshotGrants(sql)).toThrow()
  })

  it.each([
    'GRANT EXECUTE ON FUNCTION get_alert_weekly_snapshot(uuid[]) TO authenticated;',
    'GRANT ALL PRIVILEGES ON FUNCTION "public"."get_alert_weekly_snapshot"(uuid[]) TO anon;',
  ])('rejects unauthorized unqualified or quoted target grants', sql => {
    expect(alertSnapshotGrants(sql)).toHaveLength(1)
    expect(() => expectOnlyServiceRoleAlertSnapshotGrants(sql)).toThrow()
  })

  it.each([
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;',
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "public" TO authenticated;',
  ])('rejects unauthorized broad public-schema function grants', sql => {
    expect(alertSnapshotGrants(sql)).toHaveLength(1)
    expect(() => expectOnlyServiceRoleAlertSnapshotGrants(sql)).toThrow()
  })

  it('finds a quoted target among comma-separated function grants', () => {
    const sql = 'GRANT EXECUTE ON FUNCTION public.refresh_alert_cache(), "public"."get_alert_weekly_snapshot"(uuid[]) TO service_role;'

    expect(alertSnapshotGrants(sql)).toHaveLength(1)
    expectOnlyServiceRoleAlertSnapshotGrants(sql)
  })

  it('does not treat a near-name function as the alert snapshot RPC', () => {
    const sql = 'GRANT EXECUTE ON FUNCTION public.other_get_alert_weekly_snapshot(uuid[]) TO authenticated;'

    expect(alertSnapshotGrants(sql)).toHaveLength(0)
  })

  it('contains no transaction control statements', async () => {
    const sql = await Promise.all((await migrationFiles()).map(file => readFile(resolve(migrationsDirectory, file), 'utf8')))
    const runnerSql = sql.join('\n').replace(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$/g, '')

    expect(runnerSql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/im)
  })
})
