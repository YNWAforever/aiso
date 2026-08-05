'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

export type ClaimReturnState =
  | 'idle' | 'claiming' | 'claimed' | 'already-owned'
  | 'not-found' | 'conflict' | 'error'

export function buildScanClaimNext(lang: string, scanId: string): string {
  return `/${lang}/result/${encodeURIComponent(scanId)}?claim=1`
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
  return 'error'
}

export function ClaimScanOnReturn({ scanId, lang }: { scanId: string; lang: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('home')
  const attempted = useRef(false)
  const [state, setState] = useState<ClaimReturnState>('idle')

  const claim = useCallback(async () => {
    setState('claiming')
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(scanId)}/claim`, { method: 'POST' })
      let body: unknown = null
      try {
        body = await response.json()
      } catch {}
      const result = classifyClaimResponse(response.status, body)
      setState(result)
      if (result === 'claimed' || result === 'already-owned') {
        router.replace(`/${lang}/result/${encodeURIComponent(scanId)}`)
      }
    } catch {
      setState('error')
    }
  }, [lang, router, scanId])

  useEffect(() => {
    if (searchParams.get('claim') !== '1' || attempted.current) return
    attempted.current = true
    void claim()
  }, [claim, searchParams, scanId])

  if (searchParams.get('claim') !== '1') return null

  const message = state === 'claiming'
    ? t('claiming_report')
    : state === 'claimed' || state === 'already-owned'
      ? t('report_saved')
      : state === 'not-found'
        ? t('scan_not_found')
        : state === 'conflict'
          ? t('scan_conflict')
          : state === 'error'
            ? t('claim_failed')
            : ''
  const retryable = state === 'not-found' || state === 'conflict' || state === 'error'

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="claim-status">
      <p role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
        {message}
      </p>
      {retryable ? (
        <button
          type="button"
          onClick={() => void claim()}
          className="mt-2 min-h-11 rounded-lg px-3 text-sm font-bold text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('retry_saving')}
        </button>
      ) : null}
    </div>
  )
}
