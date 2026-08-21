import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

import { createNeonAlertStore } from '@/lib/alerts/neon-store'

const sql = neon(process.env.TEST_DATABASE_URL!)

const CLIENT = '77777777-7777-7777-7777-777777777777'
const ACCOUNT = '88888888-8888-8888-8888-888888888888'

/**
 * The unit suite hand-builds the snapshot, so it can prove the evaluator skips
 * a stale week but not that `loadCurrentScanWeek` produces the same string
 * `computeWeeklySummary` writes into `scan_week`. A one-day disagreement
 * between those two -- a timezone, a `toISOString()`, a `::date` cast -- would
 * make EVERY client look stale forever, and no mocked test can see it.
 */
async function seed() {
  await sql`delete from alert_configs where client_id = ${CLIENT}`
  await sql`delete from pulse_weekly_summary where client_id = ${CLIENT}`
  await sql`delete from clients where id = ${CLIENT}`
  await sql`delete from accounts where id = ${ACCOUNT}`
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}, 'pro', 'active')`
  await sql`
    insert into clients (id, account_id, brand_name, status, competitors)
    values (${CLIENT}, ${ACCOUNT}, 'Stale Co', 'active', ${[]}::text[])
  `
  await sql`
    insert into alert_configs
      (client_id, enabled_sov, sov_threshold, enabled_wow, wow_threshold, notify_email, notify_inapp)
    values (${CLIENT}, true, 50, true, 10, false, true)
  `
}

describe('alert snapshot staleness', () => {
  beforeEach(seed)

  it('reports the same week string that the rollup writes', async () => {
    await sql`
      insert into pulse_weekly_summary (client_id, scan_week, platform, sov_score)
      values (${CLIENT}, date_trunc('week', now())::date, null, 40)
    `

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.currentScanWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snapshot.weeksByClient[CLIENT][0].scan_week).toBe(snapshot.currentScanWeek)
  })

  it('marks a client whose newest aggregate week is last week', async () => {
    await sql`
      insert into pulse_weekly_summary (client_id, scan_week, platform, sov_score)
      values (${CLIENT}, (date_trunc('week', now()) - interval '7 days')::date, null, 40)
    `

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.weeksByClient[CLIENT][0].scan_week).not.toBe(snapshot.currentScanWeek)
  })
})
