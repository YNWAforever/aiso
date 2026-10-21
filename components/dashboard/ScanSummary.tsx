import { useLocale, useTranslations } from 'next-intl'
import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { ScanEvidencePanel } from '@/components/result/ScanEvidencePanel'
import { getCheckExplanations } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'
import type { ScanSummaryView } from '@/lib/view-models/scan-summary'
import { factualDensityState } from '@/lib/factual-density-evidence'

type Props = {
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
  view?: ScanSummaryView | null
  brandName?: string | null
}
const GROUPS = [
  { title: 'core', keys: ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] },
  { title: 'extended', keys: ['c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness'] },
  { title: 'geo', keys: ['c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'] },
] as const
const verdicts = ['pass', 'warn', 'fail'] as const

export function ScanSummary({ scan, view, brandName }: Props) {
  const t = useTranslations('resultSummary'), checkT = useTranslations('checks'), locale = useLocale()
  const explanations = getCheckExplanations(locale)
  // A response for a different selected scan cannot supply its score or evidence.
  const current = view?.scanId === scan.id ? view : null
  const r = (scan.results ?? {}) as Record<string, unknown>
  const evidence = current?.evidence ?? null
  const observations = new Map(evidence?.checks.map(check => [check.key, check]) ?? [])
  const counts = current?.counts
  const observed = counts ? counts.pass + counts.warn + counts.fail : 0
  const title = current?.state === 'scored' ? t('websiteDiagnostic')
    : current?.state === 'limited' ? t('provisional')
    : current?.state === 'failed' ? t('collectionFailed') : t('unavailable')
  const date = new Date(scan.created_at)
  const recorded = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale === 'zh-HK' ? 'zh-HK' : 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)
    : null
  const confirmed = (key: string) => {
    const check = observations.get(key)
    return check?.collection === 'complete' && verdicts.includes(check.assessment as typeof verdicts[number])
  }

  return (
    <section className="min-w-0 space-y-5 rounded-xl border border-dash-border bg-dash-surface p-4 sm:p-5" aria-label={t('title')}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="break-words text-xl font-bold text-dash-text">{brandName || scan.domain}</h2>
          <p className="break-all text-sm text-dash-muted">{scan.domain}</p>
          <p className="text-sm text-dash-muted">{t('recordedAt')}: {recorded
            ? <time dateTime={scan.created_at}>{recorded} UTC</time> : t('unknownTime')}</p>
          <p className="font-semibold text-dash-text">{title}</p>
        </div>
        {current?.score !== null && current?.score !== undefined && <ScoreRing score={current.score} />}
      </header>
      <p className="text-sm text-dash-muted">{t('scope')}</p>
      {current?.state === 'scored' && current.grade && <p className="font-semibold">{t('grade')}: {current.grade}</p>}
      {evidence && counts && <div className="space-y-1 text-sm" aria-label={t('coverage')}>
        <p>{t('observed', { observed, total: counts.total })}</p>
        {observed > 0 ? <p>{t('passing', { pass: counts.pass, observed })}</p> : <p>{t('noObserved')}</p>}
        <p>{t('verdicts', { pass: counts.pass, warn: counts.warn, fail: counts.fail, unknown: counts.unknown, notApplicable: counts.notApplicable })}</p>
      </div>}
      <ScanEvidencePanel evidence={evidence} locale={locale} />
      {evidence && <PillarScoreCards results={r} evidenceInputs={evidence.pillarInputs} locale={locale} tone="dashboard" />}
      <div className="space-y-2">
        {GROUPS.map(group => {
          const keys = group.keys.filter(key => observations.has(key) || r[key])
          if (!keys.length) return null
          const covered = keys.filter(confirmed)
          const passed = covered.filter(key => observations.get(key)?.assessment === 'pass').length
          return <details key={group.title} className="rounded-lg border border-dash-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-dash-text">
              {t(group.title)} · {covered.length ? t('passing', { pass: passed, observed: covered.length }) : t('noObserved')}
            </summary>
            <div className="space-y-2 pt-2">
              {keys.map(key => {
                const check = observations.get(key)
                const label = checkT(key)
                if (!confirmed(key)) return <div key={key} className="border-b border-dash-border py-3 text-sm">
                  <p className="font-semibold">{label}</p>
                  <p>{check?.assessment === 'not-applicable' ? t('notApplicable')
                    : t('collectionState', { state: t(`states.${check?.collection ?? 'unknown'}`) })}</p>
                </div>
                const raw = r[key] as CheckResult | undefined
                const status = check!.assessment as typeof verdicts[number]
                const message = typeof raw?.message === 'string' && raw.status === status && checkT.has(raw.message)
                  ? checkT(raw.message) : t(`assessment.${status}`)
                return <ExpandableCheckItem key={key} label={label} result={{ ...raw, status, message: raw?.message ?? '' }}
                  message={message} explanation={explanations[key]}
                  factualState={key === 'c18_factual_density' ? factualDensityState(r.c18_factual_density_data ?? r.c18, raw?.diagnostic) : undefined} />
              })}
            </div>
          </details>
        })}
      </div>
    </section>
  )
}
