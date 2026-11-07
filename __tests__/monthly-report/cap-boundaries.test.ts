import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { MONTHLY_SNAPSHOT_MAX_BYTES, parseMonthlyReportSnapshot } from '@/lib/monthly-report/snapshot'
import { ACCOUNT, CLIENT, MEMBER, reportDatabase, snapshotAtBytes } from './sql-fixture'

describe.each([65536, 262144] as const)('JSONB byte boundary with CHECK <= %i', cap => {
  let pg: PGlite
  beforeAll(async () => { pg = await reportDatabase(cap) })
  afterAll(async () => { await pg?.close() })

  it('queries the actual fixture CHECK rather than assuming its bound', async () => {
    const { rows: [check] } = await pg.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conname = 'client_report_versions_monthly_shape_check'`)
    expect(check.definition).toContain(`<= ${cap}`)
    expect(MONTHLY_SNAPSHOT_MAX_BYTES).toBe(262144)
  })

  it.each([65535, 65536, 65537, 131072, 262143, 262144, 262145])(
    'measures and writes exactly %i PostgreSQL JSONB::text bytes', async bytes => {
      const snapshot = await snapshotAtBytes(pg, bytes)
      expect(parseMonthlyReportSnapshot(snapshot)).not.toBeNull()
      // JSON.stringify is smaller: JSONB inserts spaces, and counts UTF-8, not JS code units.
      expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(bytes)
      const { rows: [before] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
      const write = pg.query(`select create_monthly_client_report_with_version(
        $1::uuid, $2::uuid, '2026-10-01', 'en', 'Boundary fixture', $3::jsonb, $4::uuid)`,
      [ACCOUNT, CLIENT, JSON.stringify(snapshot), MEMBER])
      if (bytes <= cap) {
        await write
        const { rows: [stored] } = await pg.query<{ bytes: number }>(
          'select octet_length(snapshot::text) as bytes from client_report_versions')
        expect(stored.bytes).toBe(bytes)
        await pg.exec('truncate client_report_versions, client_reports cascade')
      } else {
        await expect(write).rejects.toMatchObject({ code: '23514', constraint: 'client_report_versions_monthly_shape_check' })
        const { rows: [after] } = await pg.query<{ count: number }>('select count(*)::int as count from client_reports')
        expect(after.count).toBe(before.count) // Failed RPC must roll back its report insert too.
      }
    })
})
