'use client'
import { useEffect,useRef,useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale,useTranslations } from 'next-intl'
import type { SourcePack, SourcePackEntry } from '@/lib/view-models/source-pack'
import type { SourcePage } from '@/lib/sources/pagination'
import type { SourceFilter } from '@/lib/sources/query'
import type { PreviewRows } from '@/lib/sources/import-preview'
import { mergePreviewRetry } from '@/lib/sources/preview-state'
import { MaintenanceNextSteps,workflowCopyKeys,type WorkflowCopy } from '@/components/workspace/MaintenanceNextSteps'

/**
 * The owner's view of the facts a draft may quote.
 *
 * It renders a projection the SERVER derived and never derives one itself. Two
 * copies of "will a draft use this?" would be two chances to disagree with
 * `listAgentUsableSources`, and the disagreement would surface as a green badge
 * over a source nothing will ever cite. So a mutation here posts, then asks the
 * server to re-render (`router.refresh()`), rather than patching local state.
 *
 * Every failure path says what did NOT happen. A silent revert would leave an
 * owner believing they had switched agent use on.
 *
 * The type imports are type-only on purpose: `lib/sources/schema.ts` reaches for
 * `node:crypto`, which has no business in a browser bundle.
 */

type Draft = { question: string; answer: string }
const EMPTY_PAIR: Draft = { question: '', answer: '' }

export function SourcePackWorkspace({
  clientId,
  pack,
  page=null,
  loadFailed = false,
  initialReview=null,
  initialReviewStale=false,
}: {
  clientId: string
  pack: SourcePack | null
  page?:SourcePage|null
  loadFailed?: boolean
  initialReview?:import('@/lib/sources/schema').SourceDto|null
  initialReviewStale?:boolean
}) {
  const t = useTranslations('sources')
  const locale=useLocale()==='zh-HK'?'zh-HK':'en'
  const router = useRouter()
  const base = `/api/clients/${encodeURIComponent(clientId)}/sources`

  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [review, setReview] = useState<import('@/lib/sources/schema').SourceDto | null>(initialReview)
  const [status, setStatus] = useState('')
  const [loaded,setLoaded]=useState({originPack:pack,originPage:page,pack,page,filter:'all' as SourceFilter})
  const current=loaded.originPack===pack&&loaded.originPage===page
  const shown=current?loaded.pack:pack,pageState=current?loaded.page:page,filter=current?loaded.filter:'all'
  const [pagePending,setPagePending]=useState({pack,page,busy:false})
  const loadingPage=pagePending.pack===pack&&pagePending.page===page&&pagePending.busy
  const pageRequest=useRef(0)
  useEffect(()=>{pageRequest.current++},[pack,page])

  const [label, setLabel] = useState('')
  const [sourceKey, setSourceKey] = useState('')
  const [kind, setKind] = useState<'facts' | 'faq'>('facts')
  const [method, setMethod] = useState<'paste' | 'csv'>('paste')
  const [originRef, setOriginRef] = useState('')
  const [pairs, setPairs] = useState<Draft[]>([{ ...EMPTY_PAIR }])
  const [csv, setCsv] = useState('')
  const [approve, setApprove] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [preview,setPreview]=useState<(PreviewRows&{expectedLatestVersion:number})|null>(null)
  const [previewing,setPreviewing]=useState(false)
  async function loadPage(nextFilter:SourceFilter,more=false){
    const request=++pageRequest.current;setPagePending({pack,page,busy:true});setActionError(null)
    try{
      const params=new URLSearchParams({filter:nextFilter})
      if(more&&pageState?.nextCursor)params.set('cursor',pageState.nextCursor)
      const response=await fetch(`${base}?${params}`,{cache:'no-store',signal:AbortSignal.timeout(15000)})
      const data=await response.json()
      if(request!==pageRequest.current)return
      if(!response.ok)throw new Error(data.error)
      if(!Array.isArray(data.pack?.entries))throw new Error('SOURCES_UNAVAILABLE')
      setLoaded(old=>{
        const previous=old.originPack===pack&&old.originPage===page?old.pack:pack
        const entries:SourcePackEntry[]=more&&previous?[...previous.entries,...data.pack.entries].filter((row,index,rows)=>rows.findIndex(item=>item.id===row.id)===index):data.pack.entries
        const nextPack={...data.pack,entries,inUse:entries.filter(row=>row.usability==='in-use').length,awaitingApproval:entries.filter(row=>row.usability==='awaiting-approval').length,revoked:entries.filter(row=>row.usability==='revoked').length,staleInUse:entries.filter(row=>row.usability==='in-use'&&row.freshness==='stale').length}
        return{originPack:pack,originPage:page,pack:nextPack,page:data,filter:nextFilter}
      })
    }catch(error){if(request===pageRequest.current)setActionError(messageFor(error instanceof Error?error.message:null))}
    finally{if(request===pageRequest.current)setPagePending({pack,page,busy:false})}
  }
  async function previewCsv(retry=false){
    if(previewing)return
    setPreviewing(true);setImportError(null)
    try{
      const response=await fetch(`${base}/import-preview`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({sourceKey,...(retry&&preview?{rows:preview.rows.filter(row=>row.errorCode!==null).map(({rowNumber,question,answer})=>({rowNumber,question,answer}))}:{csv})})})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error)
      if(!Array.isArray(data.rows)||!Number.isInteger(data.expectedLatestVersion))throw new Error('SOURCE_PREVIEW_INVALID')
      setPreview(old=>retry&&old?{...mergePreviewRetry(old,data),expectedLatestVersion:old.expectedLatestVersion}:data)
    }catch(error){setImportError(messageFor(error instanceof Error?error.message:null))}
    finally{setPreviewing(false)}
  }

  /** A code the service documented; anything else is a dependency failure. */
  function messageFor(code: unknown): string {
    const table = t.raw('errors') as Record<string, string>
    return (typeof code === 'string' && table[code]) || table.SOURCES_UNAVAILABLE!
  }

  function versionStatus(payload: unknown, done: string): string {
    // Identify the persisted source returned by the service, including its canonical key.
    const source = (payload as { source?: { sourceKey: string; latestVersion: number } } | null)?.source
    return typeof source?.sourceKey === 'string' && source.sourceKey.length > 0
      && Number.isSafeInteger(source.latestVersion) && source.latestVersion > 0
      ? `${t('import.savedVersion', { key: source.sourceKey, version: source.latestVersion })} ${done}`
      : done
  }

  async function mutate(sourceId: string, body: Record<string, unknown>, done: string) {
    if (busy) return
    setBusy(sourceId)
    setActionError(null)
    setStatus('')
    try {
      const response = await fetch(`${base}/${encodeURIComponent(sourceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setActionError(messageFor((payload as { error?: unknown }).error))
        return
      }
      setStatus(done)
      router.refresh()
    } catch {
      // A network failure is not a saved change, and must not read like one.
      setActionError(t('actions.failed'))
    } finally {
      setBusy(null)
    }
  }

  async function submitImport(event: React.FormEvent) {
    event.preventDefault()
    if (importing) return
    if(method==='csv'&&(!preview||preview.invalidCount||previewing)){setImportError(messageFor('SOURCE_PREVIEW_INVALID'));return}
    setImporting(true)
    setImportError(null)
    setStatus('')
    try {
      let expectedLatestVersion:number|undefined
      if(method==='paste'){
        const validation=await fetch(`${base}/import-preview`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({sourceKey,rows:pairs.map((pair,index)=>({...pair,rowNumber:index+1}))})})
        const checked=await validation.json()
        if(!validation.ok||checked.invalidCount||!Number.isSafeInteger(checked.expectedLatestVersion)){
          setImportError(messageFor(checked.rows?.find((row:{errorCode:string|null})=>row.errorCode)?.errorCode??checked.error??'SOURCE_PREVIEW_INVALID'));return
        }
        expectedLatestVersion=checked.expectedLatestVersion
      }
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:AbortSignal.timeout(15000),
        body: JSON.stringify({
          sourceKey,
          kind,
          label,
          importMethod: method,
          originRef: originRef.trim() ? originRef : null,
          approve,
          ...(method === 'csv' && preview ? {entries:preview.rows.map(row=>row.entry),previewRowCount:preview.rows.length,previewContentHash:preview.contentHash,expectedLatestVersion:preview.expectedLatestVersion} : { entries: pairs,expectedLatestVersion }),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setImportError(messageFor((payload as { error?: unknown }).error))
        return
      }
      // `unchanged` is a real outcome, not a failure: identical text hashes the
      // same, so no version was created and saying "imported" would overstate it.
      const outcome = payload as { result?: string; approval?: string }
      setStatus(versionStatus(payload, outcome.approval === 'approved' ? t('actions.approved')
        : outcome.result === 'unchanged' ? t('import.unchanged') : t('import.created')))
      setPairs([{ ...EMPTY_PAIR }])
      setCsv('')
      setPreview(null)
      router.refresh()
    } catch {
      setImportError(t('import.failed'))
    } finally {
      setImporting(false)
    }
  }

  async function reviewVersion(sourceId: string) {
    if (busy) return
    setBusy(sourceId)
    setActionError(null)
    try {
      const response = await fetch(`${base}/${encodeURIComponent(sourceId)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) { setActionError(messageFor(payload.error)); return }
      setReview(payload.source)
    } catch { setActionError(t('actions.failed')) }
    finally { setBusy(null) }
  }

  async function approveReviewedVersion() {
    if (busy || !review?.current) return
    setBusy(review.id)
    setActionError(null)
    try {
      const response = await fetch(`${base}/${encodeURIComponent(review.id)}/versions/${encodeURIComponent(review.current.id)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedLatestVersion: review.latestVersion, expectedContentHash: review.current.contentHash }),
      })
      const payload = await response.json()
      if (!response.ok) { setActionError(messageFor(payload.error)); return }
      setStatus(versionStatus(payload, t('actions.approved')))
      setReview(null)
      router.refresh()
    } catch { setActionError(t('actions.failed')) }
    finally { setBusy(null) }
  }

  const field = 'mt-1 w-full min-h-11 rounded-lg border border-dash-border bg-dash-surface px-3 py-2 text-sm text-dash-text'
  const action = 'inline-flex min-h-11 items-center rounded-lg border border-dash-border px-3 py-2 text-sm font-semibold text-dash-text disabled:opacity-60'

  function entryCard(entry: SourcePackEntry) {
    const { provenance } = entry
    return (
      <li key={entry.id} className="min-w-0 rounded-xl border border-dash-border bg-dash-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-dash-text">{entry.label}</h2>
          <span className="rounded-full border border-dash-border px-3 py-1 text-xs font-semibold text-dash-text">
            {t(`usability.${entry.usability}`)}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-dash-muted">{t(`why.${entry.usability}`)}</p>

        <dl className="mt-4 grid gap-2 text-xs text-dash-muted sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.sourceKey')}</dt>
            <dd><code className="break-all">{entry.sourceKey}</code></dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.method')}</dt>
            <dd>{provenance.importMethod ? t(`provenance.${provenance.importMethod}`) : t('provenance.none')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.imported')}</dt>
            <dd>
              {provenance.importedAt
                ? <><time dateTime={provenance.importedAt}>{provenance.importedAt.slice(0, 10)}</time>
                    {' · '}{provenance.ageDays} {t('provenance.daysAgo')}</>
                : t('provenance.none')}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.origin')}</dt>
            <dd className="break-words">{provenance.originRef ?? t('provenance.noOrigin')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-dash-text">{t('provenance.version')}</dt>
            <dd>
              {entry.versionNumber ?? '—'}
              {entry.contentHash && <> · <code className="break-all">{entry.contentHash.slice(0, 12)}</code></>}
              {' · '}{entry.entryCount} {t('provenance.entries')}
            </dd>
          </div>
        </dl>

        {entry.freshness === 'stale' && (
          <p className="mt-3 text-xs leading-relaxed text-dash-muted">
            <span className="font-semibold text-dash-text">{t('freshness.stale')}</span>{' — '}{t('freshness.staleNote')}
          </p>
        )}

        {entry.usability !== 'revoked' && (
          <div className="mt-4 flex flex-wrap gap-2">
            {entry.usability === 'awaiting-approval' && entry.versionId && (
              <button type="button" className={action} disabled={busy !== null}
                onClick={() => reviewVersion(entry.id)}>{t('actions.reviewVersion')}</button>
            )}
            <button
              type="button"
              className={action}
              disabled={busy !== null}
              onClick={() => mutate(entry.id, { agentUseAllowed: !entry.agentUseAllowed }, t('actions.saved'))}
            >
              {busy === entry.id ? t('actions.working') : entry.agentUseAllowed ? t('actions.disallow') : t('actions.allow')}
            </button>
            <button
              type="button"
              className={action}
              disabled={busy !== null}
              // No confirm() dialog: it is unreadable on a phone and cannot be
              // translated. The warning is stated next to the control instead.
              onClick={() => mutate(entry.id, { revoke: true }, t('actions.revoked'))}
            >
              {t('actions.revoke')}
            </button>
            <span className="self-center text-xs text-dash-muted">{t('actions.revokeWarning')}</span>
          </div>
        )}

      </li>
    )
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl break-words px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-dash-text">{t('title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('summary')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('notConnected')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('gate')}</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('untrusted')}</p>
      </header>

      <p aria-live="polite" className="text-sm text-dash-text">{status}</p>
      {actionError && <p role="alert" className="mt-2 text-sm text-dash-text">{actionError}</p>}

      {initialReviewStale&&<p role="alert">{t('actions.reviewStale')}</p>}
        {review?.current && (
          <section id="source-review" className="mt-4 rounded-lg border border-dash-border p-4" aria-label={t('actions.reviewVersion')}>
            <h2 className="text-xl font-bold text-dash-text">{review.label}</h2>
            <p className="mt-2 text-sm text-dash-muted">{t('provenance.sourceKey')}: <code className="break-all">{review.sourceKey}</code></p>
            <p className="text-sm text-dash-muted">{t('actions.reviewNote', { version: review.current.versionNumber })}</p>
            <dl className="mt-3 space-y-3 text-sm">
              {review.current.entries.map((pair, index) => <div key={index}>
                <dt className="font-semibold text-dash-text">{pair.question}</dt>
                <dd className="whitespace-pre-wrap text-dash-muted">{pair.answer}</dd>
              </div>)}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={action} disabled={busy !== null || review.revokedAt !== null || review.current.approvedAt !== null}
                onClick={approveReviewedVersion}>{t('actions.approveVersion')}</button>
              <button type="button" className={action} disabled={busy !== null} onClick={() => setReview(null)}>{t('actions.cancelReview')}</button>
            </div>
          </section>
        )}

      {loadFailed || !shown ? (
        <section className="mt-6 rounded-xl border border-dash-border bg-dash-surface p-5">
          <p role="alert" className="text-sm leading-relaxed text-dash-muted">{t('states.error')}</p>
          <button type="button" className={`${action} mt-4`} onClick={() => router.refresh()}>{t('actions.reload')}</button>
        </section>
      ) : (
        <>
          <p className="mt-6 text-sm text-dash-muted">
            {t('pagination.loadedScope')} · {shown.inUse} {t('counts.inUse')} · {shown.awaitingApproval} {t('counts.awaitingApproval')} · {shown.revoked} {t('counts.revoked')}
            {shown.staleInUse > 0 && <> · {shown.staleInUse} {t('counts.staleInUse')} {shown.staleAfterDays} {t('counts.days')}</>}
          </p>
          {pageState&&<div className="mt-3 space-y-3"><p>{t('pagination.scope',{shown:shown.entries.length,total:pageState.total})}</p><label>{t('pagination.filter')}<select className={field} value={filter} disabled={loadingPage} onChange={event=>loadPage(event.target.value as SourceFilter)}>{(['all','awaiting-approval','in-use','revoked'] as const).map(value=><option key={value} value={value}>{t(`pagination.filters.${value}`)}</option>)}</select></label><button className={action} disabled={loadingPage} onClick={()=>loadPage(filter)}>{t('pagination.refresh')}</button></div>}
          {shown.state === 'empty'
            ? <p className="mt-6 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('states.empty')}</p>
            : <ul className="mt-6 space-y-4">{shown.entries.map(entryCard)}</ul>}
          {pageState?.nextCursor&&<button className={`${action} mt-4`} disabled={loadingPage} onClick={()=>loadPage(filter,true)}>{loadingPage?t('pagination.loading'):t('pagination.more')}</button>}
        </>
      )}

      <section className="mt-10 rounded-xl border border-dash-border bg-dash-surface p-5">
        <h2 id="source-import-heading" className="text-xl font-bold text-dash-text">{t('import.title')}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dash-muted">{t('import.summary')}</p>
        <p className="mt-2 text-sm text-dash-muted">{t('import.limits')}</p>
        <form className="mt-5 space-y-4" onSubmit={submitImport}>
          <fieldset className="space-y-4" aria-labelledby="source-import-heading" disabled={importing}>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.label')}
            <input className={field} value={label} onChange={event => setLabel(event.target.value)} required maxLength={160} />
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.key')}
            <input className={field} value={sourceKey} readOnly={previewing||importing} onChange={event => {setSourceKey(event.target.value);setPreview(null)}} required maxLength={120} />
            <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.keyHint')}</span>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.kind')}
            <select className={field} value={kind} onChange={event => setKind(event.target.value as 'facts' | 'faq')}>
              <option value="facts">{t('import.kinds.facts')}</option>
              <option value="faq">{t('import.kinds.faq')}</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.method')}
            <select className={field} value={method} disabled={previewing||importing} onChange={event => {setMethod(event.target.value as 'paste' | 'csv');setPreview(null)}}>
              <option value="paste">{t('import.methods.paste')}</option>
              <option value="csv">{t('import.methods.csv')}</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-dash-text">
            {t('import.origin')}
            <input className={field} value={originRef} onChange={event => setOriginRef(event.target.value)} maxLength={500} />
            <span className="mt-1 block text-xs font-normal text-dash-muted">{t('provenance.originNote')}</span>
          </label>

          {method === 'csv' ? (
            <label className="block text-sm font-semibold text-dash-text">
              {t('import.methods.csv')}
              <textarea className={`${field} min-h-32 font-mono`} value={csv} readOnly={previewing||importing} onChange={event => {setCsv(event.target.value);setPreview(null)}} rows={8} />
              <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.csvHint')}</span>
            </label>
          ) : (
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-dash-text">{t('import.methods.paste')}</legend>
              {pairs.map((pair, index) => (
                <div key={index} className="rounded-lg border border-dash-border p-3">
                  <label className="block text-xs font-semibold text-dash-text">
                    {t('import.question')}
                    <input
                      className={field}
                      aria-label={t('import.question')}
                      value={pair.question}
                      maxLength={4000}
                      onChange={event => setPairs(old => old.map((row, i) => i === index ? { ...row, question: event.target.value } : row))}
                    />
                  </label>
                  <label className="mt-3 block text-xs font-semibold text-dash-text">
                    {t('import.answer')}
                    <textarea
                      className={field}
                      aria-label={t('import.answer')}
                      value={pair.answer}
                      maxLength={4000}
                      rows={3}
                      onChange={event => setPairs(old => old.map((row, i) => i === index ? { ...row, answer: event.target.value } : row))}
                    />
                  </label>
                  {pairs.length > 1 && (
                    <button type="button" className={`${action} mt-3`} onClick={() => setPairs(old => old.filter((_, i) => i !== index))}>
                      {t('import.remove')}
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className={action} disabled={pairs.length>=200} onClick={() => setPairs(old => [...old, { ...EMPTY_PAIR }])}>
                {t('import.add')}
              </button>
            </fieldset>
          )}
          {method==='csv'&&<section aria-label={t('import.preview')} className="space-y-3"><button type="button" className={action} disabled={previewing||importing} onClick={()=>previewCsv()}>{t('import.preview')}</button>{preview&&<><p role="status">{t('import.previewCounts',{valid:preview.validCount,invalid:preview.invalidCount})}</p><ol>{preview.rows.map(row=><li key={row.rowNumber} className="my-2 rounded-lg border border-dash-border p-3"><p>{t('import.row',{number:row.rowNumber})} · {row.errorCode?messageFor(row.errorCode):t('import.valid')}</p>{row.errorCode?<><label>{t('import.question')}<input className={field} readOnly={previewing||importing} maxLength={4000} value={row.question} onChange={event=>setPreview(old=>old&&({...old,rows:old.rows.map(item=>item.rowNumber===row.rowNumber?{...item,question:event.target.value}:item)}))}/></label><label>{t('import.answer')}<textarea className={field} readOnly={previewing||importing} maxLength={4000} value={row.answer} onChange={event=>setPreview(old=>old&&({...old,rows:old.rows.map(item=>item.rowNumber===row.rowNumber?{...item,answer:event.target.value}:item)}))}/></label></>:<p className="whitespace-pre-wrap">{row.entry?.question} · {row.entry?.answer}</p>}</li>)}</ol>{preview.invalidCount>0&&<button type="button" className={action} disabled={previewing||importing} onClick={()=>previewCsv(true)}>{t('import.retryRows')}</button>}</>}</section>}

          <label className="flex items-start gap-3 text-sm font-semibold text-dash-text">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={approve} onChange={event => setApprove(event.target.checked)} />
            <span>
              {t('import.approve')}
              <span className="mt-1 block text-xs font-normal text-dash-muted">{t('import.approveNote')}</span>
            </span>
          </label>

          {importError && <p role="alert" className="text-sm text-dash-text">{importError}</p>}
          <button type="submit" className={action} disabled={importing||previewing||(method==='csv'&&(!preview||preview.invalidCount>0))}>
            {importing ? t('import.submitting') : t('import.submit')}
          </button>
          </fieldset>
        </form>
      </section>
      <MaintenanceNextSteps clientId={clientId} lang={locale} current="sources" copy={Object.fromEntries(workflowCopyKeys.map(key=>[key,t(key)])) as WorkflowCopy}/>
    </main>
  )
}
