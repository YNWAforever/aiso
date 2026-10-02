import 'server-only'
import { callOpenRouterWithEvidence, modelVariantsFor } from '@/lib/openrouter'
import { analyseAnswer } from '@/lib/pulse/analysis'
import { computeWeeklySummary } from '@/lib/pulse/summary'
import { db } from '@/lib/db'
import { claimDueItems, commitAttempt, createOrResumeRun, readRunCoverage, recordClassification } from './store'
import type { LeasedItem, ProviderEvidence, PulseScope } from './schema'

export type CollectAnswer = (item: LeasedItem, signal: AbortSignal) => Promise<ProviderEvidence>
const collect: CollectAnswer = (item, signal) => callOpenRouterWithEvidence({ label:'pulse.platform',model:item.model,
  messages:[{role:'user',content:item.snapshot.question}],maxTokens:500,signal })

export async function processLeasedItem(item: LeasedItem, deadlineAt: number, collector: CollectAnswer = collect) {
  let evidence: ProviderEvidence
  if (!process.env.OPENROUTER_API_KEY && collector === collect) {
    return await commitAttempt(item,{kind:'blocked',errorCode:'PROVIDER_NOT_CONFIGURED'})
  }
  const remaining = deadlineAt - Date.now() - 5_000
  if (remaining <= 0) return await commitAttempt(item,{kind:'failed',errorCode:'TIME_BUDGET_EXHAUSTED'})
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(new DOMException('Provider deadline','TimeoutError')),Math.min(30_000,remaining))
  let abort:()=>void=()=>{}
  try {
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true})})
    evidence = await Promise.race([collector(item,controller.signal),cancelled])
  } catch (error) {
    const timeout = error instanceof Error && /timeout|abort/i.test(error.name)
    return await commitAttempt(item,{kind:'failed',errorCode:timeout ? 'PROVIDER_TIMEOUT_OUTCOME_UNKNOWN' : 'PROVIDER_FAILED_OUTCOME_UNKNOWN'})
  } finally {
    clearTimeout(timer);controller.signal.removeEventListener('abort',abort)
  }
  const committed = await commitAttempt(item,{kind:'succeeded',evidence})
  if (committed !== 'committed') return committed
  try {
    if (Date.now() + 16_000 < deadlineAt) {
      const result = await analyseAnswer({answer:evidence.answer,brandName:item.brand.name,competitors:item.brand.competitors})
      await recordClassification(item,{...result,status:'legacy_unknown',method:'legacy-analysis',version:'pre-T08'})
    }
  } catch { /* Raw evidence survives unavailable classification. */ }
  return committed
}

export async function runPulseChunk(scope: PulseScope, options: { scanWeek:string; platforms:string[]; limit:number; deadlineAt:number }, collector?: CollectAnswer) {
  const run = await createOrResumeRun(scope,{scanWeek:options.scanWeek,manifest:modelVariantsFor(options.platforms)})
  if (!run) throw new Error('Run scope unavailable')
  const items = await claimDueItems(scope,run.id,{owner:`http:${crypto.randomUUID()}`,leaseUntil:new Date(options.deadlineAt),limit:Math.min(5,Math.max(1,options.limit))})
  const results = await Promise.allSettled(items.map(item => processLeasedItem(item,options.deadlineAt,collector)))
  const coverage = await readRunCoverage(scope,run.id)
  let summary = null
  if (coverage.status === 'completed') summary = await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:run.scanWeek})
  return { pulseRunId:run.id,scanWeek:run.scanWeek,coverage,processed:results.filter(r => r.status === 'fulfilled' && r.value === 'committed').length,
    nextCursor:coverage.pending > 0 ? 0 : null,citations:0,platforms:options.platforms.length,summary,
    outcome:results.some(r => r.status === 'rejected') ? 'partial' : coverage.status }
}
