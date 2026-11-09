/**
 * Receipt for the brand-months tick: did it run, and did the rows it is
 * supposed to write actually appear?
 *
 * The tick was configured in #180 but not deployed until 2026-11-09, and
 * nothing errored during that time — a cron that is not deployed simply never
 * fires. This script is the counterpart to `npm run worker:schedules`: that one
 * proves the schedule exists, this one proves it did its work.
 *
 * Read-only. Usage:
 *   npm run report:brand-months-receipt
 *   npm run report:brand-months-receipt -- --json
 */
import { neon } from '@neondatabase/serverless'
import { hongKongMonthKey, shiftMonth } from '../lib/brand-month/period.ts'

const ROUTE = '/api/cron/brand-months'

/** What a firing in `now`'s month should have written, and which brands lack each row. */
export function summarize(brands, snapshots, now) {
  const current = hongKongMonthKey(now)
  const previous = shiftMonth(current, -1)
  const expected = [
    { month: current, kind: 'opening', reason: 'this month opened' },
    { month: previous, kind: 'closing', reason: 'last month ended, three days ago' },
  ]
  const present = new Set(snapshots.map(row => `${row.month}|${row.kind}|${row.client_id}`))
  return expected.map(({ month, kind, reason }) => ({
    month, kind, reason,
    brands: brands.map(brand => brand.brand_name),
    missingBrands: brands.filter(brand => !present.has(`${month}|${kind}|${brand.client_id}`)).map(brand => brand.brand_name),
    recorded: snapshots.filter(row => row.month === month && row.kind === kind).length,
  }))
}

async function main() {
  const json = process.argv.includes('--json')
  const sql = neon(process.env.DATABASE_URL)
  const brands = (await sql`select id::text as client_id, brand_name from clients where status = 'active' order by brand_name`)
  const snapshots = (await sql`select client_id::text as client_id, month::text as month, kind from brand_month_snapshots order by month desc, kind`)
  const runs = (await sql`select route, status, started_at, finished_at, detail, error from cron_runs where route = ${ROUTE} order by started_at desc limit 5`)
  const output = { route: ROUTE, runs, expected: summarize(brands, snapshots, new Date()), snapshotRows: snapshots.length }

  if (json) { console.log(JSON.stringify(output, null, 1)); return }
  console.log(`brand-months tick receipt for ${ROUTE}`)
  console.log(`firings recorded: ${runs.length}`)
  for (const run of runs) {
    console.log(`  ${run.started_at?.toISOString?.() ?? run.started_at} -> ${run.status ?? 'unfinished'} ${JSON.stringify(run.detail ?? {})}${run.error ? ` error=${run.error}` : ''}`)
  }
  console.log(`snapshot rows: ${snapshots.length}`)
  for (const entry of output.expected) {
    console.log(`  ${entry.month} ${entry.kind} (${entry.reason}): ${entry.recorded} of ${entry.brands.length} brand(s) have a row`)
    // Only brands whose account has client_reports_online are written; the rest are expected to be absent.
    if (entry.missingBrands.length) console.log(`    no row yet: ${entry.missingBrands.join(', ')} (only online-report plans are recorded)`)
  }
  if (!snapshots.length && !runs.length) {
    console.log('\nNo firing has ever done anything. Check `npm run worker:schedules` (is the tick deployed?)')
    console.log('and wait for the next 17 16 * * * UTC firing (00:17 HKT), then run this again.')
  }
}

if (process.argv[1] && process.argv[1].endsWith('brand-months-receipt.mjs')) {
  main().catch(error => { console.error(`brand-months receipt: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1 })
}
