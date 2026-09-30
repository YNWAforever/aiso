import { appOrigin } from '@/lib/app-origin'
import { isFeatureEnabled } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { assertVaultConfigured, openToken, VaultError } from '@/lib/integrations/google/vault'
import { googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'
import { listKeyEvents, listWebStreams, runKeyEventReport } from '@/lib/integrations/analytics/client'
import * as store from '@/lib/integrations/analytics/store'
import { syncAnalyticsBinding } from '@/lib/integrations/analytics/sync'
import type { AnalyticsOutcome } from '@/lib/integrations/analytics/state'
// The Google connection, its sealed secret and its status flip are shared by both
// products, so the token deps are the Search Console store's, as its own cron builds them.
import * as connections from '@/lib/integrations/search-console/store'

export const dynamic = 'force-dynamic'

/**
 * Same two limits, for the same reason, as cron/search-console: inside
 * vercel.json's 60 s maxDuration, no new binding starts after START_CUTOFF_MS,
 * and a binding already running stops starting Google calls at SYNC_DEADLINE_MS
 * and records `deferred`. The worst case is one Google call begun just before the
 * deadline running its full 10 s timeout, ending near 55 s.
 */
const START_CUTOFF_MS = 40_000
const SYNC_DEADLINE_MS = 45_000
const BATCH = 10
/**
 * Deliberate skips are not failures of this run: the owner has something to fix
 * (or a plan to upgrade) and retrying changes nothing. `deferred` is NOT one: the
 * brand was due and did not finish, so it counts toward the 502 rule.
 */
const SKIPS: ReadonlySet<AnalyticsOutcome> = new Set([
  'not_entitled', 'domain_mismatch', 'scope_missing', 'events_missing',
])

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value, so an unset var can never make an
 * absent header match. Same idiom as cron/trial-emails.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  return secret && secret.length >= 16 ? secret : null
}

/**
 * Never log error.message or the error object: the Neon driver can echo the full
 * connection string, password included, into some of its own error messages.
 * Only the error's name is ever logged or recorded.
 */
const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error)

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/analytics] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isFeatureEnabled('analytics')) return Response.json({ skipped: 'flag_off' })

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[cron/analytics] vault misconfigured', { code: error.code })
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error('[cron/analytics] Google OAuth is not configured')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const runId = await startCronRun('/api/cron/analytics')
  const started = Date.now()
  const outcomes: Partial<Record<AnalyticsOutcome, number>> = {}
  let due = 0
  try {
    const deadline = started + SYNC_DEADLINE_MS
    // A binding whose sync threw before its ledger row was written is still due,
    // so the next batch would return it first; each is attempted once per run.
    const attempted = new Set<string>()
    while (Date.now() - started < START_CUTOFF_MS) {
      const batch = (await store.loadDueAnalyticsBindings(BATCH))
        .filter(b => !attempted.has(`${b.accountId}:${b.clientId}`))
      if (!batch.length) break
      for (const binding of batch) {
        if (Date.now() - started >= START_CUTOFF_MS) break
        attempted.add(`${binding.accountId}:${binding.clientId}`)
        let outcome: AnalyticsOutcome
        try {
          outcome = await syncAnalyticsBinding(binding, {
            loadSecret: connections.loadConnectionSecret,
            open: (sealed, accountId) => openToken(sealed, { accountId }),
            refresh: token => refreshAccessToken(cfg, token),
            markConnection: connections.markConnection,
            getStream: (token, propertyId, streamId) =>
              listWebStreams(token, propertyId).then(list => list.find(s => s.streamId === streamId) ?? null),
            listKeyEvents,
            report: runKeyEventReport,
            replaceDailyWindow: store.replaceDailyWindow,
            recordRun: store.recordAnalyticsRun,
            today: () => new Date().toISOString().slice(0, 10),
            deadline,
          })
        } catch (error) {
          // syncAnalyticsBinding lets a failed ledger write propagate. One brand's
          // failure must not abort the loop, or every brand behind it starves.
          console.error('[cron/analytics] binding failed', { clientId: binding.clientId, name: errorName(error) })
          outcome = 'internal_error'
        }
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        if (!SKIPS.has(outcome)) due++
      }
    }
  } catch (error) {
    // Only reachable from loading the due bindings (or the clock): a per-binding
    // failure is handled above. Only the name is logged and recorded.
    const name = errorName(error)
    await finishCronRun(runId, 'error', { outcomes }, name)
    console.error('[cron/analytics] run failed', { name })
    return Response.json({ error: 'Sync failed', outcomes }, { status: 500 })
  }

  // evaluate-alerts' rule: work was due and none of it succeeded.
  const failed = due > 0 && !outcomes.ok
  await finishCronRun(runId, failed ? 'error' : 'ok', { outcomes })
  return Response.json({ outcomes }, { status: failed ? 502 : 200 })
}
