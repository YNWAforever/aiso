import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { hongKongMonthKey, periodOf, shiftMonth } from '@/lib/brand-month/period'
import { loadDueMonthBrands } from '@/lib/brand-month/queue'
import { recordDueSnapshots } from '@/lib/brand-month/store'

export const dynamic = 'force-dynamic'

/** No brand is started after this, inside vercel.json's 60 s maxDuration. */
const START_CUTOFF_MS = 40_000
const BATCH = 200

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  return secret && secret.length >= 16 ? secret : null
}

/**
 * Retainer OS Slice B (Q4, automatic): records every due month snapshot, this
 * month's opening and last month's closing (3 days after it ends), for each
 * brand whose account has the month record (`client_reports_online`).
 * Vercel Cron's header shape. Idempotent: a recorded snapshot is never
 * rewritten, so extra firings only fill gaps. NOT scheduled by this change:
 * adding it to the cron Worker is a separate, approved schedule change.
 */
export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/brand-months] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const runId = await startCronRun('/api/cron/brand-months')
  const started = Date.now(), now = new Date()
  const current = periodOf(hongKongMonthKey(now))!, previous = periodOf(shiftMonth(current.key, -1))!
  let due = 0, recorded = 0, notEntitled = 0, failed = 0
  try {
    for (const brand of await loadDueMonthBrands(now, BATCH)) {
      if (Date.now() - started >= START_CUTOFF_MS) break
      if (!resolveCommercialEntitlement(brand.account, now).features.client_reports_online) { notEntitled++; continue }
      due++
      try {
        for (const period of [previous, current]) {
          const result = await recordDueSnapshots(brand.accountId, brand.clientId, period, now)
          if (result.state === 'ok') recorded += result.recorded.length
        }
      } catch { failed++ }
    }
  } catch {
    await finishCronRun(runId, 'error', { due, recorded, notEntitled, failed }, 'DEPENDENCY_UNAVAILABLE')
    return Response.json({ error: 'Snapshot run failed' }, { status: 500 })
  }
  // evaluate-alerts' rule: work was due and none of it succeeded.
  const allFailed = due > 0 && failed === due
  await finishCronRun(runId, allFailed ? 'error' : 'ok', { due, recorded, notEntitled, failed })
  return Response.json({ due, recorded, notEntitled, failed }, { status: allFailed ? 502 : 200 })
}
