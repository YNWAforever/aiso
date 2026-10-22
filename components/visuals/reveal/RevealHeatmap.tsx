import { Check, HelpCircle, Minus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { PILLARS, TONE_CLASSES, statusTone } from '@/components/visuals/tone'
import type { HeatmapCheck } from '@/components/visuals/CheckHeatmap'
import { revealDelay } from '@/components/visuals/reveal/reveal'

const ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

/** Read-only CheckHeatmap without hydration: tiles pop in with a CSS stagger when revealed. */
export function RevealHeatmap({ checks, className }: { checks: readonly HeatmapCheck[]; className?: string }) {
  const t = useTranslations('visuals')
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 }
  for (const check of checks) counts[check.status] += 1
  let index = 0

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid="check-heatmap">
      <p className="text-sm text-muted-foreground">{t('heatmap.summary', counts)}</p>
      {PILLARS.map(pillar => {
        const group = checks.filter(check => check.bucket === pillar)
        if (!group.length) return null
        return (
          <section key={pillar} aria-label={t(`pillars.${pillar}`)} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted-foreground">{t(`pillars.${pillar}`)}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {group.map(check => {
                const Icon = ICONS[check.status]
                const tone = TONE_CLASSES[statusTone(check.status)]
                const name = t('heatmap.tile', { label: check.label, status: t(`status.${check.status}`) })
                return (
                  <li key={check.key} className="reveal-pop" style={revealDelay(index++)}>
                    <span className={cn('flex size-10 items-center justify-center rounded-md border', tone.soft, tone.fg, tone.border)} title={name}>
                      <Icon aria-hidden="true" className="size-4" />
                      <span className="sr-only">{name}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
