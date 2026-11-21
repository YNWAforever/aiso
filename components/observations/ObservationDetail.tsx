'use client'
import {useEffect,useRef,useState} from 'react'
import type {ObservationDetailDto} from '@/lib/observations/types'
import type {ObservationCopy} from './copy'
import { observationsHref, type ObservationSelection } from '@/lib/observations/links'
import { formatDisplayDate } from '@/lib/format/date'
import { platformLabel } from '@/lib/view-models/monitor-signals'

export function ObservationDetailContent({observation:d,copy:c,smeCopilot=false,lang='en'}:{observation:ObservationDetailDto;copy:ObservationCopy;smeCopilot?:boolean;lang?:string}){
  const status={classified:c.classified,fallback:c.fallback,failed:c.failed,legacy_unknown:c.legacyUnknown}[d.classification.status]
  const sentiment={positive:c.positive,neutral:c.neutral,negative:c.negative,unknown:c.unknown}[d.classification.sentiment]
  const fields=[
    [c.model,d.model],[c.requestedModel,d.requestedModel],[c.collector,d.collector],[c.market,d.market],
    [c.collectedAt,formatDisplayDate(d.collectedAt,lang,{withTime:true,zoneLabel:true})||null],[c.classification,status],[c.sentiment,sentiment],
    [c.method,d.classification.method],[c.version,d.classification.version],
    [c.providerFinishReason,d.providerFinishReason==='stop'?c.providerComplete:c.unknown],
    [c.searchExecution,d.searchEvidence?.execution==='confirmed'?c.searchConfirmed:c.searchUnknown],
    [c.grounding,d.grounding==='web'?c.groundingWeb:d.grounding==='native'?c.groundingNative:d.grounding==='none'?c.groundingNone:c.unknown],
  ]
  const technical=<>
    <dl className="grid gap-2 sm:grid-cols-2">{fields.map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words">{value??c.unknown}</dd></div>)}</dl>
    <p>{d.classification.brandMentioned===null?c.classificationUnknown:d.classification.brandMentioned?c.brandMentioned:c.brandNotMentioned}</p>
    {!!d.classification.matchedText.length&&<section><h3 className="font-semibold">{c.matchedText}</h3><ul>{d.classification.matchedText.map((text,i)=><li key={i}>{text}</li>)}</ul></section>}
    <section><h3 className="font-semibold">{c.links}</h3>
      <p>{d.limitations.includes('provider-citations-unrecorded')?c.noProviderCitations
        :d.links.some(link=>link.kind==='provider-citation')?c.providerEvidenceNote:c.providerCitationsEmpty}</p>
      <ul>{d.links.map(link=><li key={link.url}>
      <span>{link.kind==='text-link'?c.textLink:c.providerCitation}: </span>
      {link.title&&<span>{link.title} — </span>}
      <a className="underline break-all" href={link.url} target="_blank" rel="noopener noreferrer">{link.url}</a>
    </li>)}</ul></section>
    {!!d.limitations.length&&<section><h3 className="font-semibold">{c.limitations}</h3><ul>
      {!d.model&&<li>{c.unknownModel}</li>}{!d.market&&<li>{c.unknownMarket}</li>}{!d.collectedAt&&<li>{c.unknownCollectionTime}</li>}
      {d.classification.status!=='classified'&&<li>{c.classificationUnknown}</li>}
    </ul></section>}
  </>
  if(smeCopilot) return <div className="space-y-5">
    <section className="space-y-1">
      <h3 className="text-sm font-semibold text-muted-foreground">{c.question}</h3>
      <p className="break-words text-base">{d.promptSnapshot?.question??d.question}</p>
    </section>
    <section className="space-y-2">
      <h3 className="font-semibold">{c.smeKeyPoints}</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 font-medium">{platformLabel(d.platform)}</span>
        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 font-medium">{formatDisplayDate(d.scanWeek,lang)}</span>
        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 font-medium">{d.brandMentioned===null?c.smeMentionUnknown:d.brandMentioned?c.smeMentioned:c.smeNotMentioned}</span>
      </div>
    </section>
    <section className="space-y-2">
      <h3 className="font-semibold">{c.rawAnswer}</h3>
      <p className="text-sm text-muted-foreground">{c.smeEvidenceNote}</p>
      {d.rawAnswer?<p className="whitespace-pre-wrap break-words">{d.rawAnswer}</p>:<p>{c.noAnswer}</p>}
    </section>
    <details className="rounded-lg border border-border p-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{c.smeTechnical}</summary>
      <div className="mt-3 space-y-4">{technical}</div>
    </details>
  </div>
  return <div className="space-y-4">
    <p>{c.apiSample}</p>
    <section><h3 className="font-semibold">{c.promptSnapshot}</h3><p>{d.promptSnapshot?.question??d.question}</p>
      <p>{c.snapshotLanguage}: {d.promptSnapshot?.language??c.unknown}</p>
      <p>{c.brandSnapshot}: {d.brandSnapshot?.name??c.unknown}</p></section>
    <section><h3 className="font-semibold">{c.rawAnswer}</h3>{d.rawAnswer?<pre className="whitespace-pre-wrap break-words font-sans">{d.rawAnswer}</pre>:<p>{c.noAnswer}</p>}</section>
    {technical}
  </div>
}
export function ObservationDetail({clientId,observationId,copy,onClose,smeCopilot=false,lang='en',selection,restoreFocusTo}:{clientId:string;observationId:string;copy:ObservationCopy;onClose:()=>void;smeCopilot?:boolean;lang?:string;selection?:ObservationSelection;restoreFocusTo?:HTMLElement|null}){
  const run = selection?.run
  const login = `/${lang}/auth/login?${new URLSearchParams({next:observationsHref(lang, clientId, {...selection, observation:observationId})})}`
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null)
  const [observation,setObservation]=useState<ObservationDetailDto|null>(null),[error,setError]=useState<'unavailable' | 'sign-in' | null>(null),[retry,setRetry]=useState(0)
  useEffect(()=>{
    const node = dialog.current
    const previous = restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    node?.showModal();closeButton.current?.focus()
    return () => {
      node?.close()
      const target = previous?.isConnected && previous !== document.body
        ? previous : document.querySelector<HTMLElement>('#sme-answers-title, #observation-heading')
      target?.focus({ preventScroll: true })
    }
  }, [restoreFocusTo])
  useEffect(()=>{
    const controller=new AbortController();let current=true
    const timer=setTimeout(()=>controller.abort(),15_000)
    async function load(){
      setError(null)
      try{
        const scope = run ? `?${new URLSearchParams({run})}` : ''
        const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/observations/${encodeURIComponent(observationId)}${scope}`, {cache:'no-store',signal:controller.signal})
        if (response.status === 401) {
          if (current) setError('sign-in')
          return
        }
        if(!response.ok)throw new Error('unavailable')
        const body=await response.json()
        if(body.observation?.id!==observationId||!body.observation?.classification)throw new Error('invalid')
        if(current)setObservation(body.observation)
      }catch{if(current)setError('unavailable')}finally{clearTimeout(timer)}
    }
    void load()
    return ()=>{current=false;clearTimeout(timer);controller.abort()}
  },[clientId,observationId,retry,run,lang])
  return <dialog ref={dialog} aria-labelledby="observation-detail-title" onCancel={event => { event.preventDefault(); onClose() }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-xl backdrop:bg-black/40 sm:p-6">
    <header className="mb-4 flex items-start justify-between gap-4"><h2 id="observation-detail-title" className="text-xl font-semibold">{copy.detailTitle}</h2>
      <button ref={closeButton} type="button" className="min-h-11 shrink-0 rounded-lg border px-3" onClick={onClose}>{copy.closeDetail}</button></header>
    {error?<p role="alert">{copy.detailError}{' '}{error === 'sign-in'
      ? <a className="inline-flex min-h-11 items-center underline" href={login}>{copy.signInToContinue}</a>
      : <button className="min-h-11 underline" type="button" onClick={()=>setRetry(n=>n+1)}>{copy.retry}</button>}</p>
      :observation?<ObservationDetailContent observation={observation} copy={copy} smeCopilot={smeCopilot} lang={lang}/>:<p role="status">{copy.detailLoading}</p>}
  </dialog>
}
