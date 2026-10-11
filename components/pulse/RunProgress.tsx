'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import type {readUserPulseOptions,UserPulseRun} from '@/lib/pulse/runs/user-dispatch'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
type Options=Awaited<ReturnType<typeof readUserPulseOptions>>
export function RunProgress({clientId,lang}:{clientId:string;lang:string}){
 const copy=(lang==='zh-HK'?zh:en).runProgress,endpoint=`/api/dashboard/clients/${encodeURIComponent(clientId)}/pulse-runs`,base=`/${lang}/dashboard/${encodeURIComponent(clientId)}`
 const [options,setOptions]=useState<Options|null>(null),[run,setRun]=useState<UserPulseRun|null>(null),[error,setError]=useState<string|null>(null),[repairOutcome,setRepairOutcome]=useState<{classified:number;unchanged:number;failed:number}|null>(null),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
 const inFlight=useRef(false)
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>|undefined,delay=2000
  const controller=new AbortController()
  async function poll(){
   try{const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('unavailable');const next=await response.json() as Options;if(!active)return;setOptions(next);setRun(next.latest);setError(null)
    const coverage=next.latest?.coverage
    if(coverage&&next.latest?.retryable&&(coverage.pending>0||coverage.classified<coverage.succeeded)){timer=setTimeout(poll,delay);delay=Math.min(30000,Math.round(delay*1.7))}
   }catch{if(active)setError(copy.unavailable)}
  }
  void poll()
  return()=>{active=false;controller.abort();clearTimeout(timer)}
 },[endpoint,copy.unavailable,revision])
 async function start(kind:'initial'|'repair'|'retest'){
  if(inFlight.current||!options)return
  inFlight.current=true;setBusy(true);setError(null)
  const sourceRunId=kind==='initial'?undefined:run?.id
  const storageKey=`aiso:pulse:${clientId}:${kind}:${sourceRunId??options.week}`
  let intentKey:string
  try{intentKey=localStorage.getItem(storageKey)??crypto.randomUUID();localStorage.setItem(storageKey,intentKey)}catch{intentKey=`${kind}:${sourceRunId??options.week}:${clientId}`}
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,intentKey,...(sourceRunId?{sourceRunId}:{})})});const result=await response.json();if(!response.ok){setError(copy.errors[result.error as keyof typeof copy.errors]??copy.unavailable);return}setRun(result.run);setRevision(value=>value+1)}catch{setError(copy.unavailable)}finally{inFlight.current=false;setBusy(false)}
 }
 async function repairLegacy(){
  if(inFlight.current||!options?.legacyObservationIds.length)return
  inFlight.current=true;setBusy(true);setError(null)
  const key='aiso:pulse:legacy:'+clientId+':'+options.legacyObservationIds.join(',')
  let intentKey:string
  try{intentKey=localStorage.getItem(key)??crypto.randomUUID();localStorage.setItem(key,intentKey)}catch{intentKey='legacy:'+clientId+':'+options.week}
  try{const response=await fetch(endpoint+'/legacy-repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observationIds:options.legacyObservationIds,intentKey})});const result=await response.json();if(!response.ok)throw new Error('unavailable');setRepairOutcome(result);try{localStorage.removeItem(key)}catch{}setRevision(value=>value+1)}catch{setError(copy.unavailable)}finally{inFlight.current=false;setBusy(false)}
 }
 const fill=(text:string,values:Record<string,number|string>)=>Object.entries(values).reduce((s,[key,value])=>s.replace(`{${key}}`,String(value)),text)
 const button='inline-flex min-h-11 items-center rounded-lg border border-dash-border px-4 py-2 font-semibold disabled:opacity-50'
 return<section id="first-monitoring" className="my-6 space-y-3 rounded-xl border border-dash-border p-5" aria-busy={busy}>
  <h2 className="text-xl font-bold">{copy.title}</h2>
  {error&&<p role="alert">{error}</p>}
  {repairOutcome&&<p role="status">{fill(copy.repairOutcome,repairOutcome)}</p>}
  {!options&&!error&&<p role="status">{copy.loading}</p>}
  {options&&<>
   <p>{fill(copy.workload,{prompts:options.prompts,variants:options.variants,expected:options.expected})}</p>
   <p>{fill(copy.budget,{remaining:options.remaining})}</p><p className="text-sm">{copy.cost}</p>
   <p className="text-sm">{fill(copy.search,{requested:options.search.requested==='off'?(lang==='zh-HK'?'關閉':'off'):(lang==='zh-HK'?'視可用額度而定':'subject to allowance')})}</p>
   <p className="text-sm">{copy.schedule}</p>
   {(!options.prompts||!options.contextConfirmed)&&<Link className={button} href={`${base}/prompts`}>{copy.setup}</Link>}
   {!options.enabled&&<p>{copy.disabled}</p>}
   {options.legacyCurrentWeek&&!run&&<p>{copy.legacy} <Link className="underline" href={`${base}/observations?result=incomplete`}>{copy.legacyLink}</Link></p>}
   {run&&<div aria-live="polite"><p>{run.purpose==='retest'?copy.retestScope:copy.canonicalScope} · {run.week}</p><p className="font-semibold">{copy.states[run.coverage.status]}</p><p>{fill(copy.collected,{collected:run.coverage.succeeded,expected:run.coverage.expected})}</p><p>{fill(copy.classified,{classified:run.coverage.classified,collected:run.coverage.succeeded})}</p>{run.reasons.map(reason=><p key={reason}>{copy.reasons[reason as keyof typeof copy.reasons]??copy.unavailable}</p>)}<Link className="inline-flex min-h-11 items-center underline" href={`${base}/observations?run=${encodeURIComponent(run.id)}&week=${run.week}`}>{copy.results}</Link></div>}
   <div className="flex flex-wrap gap-3">
    {!!options.legacyObservationIds.length&&<button className={button} disabled={busy||!options.enabled} onClick={repairLegacy}>{copy.repairLegacy}</button>}
    {!run&&!options.legacyCurrentWeek&&<button className={button} disabled={busy||!options.enabled||!options.prompts||!options.contextConfirmed} onClick={()=>start('initial')}>{copy.start}</button>}
    {run?.retryable&&<button className={button} disabled={busy||!options.enabled} onClick={()=>start('repair')}>{copy.repair}</button>}
    {run?.coverage.status==='completed'&&<button className={button} disabled={busy||!options.enabled||!options.contextConfirmed} onClick={()=>start('retest')}>{copy.retest}</button>}
   </div>
  </>}
 </section>
}
