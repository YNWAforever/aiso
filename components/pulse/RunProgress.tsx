'use client'
import {useEffect,useRef,useState} from 'react'
import Link from 'next/link'
import { monitoringHref, observationsHref } from '@/lib/observations/links'
import {GuidedRunProgress} from '@/components/pulse/GuidedRunProgress'
import {derivePulseAvailability} from '@/lib/pulse/runs/availability'
import type {UserPulseRun} from '@/lib/pulse/runs/user-dispatch'
import {readMonitoringOptions,readMonitoringRun,type MonitoringOptions} from '@/lib/pulse/runs/read-view'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
type Options=MonitoringOptions
type Props = {
 clientId: string; lang: string; smeCopilot?: boolean; brandName?: string; requestedRun?: string
 onCanonicalProgress?: (run: UserPulseRun) => void
}
export function RunProgress(props:Props){return <Progress key={`${props.clientId}:${props.lang}:${props.requestedRun ?? ''}`} {...props}/>}
function Progress({clientId,lang,smeCopilot=false,brandName,requestedRun,onCanonicalProgress}:Props){
 const copy=(lang==='zh-HK'?zh:en).runProgress,endpoint=`/api/dashboard/clients/${encodeURIComponent(clientId)}/pulse-runs`,base=`/${lang}/dashboard/${encodeURIComponent(clientId)}`
 const [options,setOptions]=useState<Options|null>(null),[run,setRun]=useState<UserPulseRun|null>(null),[error,setError]=useState<string|null>(null),[repairOutcome,setRepairOutcome]=useState<{classified:number;unchanged:number;failed:number}|null>(null),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
 const availability=options?derivePulseAvailability({...options,currentCanonicalId:options.currentCanonicalId??null,legacyCurrentWeek:options.legacyCurrentWeek===true}):null
 const inFlight = useRef(false)
 const selectedRun = useRef<string | null>(requestedRun ?? null)
 useEffect(() => {
  let active = true, delay = 2000, watch = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  const requested = requestedRun ?? new URLSearchParams(window.location.search).get('run')
  if (!selectedRun.current && requested && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requested)) {
   selectedRun.current = requested.toLowerCase()
  }
  const schedule = () => {
   timer = setTimeout(poll, delay)
   delay = Math.min(30_000, Math.round(delay * 1.7))
  }
  async function poll() {
   const request = new AbortController()
   controller = request
   const deadline = setTimeout(() => request.abort(), 15_000)
   try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: request.signal })
    if (!response.ok) throw new Error(response.status === 403 ? 'UPGRADE_REQUIRED' : response.status === 401 ? 'UNAUTHORIZED' : 'unavailable')
    const next = readMonitoringOptions(await response.json())
    async function readRun(id: string) {
     if (next.latest?.id === id) return next.latest
     const selected = await fetch(endpoint + '/' + encodeURIComponent(id), { cache: 'no-store', signal: request.signal })
     if (!selected.ok) throw new Error(selected.status === 404 ? 'RUN_NOT_FOUND' : 'unavailable')
     const result = readMonitoringRun(await selected.json())
     if (result.id !== id) throw new Error('unavailable')
     return result
    }
    const target = selectedRun.current ?? (smeCopilot ? next.currentCanonicalId : null)
    const chosen = target ? await readRun(target) : next.latest
    if (!active) return
    setOptions(next)
    setRun(chosen)
    setError(null)
    const stillWorking = (candidate: UserPulseRun | null) => !!candidate && (candidate.coverage.pending > 0
      || (candidate.retryable && candidate.coverage.classified < candidate.coverage.succeeded))
    watch = stillWorking(chosen)
    if (onCanonicalProgress) {
     if (chosen?.purpose === 'canonical') onCanonicalProgress(chosen)
     const canonicalId = next.currentCanonicalId
     if (canonicalId && canonicalId !== chosen?.id) {
      const canonical = await readRun(canonicalId).catch(() => null)
      if (!active) return
      if (canonical?.purpose === 'canonical') {
       onCanonicalProgress(canonical)
       watch ||= stillWorking(canonical)
      }
     }
    }
    if (watch) schedule()
   } catch (error) {
    if (!active) return
    const reason = error instanceof Error ? error.message : ''
    const signIn = reason === 'UNAUTHORIZED', upgrade = reason === 'UPGRADE_REQUIRED', notFound = reason === 'RUN_NOT_FOUND'
    setError(smeCopilot && signIn ? copy.sme.signInRequired : smeCopilot && upgrade ? copy.sme.planRequired
     : notFound && onCanonicalProgress ? copy.sme.runUnavailable : copy.unavailable)
    if (watch && !signIn && !upgrade && !notFound) schedule()
   } finally { clearTimeout(deadline) }
  }
  void poll()
  return () => { active = false; controller?.abort(); clearTimeout(timer) }
 }, [endpoint, copy.unavailable, copy.sme, revision, smeCopilot, requestedRun, onCanonicalProgress])
 async function start(kind:'initial'|'repair'|'retest'){
  if(inFlight.current||error||!options||(kind==='initial'&&!availability?.canStart)||(kind==='retest'&&(!run||!Number.isSafeInteger(run.coverage.expected)||run.coverage.expected<=0||options.remaining<run.coverage.expected||!options.variants)))return
  inFlight.current=true;setBusy(true);setError(null)
  const sourceRunId=kind==='initial'?undefined:run?.id
  const storageKey=`aiso:pulse:${clientId}:${kind}:${sourceRunId??options.week}`
  let intentKey:string
  try{intentKey=localStorage.getItem(storageKey)??crypto.randomUUID();localStorage.setItem(storageKey,intentKey)}catch{intentKey=`${kind}:${sourceRunId??options.week}:${clientId}`}
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,intentKey,...(sourceRunId?{sourceRunId}:{})})});const result=await response.json();if(!response.ok){setError(copy.errors[result.error as keyof typeof copy.errors]??copy.unavailable);return}const accepted=readMonitoringRun(result.run);selectedRun.current=accepted.id;setRun(accepted);setRevision(value=>value+1)}catch{setError(copy.unavailable)}finally{inFlight.current=false;setBusy(false)}
 }
 async function repairLegacy(savedRunId?:string){
  const observationIds=savedRunId?(run?.classificationRepairIds??[]):options?.legacyObservationIds
  if(inFlight.current||error||!observationIds||(!observationIds.length&&(!savedRunId||run?.coverage.status!=='completed')))return
  inFlight.current=true;setBusy(true);setError(null)
  const key='aiso:pulse:classification:'+clientId+':'+(savedRunId??'legacy')+':'+observationIds.join(',')
  let intentKey:string
  try{intentKey=localStorage.getItem(key)??crypto.randomUUID();localStorage.setItem(key,intentKey)}catch{intentKey='repair:'+clientId+':'+(savedRunId??options?.week)}
  try{const response=await fetch(endpoint+'/legacy-repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observationIds,intentKey,...(savedRunId?{runId:savedRunId}:{})})});const result=await response.json();if(!response.ok||![result.classified,result.unchanged,result.failed].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('unavailable');setRepairOutcome(result);if(savedRunId)selectedRun.current=savedRunId;try{localStorage.removeItem(key)}catch{}setRevision(value=>value+1)}catch{setError(copy.unavailable)}finally{inFlight.current=false;setBusy(false)}
 }
 const fill=(text:string,values:Record<string,number|string>)=>Object.entries(values).reduce((s,[key,value])=>s.replace(`{${key}}`,String(value)),text)
 const retestReady=!!run&&Number.isSafeInteger(run.coverage.expected)&&run.coverage.expected>0&&!!options&&options.variants>0&&options.remaining>=run.coverage.expected
 const button='inline-flex min-h-11 items-center rounded-lg border border-dash-border px-4 py-2 font-semibold disabled:opacity-50'
 if(smeCopilot)return <GuidedRunProgress lang={lang} clientId={clientId} brandName={brandName} options={options} run={run} error={error} busy={busy} repairOutcome={repairOutcome} refresh={()=>setRevision(value=>value+1)} start={start} repair={repairLegacy} pinnedRun={!!requestedRun} returnTo={onCanonicalProgress ? monitoringHref(lang, clientId, requestedRun ?? run?.id) : undefined} />
 return<section id="first-monitoring" className="my-6 space-y-3 rounded-xl border border-dash-border p-5" aria-busy={busy}>
  <h2 className="text-xl font-bold">{copy.title}</h2>
  {error&&<><p role="alert">{error}</p><button type="button" className={button} disabled={busy} onClick={()=>setRevision(value=>value+1)}>{copy.refresh}</button><Link className={button} href={`${base}/prompts`}>{copy.reviewQuestions}</Link></>}
  {repairOutcome&&<p role="status">{fill(copy.repairOutcome,repairOutcome)}</p>}
  {!options&&!error&&<p role="status">{copy.loading}</p>}
  {options&&<>
   <p>{fill(copy.workload,{prompts:options.prompts,variants:options.variants,expected:options.expected})}</p>
   <p>{fill(copy.budget,{remaining:options.remaining})}</p><p className="text-sm">{copy.cost}</p>
   <p className="text-sm">{fill(copy.search,{requested:options.search.requested==='off'?copy.searchOff:copy.searchAllowance})}</p>
   <p className="text-sm">{copy.schedule}</p>
   {!!availability?.reasons.length&&<ul aria-label={copy.availabilityTitle} className="list-disc pl-5">{availability.reasons.map(reason=><li key={reason}>{copy.availabilityReasons[reason]}</li>)}</ul>}
   {availability?.action==='view_existing'&&<Link className={button} href={options.currentCanonicalId?`${base}/observations?run=${encodeURIComponent(options.currentCanonicalId)}&week=${options.week}`:`${base}/observations?result=incomplete`}>{copy.viewExisting}</Link>}
   {!error&&availability?.action==='wait'&&<button type="button" className={button} disabled={busy} onClick={()=>setRevision(value=>value+1)}>{copy.refresh}</button>}
   {availability?.action==='edit_prompts'&&<Link className={button} href={`${base}/prompts`}>{copy.setup}</Link>}
   {!options.enabled&&<p>{copy.disabled}</p>}
   {options.legacyCurrentWeek&&!run&&<p>{copy.legacy} <Link className="underline" href={`${base}/observations?result=incomplete`}>{copy.legacyLink}</Link></p>}
   {run&&<div aria-live="polite"><p>{run.purpose==='retest'?copy.retestScope:copy.canonicalScope} · {run.week}</p><p className="font-semibold">{copy.states[run.coverage.status]}</p><p>{fill(copy.collected,{collected:run.coverage.succeeded,expected:run.coverage.expected})}</p><p>{fill(copy.classified,{classified:run.coverage.classified,collected:run.coverage.succeeded})}</p>{run.reasons.map(reason=><p key={reason}>{copy.reasons[reason as keyof typeof copy.reasons]??copy.unavailable}</p>)}<Link className="inline-flex min-h-11 items-center underline" href={observationsHref(lang, clientId, { run: run.id, week: run.week })}>{copy.results}</Link></div>}
   <div className="flex flex-wrap gap-3">
    {!!options.legacyObservationIds.length&&<button className={button} disabled={busy||!!error||!options.enabled} onClick={()=>repairLegacy()}>{copy.repairLegacy}</button>}
    {!!run?.classificationRepairIds?.length&&<><p className="text-sm">{copy.repairSavedNotice}</p><button className={button} disabled={busy||!!error} onClick={()=>repairLegacy(run.id)}>{copy.repairSaved}</button></>}
    {run?.purpose==='canonical'&&run.coverage.status==='completed'&&<button className={button} disabled={busy||!!error} onClick={()=>repairLegacy(run.id)}>{copy.repairSummary}</button>}
    {!options.currentCanonicalId&&(!run||run.purpose!=='canonical'||run.week!==options.week)&&!options.legacyCurrentWeek&&<button className={button} disabled={busy||!!error||!availability?.canStart} onClick={()=>start('initial')}>{copy.start}</button>}
    {run?.retryable&&<button className={button} disabled={busy||!!error||!options.enabled} onClick={()=>start('repair')}>{copy.repair}</button>}
    {run?.coverage.status==='completed'&&<p>{fill(copy.retestWorkload,{expected:Number.isSafeInteger(run.coverage.expected)?run.coverage.expected:'—'})}</p>}
    {run?.coverage.status==='completed'&&<button className={button} disabled={busy||!!error||!options.enabled||!options.contextConfirmed||!retestReady} onClick={()=>start('retest')}>{copy.retest}</button>}
   </div>
  </>}
 </section>
}
