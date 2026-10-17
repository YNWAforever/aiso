'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

/** Minimal client island: only the auto-refresh needs the router. */
export function ScanRunState({ processing, retryHref }: { processing: boolean; retryHref: string }) {
  const t = useTranslations('dashboard')
  const router = useRouter()

  // A claim row is visible before the scan finishes, so a returning user sees
  // progress instead of an empty result. Refresh the server projection rather
  // than re-POSTing the scan; the requestKey keeps both paths on one row.
  useEffect(() => {
    if (!processing) return
    const timer = setInterval(() => router.refresh(), 5_000)
    return () => clearInterval(timer)
  }, [processing, router])

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center" data-testid="scan-state">
      <h2 className="mb-2 text-sm font-semibold text-dash-text">
        {processing ? t('scan_processing_title') : t('scan_failed_title')}
      </h2>
      <p className="mx-auto mb-5 max-w-md text-xs leading-relaxed text-dash-muted">
        {processing ? t('scan_processing_body') : t('scan_failed_body')}
      </p>
      {!processing && (
        <Link
          href={retryHref}
          className="inline-flex min-h-11 items-center rounded-lg bg-dash-accent px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('scan_retry')}
        </Link>
      )}
    </div>
  )
}
