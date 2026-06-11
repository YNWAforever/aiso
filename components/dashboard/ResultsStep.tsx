import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ScanSummary } from '@/components/dashboard/ScanSummary'
import type { Scan } from '@/lib/types'

type Props = { scan: Scan; lang: string; clientId: string }

export function ResultsStep({ scan, lang, clientId }: Props) {
  const t = useTranslations('dashboard')
  return (
    <div className="space-y-5">
      <ScanSummary scan={scan} />

      <div className="flex items-center gap-3">
        <Link
          href={`/${lang}/dashboard/${clientId}?step=improve`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-primary-foreground bg-dash-accent hover:opacity-90 transition-opacity"
        >
          {t('next_improve')}
        </Link>
        <Link
          href={`/${lang}/dashboard/${clientId}?step=scan`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-dash-text bg-dash-elevated border border-dash-border hover:bg-dash-border transition-colors"
        >
          {t('run_another_scan')}
        </Link>
      </div>
    </div>
  )
}
