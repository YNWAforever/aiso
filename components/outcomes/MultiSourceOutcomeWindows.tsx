'use client'

import { useId } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import type { MultiSourceOutcomeResponse, MultiSourceOutcomeSourceResult } from '@/lib/outcomes/multi-source'
import type { OutcomeWindow, SafeEvidence } from '@/lib/outcomes/types'

const disclosure = 'min-h-11 cursor-pointer rounded py-2 font-semibold whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function reasonKey(reason: string) {
  return reason === 'diagnostic-limit-exceeded' ? 'v2.reasons.diagnostic-limit-exceeded' : `reasons.${reason}`
}
function Reasons({ reasons }: { reasons: readonly string[] }) {
  const t = useTranslations('outcomes')
  return reasons.length > 0 && <ul className="space-y-1 text-sm">{reasons.map(reason => <li key={reason}>{t(reasonKey(reason))}</li>)}</ul>
}

/** Pure presentation priority, never a recomputation of window membership or comparison. */
function priorityKey(window: OutcomeWindow) {
  if (window.evidenceState === 'invalid-baseline' || window.reasons.includes('baseline-after-delivery') || window.reasons.includes('baseline-missing')) return 'evidenceStates.invalid-baseline'
  if (window.evidenceState === 'unavailable') return 'evidenceStates.unavailable'
  if (window.evidenceState === 'evidence-limited') return 'evidenceStates.evidence-limited'
  if (window.evidenceState === 'timing-unknown') return 'evidenceStates.timing-unknown'
  if (window.provisional) return 'provisional'
  if (window.timeState !== 'observation-available') return `timeStates.${window.timeState}`
  return `evidenceStates.${window.evidenceState}`
}

/** Only safe DTO fields; identifiers and full-precision dates stay inside native disclosures. */
function EvidenceDetails({ value }: { value: SafeEvidence }) {
  const t = useTranslations('outcomes')
  return <div className="min-w-0 space-y-2 break-words text-sm">
    <p>{t('source')}: <span className="break-all">{value.source.id}</span>{value.source.checkKey && <> · <span className="break-all">{value.source.checkKey}</span></>}</p>
    <p>{t('collectedAt')}: {value.collectedAt ? <time className="break-all" dateTime={value.collectedAt}>{value.collectedAt} {t('v2.utcSuffix')}</time> : t('collectionUnknown')}</p>
    <p>{t('recordedAt')}: {value.recordedAt ? <time className="break-all" dateTime={value.recordedAt}>{value.recordedAt} {t('v2.utcSuffix')}</time> : t('unknown')}</p>
    <p>{t('verdict')}: {value.verdict ? t(`verdicts.${value.verdict}`) : t('unknown')}</p>
    <Reasons reasons={value.reasons} />
  </div>
}

function SourceWindow({ value, sourceIndex, pulse, id }: { value: OutcomeWindow; sourceIndex: number; pulse: boolean; id: string }) {
  const t = useTranslations('outcomes')
  const priority = priorityKey(value)
  const limited = ['invalid-baseline', 'unavailable', 'evidence-limited', 'timing-unknown'].includes(value.evidenceState)
  // A raw improvement can coexist with an invalid baseline in the policy DTO.
  // Retain it for audit, never promote it to the owner's main result.
  const showChange = !pulse && !limited && value.selected !== null
  return <article aria-labelledby={id} className="relative min-w-0 space-y-3 rounded-lg border border-border p-4">
    <h4 id={id} className="font-semibold">{t('v2.sourceWindow', { number: sourceIndex + 1, day: value.day })}</h4>
    <p className="font-medium">{t(priority)}</p>
    {priority !== `timeStates.${value.timeState}` && <p className="text-sm text-muted-foreground">{t(`timeStates.${value.timeState}`)}</p>}
    <Reasons reasons={value.reasons} />
    <p className="text-sm">{t('comparisonBasis')}: {t(`comparisonStatuses.${value.comparison.status}`)}</p>
    {showChange && <p className="text-sm">{t('comparisonChange')}: {t(`comparisonOutcomes.${value.comparison.outcome}`)}</p>}
    {!value.selected && <p className="text-sm text-muted-foreground">{t('sme.noSelectedEvidence')}</p>}
    <details className="min-w-0 border-t border-border">
      <summary className={disclosure}>{t('v2.windowDetails')}</summary>
      <div className="min-w-0 space-y-3 pt-2 text-sm">
        <p>{t('startsAt')}: <time className="break-all" dateTime={value.startsAt}>{value.startsAt} {t('v2.utcSuffix')}</time></p>
        <p>{t('endsAt')}: <time className="break-all" dateTime={value.endsAt}>{value.endsAt} {t('v2.utcSuffix')}</time></p>
        <p>{t('evidenceState')}: {t(`evidenceStates.${value.evidenceState}`)}</p>
        {value.provisional && priority !== 'provisional' && <p>{t('provisional')}</p>}
        {!pulse && !showChange && <p>{t('comparisonChange')}: {t(`comparisonOutcomes.${value.comparison.outcome}`)}</p>}
        {value.selected && <EvidenceDetails value={value.selected} />}
      </div>
    </details>
  </article>
}

function SourceCard({ value, snapshot, id }: { value: MultiSourceOutcomeSourceResult; snapshot: DraftSnapshotV1 | undefined; id: string }) {
  const t = useTranslations('outcomes')
  const locale = useLocale()
  // Labels come only from the selected frozen evidence supplied by the parent,
  // never from a reply's baseline, observed source ID, check key or reason text.
  const evidence = snapshot?.evidence
  const pulse = evidence?.kind === 'pulse-metric'
  const title = evidence?.kind === 'scan-check'
    ? getCheckActionCopy(evidence.checkKey, locale)?.title ?? t('sources.scan-check')
    : evidence?.kind === 'pulse-metric' ? `${evidence.question} · ${evidence.platform}` : t('v2.frozenSource')
  const reasons = value.reasons.filter(reason => !['point-in-time-read', 'self-reported-delivery', 'no-delivery', 'anchor-withdrawn'].includes(reason))
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <h3 id={`${id}-title`} className="break-words text-base font-semibold">{t('v2.sourceNumber', { number: value.sourceIndex + 1 })} · {title}</h3>
    {pulse && <p className="break-words text-sm text-muted-foreground">{t('sme.pulseUnranked')}</p>}
    <Reasons reasons={reasons} />
    {value.truncated && <p className="font-medium">{t('evidenceStates.evidence-limited')}</p>}
    <details className="min-w-0">
      <summary className={disclosure}>{t('baseline')} · {value.baseline?.verdict ? t(`verdicts.${value.baseline.verdict}`) : t('unknown')}</summary>
      <div className="space-y-2 pt-2"><p className="text-sm text-muted-foreground">{t('baselineProvenance')}</p>{value.baseline ? <EvidenceDetails value={value.baseline} /> : <p>{t('reasons.baseline-missing')}</p>}</div>
    </details>
    <div className="grid min-w-0 gap-3 lg:grid-cols-3">
      {value.windows.map(window => <SourceWindow key={window.day} value={window} sourceIndex={value.sourceIndex} pulse={pulse} id={`${id}-d${window.day}`} />)}
    </div>
    {value.diagnostics.length > 0 && <details className="min-w-0 border-t border-border">
      <summary className={disclosure}>{t('v2.retainedReferences', { count: value.diagnostics.length })}</summary>
      <p className="py-2 text-sm text-muted-foreground">{t('diagnosticsLimitation')}</p>
      <p className="pb-2 text-sm text-muted-foreground">{t('v2.diagnosticBudget')}</p>
      <ul className="min-w-0 space-y-3">{value.diagnostics.map((row, index) => <li className="rounded border border-border p-3" key={index}><EvidenceDetails value={row} /></li>)}</ul>
    </details>}
  </section>
}

/** Read-only V2 presentation. The request owner validates the complete DTO and selected context first. */
export function MultiSourceOutcomeWindows({ value, snapshots, smeCopilot = false }: {
  value: MultiSourceOutcomeResponse
  snapshots: readonly DraftSnapshotV1[]
  smeCopilot?: boolean
}) {
  const t = useTranslations('outcomes')
  const id = useId()
  return <div className="min-w-0 space-y-5 break-words">
    <div className="min-w-0 space-y-3 rounded-lg border border-border p-4 text-sm">
      <p className="font-semibold">{t(smeCopilot ? 'sme.anchorState' : 'anchorState')}: {t(`${smeCopilot ? 'sme.' : ''}anchorStates.${value.anchorState}`)}</p>
      <p>{t(value.anchorState === 'active' ? 'sme.anchorLimitation' : value.anchorState === 'withdrawn' ? 'sme.anchorWithdrawn' : 'sme.noDelivery')}</p>
      <p className="text-muted-foreground">{t('sme.comparisonLimitation')}</p>
      <details className="min-w-0 border-t border-border">
        <summary className={disclosure}>{t('v2.readDetails')}</summary>
        <div className="min-w-0 space-y-2 pt-2">
          <p>{t('sme.intervalPolicy')}</p>
          <p>{t('limitation')}</p>
          <p>{t('evaluatedAt')}: <time className="break-all" dateTime={value.evaluatedAt}>{value.evaluatedAt} {t('v2.utcSuffix')}</time></p>
          {value.anchor && <>
            <p>{t('deliveredAt')}: <time className="break-all" dateTime={value.anchor.deliveredAt}>{value.anchor.deliveredAt} {t('v2.utcSuffix')}</time></p>
            <p>{t('attestedAt')}: <time className="break-all" dateTime={value.anchor.recordedAt}>{value.anchor.recordedAt} {t('v2.utcSuffix')}</time></p>
            <p>{t('anchorId')}: <span className="break-all">{value.anchor.id}</span></p>
          </>}
          <p>{t('sme.client')}: <span className="break-all">{value.clientId}</span></p>
          <p>{t('sme.item')}: <span className="break-all">{value.itemId}</span></p>
          <p>{t('version')}: <span className="break-all">{value.versionId}</span></p>
          <p>{t('contentHash')}: <span className="break-all">{value.contentHash}</span></p>
          <p>{t('policy')}: {value.policyVersion} · {t('sme.schema')}: {value.schemaVersion}</p>
        </div>
      </details>
    </div>
    {value.sources.map(source => <SourceCard key={source.sourceIndex} value={source} snapshot={snapshots[source.sourceIndex]} id={`${id}-source-${source.sourceIndex}`} />)}
  </div>
}
