import { isFeatureEnabled } from '@/lib/flags'
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'
import { runOutcomeEvaluations } from '@/lib/outcome-integrations/evaluate'
import { runVisibilityRevalidations } from '@/lib/visibility/cron'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return Response.json({ error: 'CRON_MISCONFIGURED' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  const outcomes=isFeatureEnabled('outcome_integrations'),visibility=isFeatureEnabled('closed_loop_visibility')
  if (!outcomes&&!visibility) return Response.json({ skipped: 'flag_off' })
  const runId = await startCronRun('/api/cron/outcomes')
  try {
    const results=await Promise.allSettled([outcomes?runOutcomeEvaluations():Promise.resolve(null),visibility?runVisibilityRevalidations():Promise.resolve(null)])
    const failed=results.some(result=>result.status==='rejected')
    const result={outcomes:results[0].status==='fulfilled'?results[0].value:{error:'AUTOMATION_UNAVAILABLE'},visibility:results[1].status==='fulfilled'?results[1].value:{error:'AUTOMATION_UNAVAILABLE'}}
    const deferred=results.some(result=>result.status==='fulfilled'&&result.value&&result.value.deferred>0)
    await finishCronRun(runId, failed||deferred?'error':'ok', result,failed?'AUTOMATION_UNAVAILABLE':undefined)
    return Response.json(result, { status: failed?503:deferred?502:200 })
  } catch {
    await finishCronRun(runId, 'error', {}, 'AUTOMATION_UNAVAILABLE')
    return Response.json({ error: 'AUTOMATION_UNAVAILABLE' }, { status: 503 })
  }
}
