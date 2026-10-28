import { useTranslations } from 'next-intl'
import type { OwnedResultEvidence } from '@/lib/result-evidence'

const STATES = new Set(['complete', 'partial', 'blocked', 'failed', 'unsupported', 'unknown', 'pass', 'warn', 'fail', 'not-verifiable', 'not-applicable'])

export function ScanEvidencePanel({ evidence, ariaLabel }: { evidence: OwnedResultEvidence | null; ariaLabel?: string }) {
  const t = useTranslations('scanEvidence')
  const label = (state: string) => t(`states.${STATES.has(state) ? state : 'unknown'}`)
  return (
    <section aria-label={ariaLabel ?? t('title')} data-testid="owned-scan-evidence" className="rounded-2xl border border-border bg-card p-5 text-sm text-foreground/80">
      <h2 className="font-bold text-foreground">{t('title')}</h2>
      <p className="mt-2 text-xs leading-relaxed">{t('scope')}</p>
      {!evidence ? <p className="mt-3">{t('absent')}</p> : <>
        {evidence.limited && <p className="mt-3 text-xs">{t('limited')}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <dt>{t('collection')}</dt><dd>{label(evidence.collection)}</dd>
          <dt>{t('pages')}</dt><dd>{evidence.completedPages}</dd>
          <dt>{t('collected')}</dt><dd>{evidence.collectedAt ? <time dateTime={evidence.collectedAt}>{evidence.collectedAt}</time> : t('states.unknown')}</dd>
          <dt>{t('scanner')}</dt><dd>{evidence.scannerVersion}</dd>
          <dt>{t('method')}</dt><dd>{evidence.methodologyVersion}</dd>
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">{t('check')} / {t('collection')} / {t('assessment')}</summary>
          <ul className="mt-2 space-y-2 text-xs">{evidence.checks.map(check => <li key={check.key}>
            <span className="font-mono">{check.key}</span>: {label(check.collection)} · {label(check.assessment)}
          </li>)}</ul>
        </details>
      </>}
    </section>
  )
}
