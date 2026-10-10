'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import type { CitationKind } from '@/lib/citations/classify'
import type { CitationDomain, CitationReport } from '@/lib/citations/report'

/** Display order of the source types; also the order of the filter chips. */
export const CITATION_KINDS: readonly CitationKind[] = [
  'owned', 'competitor', 'editorial', 'review', 'forum', 'social', 'institutional', 'other',
]

/** The sites table under one filter; `all` keeps the report's order. */
export function domainsOfKind(domains: CitationDomain[], kind: CitationKind | 'all'): CitationDomain[] {
  return kind === 'all' ? domains : domains.filter(d => d.kind === kind)
}

/**
 * The citation explorer (GEO parity Step 5): who AI answers cite for this
 * brand's questions, what kind of source each is, and where a competitor is
 * cited instead of the brand. Reads the Step 4 report; no writes.
 */
export function CitationExplorer({ report, clientId }: { report: CitationReport; clientId: string }) {
  const t = useTranslations('citations')
  const [kind, setKind] = useState<CitationKind | 'all'>('all')
  const typeLabel = (d: { kind: CitationKind; competitor?: string }) =>
    d.kind === 'competitor' && d.competitor ? `${t('kind_competitor')} · ${d.competitor}` : t(`kind_${d.kind}`)

  const present = CITATION_KINDS.filter(k => report.domains.some(d => d.kind === k))
  const shown = domainsOfKind(report.domains, kind)
  const csvHref = `/api/dashboard/clients/${encodeURIComponent(clientId)}/citations?format=csv`
  const latest = report.weeks[0]
  const earliest = report.weeks.at(-1)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm leading-6 text-muted-foreground">{t('intro')}</p>
        {latest && earliest && <p className="text-sm font-medium">{t('weeks', { from: earliest, to: latest })}</p>}
        <p className="text-sm">{t('coverage', report.answers)}</p>
        <p className="text-xs text-muted-foreground">{t('coverage_note')}</p>
      </div>

      {report.domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <section aria-labelledby="citation-gaps-title" className="space-y-2">
            <h2 id="citation-gaps-title" className="text-lg font-bold">{t('gaps_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('gaps_note')}</p>
            {report.gaps.length === 0 ? <p className="text-sm">{t('gaps_none')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_question')}</th>
                      <th scope="col" className="py-2 font-medium">{t('col_competitors')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.gaps.map(gap => (
                      <tr key={gap.promptId ?? gap.question} className="border-b align-top last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">{gap.question}</th>
                        <td className="py-2">{gap.competitors.join(', ')} <span className="text-muted-foreground">({gap.domains.join(', ')})</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="citation-domains-title" className="space-y-3">
            <h2 id="citation-domains-title" className="text-lg font-bold">{t('domains_title')}</h2>
            <div role="group" aria-label={t('filter_label')} className="flex flex-wrap gap-2">
              {(['all', ...present] as const).map(option => (
                <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}
                  className={`min-h-11 rounded-full border px-4 text-sm ${kind === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}>
                  {option === 'all' ? t('filter_all') : t(`kind_${option}`)}
                </button>
              ))}
            </div>
            {shown.length === 0 ? <p className="text-sm text-muted-foreground">{t('filtered_empty')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_site')}</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_type')}</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_answers')}</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_citations')}</th>
                      <th scope="col" className="py-2 pr-4 font-medium">{t('col_questions')}</th>
                      <th scope="col" className="py-2 font-medium">{t('col_platforms')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(d => (
                      <tr key={d.domain} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium break-all">{d.domain}</th>
                        <td className="py-2 pr-4">{typeLabel(d)}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.answers}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.citations}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.prompts}</td>
                        <td className="py-2">{d.platforms.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="citation-urls-title" className="space-y-3">
            <h2 id="citation-urls-title" className="text-lg font-bold">{t('urls_title')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('col_page')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('col_type')}</th>
                    <th scope="col" className="py-2 font-medium">{t('col_answers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.urls.map(u => (
                    <tr key={u.url} className="border-b align-top last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        {/* Third-party pages the AI cited: never followed with our referrer or ranking. */}
                        <a href={u.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary-accessible underline">
                          {u.title ?? u.url}
                        </a>
                        {u.title && <span className="block break-all text-xs text-muted-foreground">{u.url}</span>}
                      </th>
                      <td className="py-2 pr-4">{typeLabel(u)}</td>
                      <td className="py-2 tabular-nums">{u.answers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <a href={csvHref} download className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline">{t('download')}</a>
        </>
      )}
    </div>
  )
}
