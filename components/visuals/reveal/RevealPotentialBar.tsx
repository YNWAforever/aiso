import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatScanScore } from '@/lib/score-display'

/** PotentialScoreBar without hydration: both segments grow by CSS scaleX when revealed. */
export function RevealPotentialBar({ current, potential, className }: { current: number; potential: number; className?: string }) {
  const t = useTranslations('visuals')
  const now = Math.min(100, Math.max(0, current))
  const next = Math.min(100, Math.max(now, potential))
  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="potential-score-bar">
      <div role="img" aria-label={t('potentialBar.label', { current: formatScanScore(now), potential: formatScanScore(next) })} className="relative h-3 overflow-hidden rounded-full bg-neutral-4">
        <div
          className="reveal-bar absolute inset-y-0 left-0 w-full rounded-full bg-tone-success/35 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_8px)]"
          style={{ ['--to' as string]: next / 100, ['--reveal-delay' as string]: '300ms' }}
        />
        <div className="reveal-bar absolute inset-y-0 left-0 w-full rounded-full bg-primary" style={{ ['--to' as string]: now / 100 }} />
      </div>
      <div aria-hidden="true" className="flex items-center justify-between gap-4 text-xs">
        <span className="font-semibold text-foreground">{t('potentialBar.now', { score: formatScanScore(now) })}</span>
        <span className="font-semibold text-tone-success-fg">{t('potentialBar.potential', { score: formatScanScore(next) })}</span>
      </div>
    </div>
  )
}
