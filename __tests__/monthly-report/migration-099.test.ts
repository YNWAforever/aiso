import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { PGlite } from '@electric-sql/pglite'
import { assertNoTransactionControl } from '@/scripts/migrate'
import { MONTHLY_SNAPSHOT_MAX_BYTES } from '@/lib/monthly-report/snapshot'
import { ACCOUNT, CLIENT, MEMBER, reportDatabase, snapshotAtBytes } from './sql-fixture'

/**
 * Forward migration 099: apply the real file onto a historical 65536 CHECK
 * fixture (queried-target drift), then prove the widened 256 KiB ceiling and
 * unchanged non-size predicates. 098 stays untouched on disk.
 */
describe('099 monthly snapshot size CHECK forward migration', () => {
  let pg: PGlite
  const migration099 = readFileSync('supabase/migrations/099_monthly_snapshot_size_check.sql', 'utf8')
  const migration098 = readFileSync('supabase/migrations/098_monthly_client_reports.sql', 'utf8')

  beforeAll(async () => {
    pg = await reportDatabase(65536)
    const { rows: [before] } = await pg.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conname = 'client_report_versions_monthly_shape_check'`)
    expect(before.definition).toContain('<= 65536')
    expect(before.definition).not.toContain('262144')
    await pg.exec(migration099)
  })
  afterAll(async () => { await pg?.close() })

  it('rejects transaction control and keeps the reviewed ALTER/CHECK payload', () => {
    expect(() => assertNoTransactionControl('099_monthly_snapshot_size_check.sql', migration099)).not.toThrow()
    expect(migration099).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/i)
    const executable = migration099
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim()
    const reviewed = readFileSync('/workspace/cli-logs/aiso-cap-correction-next/forward.review.sql', 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim()
    expect(executable).toBe(reviewed)
    expect(migration099).toContain('octet_length(snapshot::text) <= 262144')
    expect(MONTHLY_SNAPSHOT_MAX_BYTES).toBe(262144)
  })

  it('leaves 098 on disk unchanged (still 262144; git reports no diff)', () => {
    expect(migration098.split('octet_length(snapshot::text) <= 262144').length).toBe(2)
    expect(migration098).not.toContain('<= 65536')
    const diff = execFileSync('git', ['diff', '--', 'supabase/migrations/098_monthly_client_reports.sql'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    expect(diff).toBe('')
    const staged = execFileSync('git', ['diff', '--cached', '--', 'supabase/migrations/098_monthly_client_reports.sql'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    })
    expect(staged).toBe('')
  })

  it('queries the post-099 CHECK at 262144, not the historical 65536 fixture', async () => {
    const { rows: [check] } = await pg.query<{ definition: string; convalidated: boolean }>(
      `select pg_get_constraintdef(oid) as definition, convalidated
       from pg_constraint where conname = 'client_report_versions_monthly_shape_check'`)
    expect(check.convalidated).toBe(true)
    expect(check.definition).toContain('<= 262144')
    expect(check.definition).not.toContain('65536')
  })

  it.each([65536, 65537, 131072, 262143, 262144])(
    'accepts exactly %i PostgreSQL JSONB::text bytes after 099', async (bytes) => {
      const snapshot = await snapshotAtBytes(pg, bytes)
      const { rows: [before] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
      await pg.query(`select create_monthly_client_report_with_version(
        $1::uuid, $2::uuid, '2026-10-01', 'en', '099 widened fixture', $3::jsonb, $4::uuid)`,
      [ACCOUNT, CLIENT, JSON.stringify(snapshot), MEMBER])
      const { rows: [stored] } = await pg.query<{ bytes: number }>(
        'select octet_length(snapshot::text) as bytes from client_report_versions')
      expect(stored.bytes).toBe(bytes)
      await pg.exec('truncate client_report_versions, client_reports cascade')
      const { rows: [after] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
      expect(after.count).toBe(before.count)
    })

  it('rejects exactly 262145 PostgreSQL JSONB::text bytes after 099', async () => {
    const snapshot = await snapshotAtBytes(pg, 262145)
    const { rows: [before] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
    await expect(pg.query(`select create_monthly_client_report_with_version(
      $1::uuid, $2::uuid, '2026-10-01', 'en', '099 oversize fixture', $3::jsonb, $4::uuid)`,
    [ACCOUNT, CLIENT, JSON.stringify(snapshot), MEMBER]))
      .rejects.toMatchObject({ code: '23514', constraint: 'client_report_versions_monthly_shape_check' })
    const { rows: [after] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
    expect(after.count).toBe(before.count)
  })

  it('keeps non-size monthly predicates and leaves schema 1 unaffected', async () => {
    const { rows: [report] } = await pg.query<{ id: string }>(
      `insert into client_reports (account_id, client_id) values ($1, $2) returning id`, [ACCOUNT, CLIENT])
    const ins = (
      schema: number | null,
      snapshot: string | null,
      source: string | null,
      previous: string | null,
      n: number,
    ) => pg.query(
      `insert into client_report_versions (
         report_id, account_id, client_id, version_number,
         source_scan_id, previous_scan_id, locale, executive_summary,
         snapshot_schema_version, snapshot)
       values ($1,$2,$3,$4,$5,$6,'en','s',$7,$8::jsonb)`,
      [report.id, ACCOUNT, CLIENT, n, source, previous, schema, snapshot],
    )

    await expect(ins(2, '[]', null, null, 1)).rejects.toMatchObject({
      code: '23514', constraint: 'client_report_versions_monthly_shape_check',
    })
    await expect(ins(2, 'null', null, null, 2)).rejects.toMatchObject({
      code: '23514', constraint: 'client_report_versions_monthly_shape_check',
    })
    // Column is NOT NULL in 027; SQL NULL fails before the monthly CHECK (23502).
    await expect(ins(2, null, null, null, 3)).rejects.toMatchObject({ code: '23502' })
    await expect(ins(2, '{}', '11111111-1111-4111-8111-111111111111', null, 4)).rejects.toMatchObject({
      code: '23514', constraint: 'client_report_versions_monthly_shape_check',
    })
    await expect(ins(2, '{}', null, '11111111-1111-4111-8111-111111111111', 5)).rejects.toMatchObject({
      code: '23514', constraint: 'client_report_versions_monthly_shape_check',
    })
    // Schema 1 bypass: array snapshot with no monthly shape requirements.
    await ins(1, '[]', null, null, 6)
    const { rows: [row] } = await pg.query<{ snapshot_schema_version: number }>(
      'select snapshot_schema_version from client_report_versions where version_number = 6')
    expect(row.snapshot_schema_version).toBe(1)
  })
})
