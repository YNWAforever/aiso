import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Check, Gauge, HelpCircle, Minus, X } from 'lucide-react'
import { RevealHeatmap } from '@/components/visuals/reveal/RevealHeatmap'
import { TrustSignalsSection } from '@/components/result/TrustSignalsSection'
import { PrintThemeGuard } from './PrintButton'
import { formatScanScore } from '@/lib/score-display'
import type { CombinedReportData, CombinedScan, CombinedPulse } from '@/lib/reports/combined'

/**
 * The combined scan + Pulse report: the latest saved website scan and the
 * latest classified canonical Pulse week on one printable page. Server-rendered
 * and read-only; the browser's print dialog is the PDF path. Missing data stays
 * an explicit empty/unavailable state, never a zero.
 */
export function CombinedReport({ report, clientId }: { report: CombinedReportData; clientId: string }) {
  const t = useTranslations('combinedReport')
  const locale = useLocale()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(iso))
  const preparedBy = report.branding?.agencyName ?? report.client.name

  return (
    <article
      className="combined-report mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-e2 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      data-testid="combined-report"
    >
      <style>{`@media print { @page { size: A4; margin: 12mm; } .combined-report { break-inside: auto; } }`}</style>
      <PrintThemeGuard />
      <header className="border-b border-border p-5 sm:p-8 print:px-0 print:pb-4 print:pt-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{preparedBy}</p>
            <p className="text-sm text-muted-foreground">{t('prepared_for', { client: report.client.name })}</p>
          </div>
          <p className="text-sm text-muted-foreground sm:text-right">{t('generated', { date: day(report.generatedAt) })}</p>
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl print:text-2xl">{t('title')}</h1>
        <p className="mt-1 break-all text-sm text-muted-foreground">{report.client.domain}</p>
      </header>

      <div className="space-y-5 p-5 sm:p-8 print:space-y-4 print:px-0 print:py-4">
        <ScanSection scan={report.scan} clientName={report.client.name} locale={locale} />
        <PulseSection pulse={report.pulse} activeQuestions={report.activeQuestions} clientId={clientId} locale={locale} />
      </div>

      <footer className="border-t border-border px-5 py-5 sm:px-8 print:px-0 print:py-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('methodology')}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t('prepared_by', { agency: preparedBy })}</p>
      </footer>
    </article>
  )
}

const STATUS_ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

function ScanSection({ scan, clientName, locale }: { scan: CombinedScan; clientName: string; locale: string }) {
  const t = useTranslations('combinedReport')
  const resultT = useTranslations('resultPage')
  const visuals = useTranslations('visuals')
  const checkNames = useTranslations('checks')
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })

  const findingLabel = (key: string | null | undefined) => {
    if (!key) return null
    return checkNames(key)
  }

  return (
    <section aria-labelledby="combined-scan-title" className="rounded-xl border border-border p-5 print:break-inside-auto print:p-4">
      <h2 id="combined-scan-title" className="text-lg font-semibold">{t('scan_title')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('scan_body', { client: clientName })}</p>

      {scan.state !== 'recorded' ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {scan.state === 'none' ? t('scan_empty') : scan.state === 'unscored' ? t('scan_unscored') : t('scan_unavailable')}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="inline-flex items-center gap-2 text-2xl font-bold tabular-nums">
              <Gauge aria-hidden="true" className="size-5 text-primary-accessible" />
              {t('score', { score: formatScanScore(scan.score) })}
            </p>
            {scan.grade && <p className="text-sm font-medium">{t('grade', { grade: scan.grade })}</p>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('scanned', { date: date.format(new Date(scan.scannedAt)) })}</p>
          {typeof scan.potentialScore === 'number' && (
            <p className="mt-2 text-sm font-medium">{t('potential', { score: formatScanScore(scan.potentialScore) })}</p>
          )}
          {scan.collectionFailed && <p className="mt-2 text-sm text-tone-warning-fg">{t('scan_collection_failed')}</p>}
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('counts', {
              pass: scan.counts.pass,
              warn: scan.counts.warn,
              fail: scan.counts.fail,
              unknown: scan.counts.unknown,
            })}
            {scan.counts.notApplicable > 0 ? ` · ${t('counts_extra', { count: scan.counts.notApplicable })}` : ''}
          </p>

          {scan.buckets?.length ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {scan.buckets.map(bucket => (
                <div key={bucket.key} className="rounded-lg border border-border bg-neutral-1 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{visuals(`pillars.${bucket.key}`)}</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {visuals('pillarGauge.value', { earned: formatScanScore(bucket.earned), max: bucket.max })}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            <RevealHeatmap
              checks={scan.checks.map(check => ({ ...check, label: checkNames(check.key) }))}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold">{t('issues_title')}</h3>
          {scan.issues.length ? (
            <ol className="mt-2 space-y-2">
              {scan.issues.map(issue => (
                <li key={issue.key} className="flex min-w-0 items-start gap-2 text-sm leading-6">
                  {issue.status === 'fail'
                    ? <X aria-hidden="true" className="mt-1 size-4 shrink-0 text-tone-danger-fg" />
                    : <Minus aria-hidden="true" className="mt-1 size-4 shrink-0 text-tone-warning-fg" />}
                  <div className="min-w-0">
                    <p className="font-medium">
                      {issue.title}
                      {typeof issue.points === 'number' && (
                        <span className="ml-2 font-normal text-muted-foreground">{resultT('fix_points', { points: issue.points })}</span>
                      )}
                    </p>
                    {issue.nextStep && <p className="text-muted-foreground">{t('issue_next_step', { step: issue.nextStep })}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('no_issues')}</p>
          )}

          <h3 className="mt-6 text-sm font-semibold">{t('checks_detail_title')}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('checks_detail_body')}</p>
          <div className="mt-3 space-y-4">
            {(['core', 'extended', 'geo'] as const).map(bucket => {
              const checks = scan.checks.filter(check => check.bucket === bucket)
              if (!checks.length) return null
              return (
                <div key={bucket}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{visuals(`pillars.${bucket}`)}</h4>
                  <ul className="mt-1 divide-y divide-border">
                    {checks.map(check => {
                      const Icon = STATUS_ICONS[check.status]
                      const finding = findingLabel(check.finding)
                      return (
                        <li key={check.key} className="py-2.5 text-sm leading-6 print:break-inside-avoid">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                              <Icon aria-hidden="true" className="size-3.5" />
                              {visuals(`status.${check.status}`)}
                            </span>
                            <span className="font-medium">{checkNames(check.key)}</span>
                            <span className="text-xs text-muted-foreground">{t('check_weight', { weight: check.weight })}</span>
                          </div>
                          {(finding || check.details) && (
                            <p className="mt-0.5 text-muted-foreground">
                              {finding ?? t('no_finding')}{check.details ? ` (${check.details})` : ''}
                            </p>
                          )}
                          {check.action && <p className="mt-0.5 text-muted-foreground">{t('issue_next_step', { step: check.action })}</p>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>

          {scan.geo && <GeoSection geo={scan.geo} />}
          {scan.trustSignals && (
            <div className="mt-6">
              <TrustSignalsSection value={scan.trustSignals} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function GeoFact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function GeoSection({ geo }: { geo: NonNullable<Extract<CombinedScan, { state: 'recorded' }>['geo']> }) {
  const t = useTranslations('combinedReport')
  const geoLabels = useTranslations('geoDetail')
  const percent = (value: number) => `${Math.round(value)}%`

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">{t('geo_title')}</h3>
      <div className="mt-2 space-y-3">
        {geo.c17 && (
          <article className="rounded-lg border border-border p-4 print:break-inside-avoid">
            <h4 className="text-sm font-semibold">{geoLabels('c17Title')}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {typeof geo.c17.qualityScore === 'number' && <GeoFact label={geoLabels('overallQuality')} value={`${Math.round(geo.c17.qualityScore)}/100`} />}
              {typeof geo.c17.citationsPerThousandWords === 'number' && <GeoFact label={geoLabels('citationsPer1k')} value={Math.round(geo.c17.citationsPerThousandWords)} />}
              {typeof geo.c17.totalLinks === 'number' && <GeoFact label={t('geo_links_total')} value={geo.c17.totalLinks} />}
              {typeof geo.c17.externalLinks === 'number' && <GeoFact label={t('geo_links_external')} value={geo.c17.externalLinks} />}
            </dl>
            {geo.c17.authorityBreakdown && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{geoLabels('authorityBreakdown')}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {(['tier1', 'tier2', 'tier3', 'other'] as const).map(tier => (
                    <span key={tier} className="rounded border border-border px-2 py-0.5">
                      {tier === 'other' ? geoLabels('tierOther') : `Tier ${tier.slice(-1)}`} {geo.c17!.authorityBreakdown?.[tier] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>
        )}

        {geo.c18 && (
          <article className="rounded-lg border border-border p-4 print:break-inside-avoid">
            <h4 className="text-sm font-semibold">{geoLabels('c18Title')}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {typeof geo.c18.qualityScore === 'number' && <GeoFact label={geoLabels('overallQuality')} value={`${Math.round(geo.c18.qualityScore)}/100`} />}
              {typeof geo.c18.numberDensity === 'number' && <GeoFact label={geoLabels('numberDensity')} value={Math.round(geo.c18.numberDensity)} />}
              {typeof geo.c18.namedEntityDensity === 'number' && <GeoFact label={geoLabels('entityDensity')} value={Math.round(geo.c18.namedEntityDensity)} />}
              {typeof geo.c18.uniquenessScore === 'number' && <GeoFact label={geoLabels('uniqueness')} value={`${Math.round(geo.c18.uniquenessScore)}/100`} />}
              {typeof geo.c18.dateReferences === 'number' && <GeoFact label={t('geo_date_refs')} value={geo.c18.dateReferences} />}
              {typeof geo.c18.hasComparativeData === 'boolean' && <GeoFact label={geoLabels('comparativeData')} value={geo.c18.hasComparativeData ? '✓' : '—'} />}
              {typeof geo.c18.hasTimeSeriesData === 'boolean' && <GeoFact label={geoLabels('timeSeriesData')} value={geo.c18.hasTimeSeriesData ? '✓' : '—'} />}
            </dl>
          </article>
        )}

        {geo.c19 && (
          <article className="rounded-lg border border-border p-4 print:break-inside-avoid">
            <h4 className="text-sm font-semibold">{geoLabels('c19Title')}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {typeof geo.c19.topicalCoverageScore === 'number' && <GeoFact label={geoLabels('coverageScore')} value={`${Math.round(geo.c19.topicalCoverageScore)}/100`} />}
              {typeof geo.c19.totalClusters === 'number' && <GeoFact label={t('geo_clusters')} value={geo.c19.totalClusters} />}
              {typeof geo.c19.hasOrphanPages === 'number' && geo.c19.hasOrphanPages > 0 && <GeoFact label={t('geo_orphan_pages')} value={geo.c19.hasOrphanPages} />}
            </dl>
            {geo.c19.detectedClusters?.length ? (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">{geoLabels('detectedClusters')}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {geo.c19.detectedClusters.slice(0, 5).map(cluster => (
                    <li key={cluster.topic} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{cluster.topic}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{percent(cluster.completenessScore)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        )}

        {geo.c20 && (
          <article className="rounded-lg border border-border p-4 print:break-inside-avoid">
            <h4 className="text-sm font-semibold">{geoLabels('c20Title')}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              {typeof geo.c20.optimalChunkRatio === 'number' && <GeoFact label={geoLabels('optimalChunkRatio')} value={percent(geo.c20.optimalChunkRatio)} />}
              {typeof geo.c20.totalChunks === 'number' && <GeoFact label={t('geo_chunks')} value={geo.c20.totalChunks} />}
              {typeof geo.c20.avgChunkLength === 'number' && <GeoFact label={t('geo_avg_words')} value={Math.round(geo.c20.avgChunkLength)} />}
              {geo.c20.hasFaqStyle === true && <GeoFact label={t('geo_faq_style')} value="✓" />}
            </dl>
          </article>
        )}
      </div>
    </div>
  )
}

function PulseSection({ pulse, activeQuestions, clientId, locale }: { pulse: CombinedPulse; activeQuestions: number | null; clientId: string; locale: string }) {
  const t = useTranslations('combinedReport')
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const platformLabels: Record<string, string> = {
    'gemini-flash': t('platform_gemini_flash'),
    'gpt-4o': t('platform_chatgpt'),
    'claude-haiku': t('platform_claude'),
    'perplexity-sonar': t('platform_perplexity'),
    'perplexity-sonar-pro': t('platform_perplexity_pro'),
  }
  const platformLabel = (key: string) => platformLabels[key] ?? key
  const rate = (value: number | null) => value === null ? t('mention_rate_none') : t('mention_rate', { value })

  return (
    <section aria-labelledby="combined-pulse-title" className="rounded-xl border border-border p-5 print:break-inside-auto print:p-4">
      <h2 id="combined-pulse-title" className="text-lg font-semibold">{t('pulse_title')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('pulse_body')}</p>

      {pulse.state !== 'recorded' ? (
        <div className="mt-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {pulse.state === 'none' ? t('pulse_empty') : t('pulse_unavailable')}
          </p>
          {pulse.state === 'none' && (
            <Link
              href={`/${locale}/dashboard/${clientId}?step=monitor#first-monitoring`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline print:hidden"
            >
              {t('start_monitoring')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">{t('pulse_week', { week: date.format(new Date(pulse.week)) })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{typeof pulse.change === 'number'
            ? t('pulse_change', { change: pulse.change }) : t('pulse_change_unavailable')}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('active_questions_label')}</dt>
              <dd className="font-semibold tabular-nums">{activeQuestions ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('answers_label')}</dt>
              <dd className="font-semibold tabular-nums">{pulse.answers}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('mentions_label')}</dt>
              <dd className="font-semibold tabular-nums">{pulse.brandMentions}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('rate_label')}</dt>
              <dd className="font-semibold tabular-nums">{rate(pulse.brandShare)}</dd>
            </div>
          </dl>

          {pulse.platforms.length > 0 && (
            <div className="mt-5 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label={t('platforms_title')}>
              <table className="w-full min-w-[28rem] text-sm print:min-w-0">
                <caption className="mb-2 text-left font-semibold">{t('platforms_title')}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('platform')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('answers_short')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('mentions_short')}</th>
                    <th scope="col" className="py-2 font-medium">{t('rate_short')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pulse.platforms.map(platform => (
                    <tr key={platform.key} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">{platformLabel(platform.key)}</th>
                      <td className="py-2 pr-4 tabular-nums">{platform.answers}</td>
                      <td className="py-2 pr-4 tabular-nums">{platform.mentions}</td>
                      <td className="py-2 tabular-nums">{rate(platform.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label={t('competitors_title')}>
            <table className="w-full min-w-[28rem] text-sm print:min-w-0">
              <caption className="mb-2 text-left font-semibold">{t('competitors_title')}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('competitor')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('mentions_short')}</th>
                  <th scope="col" className="py-2 font-medium">{t('rate_short')}</th>
                </tr>
              </thead>
              <tbody>
                {pulse.competitors?.length ? pulse.competitors.map(competitor => (
                  <tr key={competitor.label} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{competitor.label}</th>
                    <td className="py-2 pr-4 tabular-nums">{competitor.mentions}</td>
                    <td className="py-2 tabular-nums">{rate(competitor.share)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="py-2 text-muted-foreground">{t('competitors_empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-5 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label={t('questions_title')}>
            <table className="w-full min-w-[28rem] text-sm print:min-w-0">
              <caption className="mb-2 text-left font-semibold">{t('questions_title')}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('question')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('answers_short')}</th>
                  <th scope="col" className="py-2 font-medium">{t('mentions_short')}</th>
                </tr>
              </thead>
              <tbody>
                {pulse.prompts.length ? pulse.prompts.map((prompt, index) => (
                  <tr key={`${prompt.question}-${index}`} className="border-b align-top last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{prompt.question}</th>
                    <td className="py-2 pr-4 tabular-nums">{prompt.answers}</td>
                    <td className="py-2 tabular-nums">{prompt.brandMentions}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="py-2 text-muted-foreground">{t('questions_empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
