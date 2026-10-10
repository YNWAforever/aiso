import {after,NextResponse} from 'next/server'
import {appOrigin} from '@/lib/app-origin'
import {startCronRun,finishCronRun} from '@/lib/cron/recordRun'
import {currentScanWeek} from '@/lib/pulse/schedule'
import {consumeDuePulseWork} from './worker'
import {readRepairCursor,readWeeklyEnqueue,saveWeeklyEnqueue,type WeeklyEnqueue} from './dispatch'

export async function runLedgerCron(url:URL,secret:string){
  const mode=url.searchParams.get('mode')==='repair'?'repair':'weekly'
  const hop=Number(url.searchParams.get('hop')??0)
  let master:Awaited<ReturnType<typeof readWeeklyEnqueue>>=null
  let cursor:string|null=null
  try{
    if(mode==='repair'||hop>0)master=await readWeeklyEnqueue()
    const supplied=url.searchParams.get('runAfter')
    if(supplied&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(supplied))return NextResponse.json({error:'Invalid run cursor'},{status:400})
    cursor=supplied??(mode==='repair'?await readRepairCursor():null)
  }catch{return NextResponse.json({error:'Dispatch checkpoint unavailable'},{status:503})}
  const initial:WeeklyEnqueue={scanWeek:currentScanWeek(),after:null,failedClientIds:[],complete:false}
  const newIntent=mode==='weekly'&&hop===0
  const runId=await startCronRun('/api/cron/pulse',{mode,...(newIntent?{enqueue:initial}:{})})
  if(!runId)return NextResponse.json({error:'Dispatch intent unavailable'},{status:503})
  if(!Number.isSafeInteger(hop)||hop<0||hop>=200){
    const payload={error:'Chain limit reached',outcome:'partial',done:false,mode,hop,nextRunCursor:cursor}
    await finishCronRun(runId,'error',payload);return NextResponse.json(payload)
  }
  try{
    const result=await consumeDuePulseWork({mode:newIntent?'weekly':'repair',enqueue:newIntent?initial:master?.state,
      deadlineAt:Date.now()+45_000,owner:`cron:${runId}`,afterRunId:cursor})
    if(master&&result.enqueue)await saveWeeklyEnqueue(master.id,master.state,result.enqueue)
    const {enqueue,...safeResult}=result
    const payload={...safeResult,mode,hop,done:result.outcome==='complete',...(newIntent?{enqueue}:{enqueueRootId:master?.id??null})}
    await finishCronRun(runId,result.outcome==='complete'?'ok':'error',payload)
    if(result.hasDue&&hop+1<200){
      const next=new URL('/api/cron/pulse',appOrigin());next.searchParams.set('mode',mode);next.searchParams.set('hop',String(hop+1))
      if(result.nextRunCursor)next.searchParams.set('runAfter',result.nextRunCursor)
      after(async()=>{try{await fetch(next,{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(5_000)})}
        catch{console.error('[cron/pulse] acceleration failed; persisted repair remains due')}})
    }
    return NextResponse.json(payload,{status:result.outcome==='failed'?502:200,headers:{'x-aiso-outcome':result.outcome}})
  }catch{
    const payload={error:'Pulse consumer failed',outcome:'partial',done:false,mode,hop,nextRunCursor:cursor}
    await finishCronRun(runId,'error',payload);return NextResponse.json(payload,{status:503})
  }
}
