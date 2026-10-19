'use client'

import { useTranslations } from 'next-intl'
import {
  evaluateWorkVerification,
  type WorkVerificationBaseline,
  type WorkVerificationObservation,
} from '@/lib/work-items/verification'

export function VerificationPreview({
  baseline,
  reportedAt,
  observations,
}: {
  baseline: WorkVerificationBaseline
  reportedAt: string
  observations: WorkVerificationObservation[]
}) {
  const t = useTranslations('opportunities')
  const result = evaluateWorkVerification({ baseline, reportedAt, observations })
  const stateCopy = {
    observed_improvement: t('verificationObservedImprovement'),
    no_observed_improvement: t('verificationNoObservedImprovement'),
    insufficient_evidence: t('verificationInsufficient'),
  }[result.state]
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-label={t('verificationTitle')}>
      <h3 className="font-semibold">{t('verificationTitle')}</h3>
      <p className="text-sm">{t('verificationSyntheticNotice')}</p>
      <p data-verification-state={result.state} className="font-semibold">{stateCopy}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t('verificationBaseline')}</dt>
          <dd>{baseline.source} · {baseline.observedAt ?? t('findingsTimeUnknown')}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('verificationReportedAt')}</dt>
          <dd>{reportedAt}</dd>
        </div>
      </dl>
      <ul className="space-y-2">
        {result.observations.map(observation => (
          <li key={observation.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-semibold">{observation.source}</p>
            <p>{t('verificationObservedAt')}: {observation.observedAt ?? t('findingsTimeUnknown')}</p>
            <p>{t('verificationTarget')}: {observation.target ?? t('findingsTargetMissing')}</p>
          </li>
        ))}
      </ul>
      {result.reasons.length > 0 && (
        <p className="text-sm">{t('verificationReasons')}: {result.reasons.join(', ')}</p>
      )}
      <p className="text-sm">{t('verificationAttribution')}</p>
    </section>
  )
}
