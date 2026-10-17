import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ScanSummary } from '@/components/dashboard/ScanSummary'
import { SavedScanSummary } from '@/components/dashboard/SavedScanSummary'
import { ScanRunState } from '@/components/dashboard/ScanRunState'
import type { Scan } from '@/lib/types'
import type { ScanSummaryView } from '@/lib/view-models/scan-summary'

type Props = { scan: Scan; lang: string; clientId: string; view?: ScanSummaryView | null; brandName?: string | null }

export function ResultsStep({ scan, lang, clientId, view, brandName }: Props) {
  const t = useTranslations('dashboard')
  const results = (scan.results ?? {}) as Record<string, unknown>
  const runState = results._scan_request && typeof results._scan_request === 'object'
    ? (results._scan_request as Record<string, unknown>).state
    : null
  const hasScore = Number.isFinite(scan.score)
  const processing = !hasScore && runState === 'processing'

  if (!hasScore && !view?.evidence) {
    const retryHref = `/${lang}/dashboard/${clientId}?step=scan${scan.url ? `&url=${encodeURIComponent(scan.url)}` : ''}`
    return <><ScanRunState processing={processing} retryHref={retryHref} /><SavedScanSummary value={results._n8n} /></>
  }

  return (
    <div className="space-y-5">
      <ScanSummary scan={scan} view={view} brandName={brandName} />
      <SavedScanSummary value={results._n8n} />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/${lang}/dashboard/${clientId}?step=improve&scanId=${encodeURIComponent(scan.id)}`}
          className="inline-flex min-h-11 items-center rounded-lg bg-dash-accent px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('next_improve')}
        </Link>
        <Link
          href={`/${lang}/dashboard/${clientId}?step=scan`}
          className="inline-flex min-h-11 items-center rounded-lg border border-dash-border bg-dash-elevated px-5 py-2.5 text-sm font-medium text-dash-text transition-colors hover:bg-dash-border"
        >
          {t('run_another_scan')}
        </Link>
      </div>
    </div>
  )
}
