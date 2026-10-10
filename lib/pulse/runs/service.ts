import 'server-only'
import { callOpenRouterWithEvidence, modelVariantsFor } from '@/lib/openrouter'
import { computeWeeklySummary } from '@/lib/pulse/summary'
import { db } from '@/lib/db'
import { claimDueItems, commitAttempt, createOrResumeRun, readRunCoverage } from './store'
import {classifySavedAnswers} from './classification'
import { readPulseTarget } from './queue'
import type { LeasedItem, ProviderEvidence, PulseScope } from './schema'
import { promptCollectionMessages } from '@/lib/prompts/context'

export type CollectAnswer = (item: LeasedItem, signal: AbortSignal) => Promise<ProviderEvidence>
const collect: CollectAnswer = (item, signal) => callOpenRouterWithEvidence({ label:'pulse.platform',model:item.model,
  messages:promptCollectionMessages(item.snapshot),maxTokens:500,signal })

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
  return committed
}

export async function runPulseChunk(scope: PulseScope, options: { scanWeek:string; platforms:string[]; limit:number; deadlineAt:number }, collector?: CollectAnswer) {
  const target = await readPulseTarget(scope.clientId)
  if (!target || target.accountId !== scope.accountId) throw new Error('Run scope unavailable')
  const platforms = options.platforms.filter(platform => target.allowedPlatforms.includes(platform))
  const manifest = modelVariantsFor(platforms)
  if (!manifest.length) throw new Error('Run scope unavailable')
  const allowedModels = new Set(manifest.map(variant => variant.model))
  const run = await createOrResumeRun(scope,{scanWeek:options.scanWeek,manifest})
  if (!run) throw new Error('Run scope unavailable')
  const items = await claimDueItems(scope,run.id,{owner:`http:${crypto.randomUUID()}`,leaseUntil:new Date(options.deadlineAt),limit:Math.min(5,Math.max(1,options.limit))})
  // Resumed manifests are immutable and can still include a previous plan's models.
  const results = await Promise.allSettled(items.map(item => allowedModels.has(item.model)
    ? processLeasedItem(item,options.deadlineAt,collector)
    : commitAttempt(item,{kind:'blocked',errorCode:'PLAN_HAS_NO_PLATFORMS'})))
  await classifySavedAnswers(scope,run.id,options.deadlineAt)
  const coverage = await readRunCoverage(scope,run.id)
  let summary = null
  if (coverage.status === 'completed') summary = await computeWeeklySummary(db(),{clientId:scope.clientId,scanWeek:run.scanWeek})
  return { pulseRunId:run.id,scanWeek:run.scanWeek,coverage,processed:results.filter(r => r.status === 'fulfilled' && r.value === 'committed').length,
    nextCursor:coverage.pending > 0 ? 0 : null,citations:0,platforms:platforms.length,summary,
    outcome:results.some(r => r.status === 'rejected') || coverage.classified < coverage.succeeded ? 'partial' : coverage.status }
}
