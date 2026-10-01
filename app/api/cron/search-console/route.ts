import { appOrigin } from '@/lib/app-origin'
import { isFeatureEnabled } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { assertVaultConfigured, openToken, VaultError } from '@/lib/integrations/google/vault'
import { googleOAuthConfig, refreshAccessToken } from '@/lib/integrations/google/oauth'
import { querySearchAnalytics } from '@/lib/integrations/search-console/client'
import * as store from '@/lib/integrations/search-console/store'
import { syncBinding } from '@/lib/integrations/search-console/sync'
import type { SyncOutcome } from '@/lib/integrations/search-console/state'

export const dynamic = 'force-dynamic'

/**
 * Two limits inside vercel.json's 60 s maxDuration. No new binding is started
 * after START_CUTOFF_MS; a binding already running stops starting Google calls
 * at SYNC_DEADLINE_MS and records `deferred`. The worst case is one Google call
 * begun just before the deadline running its full 10 s timeout, ending near
 * 55 s — still under 60, so the run always writes its ledger row and finishes.
 */
const START_CUTOFF_MS = 40_000
const SYNC_DEADLINE_MS = 45_000
const BATCH = 10
/**
 * Deliberate skips are not failures of this run. `deferred` is NOT one: the
 * brand was due and did not finish, so it counts toward the 502 rule.
 */
const SKIPS: ReadonlySet<SyncOutcome> = new Set(['not_entitled', 'domain_mismatch'])

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

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/search-console] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isFeatureEnabled('search_console')) return Response.json({ skipped: 'flag_off' })

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error('[cron/search-console] vault misconfigured', { code: error.code })
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error('[cron/search-console] Google OAuth is not configured')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const runId = await startCronRun('/api/cron/search-console')
  const started = Date.now()
  const outcomes: Partial<Record<SyncOutcome, number>> = {}
  let due = 0
  try {
    const deadline = started + SYNC_DEADLINE_MS
    while (Date.now() - started < START_CUTOFF_MS) {
      const batch = await store.loadDueBindings(BATCH)
      if (!batch.length) break
      for (const binding of batch) {
        if (Date.now() - started >= START_CUTOFF_MS) break
        const outcome = await syncBinding(binding, {
          loadSecret: store.loadConnectionSecret,
          open: (sealed, accountId) => openToken(sealed, { accountId }),
          refresh: token => refreshAccessToken(cfg, token),
          query: querySearchAnalytics,
          listPages: store.listSyncPages,
          writeDaily: store.writeDaily,
          writePageQueries: store.writePageQueries,
          markConnection: store.markConnection,
          recordRun: store.recordRun,
          today: () => new Date().toISOString().slice(0, 10),
          deadline,
        })
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        if (!SKIPS.has(outcome)) due++
      }
    }
  } catch (error) {
    // Never log error.message or the error object: the Neon driver can echo
    // the full connection string, password included, into some of its own
    // error messages. Only the error's name is logged, and only that name is
    // passed to finishCronRun's error argument.
    const name = error instanceof Error ? error.name : typeof error
    await finishCronRun(runId, 'error', { outcomes }, name)
    console.error('[cron/search-console] run failed', { name })
    return Response.json({ error: 'Sync failed', outcomes }, { status: 500 })
  }

  // evaluate-alerts' rule: work was due and none of it succeeded.
  const failed = due > 0 && !outcomes.ok
  await finishCronRun(runId, failed ? 'error' : 'ok', { outcomes })
  return Response.json({ outcomes }, { status: failed ? 502 : 200 })
}
