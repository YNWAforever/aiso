'use client'
import {useEffect,useRef,useState} from 'react'
import type {ObservationDetailDto} from '@/lib/observations/types'
import type {ObservationCopy} from './copy'

export function ObservationDetailContent({observation:d,copy:c}:{observation:ObservationDetailDto;copy:ObservationCopy}){
  const status={classified:c.classified,fallback:c.fallback,failed:c.failed,legacy_unknown:c.legacyUnknown}[d.classification.status]
  const sentiment={positive:c.positive,neutral:c.neutral,negative:c.negative,unknown:c.unknown}[d.classification.sentiment]
  const fields=[
    [c.model,d.model],[c.requestedModel,d.requestedModel],[c.collector,d.collector],[c.market,d.market],
    [c.collectedAt,d.collectedAt],[c.classification,status],[c.sentiment,sentiment],
    [c.method,d.classification.method],[c.version,d.classification.version],
    [c.providerFinishReason,d.providerFinishReason==='stop'?c.providerComplete:c.unknown],
  ]
  return <div className="space-y-4">
    <p>{c.apiSample}</p>
    <section><h3 className="font-semibold">{c.promptSnapshot}</h3><p>{d.promptSnapshot?.question??d.question}</p>
      <p>{c.snapshotLanguage}: {d.promptSnapshot?.language??c.unknown}</p>
      <p>{c.brandSnapshot}: {d.brandSnapshot?.name??c.unknown}</p></section>
    <section><h3 className="font-semibold">{c.rawAnswer}</h3>{d.rawAnswer?<pre className="whitespace-pre-wrap break-words font-sans">{d.rawAnswer}</pre>:<p>{c.noAnswer}</p>}</section>
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
  </div>
}
export function ObservationDetail({clientId,observationId,copy,onClose}:{clientId:string;observationId:string;copy:ObservationCopy;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null)
  const [observation,setObservation]=useState<ObservationDetailDto|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0)
  useEffect(()=>{
    const node=dialog.current,previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    node?.showModal();closeButton.current?.focus()
    return ()=>{node?.close();if(previous?.isConnected)previous.focus()}
  },[])
  useEffect(()=>{
    const controller=new AbortController();let current=true
    const timer=setTimeout(()=>controller.abort(),15_000)
    async function load(){
      setError(false)
      try{
        const response=await fetch(`/api/clients/${encodeURIComponent(clientId)}/observations/${encodeURIComponent(observationId)}`,{cache:'no-store',signal:controller.signal})
        if(!response.ok)throw new Error('unavailable')
        const body=await response.json()
        if(body.observation?.id!==observationId||!body.observation?.classification)throw new Error('invalid')
        if(current)setObservation(body.observation)
      }catch{if(current)setError(true)}finally{clearTimeout(timer)}
    }
    void load()
    return ()=>{current=false;clearTimeout(timer);controller.abort()}
  },[clientId,observationId,retry])
  return <dialog ref={dialog} aria-labelledby="observation-detail-title" onCancel={onClose}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-xl backdrop:bg-black/40 sm:p-6">
    <header className="mb-4 flex items-start justify-between gap-4"><h2 id="observation-detail-title" className="text-xl font-semibold">{copy.detailTitle}</h2>
      <button ref={closeButton} type="button" className="min-h-11 shrink-0 rounded-lg border px-3" onClick={onClose}>{copy.closeDetail}</button></header>
    {error?<p role="alert">{copy.detailError} <button className="min-h-11 underline" type="button" onClick={()=>setRetry(n=>n+1)}>{copy.retry}</button></p>
      :observation?<ObservationDetailContent observation={observation} copy={copy}/>:<p role="status">{copy.detailLoading}</p>}
  </dialog>
}
