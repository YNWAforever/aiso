import { useTranslations } from 'next-intl'
import type { AgentRecommendation } from '@/lib/types'

type Props = { recommendations: AgentRecommendation[]; initialLimit?: number }

/**
 * Saved review suggestions, in the order the server read them (priority, then
 * impact score). The surrounding Improve section owns the heading and count;
 * this list only renders the drafts so the page does not grow a nested card.
 * The first three are visible; the rest are one native disclosure away so the
 * page stays scannable on a phone without hiding the saved output.
 */
export function AgentRecommendations({ recommendations, initialLimit = 3 }: Props) {
  const t = useTranslations('dashboard')
  if (!recommendations.length) {
    return <p role="status" className="text-sm leading-relaxed text-muted-foreground">{t('recs_empty')}</p>
  }

  const card = (r: AgentRecommendation, index: number) => (
    <li key={r.id} className="min-w-0 rounded-xl border border-border bg-background p-4">
      <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground">{String(index + 1).padStart(2, '0')}</p>
      <p className="mt-2 break-words text-sm leading-relaxed text-foreground">{r.recommendation}</p>
    </li>
  )
  const visible = recommendations.slice(0, initialLimit)
  const rest = recommendations.slice(initialLimit)

  return (
    <>
      <ol className="grid gap-3 sm:grid-cols-2">
        {visible.map((r, index) => card(r, index))}
      </ol>
      {rest.length ? (
        <details className="group mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm font-semibold text-primary-accessible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
            {t('recs_show_more', { count: rest.length })}
          </summary>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {rest.map((r, index) => card(r, initialLimit + index))}
          </ol>
        </details>
      ) : null}
    </>
  )
}
