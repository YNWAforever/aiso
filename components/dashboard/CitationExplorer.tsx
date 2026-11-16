'use client'

import { useState } from 'react'
import {citationQueryParams} from '@/lib/citations/query'
import { useLocale, useTranslations } from 'next-intl'
import { EmptyState } from '@/components/ui/empty-state'

import type { CitationKind } from '@/lib/citations/classify'
import type { CitationDomain, CitationReport } from '@/lib/citations/report'
import { summarizeCitations } from '@/lib/citations/summary'
import { platformLabel } from '@/lib/view-models/monitor-signals'

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
  const [exportError,setExportError]=useState(false)
  const t = useTranslations('citations');const locale=useLocale()
  const [kind, setKind] = useState<CitationKind | 'all'>(report.query?.kind??'all')
  const typeLabel = (d: { kind: CitationKind; competitor?: string }) =>
    d.kind === 'competitor' && d.competitor ? `${t('kind_competitor')} · ${d.competitor}` : t(`kind_${d.kind}`)

  const present = CITATION_KINDS.filter(k => report.availableKinds?report.availableKinds.includes(k):report.domains.some(d => d.kind === k))
  const shown = report.query?report.domains:domainsOfKind(report.domains, kind)
  const queryHref=(updates:Record<string,string|number|undefined>)=>{const p=report.query?citationQueryParams(report.query):new URLSearchParams();for(const [k,v]of Object.entries(updates)){if(v===undefined)p.delete(k);else p.set(k,String(v));}return `/${locale}/dashboard/${clientId}/citations?${p}`}
  const csvHref = `/api/dashboard/clients/${encodeURIComponent(clientId)}/citations?format=csv${report.query?`&${citationQueryParams(report.query)}`:''}`
  const latest = report.weeks[0]
  const earliest = report.weeks.at(-1)
  const summary = summarizeCitations(report)
  const filterKeys = ['domain', 'platform', 'promptId', 'runId', 'from', 'to'] as const
  const filterCount = filterKeys.filter(key => report.query?.[key]).length + (report.query?.kind ? 1 : 0)

  return (
    <div className="space-y-6">
      <section aria-label={t('summary_label')} className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          [t('summary_with_citations'), summary.withCitations],
          [t('summary_recorded_empty'), summary.recordedEmpty],
          [t('summary_unrecorded'), summary.unrecorded],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card p-3 sm:p-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground sm:text-3xl">{value}</p>
          </div>
        ))}
      </section>
      {summary.total > 0 && <p className="text-sm text-muted-foreground">{t('summary_note', { share: summary.citedShare ?? '—', total: summary.total })}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {summary.total > 0 && <a href={csvHref} download onClick={async event=>{event.preventDefault();setExportError(false);try{const response=await fetch(csvHref,{cache:'no-store'});if(!response.ok)throw new Error('export');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cited-sources.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{setExportError(true)}}} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-primary-accessible underline">{t('download')}</a>}
        {latest && (latest === earliest
          ? <p className="text-sm text-muted-foreground">{t('week_single', { week: latest })}</p>
          : <p className="text-sm text-muted-foreground">{t('weeks', { from: earliest ?? latest, to: latest })}</p>)}
        {exportError && <p role="alert" className="text-sm text-tone-danger-fg">{t('export_error')}</p>}
      </div>

      <details className="rounded-2xl border border-border bg-card">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
          {t('filters')}{filterCount > 0 ? ` · ${t('filters_applied', { count: filterCount })}` : ''}
        </summary>
        <div className="space-y-3 border-t border-border p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('scope_label')}>
            {filterKeys.map(key => (
              <label key={key} className="text-sm font-medium">
                {t(`scope_${key}`)}
                <input className="mt-1 block w-full min-h-11 rounded-lg border border-border bg-background px-3" type={key==='from'||key==='to'?'date':'text'} name={key} defaultValue={report.query?.[key]??''}/>
              </label>
            ))}
            {report.query?.kind&&<input type="hidden" name="kind" value={report.query.kind}/>}
            <div className="flex items-end">
              <button className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{t('apply_filters')}</button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">{t('scope_note')}</p>
          <p className="text-xs text-muted-foreground">{t('coverage_note')}</p>
        </div>
      </details>

      {report.pages&&<nav aria-label={t('pagination')} className="flex flex-wrap gap-3"><span className="text-sm">{t('page_label',{page:report.pages.domains.page,total:report.pages.domains.total})}</span>{report.query!.page>1&&<a className="min-h-11 underline" href={queryHref({page:report.query!.page-1,evidencePage:1})}>{t('previous')}</a>}{[report.pages.domains,report.pages.urls,report.pages.gaps].some(p=>p.page*p.pageSize<p.total)&&<a className="min-h-11 underline" href={queryHref({page:report.query!.page+1,evidencePage:1})}>{t('next')}</a>}</nav>}
      {report.evidenceWindow&&<nav aria-label={t('answer_evidence')} className="flex flex-wrap gap-3"><p className="text-sm">{t('evidence_window',{shown:report.evidence?.length??0,total:report.evidenceWindow.total,page:report.evidenceWindow.page})}</p>{report.evidenceWindow.page>1&&<a className="min-h-11 underline" href={queryHref({evidencePage:report.evidenceWindow.page-1})}>{t('previous')}</a>}{report.evidenceWindow.page*report.evidenceWindow.pageSize<report.evidenceWindow.total&&<a className="min-h-11 underline" href={queryHref({evidencePage:report.evidenceWindow.page+1})}>{t('next_evidence')}</a>}</nav>}
      <section className="space-y-2"><p>{t('gap_'+report.gapCoverage.state,{configured:report.gapCoverage.configuredCompetitors,domains:report.gapCoverage.competitorsWithDomains})}</p>{['not_configured','partial_config'].includes(report.gapCoverage.state)&&<a className="inline-flex min-h-11 items-center underline" href={`/${locale}/dashboard/${clientId}/competitors`}>{t('configure_competitors')}</a>}</section>
      {report.domains.length === 0 && (!report.pages||report.pages.domains.total===0) ? (
        report.query?.kind||report.query?.domain?<p className="text-sm text-muted-foreground">{t('filtered_empty')}</p>:<EmptyState illustration="monitor" title={t('empty')} />
      ) : (
        <>
          <section aria-labelledby="citation-gaps-title" className="space-y-2">
            <h2 id="citation-gaps-title" className="text-lg font-bold">{t('gaps_title')}</h2>
            <p className="text-sm text-muted-foreground">{t('gaps_note')}</p>
            {report.gaps.length === 0 ? <p className="text-sm">{report.pages&&report.pages.gaps.total>0?t('gaps_page_empty'):report.gapCoverage.state==='ready'?t('gaps_none'):t('gap_'+report.gapCoverage.state,{configured:report.gapCoverage.configuredCompetitors,domains:report.gapCoverage.competitorsWithDomains})}</p> : (
              <div className="relative overflow-x-auto" tabIndex={0} aria-label={t('gaps_title')}>
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
                <button key={option} type="button" aria-pressed={kind === option} onClick={() => {setKind(option);if(report.query)window.location.assign(queryHref({kind:option==='all'?undefined:option,page:1,evidencePage:1}))}}
                  className={`min-h-11 rounded-full border px-4 text-sm ${kind === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}>
                  {option === 'all' ? t('filter_all') : t(`kind_${option}`)}
                </button>
              ))}
            </div>
            {shown.length === 0 ? <p className="text-sm text-muted-foreground">{report.pages&&report.pages.domains.total>0?t('page_empty'):t('filtered_empty')}</p> : (
              <div className="relative overflow-x-auto" tabIndex={0} aria-label={t('domains_title')}>
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
                        <th scope="row" className="py-2 pr-4 text-left font-medium break-all">{d.domain}<a className="block min-h-11 text-xs underline" href={queryHref({domain:d.domain,page:1,evidencePage:1})}>{t('scope_evidence')}</a><details><summary className="min-h-11 text-xs underline">{t('answer_evidence')}</summary><ul>{report.evidence?.filter(e=>e.domain===d.domain).map(e=><li key={`${e.observationId}:${e.url}`}><a className="min-h-11 underline" href={`/${locale}/dashboard/${clientId}/observations?week=${e.week}&observation=${e.observationId}${e.runId?`&run=${e.runId}`:''}`}>{e.question} · {e.platform} · {e.market??t('context_unknown')} · {e.language??t('context_unknown')} · {e.runId??'legacy'}</a></li>)}</ul></details></th>
                        <td className="py-2 pr-4">{typeLabel(d)}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.answers}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.citations}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.prompts}</td>
                        <td className="py-2">{d.platforms.map(platformLabel).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="citation-urls-title" className="space-y-3">
            <h2 id="citation-urls-title" className="text-lg font-bold">{t('urls_title')}</h2>
            <div className="relative overflow-x-auto" tabIndex={0} aria-label={t('urls_title')}>
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
                        <details><summary className="min-h-11 text-xs underline">{t('answer_evidence')}</summary><p className="text-xs">{t('evidence_window',{shown:report.evidence?.filter(e=>e.url===u.url).length??0,total:u.answers,page:report.evidenceWindow?.page??1})}</p><ul>{report.evidence?.filter(e=>e.url===u.url).map(e=><li key={e.observationId}><a className="min-h-11 underline" href={`/${locale}/dashboard/${clientId}/observations?week=${e.week}&observation=${e.observationId}${e.runId?`&run=${e.runId}`:''}`}>{e.question} · {e.platform} · {e.market??t('context_unknown')} · {e.language??t('context_unknown')}</a></li>)}</ul></details>
                      </th>
                      <td className="py-2 pr-4">{typeLabel(u)}</td>
                      <td className="py-2 tabular-nums">{u.answers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </>
      )}
    </div>
  )
}

