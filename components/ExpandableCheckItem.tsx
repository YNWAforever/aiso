'use client'
import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, Check, HelpCircle, Minus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CheckResult } from '@/lib/types'
import type { CheckExplanation } from '@/lib/checkExplanations'
import type { FactualDensityState } from '@/lib/factual-density-evidence'
import { topicalAuthorityState } from '@/lib/topical-authority-evidence'
import { formatDensityDetails } from '@/lib/score-display'
import type { CheckAssessment } from '@/lib/view-models/check-priority'
import { TONE_CLASSES, statusTone } from '@/components/visuals/tone'

const ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

interface Props {
  label: string
  result: CheckResult
  message: string
  explanation?: CheckExplanation
  factualState?: FactualDensityState
  assessment?: CheckAssessment
  anchorId?: string
  initiallyOpen?: boolean
  children?: ReactNode
}

export function ExpandableCheckItem({ label, result, message, explanation, factualState, assessment, anchorId, initiallyOpen = false, children }: Props) {
  const t = useTranslations('checkItem')
  const visuals = useTranslations('visuals')
  const evidence = useTranslations('scanEvidence')
  const [open, setOpen] = useState(initiallyOpen)
  const detailsId = useId()
  const topical = result.message.startsWith('topical_authority_') ? topicalAuthorityState(result) : null
  const legacy = topical === 'legacy' || factualState === 'legacy'
  const unavailable = legacy || topical === 'unavailable' || factualState === 'unavailable' || result.message === 'factual_density_unavailable'
  const verdict = unavailable ? 'unknown' : assessment ?? result.status
  const status = verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'unknown'
  const display = legacy ? t('legacy') : topical === 'unavailable' ? t('topicalUnavailable') : unavailable ? t('unavailable')
    : verdict === 'not-applicable' ? evidence('states.not-applicable')
      : status === 'unknown' || status !== result.status ? visuals(`status.${status}`) : message
  const ownFinding = status !== 'unknown' && status === result.status ? result.details : undefined
  const density = result.message.startsWith('factual_density_') || result.message.startsWith('citation_density_')
  const details = ownFinding && density ? formatDensityDetails(ownFinding) : ownFinding
  const canExpand = Boolean(children || (explanation && status !== 'unknown'))
  const Icon = ICONS[status]
  const tone = TONE_CLASSES[statusTone(status)]
  const header = (
    <>
      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground"><Icon aria-hidden="true" className={`size-4 shrink-0 ${tone.fg}`} /><span className="break-words">{label}</span></span>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="break-words">{display}</span>
        {canExpand && <ChevronDown aria-hidden="true" className={`size-4 shrink-0 ${open ? 'rotate-180' : ''}`} />}
      </span>
    </>
  )
  const rowClass = 'flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-2 text-left text-sm'
  return (
    <div className="border-b border-border last:border-0">
      {canExpand ? <button id={anchorId} type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(value => !value)}
        className={`${rowClass} rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary`}>{header}</button>
        : <div id={anchorId} tabIndex={anchorId ? -1 : undefined} className={rowClass}>{header}</div>}
      {canExpand && <div id={detailsId} hidden={!open} className="mx-1 mb-3 space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
        {explanation && status !== 'unknown' && <dl className="space-y-3">
          <div><dt className="font-semibold">{t('question')}</dt><dd className="mt-1 text-muted-foreground">{explanation.question}</dd></div>
          <div><dt className="font-semibold">{t('whyItMatters')}</dt><dd className="mt-1 text-muted-foreground">{explanation.why}</dd></div>
          {details && <div><dt className="font-semibold">{t('whatWeFound')}</dt><dd className="mt-1 break-words text-muted-foreground">{details}</dd></div>}
          <div><dt className="font-semibold">{status === 'pass' ? t('status') : t('howToFix')}</dt><dd className="mt-1 text-muted-foreground">{explanation.fix[status]}</dd></div>
        </dl>}
        {children}
      </div>}
    </div>
  )
}
