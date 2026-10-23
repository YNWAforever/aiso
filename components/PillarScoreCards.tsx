import { useTranslations } from 'next-intl'
import { resolvePillarScores, isPillarScoreStored, type PillarKey } from '@/lib/pillar-scores'

type Tone = 'light' | 'dashboard'

type Props = {
  results: Record<string, unknown>
  /** Unused: copy follows the surrounding next-intl locale. Kept so callers need no change. */
  locale?: string
  tone?: Tone
  evidenceInputs?: Parameters<typeof resolvePillarScores>[1]
}

const PILLAR_ORDER: PillarKey[] = ['seo', 'aeo', 'geo']

export function PillarScoreCards({ results, tone = 'light', evidenceInputs }: Props) {
  const t = useTranslations('pillarCards')
  const snapshot = resolvePillarScores(results, evidenceInputs)
  const stored = isPillarScoreStored(results)
  const dashboard = tone === 'dashboard'

  const cardClass = dashboard
    ? 'rounded-xl border border-dash-border bg-dash-elevated p-4'
    : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'
  const headingClass = dashboard ? 'text-dash-text' : 'text-slate-900'
  const mutedClass = dashboard ? 'text-dash-muted' : 'text-slate-500'
  const trackClass = dashboard ? 'bg-dash-border' : 'bg-slate-100'

  return (
    <section
      aria-label={t('aria')}
      data-testid="pillar-score-cards"
      data-methodology-version={snapshot.methodologyVersion}
      data-recalculated={!stored}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {PILLAR_ORDER.map((key) => {
          const score = snapshot[key]

          return (
            <article key={key} data-pillar={key} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-[0.12em] ${mutedClass}`}>
                    {t(`pillars.${key}.label`)}
                  </p>
                  <p className={`mt-2 text-xs leading-relaxed ${mutedClass}`}>
                    {t(`pillars.${key}.description`)}
                  </p>
                </div>
                {score.score !== null && <p className={`shrink-0 font-mono text-2xl font-black ${headingClass}`}>
                  {score.score}
                  <span className={`ml-0.5 text-xs font-medium ${mutedClass}`}>/100</span>
                </p>}
              </div>

              {score.state && <p className={`mt-3 text-xs font-semibold ${headingClass}`}>{t(`states.${score.state}`)}</p>}
              {score.score !== null && <div
                role="progressbar"
                aria-label={`${t(`pillars.${key}.label`)}: ${score.score} out of 100`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score.score}
                className={`mt-4 h-1.5 overflow-hidden rounded-full ${trackClass}`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700"
                  style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }}
                />
              </div>}

              <p className={`mt-3 text-xs ${mutedClass}`}>{t('coverage')}: {Math.round(score.coverage * 10000) / 100}%</p>
              <p className={`mt-3 text-xs tabular-nums ${mutedClass}`}>
                {t('checkCounts', { passing: score.passing, warnings: score.warnings, failing: score.failing })}
              </p>
            </article>
          )
        })}
      </div>

      {!stored && (
        <p className={`mt-2 text-xs font-semibold ${mutedClass}`}>
          {t('recalculated')}
        </p>
      )}
      {stored && <p className={`mt-2 text-xs font-semibold ${mutedClass}`}>
        {snapshot.seo.state === undefined ? t('legacy') : t('stored')}
      </p>}
      <p className={`mt-2 text-xs ${mutedClass}`}>{t('version')}: {snapshot.methodologyVersion}</p>
      <p className={`mt-3 text-xs leading-relaxed ${mutedClass}`}>
        {t('note')}
      </p>
    </section>
  )
}
