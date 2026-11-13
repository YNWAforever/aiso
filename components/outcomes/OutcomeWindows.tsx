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
function Comparison({ value, smeCopilot = false }: { value: OutcomeComparison; smeCopilot?: boolean }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-2 break-words border-t border-border pt-3">
    <h4 className="font-semibold">{t('comparison')}</h4>
    <p>{t('comparisonBasis')}: {t(smeCopilot && value.status === 'not_comparable' ? 'sme.notComparable' : `comparisonStatuses.${value.status}`)}</p>
    <p>{t('comparisonChange')}: {t(`comparisonOutcomes.${value.outcome}`)}</p>
    <p>{t('comparisonBaseline')}: {value.baselineVerdict ? t(`verdicts.${value.baselineVerdict}`) : t('unknown')}</p>
    <p>{t('comparisonObserved')}: {value.observedVerdict ? t(`verdicts.${value.observedVerdict}`) : t('unknown')}</p>
    <p>{t(smeCopilot ? 'sme.comparisonLimitation' : 'comparisonLimitation')}</p>
  </div>
}

/** Presentation only: all requests and error classification stay in OutcomeWorkspace. */
export function OutcomeReadError({ error, smeCopilot = false, versionSchema = 1 }: { error: string; smeCopilot?: boolean; versionSchema?: 1 | 2 }) {
  const t = useTranslations('outcomes')
  return <p role="alert">{t(smeCopilot && versionSchema === 2 && error === 'unavailable' ? 'sme.multiSourceUnavailable' : error)}</p>
}

function SmeReasons({ reasons }: { reasons: string[] }) {
  const t = useTranslations('outcomes')
  return <ul className="space-y-1">{reasons.map(reason => <li key={reason}>{t(
    reason === 'self-reported-delivery' ? 'sme.anchorLimitation' :
      reason === 'no-delivery' ? 'sme.noDelivery' :
        reason === 'anchor-withdrawn' ? 'sme.anchorWithdrawn' :
          reason === 'final-path-identity-withheld' ? 'sme.pathLimitation' : `reasons.${reason}`,
  )}</li>)}</ul>
}

const disclosureFocus = 'min-h-11 cursor-pointer rounded py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function SmeEvidence({ value }: { value: SafeEvidence }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-2 break-words">
    <p>{t('source')}: {t(`sources.${value.source.kind}`)}{value.source.checkKey && <> · <span className="break-all">{value.source.checkKey}</span></>}</p>
    <p>{t('collectedAt')}: {value.collectedAt ? <time className="break-all" dateTime={value.collectedAt}>{value.collectedAt}</time> : t('collectionUnknown')}</p>
    <p>{t('recordedAt')}: {value.recordedAt ? <time className="break-all" dateTime={value.recordedAt}>{value.recordedAt}</time> : t('unknown')}</p>
    <p>{t('verdict')}: {value.verdict ? t(`verdicts.${value.verdict}`) : t('unknown')}</p>
    {value.source.kind === 'pulse-metric' && <p>{t('sme.pulseUnranked')}</p>}
    <SmeReasons reasons={value.reasons} />
    <details className="min-w-0"><summary className={disclosureFocus}>{t('sme.sourceDetails')}</summary><p className="break-all">{t('source')}: {value.source.id}</p></details>
  </div>
}

function SmeOutcomeWindows({ value }: { value: OutcomeResponse }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-5 break-words">
    <div className="space-y-2">
      <h3 className="font-semibold">{t('sme.context')}</h3>
      <p>{t('sme.anchorState')}: {t(`sme.anchorStates.${value.anchorState}`)}</p>
      {value.anchor && <>
        <p>{t('sme.deliveredAt')}: <time className="break-all" dateTime={value.anchor.deliveredAt}>{value.anchor.deliveredAt}</time></p>
        <p>{t('sme.recordedAt')}: <time className="break-all" dateTime={value.anchor.recordedAt}>{value.anchor.recordedAt}</time></p>
      </>}
      <SmeReasons reasons={value.reasons} />
    </div>
    <div className="space-y-2"><h3 className="font-semibold">{t('baseline')}</h3><p>{t('baselineProvenance')}</p>{value.baseline ? <SmeEvidence value={value.baseline} /> : <p>{t('reasons.baseline-missing')}</p>}</div>
    {value.windows.length > 0 && <p>{t('sme.intervalPolicy')}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-3">
      {value.windows.map(window => <article key={window.day} className="min-w-0 space-y-3 rounded-lg border border-border p-3" aria-label={t('window', { day: window.day })}>
        <h3 className="font-semibold">{t('window', { day: window.day })}</h3>
        <p>{t('startsAt')}: <time className="break-all" dateTime={window.startsAt}>{window.startsAt} (UTC)</time></p>
        <p>{t('endsAt')}: <time className="break-all" dateTime={window.endsAt}>{window.endsAt} (UTC)</time></p>
        <p>{t('timeState')}: {t(`timeStates.${window.timeState}`)}</p>
        <p>{t('evidenceState')}: {t(`evidenceStates.${window.evidenceState}`)}</p>
        {window.provisional && <p>{t('provisional')}</p>}
        <SmeReasons reasons={window.reasons} />
        {window.selected ? <SmeEvidence value={window.selected} /> : <p>{t('sme.noSelectedEvidence')}</p>}
        <Comparison value={window.comparison} smeCopilot />
      </article>)}
    </div>
    {value.diagnostics.length > 0 && <div className="space-y-3"><h3 className="font-semibold">{t('diagnostics')}</h3><p>{t('diagnosticsLimitation')}</p>{value.diagnostics.map(row => <SmeEvidence key={JSON.stringify(row.source)} value={row} />)}</div>}
    <details className="min-w-0 space-y-2">
      <summary className={disclosureFocus}>{t('sme.technicalDetails')}</summary>
      <p>{t('version')}: <span className="break-all">{value.versionId}</span></p>
      <p>{t('contentHash')}: <span className="break-all">{value.contentHash}</span></p>
      <p>{t('evaluatedAt')}: <time className="break-all" dateTime={value.evaluatedAt}>{value.evaluatedAt}</time></p>
      <p>{t('policy')}: {value.policyVersion}</p>
      <p>{t('sme.schema')}: {value.schemaVersion}</p>
      <p>{t('sme.client')}: <span className="break-all">{value.clientId}</span></p>
      <p>{t('sme.item')}: <span className="break-all">{value.itemId}</span></p>
      <p>{t('sme.truncated')}: {t(value.truncated ? 'sme.yes' : 'sme.no')}</p>
      {value.anchor && <p>{t('sme.anchorId')}: <span className="break-all">{value.anchor.id}</span></p>}
    </details>
  </div>
}

export function OutcomeWindows({ value, smeCopilot = false }: { value: OutcomeResponse; smeCopilot?: boolean }) {
  const t = useTranslations('outcomes')
  if (smeCopilot) return <SmeOutcomeWindows value={value} />
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
