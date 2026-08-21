/**
 * Two entry points, deliberately.
 *
 *   GET  + `Authorization: Bearer $CRON_SECRET`  <- Vercel Cron, the scheduler
 *   POST + `x-cron-secret`                       <- operators, the smoke checks
 *                                                   in docs/alert-evaluation-release.md
 *
 * Neither shape is ours to choose, and a cron pointed at a POST-only route
 * would 405 forever without ever saying so.
 *
 * Unlike cron/pulse there is no driver hop to a second route. That hop exists
 * because pulse/run is chunked and re-entrant -- one invocation cannot finish a
 * week inside the 60s ceiling, so the driver chains via after(). Alert
 * evaluation is one bounded pass over alert_configs, so an internal fetch would
 * only add failure modes: origin resolution, an extra invocation, another
 * error path to interpret.
 */
import {
  runAlertEvaluation,
  type AlertEvaluationPorts,
} from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'
import { db } from '@/lib/db'
import { sendAlertEmail as deliverAlertEmail } from '@/lib/resend'

export const dynamic = 'force-dynamic'

function evaluateAlerts() {
  const ports: AlertEvaluationPorts = {
    ...createNeonAlertStore(db()),
    sendAlertEmail: deliverAlertEmail,
  }
  return runAlertEvaluation(ports)
}

/**
 * A run with any delivery failure must not read as a green cron.
 *
 * `emailFailures` and `notificationFailures` exist specifically to distinguish
 * an outage (migration 035 unapplied, RESEND_API_KEY revoked, migration 033's
 * ON CONFLICT arbiter missing, ...) from a healthy re-run. Vercel Cron surfaces
 * status codes, not response bodies, so a totally failed run that still
 * returns 200 is invisible in the deployment logs -- every Monday shows green
 * while zero alerts go out. One function decides the status for both GET and
 * POST so they cannot drift apart, and it logs which rule tripped before
 * returning 502 -- the same reason applies to the cause, not just the
 * failure: the deployment log has only the status code, never the body.
 *
 * Two non-delivery faults join them, for the same reason:
 *
 *   deferred > 0     the run hit its time budget and stopped. Work remains
 *                    undone and Vercel Cron does not retry, so the next
 *                    attempt is seven days away. `runAlertEvaluation` returns
 *                    the literal 0 for this today -- Task 5 of
 *                    docs/superpowers/plans/2026-08-16-harden-alert-evaluator.md
 *                    adds the producer that gives it a real value, so this
 *                    branch is currently unreachable. Do not go looking for a
 *                    time budget that does not exist yet.
 *
 *   evaluated === 0  the evaluator ran against at least one configured client
 *                    and evaluated none of them.
 *
 * That second rule used to be phrased as "every client stale"
 * (`stale === processed`), which missed the case production is actually in.
 * `runAlertEvaluation`'s `!weeks.length` check runs BEFORE the staleness
 * check, so a client with no `pulse_weekly_summary` rows at all is skipped
 * without being counted in `stale` and without any log line. CLAUDE.md
 * records that the Pulse weekly rollup has never written a row in
 * production, so the first Monday after anyone creates an `alert_config`,
 * the old rule would have stayed 200 while zero clients were ever evaluated
 * -- silent-green in exactly the way this plan exists to close. `evaluated
 * === 0` catches that case, an all-stale run, a mix of the two, and every
 * client having a null latest score alike: anything that leaves the run
 * having assessed nobody's alert policies.
 *
 * Partial staleness -- or any run that evaluated at least one client -- stays
 * 200 deliberately: one client's rollup lagging is a data gap rather than a
 * system fault, and failing the cron for it would train whoever reads these
 * logs to ignore the alarm. That case is reported by the per-client
 * console.warn in runAlertEvaluation.
 */
function evaluationStatus(result: {
  processed: number
  evaluated: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}): number {
  if (result.emailFailures > 0 || result.notificationFailures > 0) {
    console.error(
      `[cron/evaluate-alerts] 502: emailFailures=${result.emailFailures} notificationFailures=${result.notificationFailures}`,
    )
    return 502
  }
  if (result.deferred > 0) {
    console.error(`[cron/evaluate-alerts] 502: deferred=${result.deferred} alert(s) past the time budget`)
    return 502
  }
  if (result.processed > 0 && result.evaluated === 0) {
    console.error(
      `[cron/evaluate-alerts] 502: evaluated 0 of ${result.processed} configured client(s) -- the Pulse rollup likely never landed`,
    )
    return 502
  }
  return 200
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value at both call sites, so an unset var
 * can never make an absent header match -- the pre-fence trial-emails route
 * compared against `Bearer undefined` and would have accepted that literal.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/evaluate-alerts] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await evaluateAlerts()
  return Response.json(result, { status: evaluationStatus(result) })
}

export async function POST(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/evaluate-alerts] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await evaluateAlerts()
  return Response.json(result, { status: evaluationStatus(result) })
}
