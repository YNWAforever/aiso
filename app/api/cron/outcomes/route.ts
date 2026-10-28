import { isFeatureEnabled } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { runOutcomeEvaluations } from '@/lib/outcome-integrations/evaluate'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return Response.json({ error: 'CRON_MISCONFIGURED' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (!isFeatureEnabled('outcome_integrations')) return Response.json({ skipped: 'flag_off' })
  const runId = await startCronRun('/api/cron/outcomes')
  try {
    const result = await runOutcomeEvaluations()
    await finishCronRun(runId, result.deferred ? 'error' : 'ok', result)
    return Response.json(result, { status: result.deferred ? 502 : 200 })
  } catch {
    await finishCronRun(runId, 'error', {}, 'OUTCOME_EVALUATION_UNAVAILABLE')
    return Response.json({ error: 'OUTCOME_EVALUATION_UNAVAILABLE' }, { status: 503 })
  }
}
