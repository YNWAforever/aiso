import { beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'

vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Single-use claim intents, against real Postgres (AC-03).
 *
 * The unit suite can prove the query was built and that an empty result reads
 * as a replay. It cannot prove the thing that actually matters: that two
 * presentations of the same cookie arriving together cannot both win. That is
 * a property of the primary key under concurrency, so only a database can
 * refute it — the same argument webhook-provisioning-race.test.ts makes.
 *
 * Fixtures are keyed to this file; setup.ts shares one branch across the run.
 */

const ATTEMPT = 'b1000000-0000-4000-8000-000000000001'
const SCAN = 'b1000000-0000-4000-8000-000000000002'
const CONCURRENCY = 10

beforeEach(async () => {
  await sql`delete from scan_claim_attempts where attempt_id = ${ATTEMPT}::uuid`
})

describe('consumeScanClaimAttempt', () => {
  it('spends the attempt once, and reports the second use as a replay', async () => {
    const { consumeScanClaimAttempt } = await import('@/lib/security/scan-claim-attempt')

    await expect(consumeScanClaimAttempt(ATTEMPT, SCAN)).resolves.toBe('consumed')
    await expect(consumeScanClaimAttempt(ATTEMPT, SCAN)).resolves.toBe('replayed')

    const rows = (await sql`
      select scan_id from scan_claim_attempts where attempt_id = ${ATTEMPT}::uuid
    `) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].scan_id).toBe(SCAN)
  })

  /**
   * The race the design exists to close. A select-then-insert would let both
   * of two simultaneous presentations observe "not yet consumed" and both
   * proceed; `on conflict do nothing returning` cannot, because the unique
   * index decides inside one statement.
   */
  it('lets exactly one of many simultaneous presentations win', async () => {
    const { consumeScanClaimAttempt } = await import('@/lib/security/scan-claim-attempt')

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => consumeScanClaimAttempt(ATTEMPT, SCAN)),
    )

    expect(results.filter(result => result === 'consumed')).toHaveLength(1)
    expect(results.filter(result => result === 'replayed')).toHaveLength(CONCURRENCY - 1)
  })

  it('never writes for a malformed id, so a bad token cannot fill the table', async () => {
    const { consumeScanClaimAttempt } = await import('@/lib/security/scan-claim-attempt')

    await expect(consumeScanClaimAttempt('not-a-uuid', SCAN)).resolves.toBe('invalid')

    const rows = await sql`select 1 from scan_claim_attempts where scan_id = ${SCAN}::uuid`
    expect(rows).toHaveLength(0)
  })
})

describe('migration 052 posture', () => {
  /**
   * A role that could delete a consumed attempt could replay the claim it
   * guards, so the app role gets SELECT and INSERT and nothing else. 037
   * grants full DML on every new table by default, which is why 052 states
   * the denial explicitly and why it is worth asserting.
   */
  it('gives the app role no way to erase a spent attempt', async () => {
    const rows = (await sql`
      select privilege_type from information_schema.role_table_grants
      where grantee = 'aeo_app' and table_name = 'scan_claim_attempts'
      order by privilege_type
    `) as Array<{ privilege_type: string }>

    expect(rows.map(row => row.privilege_type)).toEqual(['INSERT', 'SELECT'])
  })
})
