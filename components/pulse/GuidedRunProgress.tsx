'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { derivePulseAvailability } from '@/lib/pulse/runs/availability'
import type { UserPulseRun } from '@/lib/pulse/runs/user-dispatch'
import type { MonitoringOptions } from '@/lib/pulse/runs/read-view'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

type Options = MonitoringOptions
type Action = 'initial' | 'repair' | 'retest' | 'saved' | 'legacy'
type Props = {
  lang: string; clientId: string; brandName?: string
  options: Options | null; run: UserPulseRun | null; error: string | null; busy: boolean
  repairOutcome: { classified: number; unchanged: number; failed: number } | null
  refresh: () => void
  start: (kind: 'initial' | 'repair' | 'retest') => Promise<void>
  repair: (runId?: string) => Promise<void>
}
const fill = (text: string, values: Record<string, number | string>) =>
  Object.entries(values).reduce((s, [key, value]) => s.replaceAll(`{${key}}`, String(value)), text)
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50'

/** Display and explicit confirmation only. All writes use the existing run controller. */
export function GuidedRunProgress({ lang, clientId, brandName, options, run, error, busy, repairOutcome, refresh, start, repair }: Props) {
  const copy = (lang === 'zh-HK' ? zh : en).runProgress
  const c = copy.sme
  const base = `/${lang}/dashboard/${encodeURIComponent(clientId)}`
  const availability = options ? derivePulseAvailability({ ...options, currentCanonicalId: options.currentCanonicalId ?? null, legacyCurrentWeek: options.legacyCurrentWeek === true }) : null
  const [confirmation, setConfirmation] = useState<{ action: Action; signature: string } | null>(null)
  const panel = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returning = useRef(false)
  useEffect(() => { if (returning.current && !busy) { heading.current?.focus(); returning.current = false } }, [busy, run, error])
  const trigger = useRef<HTMLButtonElement | null>(null)
  const signature = JSON.stringify([clientId, options?.week, options?.prompts, options?.variants, options?.models, options?.contextConfirmed, options?.enabled, options?.remaining, options?.currentCanonicalId, options?.legacyObservationIds, run?.id, run?.coverage.expected, run?.classificationRepairIds])
  useEffect(() => { if (confirmation) panel.current?.focus() }, [confirmation])
  const retestReady = !!options && !!run && run.coverage.status === 'completed' && run.coverage.expected > 0 && options.remaining >= run.coverage.expected && options.enabled && options.contextConfirmed && options.variants > 0
  function eligible(action: Action) {
    if (busy || error || !options) return false
    if (action === 'initial') return availability?.canStart === true
    if (action === 'retest') return retestReady
    if (action === 'repair') return options.enabled && run?.retryable === true
    if (action === 'saved') return !!run?.classificationRepairIds?.length
    return options.enabled && options.legacyObservationIds.length > 0
  }
  function request(action: Action, source: HTMLButtonElement) {
    if (!eligible(action)) return
    trigger.current = source
    setConfirmation({ action, signature })
  }
  function cancel() { setConfirmation(null); trigger.current?.focus() }
  async function confirm() {
    if (!confirmation || confirmation.signature !== signature || !eligible(confirmation.action)) return
    const action = confirmation.action
    returning.current = true
    setConfirmation(null)
    if (action === 'saved') await repair(run!.id)
    else if (action === 'legacy') await repair()
    else await start(action)
  }
  const results = run ? `${base}/observations?run=${encodeURIComponent(run.id)}&week=${encodeURIComponent(run.week)}` : `${base}/observations`
  const currentResults = options?.currentCanonicalId ? `${base}/observations?run=${encodeURIComponent(options.currentCanonicalId)}&week=${encodeURIComponent(options.week)}` : `${base}/observations?result=incomplete`
  const changed = confirmation && (confirmation.signature !== signature || !eligible(confirmation.action))

  return <section id="first-monitoring" aria-labelledby="monitoring-heading" aria-busy={busy} className="my-6 space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
    <header><h2 ref={heading} tabIndex={-1} id="monitoring-heading" className="text-xl font-bold">{c.title}</h2>{brandName && <p className="mt-1 text-sm text-muted-foreground">{brandName}</p>}</header>
    {error ? <div role="alert" className="space-y-3"><p>{error}</p>{error === c.planRequired && <Link className={button} href={`/${lang}/pricing`}>{c.viewPlans}</Link>}{error === c.signInRequired && <Link className={button} href={`/${lang}/auth/login`}>{c.signIn}</Link>}<button type="button" className={button} disabled={busy} onClick={refresh}>{copy.refresh}</button></div> : !options ? <p role="status">{copy.loading}</p> : <>
      <p className="text-sm text-muted-foreground">{c.week}: {options.week}</p>
      <p className="font-semibold">{!options.enabled ? c.paused : run ? c.states[run.coverage.status] : availability?.canStart ? c.ready : c.needsAttention}</p>
      {availability && availability.reasons.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm" aria-label={copy.availabilityTitle}>{availability.reasons.map(reason => <li key={reason}>{c.blockers[reason]}</li>)}</ul>}
      {run && <div className="space-y-2" aria-live="polite">
        <p className="text-sm">{run.purpose === 'retest' ? c.retest : c.weekly}: {run.week}</p>
        <p>{fill(c.saved, { saved: run.coverage.succeeded, expected: run.coverage.expected })}</p>
        <p className="text-sm text-muted-foreground">{fill(c.checked, { checked: run.coverage.classified, saved: run.coverage.succeeded })}</p>
        {run.reasons.map(reason => <p className="text-sm" key={reason}>{copy.reasons[reason as keyof typeof copy.reasons] ?? copy.unavailable}</p>)}
      </div>}
      <div className="flex flex-wrap gap-3">
        {availability?.canStart ? <button type="button" className={button + ' bg-primary text-primary-foreground'} disabled={busy} onClick={e => request('initial', e.currentTarget)}>{c.start}</button>
          : run ? <Link className={button + ' bg-primary text-primary-foreground'} href={results}>{c.viewAnswers}</Link>
          : availability?.action === 'view_existing' ? <Link className={button} href={currentResults}>{copy.viewExisting}</Link>
          : availability?.action === 'edit_prompts' ? <Link className={button} href={`${base}/prompts`}>{copy.setup}</Link>
          : <button type="button" className={button} disabled={busy} onClick={refresh}>{copy.refresh}</button>}
      </div>
      {confirmation && <section ref={panel} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel() } }} aria-labelledby="monitor-confirm-heading" className="space-y-3 rounded-xl border border-primary p-4 focus-visible:outline-2 focus-visible:outline-offset-2">
        <h3 id="monitor-confirm-heading" className="font-semibold">{c.confirmTitle}</h3>
        {brandName && <p>{brandName}</p>}
        <p>{confirmation.action === 'initial' ? fill(copy.workload, { prompts: options.prompts, variants: options.variants, expected: options.expected }) : confirmation.action === 'saved' || confirmation.action === 'legacy' ? fill(c.classificationWork, { count: confirmation.action === 'saved' ? run?.classificationRepairIds?.length ?? 0 : options.legacyObservationIds.length }) : fill(c.savedWorkload, { expected: run?.coverage.expected ?? 0 })}</p>
        <p className="text-sm">{confirmation.action === 'saved' || confirmation.action === 'legacy' ? copy.repairSavedNotice : c.collectionNotice}</p>
        <p className="text-sm">{fill(copy.budget, { remaining: options.remaining })}</p><p className="text-sm">{copy.cost}</p>
        {changed && <p role="status">{c.changed}</p>}
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !!changed} onClick={() => void confirm()}>{c.confirm}</button><button type="button" className={button} disabled={busy} onClick={cancel}>{c.cancel}</button></div>
      </section>}
      {repairOutcome && <p role="status">{fill(copy.repairOutcome, repairOutcome)}</p>}
      <details className="border-t border-border pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm">{c.details}</summary><div className="space-y-3 pt-2 text-sm">
        <p>{fill(copy.workload, { prompts: options.prompts, variants: options.variants, expected: options.expected })}</p>
        <p>{fill(copy.budget, { remaining: options.remaining })}</p><p>{copy.cost}</p><p>{copy.schedule}</p>
        <p>{fill(copy.search, { requested: options.search.requested === 'off' ? copy.searchOff : copy.searchAllowance })}</p>
        <Link className={button} href={`${base}/prompts`}>{copy.reviewQuestions}</Link>
        {run?.retryable && <button type="button" className={button} disabled={!eligible('repair')} onClick={e => request('repair', e.currentTarget)}>{copy.repair}</button>}
        {!!run?.classificationRepairIds?.length && <button type="button" className={button} disabled={!eligible('saved')} onClick={e => request('saved', e.currentTarget)}>{copy.repairSaved}</button>}
        {!!options.legacyObservationIds.length && <button type="button" className={button} disabled={!eligible('legacy')} onClick={e => request('legacy', e.currentTarget)}>{copy.repairLegacy}</button>}
        {run?.purpose === 'canonical' && run.coverage.status === 'completed' && <button type="button" className={button} disabled={busy} onClick={() => void repair(run.id)}>{copy.repairSummary}</button>}
        {run?.coverage.status === 'completed' && <button type="button" className={button} disabled={!retestReady || busy} onClick={e => request('retest', e.currentTarget)}>{copy.retest}</button>}
        {options.latest && options.latest.id !== run?.id && <Link className={button} href={`${base}/observations?run=${encodeURIComponent(options.latest.id)}&week=${encodeURIComponent(options.latest.week)}`}>{c.latest}</Link>}
        <button type="button" className={button} disabled={busy} onClick={refresh}>{copy.refresh}</button>
      </div></details>
    </>}
  </section>
}
