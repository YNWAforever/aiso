'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
type Row = Record<string, unknown>
export type OutcomeView = { technical: { id: string; score: number; recordedAt: string; method: string | null; collection: string } | null;
  search: Row[]; analytics: Row[]; appearance: Row[]; clusters: Row[]; clusterOutcomes: Row[]; attempts: Row[]; regressions: Row[]; settings: { indexnow_key?: string } | null; lastSearchSync?: Row | null; window?: {start:string;end:string} }
const lines = (value: FormDataEntryValue | null) => String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
const cell = (value: unknown) => value == null ? '—' : String(value)
type Submission = { key: string; urls: string[] }
export function OutcomeWorkspace({ clientId, lang, initialView = null, initialSubmission = null }: { clientId: string; lang: string; initialView?: OutcomeView | null; initialSubmission?: Submission | null }) {
  const c = (lang === 'zh-HK' ? zhHK : en).outcomeIntegrations, base = `/api/clients/${clientId}/outcomes`
  const [view, setView] = useState<OutcomeView | null>(initialView), [credentials, setCredentials] = useState<Row[]>([])
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [secret, setSecret] = useState<{ id: string; secret: string } | null>(null)
  // Keep an intent across retries; change it only after a confirmed response.
  const [submission, setSubmission] = useState<Submission | null>(initialSubmission)
  const status = (value: unknown) => c[String(value) as keyof typeof c] ?? c.unknown
  async function load() {
    setError(false)
    try {
      const responses = await Promise.all([fetch(base, { cache: 'no-store' }), fetch(`${base}/credentials`, { cache: 'no-store' })])
      if (responses.some(response => !response.ok)) throw new Error()
      const [data, keys] = await Promise.all(responses.map(response => response.json()))
      setView(data); setCredentials(keys.credentials)
    } catch { setError(true) }
  }
  useEffect(() => { let alive = true; void (async () => {
    try {
      const responses = await Promise.all([fetch(base), fetch(`${base}/credentials`)])
      if (responses.some(response => !response.ok)) throw new Error()
      const [data, keys] = await Promise.all(responses.map(response => response.json()))
      if (alive) { setView(data); setCredentials(keys.credentials) }
    } catch { if (alive) setError(true) }
  })(); return () => { alive = false } }, [base])
  async function act(action: string, body: unknown) {
    if (busy) return null
    setBusy(true); setNotice('')
    try {
      const response = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error()
      const data = await response.json()
      setNotice(c.success); await load(); return data
    } catch { setNotice(c.failed); return null } finally { setBusy(false) }
  }
  const field = 'block w-full rounded border border-border bg-background p-2'
  const button = 'min-h-11 rounded bg-primary px-4 text-primary-foreground disabled:opacity-50'
  const panel = 'space-y-3 rounded-xl border border-border bg-card p-5'
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">{c.title}</h1><p>{c.intro}</p>{view?.window&&<p>{c.window}: {view.window.start} – {view.window.end}</p>}
    <nav className="flex gap-4"><button onClick={() => void load()} className="min-h-11 underline">{c.retry}</button><Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}/assets`}>{c.search}</Link><a className="inline-flex min-h-11 items-center underline" href={`/${lang}/guides/outcomes`}>{c.setup}</a></nav>
    {error && <p role="alert">{c.unavailable}</p>}{notice && <p role="status">{notice}</p>}
    {!view ? !error && <p role="status">{c.loading}</p> : <>
      <section className={panel}><h2 className="font-semibold">{c.technical}</h2>{view.technical ? <p>{view.technical.score}/100 · {view.technical.method ?? c.unknown} · {c.at}: {view.technical.recordedAt} · {status(view.technical.collection)}</p> : <p>{c.noScan}</p>}</section>
      <section className={panel}><h2 className="font-semibold">{c.retrieval}</h2><p>{c.noRetrieval}</p></section>
      <section className={panel}><h2 className="font-semibold">{c.outcomes}</h2><p>{c.limit}</p>{view.lastSearchSync && <p>{c.lastSync}: {view.lastSearchSync.outcome==='ok'?c.succeeded:view.lastSearchSync.outcome==='deferred'?c.partial:c.unknown} · {cell(view.lastSearchSync.ran_at)} · {c.through}: {cell(view.lastSearchSync.data_through)}</p>}
        {!view.search.length && !view.analytics.length && <p>{c.empty}</p>}
        {view.search.filter(row => row.scope === 'property').map((row, i) => <p key={i}>{c.search}: {c.clicks} {cell(row.clicks)} · {c.impressions} {cell(row.impressions)} · {c.position} {cell(row.position)}</p>)}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[c.page,c.currency,c.sessions,c.conversions,c.revenue].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{view.analytics.map((row,i) => <tr key={i}>{['page_url','currency','sessions','conversions','revenue_minor'].map(key => <td className="p-2" key={key}>{cell(row[key])}</td>)}</tr>)}</tbody></table></div>
        {view.appearance.length > 0 && <details><summary>{c.appearance}</summary>{view.appearance.map((row,i) => <p key={i}>{cell(row.page_url)} · {cell(row.appearance)} · {c.impressions}: {cell(row.impressions)}</p>)}</details>}
      </section>
      <section className={panel}><h2 className="font-semibold">{c.clusters}</h2><p>{c.clusterHint}</p>
        {view.clusterOutcomes.map(row => <p key={cell(row.id)}>{cell(row.name)} · {c.clicks}: {cell(row.clicks)} · {c.impressions}: {cell(row.impressions)} · {c.position}: {cell(row.position)}</p>)}
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act('clusters', { name: form.get('name'), keywords: lines(form.get('keywords')), targetUrl: form.get('target') }) }}>
          <label className="block">{c.name}<input className={field} name="name" required maxLength={100}/></label><label className="block">{c.keywords}<textarea className={field} name="keywords" required maxLength={1600}/></label><label className="block">{c.target}<input className={field} name="target" type="url" required maxLength={2048}/></label><button disabled={busy} className={button}>{c.add}</button>
        </form>
      </section>
      <section className={panel}><h2 className="font-semibold">{c.indexnow}</h2><p>{c.keyHint}</p><button className={button} disabled={busy} onClick={() => void act('indexnow-key', {})}>{c.key}</button>
        {view.settings?.indexnow_key && <pre className="overflow-x-auto whitespace-pre-wrap break-all">/{view.settings.indexnow_key}{c.keyFileSuffix}{'\n'}{view.settings.indexnow_key}</pre>}
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); const urls = lines(new FormData(event.currentTarget).get('urls')); const intent = submission ?? { key: crypto.randomUUID(), urls }; setSubmission(intent); void act('indexnow', { intentKey: intent.key, urls: intent.urls }).then(result => { if (result && ['succeeded','failed','blocked'].includes(result.status)) setSubmission(null) }) }}>
          <label className="block">{c.urls}<textarea className={field} name="urls" required maxLength={40000} disabled={submission !== null}/></label><button className={button} disabled={busy || !view.settings?.indexnow_key}>{submission ? c.checkSubmission : c.submit}</button>
        </form>
      </section>
      <section className={panel}><h2 className="font-semibold">{c.credential}</h2><p>{c.credentialHint}</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void act('credentials', { name: new FormData(event.currentTarget).get('name'), scopes: ['analytics','deployments'] }).then(result => { if (result) setSecret(result) }) }}><label className="block">{c.name}<input className={field} name="name" required maxLength={100}/></label><button className={button} disabled={busy}>{c.create}</button></form>
        {secret && <div role="status"><p>{c.secret}</p><pre className="overflow-x-auto">{secret.id}{'\n'}{secret.secret}</pre></div>}
        {credentials.map(key => <div key={cell(key.id)} className="flex flex-wrap items-center gap-3"><span>{cell(key.name)}</span>{!key.revoked_at && <button className="min-h-11 underline" disabled={busy} onClick={async () => { setBusy(true); try { const response = await fetch(`${base}/credentials/${key.id}`, { method: 'DELETE' }); if (!response.ok) throw new Error(); setSecret(null); await load() } catch { setNotice(c.failed) } finally { setBusy(false) } }}>{c.revoke}</button>}</div>)}
      </section>
      <section className={panel}><h2 className="font-semibold">{c.deployment}</h2><p>{c.deploymentHint}</p><p>{c.thresholds}</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act('deployments', { intentKey: crypto.randomUUID(), externalId: form.get('release'), deployedAt: new Date().toISOString(), urls: lines(form.get('urls')), baselineScanId: view.technical?.id ?? null }) }}><label className="block">{c.release}<input className={field} name="release" required maxLength={128}/></label><label className="block">{c.urls}<textarea className={field} name="urls" required maxLength={10000}/></label><button className={button} disabled={busy}>{c.record}</button></form>
      </section>
      <section className={panel}><h2 className="font-semibold">{c.regressions}</h2>{!view.regressions.length && <p>{c.empty}</p>}{view.regressions.map(row => <details key={cell(row.id)}><summary>{status(row.state)} · {cell(row.created_at)}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(row.evidence, null, 2)}</pre></details>)}</section>
      <section className={panel}><h2 className="font-semibold">{c.attempts}</h2>{!view.attempts.length && <p>{c.empty}</p>}{view.attempts.map(row => <p key={cell(row.id)}>{row.kind === 'indexnow' ? c.indexnow : status(row.kind)} · {row.status === 'failed' ? c.failedState : status(row.status)} · {cell(row.started_at)}</p>)}</section>
    </>}
  </div>
}
