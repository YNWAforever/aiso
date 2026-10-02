import 'server-only'
import { db } from '@/lib/db'
import { currentScanWeek,selectPendingClientPage,type CandidateCursor } from '@/lib/pulse/schedule'
import { modelVariantsFor } from '@/lib/openrouter'
import { computeWeeklySummary } from '@/lib/pulse/summary'
import { claimDueItems,commitAttempt,createOrResumeRun,readRunCoverage } from './store'
import { processLeasedItem } from './service'
import { hasDueItems,listPendingRunPage,readPulseTarget,unblockConfiguredItems,type DueRun } from './queue'
import type { LeasedItem,RunCoverage } from './schema'
import type { WeeklyEnqueue } from './dispatch'

export type PulseWorkerPorts={
  now:()=>number
  initialize:(deadlineAt:number,enqueue?:WeeklyEnqueue)=>Promise<{runs:DueRun[];exhausted:boolean;failures:number;enqueue?:WeeklyEnqueue}>
  page:(after:string|null)=>Promise<{runs:DueRun[];cursor:string|null;exhausted:boolean}>
  unblock:(run:DueRun)=>Promise<void>
  claim:(run:DueRun,owner:string,deadlineAt:number)=>Promise<LeasedItem[]>
  process:(item:LeasedItem,deadlineAt:number)=>Promise<string>
  block:(item:LeasedItem)=>Promise<string>
  coverage:(run:DueRun)=>Promise<RunCoverage>
  summarize:(run:DueRun)=>Promise<unknown>
  due:(run:DueRun)=>Promise<boolean>
}
async function initializeWeekly(deadlineAt:number,enqueue?:WeeklyEnqueue){
  const scanWeek=enqueue?.scanWeek??currentScanWeek()
  let after:CandidateCursor|null=enqueue?.after??null,exhausted=false,failures=0
  const failedClientIds:string[]=[]
  const runs:DueRun[]=[]
  const prepare=async(clientId:string)=>{
    try{
      const target=await readPulseTarget(clientId)
      if(!target?.allowedPlatforms.length)return
      const run=await createOrResumeRun(target,{scanWeek,manifest:modelVariantsFor(target.allowedPlatforms)})
      if(run)runs.push({...target,id:run.id,scanWeek:run.scanWeek})
    }catch{failures++;failedClientIds.push(clientId)}
  }
  for(const clientId of enqueue?.failedClientIds??[]){
    if(Date.now()+15_000<deadlineAt)await prepare(clientId)
    else failedClientIds.push(clientId)
  }
  while(Date.now()+15_000<deadlineAt){
    const page=await selectPendingClientPage(db(),{limit:5,after,scanWeek,deadlineMs:deadlineAt-15_000})
    let pageConsumed=true
    for(const candidate of page.items){
      if(Date.now()+15_000>=deadlineAt){pageConsumed=false;break}
      await prepare(candidate.clientId)
    }
    if(!pageConsumed)break
    after=page.nextCursor;exhausted=page.exhausted
    if(exhausted || !after)break
  }
  return {runs,exhausted,failures,enqueue:{scanWeek,after,failedClientIds:[...new Set(failedClientIds)],complete:exhausted&&!failedClientIds.length}}
}
const defaultPorts:PulseWorkerPorts={now:()=>Date.now(),initialize:initializeWeekly,page:listPendingRunPage,unblock:unblockConfiguredItems,
  claim:(run,owner,deadlineAt)=>claimDueItems(run,run.id,{owner,leaseUntil:new Date(deadlineAt),limit:5}),
  process:processLeasedItem,block:item=>commitAttempt(item,{kind:'blocked',errorCode:'PLAN_HAS_NO_PLATFORMS'}),
  coverage:run=>readRunCoverage(run,run.id),summarize:run=>computeWeeklySummary(db(),{clientId:run.clientId,scanWeek:run.scanWeek}),due:hasDueItems}

/** Provider replacement for isolated acceptance; persistence stays real. */
export function pulseWorkerPorts():PulseWorkerPorts{return {...defaultPorts}}

export async function consumeDuePulseWork(options:{deadlineAt:number;owner:string;mode:'weekly'|'repair';afterRunId?:string|null;enqueue?:WeeklyEnqueue},ports:PulseWorkerPorts=defaultPorts){
  if(!options.owner || options.deadlineAt<=ports.now())throw new Error('Invalid worker budget')
  let processed=0,remaining=0,failed=0,blocked=0,errors=0,hasDue=false,traversalComplete=true
  const seen=new Set<string>(),coverages:Record<string,RunCoverage>={}
  let seededRuns:DueRun[]=[],enqueue=options.enqueue
  if(options.mode==='weekly'||enqueue){
    const seeded=await ports.initialize(options.deadlineAt,enqueue)
    seededRuns=seeded.runs;errors+=seeded.failures;traversalComplete=seeded.exhausted&&(seeded.enqueue?.complete??true);enqueue=seeded.enqueue
  }
  let after:string|null=options.afterRunId??null,runTraversalComplete=false
  const processRun=async(run:DueRun)=>{
    if(seen.has(run.id))return
    seen.add(run.id)
    try{
      await ports.unblock(run)
      while(ports.now()+10_000<options.deadlineAt){
        const items=await ports.claim(run,options.owner,options.deadlineAt)
        if(!items.length)break
        const allowed=new Set(modelVariantsFor(run.allowedPlatforms).map(v=>v.model))
        const outcomes=await Promise.allSettled(items.map(item=>allowed.has(item.model)?ports.process(item,options.deadlineAt):ports.block(item)))
        processed+=outcomes.filter(r=>r.status==='fulfilled' && r.value==='committed').length
        if(outcomes.some(r=>r.status==='rejected')){errors++;break}
      }
      const coverage=await ports.coverage(run)
      coverages[run.id]=coverage;remaining+=coverage.pending;failed+=coverage.failed;blocked+=coverage.blocked
      if(coverage.status==='completed')await ports.summarize(run)
      hasDue=await ports.due(run)||hasDue
    }catch{errors++;hasDue=true}
  }
  // Stream inventory pages. Never keep reading every unseen run after the
  // deadline; the persisted rotation cursor gives the next brand a turn.
  for(const run of seededRuns){
    if(ports.now()+10_000>=options.deadlineAt)break
    await processRun(run)
  }
  while(ports.now()+10_000<options.deadlineAt){
    const page=await ports.page(after)
    let consumed=true
    for(const run of page.runs){
      if(ports.now()+10_000>=options.deadlineAt){consumed=false;break}
      await processRun(run);after=run.id
    }
    if(!consumed)break
    if(page.exhausted){runTraversalComplete=true;after=null;break}
    after=page.cursor
    if(!after)break
  }
  traversalComplete=traversalComplete&&runTraversalComplete
  const outcome: 'complete'|'partial'|'failed'|'blocked' = errors||remaining||!traversalComplete?'partial':failed?'failed':blocked?'blocked':'complete'
  return {outcome,processed,remaining,failed,blocked,errors,runIds:[...seen],coverage:coverages,
    hasDue:hasDue||!traversalComplete,mode:options.mode,empty:seen.size===0,traversalComplete,nextRunCursor:after,enqueue}
}
