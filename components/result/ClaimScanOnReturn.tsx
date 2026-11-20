'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { trackFunnelEvent } from '@/lib/funnel-client'

export type ClaimReturnState =
  | 'idle' | 'claiming' | 'claimed' | 'already-owned'
  | 'not-found' | 'conflict' | 'unauthorized' | 'intent-required' | 'rate-limited' | 'error'

export function buildScanClaimNext(lang: string, scanId: string): string {
  return `/${lang}/result/${encodeURIComponent(scanId)}?claim=1`
}

export async function requestScanClaim(scanId: string, lang: string, renewIntent = false): Promise<Response> {
  if (renewIntent) {
    // A failed write may have already spent the original one-use intent.
    // Re-mint through the existing public gate; a newly owned scan is refused.
    const intent = await fetch(`/api/scans/${encodeURIComponent(scanId)}/claim-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    })
    if (!intent.ok) return intent
  }
  return fetch(`/api/scans/${encodeURIComponent(scanId)}/claim`, { method: 'POST' })
}

export function classifyClaimResponse(
  status: number,
  body: unknown,
): Exclude<ClaimReturnState, 'idle' | 'claiming'> {
  if (status === 200 && body && typeof body === 'object' && 'ok' in body && body.ok === true) {
    return 'alreadyOwned' in body && body.alreadyOwned === true ? 'already-owned' : 'claimed'
  }
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'intent-required'
  if (status === 429) return 'rate-limited'
  return 'error'
}

export function getClaimReturnFunnelEvents(status: number, body: unknown) {
  const result = classifyClaimResponse(status, body)
  return [result === 'claimed' || result === 'already-owned' ? 'scan_claim_succeeded' : 'scan_claim_failed'] as const
}

export function claimRetrySeconds(response: Response) {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(600, Math.ceil(seconds)) : 60
}

export function ClaimScanOnReturn({ scanId, lang }: { scanId: string; lang: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('home')
  const attempted = useRef(false)
  const inFlight = useRef(false)
  const [retrySeconds, setRetrySeconds] = useState(60)
  const replaceFrame = useRef<number | null>(null)
  const [state, setState] = useState<ClaimReturnState>('idle')
  const locale = lang === 'zh-HK' ? 'zh-HK' : 'en'

  const claim = useCallback(async (renewIntent = false) => {
    if (inFlight.current) return
    inFlight.current = true
    setState('claiming')
    try {
      const response = await requestScanClaim(scanId, lang, renewIntent)
      let body: unknown = null
      try {
        body = await response.json()
      } catch {}
      if (renewIntent && response.status === 409 && body && typeof body === 'object'
        && 'error' in body && body.error === 'Scan already belongs to an account') {
        // The original claim may have succeeded before its response was lost.
        // A fresh page request lets the server decide which account owns it.
        window.location.replace(`/${lang}/result/${encodeURIComponent(scanId)}`)
        return
      }
      const result = classifyClaimResponse(response.status, body)
      if (result === 'rate-limited') setRetrySeconds(claimRetrySeconds(response))
      setState(result)
      if (result === 'claimed' || result === 'already-owned') {
        trackFunnelEvent({ name: 'scan_claim_succeeded', locale, scanId })
        replaceFrame.current = window.requestAnimationFrame(() => {
          router.replace(`/${lang}/result/${encodeURIComponent(scanId)}`)
        })
      } else {
        trackFunnelEvent({
          name: 'scan_claim_failed',
          locale,
          scanId,
          errorCode: result === 'not-found'
            ? 'not_found'
            : result === 'conflict'
              ? 'conflict'
              : result === 'unauthorized'
                ? 'unauthorized'
                : result === 'rate-limited' ? 'rate_limited' : 'temporary',
        })
      }
    } catch {
      setState('error')
      trackFunnelEvent({ name: 'scan_claim_failed', locale, scanId, errorCode: 'temporary' })
    } finally {
      inFlight.current = false
    }
  }, [lang, locale, router, scanId])

  useEffect(() => {
    if (searchParams.get('claim') !== '1' || attempted.current) return
    attempted.current = true
    void claim()
  }, [claim, searchParams, scanId])

  useEffect(() => () => {
    if (replaceFrame.current !== null) window.cancelAnimationFrame(replaceFrame.current)
  }, [])

  const hasClaimParam = searchParams.get('claim') === '1'
  const isSaved = state === 'claimed' || state === 'already-owned'
  if (!hasClaimParam && !isSaved) return null

  const messageKeys = {
    idle: null, claiming: 'claiming_report', claimed: 'report_saved', 'already-owned': 'report_saved',
    'not-found': 'scan_not_found', conflict: 'scan_conflict', unauthorized: 'claim_unauthorized',
    'intent-required': 'claim_expired', 'rate-limited': null, error: 'claim_failed',
  } as const
  const messageKey = messageKeys[state]
  const message = state === 'rate-limited' ? t('claim_rate_limited', { seconds: retrySeconds }) : messageKey ? t(messageKey) : ''
  const retryable = state === 'intent-required' || state === 'rate-limited' || state === 'error'

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3" data-testid="claim-status">
      <p role="status" aria-live="polite" className="text-sm font-medium text-foreground/80">
        {message}
      </p>
      {retryable ? (
        <button
          type="button"
          onClick={() => {
            trackFunnelEvent({ name: 'scan_retry_clicked', locale, scanId })
            void claim(true)
          }}
          className="mt-2 min-h-11 rounded-lg px-3 text-sm font-bold text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('retry_saving')}
        </button>
      ) : null}
      {state === 'unauthorized' && (
        <Link href={`/${lang}/auth/login?next=${encodeURIComponent(buildScanClaimNext(lang, scanId))}`} className="mt-2 inline-flex min-h-11 items-center px-3 font-semibold text-primary-accessible underline">{t('claim_sign_in')}</Link>
      )}
      {isSaved ? (
        <Link
          href={`/${lang}/dashboard`}
          className="mt-2 inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-bold text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('go_to_dashboard')}
        </Link>
      ) : null}
    </div>
  )
}
