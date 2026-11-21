import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ScanSummary } from '@/components/dashboard/ScanSummary'
import type { Scan } from '@/lib/types'
import type { EvidenceCheckKey } from '@/lib/scan-evidence-versions'
import { scanReportHref, selectionQuery } from '@/lib/result/links'

type Props = { scan: Scan; lang: string; clientId: string; focusedCheck?: EvidenceCheckKey }

export function ResultsStep({ scan, lang, clientId, focusedCheck }: Props) {
  const t = useTranslations('dashboard')
  const reports = useTranslations('reports')
  return (
    <div className="space-y-5">
      <ScanSummary key={`${scan.id}:${focusedCheck ?? ''}`} scan={scan} clientId={clientId} focusedCheck={focusedCheck} />

      <div className="flex flex-wrap items-center gap-3">
        <Link href={scanReportHref(lang, clientId, scan.id)} className="inline-flex min-h-11 items-center rounded-lg border border-dash-border px-5 py-2.5 text-sm font-medium text-dash-text hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {reports('open_aeo_report')}
        </Link>
        <Link
          href={`/${lang}/dashboard/${clientId}?step=improve&${selectionQuery({scanId:scan.id, check:focusedCheck})}`}
          className="inline-flex min-h-11 items-center px-5 py-2.5 text-sm font-medium rounded-lg text-primary-foreground bg-dash-accent hover:opacity-90 transition-opacity"
        >
          {t('next_improve')}
        </Link>
        <Link
          href={`/${lang}/dashboard/${clientId}/reports/new?scanId=${encodeURIComponent(scan.id)}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-dash-border px-5 py-2.5 text-sm font-medium text-dash-text hover:bg-dash-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {reports('create_share_report')}
        </Link>
        <Link
          href={`/${lang}/dashboard/${clientId}?step=scan&${selectionQuery({ scanId: scan.id, check: focusedCheck })}`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-dash-text bg-dash-elevated border border-dash-border hover:bg-dash-border transition-colors"
        >
          {t('run_another_scan')}
        </Link>
      </div>
    </div>
  )
}
