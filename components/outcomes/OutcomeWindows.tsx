'use client'
import { useTranslations } from 'next-intl'
import type { OutcomeComparison, OutcomeResponse, SafeEvidence } from '@/lib/outcomes/types'
function Evidence({ value }: { value: SafeEvidence }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-2 break-words">
    <p>{t('source')}: {t(`sources.${value.source.kind}`)} · <span className="break-all">{value.source.id}</span>{value.source.checkKey && <> · {value.source.checkKey}</>}</p>
    <p>{t('collectedAt')}: {value.collectedAt ? <time dateTime={value.collectedAt}>{value.collectedAt} (UTC)</time> : t('collectionUnknown')}</p>
    <p>{t('recordedAt')}: {value.recordedAt ? <time dateTime={value.recordedAt}>{value.recordedAt} (UTC)</time> : t('unknown')}</p>
    <p>{t('verdict')}: {value.verdict ? t(`verdicts.${value.verdict}`) : t('unknown')}</p>
    <ul className="space-y-1">{value.reasons.map(reason => <li key={reason}>{t(`reasons.${reason}`)}</li>)}</ul>
  </div>
}
/**
 * Status and change are shown together, always. The status is what licenses the
 * change to be read at all, so rendering the movement without it would let a
 * hedged observation be taken as a like-for-like result.
 */
function Comparison({ value }: { value: OutcomeComparison }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-2 break-words border-t border-border pt-3">
    <h4 className="font-semibold">{t('comparison')}</h4>
    <p>{t('comparisonBasis')}: {t(`comparisonStatuses.${value.status}`)}</p>
    <p>{t('comparisonChange')}: {t(`comparisonOutcomes.${value.outcome}`)}</p>
    <p>{t('comparisonBaseline')}: {value.baselineVerdict ? t(`verdicts.${value.baselineVerdict}`) : t('unknown')}</p>
    <p>{t('comparisonObserved')}: {value.observedVerdict ? t(`verdicts.${value.observedVerdict}`) : t('unknown')}</p>
    <p>{t('comparisonLimitation')}</p>
  </div>
}

export function OutcomeWindows({ value }: { value: OutcomeResponse }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-5 break-words">
    <p>{t('anchorState')}: {t(`anchorStates.${value.anchorState}`)}</p>
    <p>{t('version')}: <span className="break-all">{value.versionId}</span></p>
    <p>{t('contentHash')}: <span className="break-all">{value.contentHash}</span></p>
    <p>{t('evaluatedAt')}: <time dateTime={value.evaluatedAt}>{value.evaluatedAt} (UTC)</time></p>
    <p>{t('policy')}: {value.policyVersion}</p>
    {value.anchor && <div className="space-y-2">
      <p>{t('anchorId')}: <span className="break-all">{value.anchor.id}</span></p>
      <p>{t('deliveredAt')}: <time dateTime={value.anchor.deliveredAt}>{value.anchor.deliveredAt} (UTC)</time></p>
      <p>{t('attestedAt')}: <time dateTime={value.anchor.recordedAt}>{value.anchor.recordedAt} (UTC)</time></p>
    </div>}
    <ul className="space-y-1">{value.reasons.map(reason => <li key={reason}>{t(`reasons.${reason}`)}</li>)}</ul>
    <div className="space-y-2"><h3 className="font-semibold">{t('baseline')}</h3><p>{t('baselineProvenance')}</p>{value.baseline ? <Evidence value={value.baseline} /> : <p>{t('reasons.baseline-missing')}</p>}</div>
    {value.windows.length > 0 && <p>{t('intervalPolicy')}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-3">
      {value.windows.map(window => <article key={window.day} className="min-w-0 space-y-3 rounded-lg border border-border p-3" aria-label={t('window', { day: window.day })}>
        <h3 className="font-semibold">{t('window', { day: window.day })}</h3>
        <p>{t('startsAt')}: <time className="break-all" dateTime={window.startsAt}>{window.startsAt} (UTC)</time></p>
        <p>{t('endsAt')}: <time className="break-all" dateTime={window.endsAt}>{window.endsAt} (UTC)</time></p>
        <p>{t('timeState')}: {t(`timeStates.${window.timeState}`)}</p>
        <p>{t('evidenceState')}: {t(`evidenceStates.${window.evidenceState}`)}</p>
        {window.provisional && <p>{t('provisional')}</p>}
        <ul className="space-y-1">{window.reasons.map(reason => <li key={reason}>{t(`reasons.${reason}`)}</li>)}</ul>
        {window.selected && <Evidence value={window.selected} />}
        <Comparison value={window.comparison} />
      </article>)}
    </div>
    {value.diagnostics.length > 0 && <div className="space-y-3"><h3 className="font-semibold">{t('diagnostics')}</h3><p>{t('diagnosticsLimitation')}</p>{value.diagnostics.map(row => <Evidence key={JSON.stringify(row.source)} value={row} />)}</div>}
  </div>
}
