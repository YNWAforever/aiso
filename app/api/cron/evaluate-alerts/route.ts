import {
  runAlertEvaluation,
  type AlertEvaluationPorts,
} from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'
import { db } from '@/lib/db'
import { sendAlertEmail as deliverAlertEmail } from '@/lib/resend'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('evaluate-alerts: CRON_SECRET env var is not set')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ports: AlertEvaluationPorts = {
    ...createNeonAlertStore(db()),
    sendAlertEmail: deliverAlertEmail,
  }
  const result = await runAlertEvaluation(ports)

  return Response.json(result)
}
