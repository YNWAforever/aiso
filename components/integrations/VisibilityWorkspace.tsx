'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { PROMPT_MARKETS } from '@/lib/prompts/context'
import { buildVisibilityReport } from '@/lib/visibility/metrics'
import type { VisibilityWorkspaceData } from '@/lib/visibility/store'
const value=(input:unknown)=>input==null?'—':String(input)
const lines=(input:FormDataEntryValue|null)=>String(input??'').split('\n').map(line=>line.trim()).filter(Boolean)
const field='block w-full rounded border border-border bg-background p-2'
const button='min-h-11 rounded border border-border px-3 font-medium disabled:opacity-50'
const panel='space-y-4 rounded-xl border border-border bg-card p-5'
export function VisibilityWorkspace({clientId,lang,initialView=null}:{clientId:string;lang:string;initialView?:VisibilityWorkspaceData|null}) {
  const c=(lang==='zh-HK'?zhHK:en).closedLoopVisibility,base=`/api/clients/${clientId}/visibility`
  const [view,setView]=useState(initialView),[error,setError]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const [draftPreview,setDraftPreview]=useState<{id:string;artifact:string;kind:string}|null>(null)
  const [queryId,setQueryId]=useState(''),[locale,setLocale]=useState(''),[market,setMarket]=useState(''),[platform,setPlatform]=useState(''),[count,setCount]=useState(50)
  const state=(input:unknown)=>c.states[String(input) as keyof typeof c.states]??c.unknown
  const percent=(input:number|null)=>input==null?c.unknown:new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:1}).format(input)
  async function reload() {
    setError(false)
    try {const response=await fetch(base,{cache:'no-store'});if(!response.ok)throw new Error();setView(await response.json())}
    catch{setError(true)}
  }
  useEffect(()=>{
    const controller=new AbortController()
    void fetch(base,{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error();const data=await response.json();if(!controller.signal.aborted)setView(data)})
      .catch(()=>{if(!controller.signal.aborted)setError(true)})
    return()=>controller.abort()
  },[base])
  async function act(action:string,body:unknown) {
    if(busy)return
    setBusy(true);setNotice('')
    try {
      const response=await fetch(`${base}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      const result=await response.json()
      if(!response.ok){setNotice(result.error==='VISIBILITY_TECHNICAL_GAP_UNVERIFIED'?c.techGap:result.error==='VISIBILITY_GAP_REQUIRED'?c.gapRequired:c.reasons[result.error as keyof typeof c.reasons]??c.failed);return}
      if(action==='drafts'&&typeof result.artifact==='string')setDraftPreview({id:String(result.id),artifact:result.artifact,kind:String((body as {kind?:unknown}).kind??'brief')})
      setNotice(c.saved);await reload()
    }catch{setNotice(c.failed)}finally{setBusy(false)}
  }
  const selected=view?.queries.find(query=>query.id===queryId)??view?.queries[0]
  const monitoring=(selected?.monitoring??{}) as Record<string,unknown>
  const observations=view?.observations.filter(row=>(!locale||row.locale===locale)&&(!market||row.market===market)&&(!platform||row.platform===platform))??[]
  const report=buildVisibilityReport(observations)
  const options=(labels:Record<string,string>,withUnknown=false)=><>{withUnknown&&<option value="unknown">{c.unknown}</option>}{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</>
  function download(artifact:string,id:string,kind:string) {
    const url=URL.createObjectURL(new Blob([artifact],{type:'text/plain;charset=utf-8'})),anchor=document.createElement('a')
    anchor.href=url;anchor.download=`visibility-${id}.${kind==='schema'?'json':kind==='technical_patch'?'patch':'md'}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div className="space-y-6"><h1 className="text-2xl font-bold">{c.title}</h1><p>{c.intro}</p>
    <nav className="flex flex-wrap gap-4"><Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}?step=monitor`}>{c.collect}</Link><button className={button} onClick={()=>void reload()}>{c.refresh}</button><Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}/prompts`}>{c.manage}</Link></nav>
    {error&&<p role="alert">{c.unavailable}</p>}{notice&&<p role="status">{notice}</p>}{!view&&!error&&<p role="status">{c.loading}</p>}
    {view&&<>
      <section className={panel}><h2 className="font-semibold">{c.measurements}</h2><p>{c.limits}</p><p>{c.sample}</p>
        <div className="grid gap-3 sm:grid-cols-3"><label>{c.locale}<select className={field} value={locale} onChange={event=>setLocale(event.target.value)}><option value="">{c.all}</option><option value="en">{c.languages.en}</option><option value="zh-HK">{c.languages['zh-HK']}</option></select></label>
          <label>{c.market}<select className={field} value={market} onChange={event=>setMarket(event.target.value)}><option value="">{c.all}</option>{PROMPT_MARKETS.map(item=><option key={item.value} value={item.value}>{lang==='zh-HK'?item.labelZh:item.labelEn}</option>)}</select></label>
          <label>{c.platform}<select className={field} value={platform} onChange={event=>setPlatform(event.target.value)}><option value="">{c.all}</option>{[...new Set(view.observations.map(row=>row.platform))].map(item=><option key={item}>{item}</option>)}</select></label></div>
        {!observations.length?<p>{c.noObservations}</p>:<dl className="grid gap-4 sm:grid-cols-3">{[[c.presence,percent(report.answerPresence)],[c.citations,percent(report.citationShare)],[c.citationCoverage,percent(report.citationCoverage)],[c.firstCitation,report.firstCitationPosition?.toFixed(1)??c.unknown],[c.sov,percent(report.brandShareOfVoice)],[c.volatility,percent(report.volatility)],[c.coverage,`${report.classified} / ${report.observations}`]].map(([label,number])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{number}</dd></div>)}</dl>}
        {report.competitorShareOfVoice.map(row=><p key={row.name}>{row.name}: {percent(row.share)}</p>)}
      </section>
      <section className={panel}><h2 className="font-semibold">{c.configure}</h2><p>{c.activeHint}</p>
        {!selected?<p>{c.emptyQuestions}</p>:<><label className="block">{c.question}<select className={field} value={selected.id} onChange={event=>setQueryId(event.target.value)}>{view.queries.map(query=><option key={query.id} value={query.id}>{value(query.question)}</option>)}</select></label>
          {selected.monitoring&&!selected.context_current&&<p role="status">{c.contextStale}</p>}
          <form key={selected.id} className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void act('queries',{promptId:selected.id,locale:form.get('locale'),market:form.get('market'),persona:form.get('persona'),intent:form.get('intent'),funnel:form.get('funnel'),topic:form.get('topic'),targetUrl:form.get('target'),priority:Number(form.get('priority')),branded:form.get('branded')==='on',expectedAttributes:lines(form.get('attributes')),competitorIds:form.getAll('competitors')})}}>
            <label>{c.locale}<select className={field} name="locale" required defaultValue={['en','zh-HK'].includes(selected.locale)?selected.locale:''}><option value="">{c.choose}</option><option value="en">{c.languages.en}</option><option value="zh-HK">{c.languages['zh-HK']}</option></select></label>
            <label>{c.market}<select className={field} name="market" required defaultValue={selected.market??''}><option value="">{c.choose}</option>{PROMPT_MARKETS.map(item=><option key={item.value} value={item.value}>{lang==='zh-HK'?item.labelZh:item.labelEn}</option>)}</select></label>
            <label>{c.persona}<input className={field} name="persona" required maxLength={200} defaultValue={String(monitoring.persona??'')}/></label><label>{c.topic}<input className={field} name="topic" required maxLength={120} defaultValue={String(monitoring.topic??'')}/></label>
            <label>{c.intent}<select className={field} name="intent" required defaultValue={String(monitoring.intent??'')}><option value="">{c.choose}</option>{options(c.intents)}</select></label><label>{c.funnel}<select className={field} name="funnel" required defaultValue={String(monitoring.funnel??'')}><option value="">{c.choose}</option>{options(c.funnels)}</select></label>
            <label>{c.target}<input className={field} type="url" name="target" required maxLength={2048} defaultValue={String(monitoring.targetUrl??'')}/></label><label>{c.priority}<input className={field} type="number" name="priority" required min={1} max={5} defaultValue={Number(monitoring.priority??3)}/></label>
            <label><input className="mr-2" type="checkbox" name="branded" defaultChecked={monitoring.branded===true}/>{c.branded}</label><label>{c.expected}<textarea className={field} name="attributes" maxLength={2100} defaultValue={Array.isArray(monitoring.expectedAttributes)?monitoring.expectedAttributes.join('\n'):''}/></label>
            <fieldset className="space-y-2"><legend>{c.competitors}</legend>{view.competitors.map(row=><label className="block" key={row.id}><input className="mr-2" type="checkbox" name="competitors" value={row.id} defaultChecked={Array.isArray(monitoring.competitorIds)&&monitoring.competitorIds.includes(row.id)}/>{value(row.name)}</label>)}</fieldset>
            <div><button className={button} disabled={busy}>{c.save}</button></div>
          </form>
          <p>{c.baselineHint}</p><button className={button} disabled={busy||!selected.context_current||typeof monitoring.targetUrl!=='string'} onClick={()=>void act('baseline',{url:monitoring.targetUrl})}>{c.baseline}</button>
        </>}
      </section>
      <section className={panel}><h2 className="font-semibold">{c.sources}</h2><p>{c.sourceHint}</p>{report.trustedSources.map(row=><p key={row.domain}>{row.domain} · {row.answers} · {row.platforms.join(', ')}</p>)}<h3 className="font-semibold">{c.gaps}</h3>{!report.gaps.length&&<p>{c.noGaps}</p>}{report.gaps.map(row=><p key={row.observationId}>{row.question} → {row.domains.join(', ')}</p>)}</section>
      <section className={panel}><h2 className="font-semibold">{c.observations}</h2><p>{c.patchHint}</p><p>{c.schemaHint}</p>
        {observations.slice(0,count).map(row=><details key={row.id} className="rounded border border-border p-3"><summary>{row.question} · {row.platform} · {row.locale??c.unknown} / {row.market??c.unknown} · {row.observedAt}</summary>
          <p className="mt-3">{c.model}: {row.model??c.unknown} · {c.sentiment}: {state(row.sentiment)} · {c.recommendation}: {state(row.recommendation)} · {c.accuracy}: {state(row.accuracy)} · {c.risk}: {state(row.risk)}</p>
          <details className="my-3"><summary>{c.frozenContext}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(row.monitoring,null,2)}</pre></details><pre className="my-3 overflow-x-auto whitespace-pre-wrap break-words">{row.answerExcerpt}</pre>{row.citations.map(citation=><p key={citation.url} className="break-all">{citation.url}</p>)}
          <form className="my-3 grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void act('reviews',{observationId:row.id,recommendation:form.get('recommendation'),accuracy:form.get('accuracy'),risk:form.get('risk'),notes:form.get('notes')})}}>
            <label>{c.recommendation}<select className={field} name="recommendation" defaultValue={row.recommendation}>{options({recommended:c.states.recommended,excluded:c.states.excluded,neutral:c.states.neutral},true)}</select></label>
            <label>{c.accuracy}<select className={field} name="accuracy" defaultValue={row.accuracy}>{options({accurate:c.states.accurate,inaccurate:c.states.inaccurate},true)}</select></label><label>{c.risk}<select className={field} name="risk" defaultValue={row.risk}>{options({low:c.states.low,medium:c.states.medium,high:c.states.high},true)}</select></label>
            <label>{c.notes}<textarea className={field} name="notes" required maxLength={2000}/></label><div><button className={button} disabled={busy}>{c.review}</button></div>
          </form>
          {typeof row.monitoring.targetUrl!=='string'&&<p>{c.noTarget}</p>}<div className="flex flex-wrap gap-3">{(['brief','schema','technical_patch'] as const).map(kind=><button className={button} key={kind} disabled={busy||typeof row.monitoring.targetUrl!=='string'} onClick={()=>void act('drafts',{observationId:row.id,kind,locale:lang==='zh-HK'?'zh-HK':'en'})}>{kind==='brief'?c.brief:kind==='schema'?c.schema:c.patch}</button>)}</div>
        </details>)}{observations.length>count&&<button className={button} onClick={()=>setCount(number=>number+50)}>{c.more}</button>}
      </section>
      <section className={panel}><h2 className="font-semibold">{c.drafts}</h2><p>{c.draftHint}</p>{draftPreview&&<details open><summary>{c.preview}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{draftPreview.artifact}</pre><button className={button} onClick={()=>download(draftPreview.artifact,draftPreview.id,draftPreview.kind)}>{c.download}</button></details>}{view.drafts.map(row=><details key={row.id}><summary>{state(row.state)} · {row.kind==='brief'?c.brief:row.kind==='schema'?c.schema:c.patch} · {value(row.created_at)}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{value(row.artifact)}</pre><button className={button} onClick={()=>download(String(row.artifact),String(row.id),String(row.kind))}>{c.download}</button></details>)}</section>
      <section className={panel}><h2 className="font-semibold">{c.automation}</h2><p>{c.automationHint}</p><form className="space-y-3" onSubmit={event=>{event.preventDefault();void act('automation',{enabled:new FormData(event.currentTarget).get('enabled')==='on'})}}><label className="block"><input className="mr-2" name="enabled" type="checkbox" defaultChecked={view.autoRetest}/>{c.enable}</label><button className={button} disabled={busy}>{c.saveAutomation}</button></form>
        <p>{c.queueHint}</p><form className="space-y-3" onSubmit={event=>{event.preventDefault();const [sourceKind,sourceId]=String(new FormData(event.currentTarget).get('source')).split(':');void act('revalidate',{sourceKind,sourceId})}}><label className="block">{c.source}<select name="source" className={field} required defaultValue=""><option value="">{c.choose}</option>{view.sources.map(row=><option key={row.id} value={`${row.kind}:${row.id}`}>{value(row.label)} · {value(row.source_at)}</option>)}</select></label><button className={button} disabled={busy||!view.sources.length}>{c.queue}</button></form>
      </section>
      <section className={panel}><h2 className="font-semibold">{c.baselines}</h2>{view.pageSnapshots.map(row=><details key={row.id}><summary>{value(row.url)} · {value(row.observed_at)}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(row.evidence,null,2)}</pre></details>)}</section>
      <section className={panel}><h2 className="font-semibold">{c.jobs}</h2><p>{c.jobHint}</p>{!view.jobs.length&&<p>{c.noJobs}</p>}{view.jobs.map(row=><details key={row.id}><summary>{state(row.status)} · {value(row.created_at)}</summary><p>{c.reasons[String(row.reason) as keyof typeof c.reasons]??c.unknown}</p><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(row.result,null,2)}</pre>{['failed','blocked','unknown'].includes(String(row.status))&&Number(row.attempt_count)>=3&&<p>{c.exhausted}</p>}{['failed','blocked','unknown'].includes(String(row.status))&&Number(row.attempt_count)<3&&row.reason!=='TARGET_URL_UNSUPPORTED'&&<button className={button} disabled={busy} onClick={()=>void act('retry',{jobId:row.id})}>{c.retry}</button>}</details>)}</section>
    </>}
  </div>
}
