import type { LocalTrustBucketScore } from '@/lib/types'

type Copy = {
  title: string
  strongest: string
  weakest: string
  topAction: string
}

const defaultCopy: Copy = {
  title: 'Local Trust Score',
  strongest: 'Strongest',
  weakest: 'Weakest',
  topAction: 'Top action',
}

type Props = {
  score: number
  buckets: LocalTrustBucketScore[]
  copy?: Partial<Copy>
}

export function LocalTrustScorePanel({ score, buckets, copy }: Props) {
  const labels = { ...defaultCopy, ...copy }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <p className="font-mono text-4xl font-black text-dash-text">{score}</p>
            <p className="font-mono text-sm font-semibold text-dash-muted">/100</p>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {buckets.map((bucket) => {
          const width = bucket.maxScore > 0 ? Math.min(100, Math.max(0, (bucket.score / bucket.maxScore) * 100)) : 0

          return (
            <article key={bucket.key} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-semibold leading-snug text-dash-text">{bucket.label}</h4>
                <span className="shrink-0 font-mono text-xs font-bold text-dash-accent">
                  {bucket.score}/{bucket.maxScore}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dash-border" aria-hidden="true">
                <div className="h-full rounded-full bg-dash-accent" style={{ width: `${width}%` }} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-dash-muted">{bucket.explanation}</p>
              <dl className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-dash-muted">
                <div>
                  <dt className="inline font-semibold text-dash-text">{labels.strongest}: </dt>
                  <dd className="inline">{bucket.strongestSignal}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-dash-text">{labels.weakest}: </dt>
                  <dd className="inline">{bucket.weakestSignal}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-dash-text">{labels.topAction}: </dt>
                  <dd className="inline">{bucket.topAction}</dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>
    </section>
  )
}
