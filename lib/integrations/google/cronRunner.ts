import { appOrigin } from '@/lib/app-origin'
import { isFeatureEnabled, type FeatureFlag } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { assertVaultConfigured, VaultError } from './vault'
import { googleOAuthConfig, type GoogleOAuthConfig } from './oauth'

/**
 * The daily Google sync cron, shared by Search Console and Analytics: the guards,
 * the batch loop and its time limits, the 502 rule and the ledger row. Each route
 * supplies only what differs: which flag, which bindings, and how one is synced.
 * A 2xx means every attempted brand's ledger row was written. A sync rejects only
 * when that write itself failed, so such a brand is counted `ledger_write_failed`
 * and the loop carries on (one brand's failure must not starve the brands behind
 * it), but the run then ends 500 `{ error: 'Sync failed', outcomes }` and is
 * recorded as an error. `ledger_write_failed` is a counter in this response and
 * in cron_runs' detail only: it is in neither ledger's outcome vocabulary, and no
 * row anywhere carries it.
 *
 *
 * Two limits inside vercel.json's 60 s maxDuration. No new binding is started
 * after START_CUTOFF_MS; a binding already running stops starting Google calls at
 * SYNC_DEADLINE_MS and records `deferred`. The worst case is one Google call begun
 * just before the deadline running its full 10 s timeout, ending near 55 s, so the
 * run always writes its ledger row and finishes.
 */
export const START_CUTOFF_MS = 40_000
export const SYNC_DEADLINE_MS = 45_000
const BATCH = 10
/** The response counter for a brand whose sync rejected: its ledger row was never written. */
export const LEDGER_WRITE_FAILED = 'ledger_write_failed'


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

export type GoogleCronSpec<B extends { accountId: string; clientId: string }, O extends string> = {
  /** The route's path, e.g. `/api/cron/analytics`: the ledger key, and (minus `/api/`) the log tag. */
  route: string
  flag: FeatureFlag
  /** Account-blind by design: the cron has no session. */
  loadDue(limit: number): Promise<B[]>
  sync(binding: B, cfg: GoogleOAuthConfig, deadline: number): Promise<O>
  /**
   * Deliberate skips are not failures of this run: the owner has something to fix
   * (or a plan to upgrade) and retrying changes nothing. `deferred` is NOT one: the
   * brand was due and did not finish, so it counts toward the 502 rule.
   */
  skips: ReadonlySet<O>
}

export async function runGoogleCron<B extends { accountId: string; clientId: string }, O extends string>(
  req: Request,
  spec: GoogleCronSpec<B, O>,
): Promise<Response> {
  const tag = `[${spec.route.replace(/^\/api\//, '')}]`
  const secret = cronSecret()
  if (!secret) {
    console.error(`${tag} CRON_SECRET is unset or shorter than 16 characters`)
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isFeatureEnabled(spec.flag)) return Response.json({ skipped: 'flag_off' })

  try {
    assertVaultConfigured()
  } catch (error) {
    if (!(error instanceof VaultError)) throw error
    console.error(`${tag} vault misconfigured`, { code: error.code })
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const cfg = googleOAuthConfig(process.env, appOrigin())
  if (!cfg) {
    console.error(`${tag} Google OAuth is not configured`)
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const runId = await startCronRun(spec.route)
  const started = Date.now()
  const outcomes: Partial<Record<O | typeof LEDGER_WRITE_FAILED, number>> = {}
  let due = 0
  let ledgerWriteFailed = 0
  try {
    const deadline = started + SYNC_DEADLINE_MS
    // A binding whose sync threw before its ledger row was written is still due,
    // so the next batch would return it first; each is attempted once per run.
    const attempted = new Set<string>()
    while (Date.now() - started < START_CUTOFF_MS) {
      const batch = (await spec.loadDue(BATCH)).filter(b => !attempted.has(`${b.accountId}:${b.clientId}`))
      if (!batch.length) break
      for (const binding of batch) {
        if (Date.now() - started >= START_CUTOFF_MS) break
        attempted.add(`${binding.accountId}:${binding.clientId}`)
        let outcome: O
        try {
          outcome = await spec.sync(binding, cfg, deadline)
        } catch (error) {
          // A sync only rejects when its own ledger write fails. One brand's
          // failure must not abort the loop, or every brand behind it starves;
          // but it is not internal_error either, which is a row that WAS written.
          console.error(`${tag} ledger write failed`, { clientId: binding.clientId, name: errorName(error) })
          outcomes[LEDGER_WRITE_FAILED] = (outcomes[LEDGER_WRITE_FAILED] ?? 0) + 1
          ledgerWriteFailed++
          due++
          continue
        }
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        if (!spec.skips.has(outcome)) due++
      }
    }
  } catch (error) {
    // Only reachable from loading the due bindings (or the clock): a per-binding
    // failure is handled above. Only the name is logged and recorded.
    const name = errorName(error)
    await finishCronRun(runId, 'error', { outcomes }, name)
    console.error(`${tag} run failed`, { name })
    return Response.json({ error: 'Sync failed', outcomes }, { status: 500 })
  }

  // A brand whose run left no ledger row: a 2xx would say the writes happened.
  if (ledgerWriteFailed > 0) {
    await finishCronRun(runId, 'error', { outcomes }, LEDGER_WRITE_FAILED)
    console.error(`${tag} run finished with lost ledger writes`, { count: ledgerWriteFailed })
    return Response.json({ error: 'Sync failed', outcomes }, { status: 500 })
  }

  // evaluate-alerts' rule: work was due and none of it succeeded.
  const failed = due > 0 && !(outcomes as Record<string, number>).ok
  await finishCronRun(runId, failed ? 'error' : 'ok', { outcomes })
  return Response.json({ outcomes }, { status: failed ? 502 : 200 })
}
