'use client'
import { useState, type ReactNode } from 'react'
import { ChevronRight, Check, HelpCircle, Minus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { CHECK_SLOTS, matchesFilter, visualStatus, type CheckFilter } from '@/lib/result/view-model'
import type { CheckAssessment } from '@/lib/view-models/check-priority'
import { TONE_CLASSES, statusTone } from '@/components/visuals/tone'
import { CHECK_ICONS } from '@/components/visuals/check-icons'

const FILTERS: readonly CheckFilter[] = ['all', 'fail', 'warn', 'pass', 'unknown']
const STATUS_ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

interface Props {
  assessments: Readonly<Record<string, CheckAssessment>>
  onSelect: (key: string) => void
  /**
   * The owner's detailed row for a check (the scan's own message and evidence).
   * Absent for anonymous viewers, who get the check name and verdict only.
   */
  renderOwnerRow?: (key: string) => ReactNode
}

/**
 * All 20 checks, filterable by verdict. Filters are a group of toggle buttons
 * with counts; an empty group says so rather than going blank.
 */
export function CheckList({ assessments, onSelect, renderOwnerRow }: Props) {
  const t = useTranslations('resultPage')
  const visuals = useTranslations('visuals')
  const checkNames = useTranslations('checks')
  const [filter, setFilter] = useState<CheckFilter>('all')
  const count = (f: CheckFilter) => CHECK_SLOTS.filter(slot => matchesFilter(assessments[slot.key], f)).length
  const visible = CHECK_SLOTS.filter(slot => matchesFilter(assessments[slot.key], filter))

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t('filters_label')} className="flex flex-wrap gap-2" data-print-hide>
        {FILTERS.filter(f => f === 'all' || count(f) > 0).map(f => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              filter === f ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:bg-neutral-3',
            )}
          >
            {t(`filter.${f}`, { count: count(f) })}
          </button>
        ))}
      </div>

      {visible.length === 0 && <p className="text-sm text-muted-foreground">{t('list_empty')}</p>}

      {renderOwnerRow ? (
        <div data-testid="full-check-breakdown" className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          {visible.map(slot => <div key={slot.key} id={slot.key} className="scroll-mt-20">{renderOwnerRow(slot.key)}</div>)}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {visible.map(slot => {
            const status = visualStatus(assessments[slot.key])
            const tone = TONE_CLASSES[statusTone(status)]
            const Icon = CHECK_ICONS[slot.key]
            const StatusIcon = STATUS_ICONS[status]
            return (
              <li key={slot.key}>
                <button
                  type="button"
                  onClick={() => onSelect(slot.key)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-neutral-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                >
                  <span aria-hidden="true" className="text-muted-foreground">{Icon && <Icon className="size-4" />}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{checkNames(slot.key)}</span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', tone.soft, tone.fg)}>
                    <StatusIcon aria-hidden="true" className="size-3" />{visuals(`status.${status}`)}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
