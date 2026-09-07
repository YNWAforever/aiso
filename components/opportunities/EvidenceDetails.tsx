'use client'
import { useTranslations } from 'next-intl'
import type { SuggestionEvidence } from '@/lib/opportunities/types'
export function EvidenceDetails({
  evidence,
  limitations = [],
}: {
  evidence: SuggestionEvidence
  limitations?: string[]
}) {
  const t = useTranslations('opportunities')
  const date = (value: string | null) => value ?? t('unknownRecordedAt')
  return (
    <div className="min-w-0 space-y-3 break-words text-sm">
      <p>{evidence.kind === 'pulse-metric' ? t('pulseWhy') : t('scanWhy')}</p>
      <p>
        {t('recordedAt')}: {date(evidence.recordedAt)}
      </p>
      {evidence.kind === 'pulse-metric' ? (
        <>
          <p className="whitespace-pre-wrap">
            {t('question')}: {evidence.question}
          </p>
          <p>
            {t('platform')}: {evidence.platform}
          </p>
          <p>
            {t('week')}: {evidence.scanWeek}
          </p>
          <p>{t('pulseUnknowns')}</p>
        </>
      ) : (
        <>
          <p>
            {t('check')}: {evidence.checkKey} ·{' '}
            {t(evidence.check.assessment === 'warn' ? 'warning' : 'failed')}
          </p>
          <p>
            {t('collectedAt')}:{' '}
            {evidence.collectedAt ?? t('unknownCollectionTime')}
          </p>
          <p>
            {t('origin')}: {evidence.evaluated.origin ?? t('unknown')}
          </p>
          <p>{t('redacted')}</p>
          {evidence.limited && <p>{t('limitedScan')}</p>}
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              {t('collectionDetails')}
            </summary>
            <dl className="space-y-2">
              <dt>{t('requestedOrigin')}</dt>
              <dd>{evidence.requested.origin ?? t('unknown')}</dd>
              <dt>{t('finalOrigin')}</dt>
              <dd>{evidence.final?.origin ?? t('unknown')}</dd>
              <dt>{t('collection')}</dt>
              <dd>
                {t.has(`states.${evidence.collection}`)
                  ? t(`states.${evidence.collection}`)
                  : t('unknown')}
              </dd>
              <dt>{t('methods')}</dt>
              <dd>
                {evidence.scannerVersion} · {evidence.check.version} ·{' '}
                {evidence.headlineMethod} · {evidence.pillarMethod}
              </dd>
            </dl>
            {evidence.observations.map((row, i) => (
              <div key={i} className="mt-3 border-t border-border pt-3">
                <p>
                  {row.target.origin ?? t('unknown')} ·{' '}
                  {row.observedAt ?? t('unknownCollectionTime')}
                </p>
                <p>
                  {t('collection')}:{' '}
                  {t.has(`states.${row.collection}`)
                    ? t(`states.${row.collection}`)
                    : t('unknown')}
                </p>
                <p>
                  {t('provenance')}:{' '}
                  {row.provenance ? t('validatedFetch') : t('unknown')}
                </p>
                <p>
                  {t('httpStatus')}: {row.httpStatus ?? t('unknown')}
                </p>
                {Object.entries(row.signals).map(([key, value]) => (
                  <p key={key}>
                    {key}: {String(value)}
                  </p>
                ))}
              </div>
            ))}
          </details>
        </>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-3">
          {t('limitations')}
        </summary>
        <ul className="list-disc space-y-1 pl-5">
          {Array.from(new Set([...evidence.limitations, ...limitations])).map(
            (value) => (
              <li key={value}>
                {t.has(`limits.${value}`) ? t(`limits.${value}`) : value}
              </li>
            ),
          )}
        </ul>
      </details>
    </div>
  )
}
