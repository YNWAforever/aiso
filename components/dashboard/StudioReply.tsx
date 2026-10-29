import { useTranslations } from 'next-intl'
import { ScanEvidencePanel } from '@/components/result/ScanEvidencePanel'
import type { OpenStudioEvidence, StudioEvidence, StudioReply } from '@/lib/conversation-studio/types'

export function StudioReplyView({ reply, number = 1, onBranchBrief, onOpenEvidence }: { reply: StudioReply; evidence: StudioEvidence; id: string; number?: number; liveEnabled?: boolean; onBranchBrief?: () => void; onOpenEvidence?: OpenStudioEvidence }) {
  const t = useTranslations('conversationStudio.evidence')
  const studio = useTranslations('conversationStudio')
  return <article aria-label={t('replyLabel')} className="as-saved-reply min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <details className="as-research">
      <summary>{t('stepsTitle')}</summary>
      {reply.researchSteps.length ? <ol className="list-decimal space-y-2 pb-3 pl-5">{reply.researchSteps.map(step => <li key={step.kind}>{step.kind === 'loadWeek' ? t('stepLoad', { week: step.week, count: step.count }) : t(step.kind === 'selectRecords' ? 'stepSelect' : 'stepCompose')}</li>)}</ol> : <p className="as-muted pb-3">{t('noSteps')}</p>}
    </details>
    <section className="as-result space-y-3">
    <p className="as-result-kicker">{t('savedSummary')}</p>
    <h3>{t(reply.status === 'evidenced' ? 'savedSummary' : 'insufficient')}</h3>
    <p className="as-note">{t(reply.template === 'competitors' ? 'comparisonLimit' : reply.template ? 'summaryScope' : 'questionLimit')}</p>
    <div className="flex flex-wrap gap-2"><span className="as-badge as-badge-amber">{studio('honesty.searchDemandPending')}</span></div>
    {reply.template === 'report' && <p className="as-badge">{t('reportDraft')}</p>}
    <div className="as-result-actions"><button type="button" className="as-button px-3" onClick={event => onOpenEvidence?.(event.currentTarget)} aria-haspopup="dialog">{t('open')}</button>{onBranchBrief && <button type="button" className="as-button as-primary px-3" onClick={onBranchBrief}>{studio('branchBrief')}</button>}</div>
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
