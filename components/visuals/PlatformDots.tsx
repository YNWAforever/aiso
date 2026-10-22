import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export type PlatformCell = 'cited' | 'mentioned' | 'absent' | 'notRun'

export interface PlatformDotsProps {
  /** Platform names are product names and pass through untranslated. */
  platforms: readonly { id: string; name: string }[]
  /** Column headings, already formatted (e.g. "8 Sep"). */
  weeks: readonly string[]
  /** cells[platformId][weekIndex] */
  cells: Readonly<Record<string, readonly PlatformCell[]>>
  caption: string
  className?: string
}

const DOT: Record<PlatformCell, string> = {
  cited: 'size-3 bg-tone-success',
  mentioned: 'size-3 bg-tone-info/70',
  absent: 'size-3 border-2 border-neutral-7 bg-transparent',
  notRun: 'size-1.5 bg-neutral-6',
}

const LEGEND: readonly PlatformCell[] = ['cited', 'mentioned', 'absent', 'notRun']

/**
 * AI platform × week, one dot per sample. A real table underneath, so screen
 * readers get row and column headers for every dot. Neutral dots, not vendor
 * logos: logo use is pending a rights decision (docs/ux/visual-system.md §5).
 */
export function PlatformDots({ platforms, weeks, cells, caption, className }: PlatformDotsProps) {
  const t = useTranslations('visuals')
  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="platform-dots">
      {/* Focusable so keyboard users can scroll it when the weeks overflow. `relative`
          contains the absolutely positioned sr-only labels, which would otherwise
          escape the scroller and widen the page. */}
      <div role="region" aria-label={caption} tabIndex={0} className="relative max-w-full overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table className="border-separate border-spacing-x-2 border-spacing-y-1.5 text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">{t('platformDots.platform')}</th>
              {weeks.map(week => (
                <th key={week} scope="col" className="whitespace-nowrap px-1 text-center text-xs font-medium text-muted-foreground">{week}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {platforms.map(platform => (
              <tr key={platform.id}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left text-sm font-semibold text-foreground">{platform.name}</th>
                {weeks.map((week, i) => {
                  const cell = cells[platform.id]?.[i] ?? 'notRun'
                  return (
                    <td key={week} className="px-1 text-center">
                      <span className={cn('inline-block rounded-full align-middle', DOT[cell])} aria-hidden="true" />
                      <span className="sr-only">{t(`platformDots.${cell}`)}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={t('platformDots.legend')} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map(cell => (
          <li key={cell} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-block rounded-full', DOT[cell])} />
            {t(`platformDots.${cell}`)}
          </li>
        ))}
      </ul>
    </div>
  )
}
