import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { neon } from '@neondatabase/serverless'
import { listMigrationFiles } from '@/scripts/migrate'

const sql = neon(process.env.TEST_DATABASE_URL!)

describe('migration runner against a real branch', () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL is not set — globalSetup did not provision a branch')
    }
  })

  it('records every migration file in the ledger', async () => {
    const rows = await sql`select filename from schema_migrations order by filename`
    expect(rows.map((r) => r.filename)).toEqual(listMigrationFiles())
  })

  it('creates the client report tables from 027', async () => {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('client_reports', 'client_report_versions', 'account_report_branding')
      order by table_name
    `
    expect(rows.map((r) => r.table_name)).toEqual([
      'account_report_branding', 'client_report_versions', 'client_reports',
    ])
  })

  it('creates the client report functions from 027', async () => {
    const rows = await sql`
      select routine_name from information_schema.routines
      where routine_schema = 'public' and routine_name like '%client_report%'
      order by routine_name
    `
    expect(rows.map((r) => r.routine_name)).toContain('publish_client_report_latest')
    expect(rows.map((r) => r.routine_name)).toContain('revoke_client_report')
    expect(rows.map((r) => r.routine_name)).toContain('rotate_client_report_link')
  })

  it('creates the account override columns from 028', async () => {
    const rows = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts'
        and column_name in ('override_plan', 'override_expires_at')
      order by column_name
    `
    expect(rows.map((r) => r.column_name)).toEqual(['override_expires_at', 'override_plan'])
  })

  it('is idempotent — running it again applies nothing', async () => {
    const before = await sql`select count(*)::int as n from schema_migrations`

    const output = execFileSync('node', ['scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      encoding: 'utf8',
    })
    expect(output).toContain('Nothing to apply')

    const after = await sql`select count(*)::int as n from schema_migrations`
    expect(after[0].n).toBe(before[0].n)
    expect(after[0].n).toBe(listMigrationFiles().length)
  })
})
