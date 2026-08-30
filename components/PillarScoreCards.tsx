import { resolvePillarScores, isPillarScoreStored, type PillarKey } from '@/lib/pillar-scores'

type Tone = 'light' | 'dashboard'

type Props = {
  results: Record<string, unknown>
  locale?: string
  tone?: Tone
}

const COPY = {
  en: {
    aria: 'SEO, AEO and GEO diagnostic scores',
    note: 'These diagnostic pillars overlap by design and do not add together. The overall AISO score remains the 100-point benchmark.',
    recalculated: 'Recalculated with current methodology — not the original scan result.',
    pass: 'pass',
    warn: 'warn',
    fail: 'fail',
    pillars: {
      seo: {
        label: 'SEO Foundation',
        description: 'Discovery, crawlability, indexing and site structure',
      },
      aeo: {
        label: 'AEO Answer Readiness',
        description: 'Machine extraction, answer structure and crawler access',
      },
      geo: {
        label: 'GEO Citation Authority',
        description: 'Evidence, entities, factual depth and topical authority',
      },
    },
  },
  'zh-HK': {
    aria: 'SEO、AEO 及 GEO 診斷分數',
    note: '三個診斷維度刻意包含重疊訊號，不應相加；整體 AISO 分數仍以 100 分為基準。',
    recalculated: '此分數已按目前方法重新計算，並非原始掃描結果。',
    pass: '通過',
    warn: '警告',
    fail: '不及格',
    pillars: {
      seo: {
        label: 'SEO 搜尋基礎',
        description: '網站發現、爬取、索引及資訊架構',
      },
      aeo: {
        label: 'AEO 答案就緒度',
        description: '機器提取、答案結構及爬蟲存取',
      },
      geo: {
        label: 'GEO 引用權威',
        description: '證據、實體、事實深度及主題權威',
      },
    },
  },
} as const

const PILLAR_ORDER: PillarKey[] = ['seo', 'aeo', 'geo']

export function PillarScoreCards({ results, locale = 'en', tone = 'light' }: Props) {
  const language = locale === 'zh-HK' ? 'zh-HK' : 'en'
  const copy = COPY[language]
  const snapshot = resolvePillarScores(results)
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
      aria-label={copy.aria}
      data-testid="pillar-score-cards"
      data-methodology-version={snapshot.methodologyVersion}
      data-recalculated={!stored}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {PILLAR_ORDER.map((key) => {
          const score = snapshot[key]
          const pillarCopy = copy.pillars[key]

          return (
            <article key={key} data-pillar={key} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-[0.12em] ${mutedClass}`}>
                    {pillarCopy.label}
                  </p>
                  <p className={`mt-2 text-xs leading-relaxed ${mutedClass}`}>
                    {pillarCopy.description}
                  </p>
                </div>
                <p className={`shrink-0 font-mono text-2xl font-black ${headingClass}`}>
                  {score.score}
                  <span className={`ml-0.5 text-[10px] font-medium ${mutedClass}`}>/100</span>
                </p>
              </div>

              <div
                role="progressbar"
                aria-label={`${pillarCopy.label}: ${score.score} out of 100`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score.score}
                className={`mt-4 h-1.5 overflow-hidden rounded-full ${trackClass}`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700"
                  style={{ width: `${Math.max(0, Math.min(100, score.score))}%` }}
                />
              </div>

              <p className={`mt-3 text-[10px] font-mono ${mutedClass}`}>
                {score.passing} {copy.pass} · {score.warnings} {copy.warn} · {score.failing} {copy.fail}
              </p>
            </article>
          )
        })}
      </div>

      {!stored && (
        <p className={`mt-2 text-[10px] font-semibold ${mutedClass}`}>
          {copy.recalculated}
        </p>
      )}
      <p className={`mt-3 text-[10px] leading-relaxed ${mutedClass}`}>
        {copy.note}
      </p>
    </section>
  )
}
