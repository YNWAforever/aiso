import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = resolve(__dirname, '../../supabase/migrations')
const alertSnapshotFunction = 'public.get_alert_weekly_snapshot'
const alertSnapshotRpc = `${alertSnapshotFunction}(uuid[])`

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

  it('defines the alert snapshot RPC in migrations 023 and 024', async () => {
    for (const prefix of ['023', '024']) {
      await expect(migrationSql(prefix)).resolves.toMatch(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+${alertSnapshotFunction}\\s*\\(\\s*p_client_ids\\s+uuid\\[\\]\\s*\\)`, 'i'),
      )
    }
  })

  it('grants alert snapshot execution only to service_role', async () => {
    for (const prefix of ['023', '024']) {
      const sql = await migrationSql(prefix)
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${alertSnapshotRpc} TO service_role;`)
      expect(sql).not.toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${alertSnapshotRpc.replace(/[()[\].]/g, '\\$&')}\\s+TO\\s+(PUBLIC|anon|authenticated)`, 'i'))
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${alertSnapshotRpc} FROM PUBLIC;`)
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${alertSnapshotRpc} FROM anon;`)
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${alertSnapshotRpc} FROM authenticated;`)
    }
  })

  it('contains no transaction control statements', async () => {
    const sql = await Promise.all((await migrationFiles()).map(file => readFile(resolve(migrationsDirectory, file), 'utf8')))
    const runnerSql = sql.join('\n').replace(/\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$/g, '')

    expect(runnerSql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/im)
  })
})
