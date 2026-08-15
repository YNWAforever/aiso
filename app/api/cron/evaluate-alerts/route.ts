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

  return Response.json(await evaluateAlerts())
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

  return Response.json(await evaluateAlerts())
}
