import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { ScanEvidencePanel } from '@/components/result/ScanEvidencePanel'
import { buildDashboardNav } from '@/lib/dashboard-nav'
import type { OpenStudioEvidence, StudioEvidence, StudioOpportunitySuggestion, StudioReply } from '@/lib/conversation-studio/types'
import type { StudioGscRead } from '@/lib/conversation-studio/gsc-types'
import type { StudioDfsRead } from '@/lib/conversation-studio/dfs-types'
import type { StudioFirecrawlRead } from '@/lib/conversation-studio/firecrawl-types'
import { buildWorkItemDraftBody, readSavedDraftId, workItemDraftErrorKey } from '@/lib/conversation-studio/work-item-draft'

function StudioResultLinks({ clientId }: { clientId: string }) {
  const lang = useLocale()
  const t = useTranslations('conversationStudio')
  const nav = buildDashboardNav({ lang, clientId: encodeURIComponent(clientId), features: {} })
  const opportunities = nav.find(section => section.key === 'scan')?.items.find(item => item.key === 'opportunities')
  const reports = nav.find(section => section.key === 'reports')
  return <div className="as-result-actions">
    {opportunities && <Link href={opportunities.href} prefetch={false} className="as-button gap-2 px-3">{t('destinations.opportunities')}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>}
    {reports && <Link href={reports.href} prefetch={false} className="as-button gap-2 px-3">{t('destinations.reports')}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>}
    <Link href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/studio/tools`} prefetch={false} className="as-button gap-2 px-3">{t('viewTools')}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>
  </div>
}

type DraftSaveState = { status: 'idle' | 'saving' | 'saved' | 'error' | 'changed'; draftId?: string; error?: string }

function OpportunityDraftAction({ clientId, suggestion, locale }: { clientId: string; suggestion: StudioOpportunitySuggestion; locale: string }) {
  const t = useTranslations('conversationStudio')
  const [state, setState] = useState<DraftSaveState>({ status: 'idle' })
  const draftId = suggestion.savedDraftId ?? state.draftId ?? null
  const versionsHref = draftId ? `/${locale}/dashboard/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(draftId)}/versions` : null

  async function save() {
    if (state.status === 'saving') return
    setState({ status: 'saving' })
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/work-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWorkItemDraftBody(suggestion, locale)),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const error = workItemDraftErrorKey(response.status, (data as { error?: unknown } | null)?.error)
        setState({ status: error === 'workItemDraftEvidenceChanged' ? 'changed' : 'error', error })
        return
      }
      const id = readSavedDraftId(data, clientId)
      if (!id) {
        setState({ status: 'error', error: 'workItemDraftError' })
        return
      }
      setState({ status: 'saved', draftId: id })
    } catch {
      setState({ status: 'error', error: 'workItemDraftError' })
    }
  }

  if (versionsHref) return <div className="space-y-2">
    <p className="as-badge">{t(state.status === 'saved' ? 'workItemDraftSaved' : 'workItemDraftAlreadySaved')}</p>
    <Link href={versionsHref} prefetch={false} className="as-button inline-flex items-center gap-2 px-3">{t('openWorkItemDraft')}<ArrowUpRight className="size-4 shrink-0" aria-hidden="true" /></Link>
  </div>
  if (suggestion.saveAvailability !== 'available') return <p className="as-note">{t('workItemDraftLimited')}</p>
  if (state.status === 'changed') return <p role="alert">{t('workItemDraftEvidenceChanged')}</p>
  return <div className="space-y-2">
    <button type="button" className="as-button as-primary px-3" disabled={state.status === 'saving'} onClick={save}>{t(state.status === 'saving' ? 'savingWorkItemDraft' : 'saveWorkItemDraft')}</button>
    <p className="as-note">{t('workItemDraftReview')}</p>
    {state.status === 'error' && <p role="alert">{t(state.error ?? 'workItemDraftError')}</p>}
  </div>
}

const DFS_RAN = new Set(['ok', 'empty'])
const FIRECRAWL_RAN = new Set(['ok', 'empty'])

export function StudioReplyView({ reply, clientId, number = 1, gsc, dfs, firecrawl, onBranchBrief, onOpenEvidence }: { reply: StudioReply; clientId?: string; evidence: StudioEvidence; id: string; number?: number; liveEnabled?: boolean; gsc?: StudioGscRead; dfs?: StudioDfsRead; firecrawl?: StudioFirecrawlRead; onBranchBrief?: () => void; onOpenEvidence?: OpenStudioEvidence }) {
  const t = useTranslations('conversationStudio.evidence')
  const studio = useTranslations('conversationStudio')
  const lang = useLocale()
  const opportunityTask = reply.template === 'opportunity'
  const dfsRan = Boolean(dfs?.snapshot && DFS_RAN.has(dfs.snapshot.status))
  const firecrawlRan = Boolean(firecrawl?.snapshot && FIRECRAWL_RAN.has(firecrawl.snapshot.status))
  return <article aria-label={t('replyLabel')} className="as-saved-reply min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <details className="as-research">
      <summary>{t('stepsTitle')}</summary>
      {reply.researchSteps.length || gsc?.snapshot?.window || dfsRan || firecrawlRan ? <ol className="list-decimal space-y-2 pb-3 pl-5">{reply.researchSteps.map(step => <li key={step.kind}>{step.kind === 'loadWeek' ? t('stepLoad', { week: step.week, count: step.count }) : step.kind === 'loadOpportunities' ? studio('templates.opportunity.stepLoad', { count: step.count }) : t(step.kind === 'selectRecords' ? 'stepSelect' : 'stepCompose')}</li>)}{gsc?.snapshot?.window && <li>{studio('gsc.researchStep', gsc.snapshot.window)}</li>}{dfsRan && dfs?.snapshot && <li>{studio('dfs.researchStep', { keyword: dfs.snapshot.keyword ?? '' })}</li>}{firecrawlRan && firecrawl?.snapshot && <li>{studio('firecrawl.researchStep', { url: firecrawl.snapshot.url ?? '' })}</li>}</ol> : <p className="as-muted pb-3">{t('noSteps')}</p>}
    </details>
    <section className="as-result space-y-3">
    <p className="as-result-kicker">{t('savedSummary')}</p>
    <h3>{opportunityTask ? studio('templates.opportunity.label') : t(reply.status === 'evidenced' ? 'savedSummary' : 'insufficient')}</h3>
    <p className="as-note">{opportunityTask ? studio('templates.opportunity.limit') : t(reply.template === 'competitors' ? 'comparisonLimit' : reply.template ? 'summaryScope' : 'questionLimit')}</p>
    <div className="flex flex-wrap gap-2"><span className="as-badge as-badge-amber">{studio('honesty.searchDemandPending')}</span></div>
    {opportunityTask && reply.opportunities && <>
      {reply.opportunities.partial && reply.opportunities.suggestions.length > 0 && <p className="as-badge as-badge-amber">{studio('templates.opportunity.partial')}</p>}
      {reply.opportunities.state === 'ready' ? <ul className="space-y-3">{reply.opportunities.suggestions.map(suggestion => <li key={suggestion.key} className="as-result space-y-2">
        <h4>{suggestion.title}</h4>
        <p className="whitespace-pre-wrap">{suggestion.action}</p>
        <p className="as-muted as-small">{t('sourcesTitle')}</p>
        <ul className="flex flex-wrap gap-2">{suggestion.evidenceRefs.map(ref => <li key={`${ref.kind}-${ref.id}-${ref.checkKey ?? ''}`} className="as-badge [overflow-wrap:anywhere]">
          {t(ref.kind === 'pulse-metric' ? 'coverage.pulse' : 'coverage.scan')}: <code>{ref.id}{ref.checkKey ? ` · ${ref.checkKey}` : ''}</code>
        </li>)}</ul>
        {suggestion.recordedAt && <p className="as-muted as-small">{t('recordedAt')}: <time dateTime={suggestion.recordedAt}>{suggestion.recordedAt}</time></p>}
        {clientId && <OpportunityDraftAction clientId={clientId} suggestion={suggestion} locale={lang} />}
      </li>)}</ul> : <p className="as-note">{studio(`templates.opportunity.${reply.opportunities.state}`)}</p>}
    </>}
    {reply.template === 'report' && <p className="as-badge">{t('reportDraft')}</p>}
    <div className="as-result-actions">{!opportunityTask && <button type="button" className="as-button px-3" onClick={event => onOpenEvidence?.(event.currentTarget)} aria-haspopup="dialog">{t('open')}</button>}{onBranchBrief && <button type="button" className="as-button as-primary px-3" onClick={onBranchBrief}>{studio('branchBrief')}</button>}</div>
    {clientId && <StudioResultLinks clientId={clientId} />}
    </section>
    {reply.observations.length > 0 && <>
      <p className="as-muted as-small">{t('selected', { count: reply.observations.length })}</p>
      <ul className="space-y-3">{reply.observations.map((item, index) => <li key={item.id} className="as-result space-y-2">
        <p className="as-result-kicker">{t('savedObservation')}</p>
        <h3>{item.question}</h3>
        <div className="flex flex-wrap gap-2"><span className="as-badge">{item.platform} · {item.scanWeek}</span><span className={item.result === 'success' ? 'as-badge as-badge-blue' : 'as-badge as-badge-amber'}>{t(item.result === 'success' ? 'classified' : 'incomplete')}</span></div>
        <p>{t('brandMention')}: {t(item.brandMentioned === true ? 'mentionYes' : item.brandMentioned === false ? 'mentionNo' : 'unknown')}</p>
        {item.excerpt ? <><p className="as-note">{t('historicalQuote')}</p><blockquote className="whitespace-pre-wrap border-l-2 pl-3">{item.excerpt}</blockquote></> : <p className="as-note">{t('answerMissing')}</p>}
        <button type="button" className="as-button px-3" onClick={event => onOpenEvidence?.(event.currentTarget, `source-${index}`)} aria-haspopup="dialog">{t('open')} [{index + 1}]</button>
      </li>)}</ul>
    </>}
    {reply.scan && <ScanEvidencePanel evidence={reply.scan.evidence} ariaLabel={t('scanReplyLabel', { number })} />}
    {reply.scan && <button type="button" className="as-button px-3" onClick={event => onOpenEvidence?.(event.currentTarget, 'scan')} aria-haspopup="dialog">{t('open')}</button>}
  </article>
}

/** Coverage and provenance now live exclusively inside the selected-turn inspector. */
export function StudioSavedEvidence({ reply, evidence, id, liveEnabled = false }: { reply: StudioReply; evidence: StudioEvidence; id: string; liveEnabled?: boolean }) {
  const t = useTranslations('conversationStudio.evidence')
  const live = useTranslations('conversationStudio.live')
  const date = (value: string | null) => value ? <time dateTime={value}>{value}</time> : t('unknown')
  return <div className="space-y-3">
    <section id={`${id}-saved`} tabIndex={-1} className="space-y-3">
      <h3>{t('coverageTitle')}</h3>
      <p className="my-3">{t('boundedScope')}</p>
      {evidence.truncated && <p>{t('truncated')}</p>}
      <dl className="grid grid-cols-2 gap-2">{(['pulse', 'citations', 'scan', 'live'] as const).map(key => <div key={key} className="contents">
        <dt>{t(`coverage.${key}`)}</dt><dd><span className={reply.coverage[key] === 'present' ? 'as-badge as-badge-blue' : reply.coverage[key] === 'missing' ? 'as-badge as-badge-amber' : 'as-badge'}>{t(`status.${reply.coverage[key]}`)}</span></dd>
      </div>)}</dl>
      <p className="as-note mt-3">{t('coverageMeaning')}</p>
      <section className="mt-2">
        <h3>{t('sourcesTitle')}</h3>
        {reply.observations.length === 0 && !reply.scan && <p>{t('noSources')}</p>}
        <ul className="space-y-4">{reply.observations.map((item, index) => <li id={`${id}-source-${index}`} tabIndex={-1} key={item.id} className="as-divider space-y-1 pt-3">
          <p>{item.platform} · {item.scanWeek}</p><p>{item.question}</p>
          <p>[{index + 1}] {t('observationId')}: {item.id}</p>
          <p>{t('recordedAt')}: {date(item.recordedAt)} · {t('collectedAt')}: {date(item.collectedAt)}</p>
          <p>{t('model')}: {item.model ?? t('unknown')} · {t('market')}: {item.market ?? t('unknown')}</p>
          <p>{t('search')}: {t(item.searchEvidence?.execution === 'confirmed' ? 'searchConfirmed' : 'searchUnknown')}</p>
          {item.links.length ? <ul className="space-y-1">{item.links.map(link => <li key={link.url}>
            {t(link.kind === 'provider-citation' ? 'providerCitation' : 'textLink')}: <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">{link.title || link.url}</a><span className="as-small as-muted block">{link.url}</span>
          </li>)}</ul> : <p>{t('citationsMissing')}</p>}
        </li>)}</ul>
        {reply.scan && <p id={`${id}-scan`} tabIndex={-1} className="mt-3">{t('scanId')}: {reply.scan.id} · {t('recordedAt')}: {date(reply.scan.recordedAt)}</p>}
      </section>
      <p className="as-note my-3">{liveEnabled ? live('savedScope') : t('liveLimit')}</p>
    </section>
  </div>
}
