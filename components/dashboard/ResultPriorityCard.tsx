'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { EvidenceDetails } from '@/components/opportunities/EvidenceDetails'
import { getCheckActionCopy, getCheckExplanations } from '@/lib/checkExplanations'
import { firstScanOpportunity, isEligibleScanOpportunity } from '@/lib/opportunities/scan-selection'
import type { OpportunityResponse } from '@/lib/opportunities/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { useAuthRateLimit } from '@/components/auth/useAuthRateLimit'

type Props = {
  clientId: string; scanId: string; brandName?: string | null
  initial: ReturnType<typeof firstScanOpportunity>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function ResultPriorityLoading() {
  const t = useTranslations('resultSummary')
  return <p role="status" className="p-4 text-sm text-dash-muted">{t('priorityLoading')}</p>
}
export function ResultPriorityCard(props: Props) {
  const initial = props.initial.suggestion && !isEligibleScanOpportunity(props.initial.suggestion, props.scanId)
    ? { ...props.initial, suggestion: null } : props.initial
  return <PriorityContent key={`${props.clientId}:${props.scanId}:${initial.suggestion?.fingerprint ?? initial.unavailable}`} {...props} initial={initial} />
}
function PriorityContent({ clientId, scanId, brandName, initial }: Props) {
  const t = useTranslations('resultSummary'), checks = useTranslations('checks')
  const locale = useLocale() === 'zh-HK' ? 'zh-HK' : 'en', router = useRouter()
  const { captureAuthLimit, clearAuthLimit, authWaiting, authNotice } = useAuthRateLimit()
  const [data, setData] = useState(initial), [busy, setBusy] = useState<'saving' | 'refreshing' | null>(null)
  const [error, setError] = useState<'saveFailed' | 'evidenceChanged' | null>(null), [savedId, setSavedId] = useState<string | null>(null)
  const active = useRef(true), lock = useRef(false), request = useRef<AbortController | null>(null)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; request.current?.abort() }
  }, [])
  const suggestion = data.suggestion, draftId = savedId ?? suggestion?.savedDraftId
  const draftHref = (id: string) => `/${locale}/dashboard/${clientId}?step=improve&scanId=${encodeURIComponent(scanId)}&draft=${encodeURIComponent(id)}`
  async function refresh() {
    if (lock.current || authWaiting) return
    lock.current = true; setBusy('refreshing')
    const controller = new AbortController(); request.current = controller
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/clients/${clientId}/opportunities?scanId=${encodeURIComponent(scanId)}`, { cache: 'no-store', signal: controller.signal })
      if (await captureAuthLimit(response)) return
      if (!response.ok) throw new Error()
      const next = await response.json() as OpportunityResponse
      if (!next.window || next.window.scanId !== scanId || !Array.isArray(next.suggestions)) throw new Error()
      if (!active.current || controller.signal.aborted) return
      setData(firstScanOpportunity(next, scanId)); setError(null); setSavedId(null)
      clearAuthLimit()
    } catch { if (active.current) setData(old => ({ ...old, unavailable: true })) }
    finally { clearTimeout(timer); if (active.current) { lock.current = false; setBusy(null) } }
  }
  async function create() {
    if (!suggestion || lock.current || error === 'evidenceChanged' || authWaiting) return
    lock.current = true; setBusy('saving'); setError(null)
    const controller = new AbortController(); request.current = controller
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(`/api/clients/${clientId}/work-items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ source: suggestion.source, ruleVersion: suggestion.ruleVersion, fingerprint: suggestion.fingerprint, locale }),
      })
      if (!active.current || controller.signal.aborted) return
      if (await captureAuthLimit(response)) return
      if (response.status === 409) { setError('evidenceChanged'); return }
      if (![200, 201].includes(response.status)) throw new Error()
      const item = (await response.json()).item as WorkItem
      const scoped = Array.isArray(item?.sourceScanIds) ? item.sourceScanIds.includes(scanId)
        : item?.sourceScanIds === undefined && item?.evidenceSnapshot?.source.kind === 'scan-check' && item.evidenceSnapshot.source.id === scanId
      if (!item || !UUID.test(item.id) || item.clientId !== clientId || !scoped || item.status !== 'draft' || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error()
      if (!active.current || controller.signal.aborted) return
      setSavedId(item.id)
      clearAuthLimit()
      router.push(draftHref(item.id))
    } catch { if (active.current) setError('saveFailed') }
    finally { clearTimeout(timer); if (active.current) { lock.current = false; setBusy(null) } }
  }
  const button = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const copy = suggestion && getCheckActionCopy(suggestion.evidence.checkKey, locale)
  const full = suggestion && getCheckExplanations(locale)[suggestion.evidence.checkKey]
  const collectedAt = suggestion?.evidence.collectedAt
  const recorded = collectedAt && Number.isFinite(Date.parse(collectedAt))
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(collectedAt)) : t('unknownTime')
  return <section aria-label={t('firstAction')} data-testid="result-priority" className="min-w-0 space-y-3 rounded-xl border border-primary/30 bg-dash-surface p-4 sm:p-5" aria-busy={busy !== null}>
    <p className="break-words text-xs font-semibold text-dash-muted">{brandName ? `${brandName} · ` : ''}{t('firstAction')}</p>
    {data.unavailable ? <p role="status">{t('priorityUnavailable')}</p> : suggestion ? <>
      <h2 className="text-xl font-bold text-dash-text">{checks(suggestion.evidence.checkKey)}</h2>
      <p className="text-sm text-dash-text">{t(`assessment.${suggestion.evidence.check.assessment}`)} · {copy?.nextStep}</p>
      <p className="flex min-w-0 flex-wrap gap-x-2 text-xs text-dash-muted">
        <span>{t('prioritySource')}:</span>
        {suggestion.evidence.evaluated.origin
          ? <a className="max-w-full truncate underline" href={suggestion.evidence.evaluated.origin} target="_blank" rel="noopener noreferrer">{suggestion.evidence.evaluated.origin}</a>
          : <span>{t('unavailable')}</span>}
        <span>{recorded}</span>
      </p>
      {draftId && UUID.test(draftId)
        ? <Link className={`${button} bg-primary text-primary-foreground`} href={draftHref(draftId)}>{t('openDraft')}</Link>
        : <button className={`${button} bg-primary text-primary-foreground disabled:opacity-50`} disabled={busy !== null || error === 'evidenceChanged' || authWaiting} onClick={() => void create()}>{t(busy === 'saving' ? 'creatingDraft' : 'createDraft')}</button>}
      {savedId && <p role="status" className="text-sm">{t('priorityDraftSaved')}</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">{t('priorityEvidence')}</summary>
        <div className="space-y-3 pt-2 text-sm">
          <p>{full?.fix[suggestion.evidence.check.assessment as 'fail' | 'warn']}</p>
          <p>{t('priorityReason')}</p>
          <p>{t('priorityScope')}</p>
          <EvidenceDetails evidence={suggestion.evidence} limitations={suggestion.limitations} />
        </div>
      </details>
    </> : <p>{t('priorityEmpty')}</p>}
    {error && <p role="alert" className="text-sm">{t(error)}</p>}
    {authNotice}
    {(data.unavailable || error === 'evidenceChanged') && <button className={`${button} border border-dash-border`} disabled={busy !== null || authWaiting} onClick={() => void refresh()}>{t(busy === 'refreshing' ? 'refreshingPriority' : 'refreshPriority')}</button>}
    <p className="text-xs text-dash-muted">{t('priorityDraftNotice')}</p>
  </section>
}
