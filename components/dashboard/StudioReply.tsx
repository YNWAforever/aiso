import { useTranslations } from 'next-intl'
import { ScanEvidencePanel } from '@/components/result/ScanEvidencePanel'
import type { StudioEvidence, StudioReply } from '@/lib/conversation-studio/types'

export function StudioReplyView({ reply, evidence, id, number = 1 }: { reply: StudioReply; evidence: StudioEvidence; id: string; number?: number }) {
  const t = useTranslations('conversationStudio.evidence')
  const date = (value: string | null) => value ? <time dateTime={value}>{value}</time> : t('unknown')
  return <article aria-label={t('replyLabel')} className="min-w-0 space-y-3 p-2 text-sm [overflow-wrap:anywhere]">
    <h3 className="font-semibold">{t(reply.status === 'evidenced' ? 'savedSummary' : 'insufficient')}</h3>
    <p>{t(reply.template === 'competitors' ? 'comparisonLimit' : reply.template ? 'summaryScope' : 'questionLimit')}</p>
    {reply.template === 'report' && <p className="font-semibold">{t('reportDraft')}</p>}
    {reply.observations.length > 0 && <>
      <p>{t('selected', { count: reply.observations.length })}</p>
      <ul className="space-y-3">{reply.observations.map((item, index) => <li key={item.id} className="space-y-2 rounded-xl bg-secondary p-3">
        <p className="font-semibold">{item.question} <a href={`#${id}-source-${index}`} className="underline">[{index + 1}]</a></p>
        <p>{item.platform} · {item.scanWeek} · {t(item.result === 'success' ? 'classified' : 'incomplete')}</p>
        <p>{t('brandMention')}: {t(item.brandMentioned === true ? 'mentionYes' : item.brandMentioned === false ? 'mentionNo' : 'unknown')}</p>
        {item.excerpt ? <><p className="text-xs">{t('historicalQuote')}</p><blockquote className="whitespace-pre-wrap border-l-2 border-border pl-3">{item.excerpt}</blockquote></> : <p>{t('answerMissing')}</p>}
      </li>)}</ul>
    </>}
    {reply.scan && <ScanEvidencePanel evidence={reply.scan.evidence} ariaLabel={t('scanReplyLabel', { number })} />}
    <details className="rounded-xl border border-border p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">{t('panelTitle')}</summary>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2">{t('stepsTitle')}</summary>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{t('stepLoad', { week: evidence.week ?? t('unknown'), count: evidence.totalRecorded })}</li>
          <li>{t('stepSelect')}</li><li>{t('stepCompose')}</li>
        </ol>
      </details>
      <p className="my-3">{t('boundedScope')}</p>
      {evidence.truncated && <p>{t('truncated')}</p>}
      <dl className="grid grid-cols-2 gap-2">{(['pulse', 'citations', 'scan', 'live'] as const).map(key => <div key={key} className="contents">
        <dt>{t(`coverage.${key}`)}</dt><dd>{t(`status.${reply.coverage[key]}`)}</dd>
      </div>)}</dl>
      <p className="mt-3">{t('coverageMeaning')}</p>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2">{t('sourcesTitle')}</summary>
        {reply.observations.length === 0 && !reply.scan && <p>{t('noSources')}</p>}
        <ul className="space-y-4">{reply.observations.map((item, index) => <li id={`${id}-source-${index}`} key={item.id} className="space-y-1 border-t border-border pt-3">
          <p>[{index + 1}] {t('observationId')}: {item.id}</p>
          <p>{t('recordedAt')}: {date(item.recordedAt)} · {t('collectedAt')}: {date(item.collectedAt)}</p>
          <p>{t('model')}: {item.model ?? t('unknown')} · {t('market')}: {item.market ?? t('unknown')}</p>
          <p>{t('search')}: {t(item.searchEvidence?.execution === 'confirmed' ? 'searchConfirmed' : 'searchUnknown')}</p>
          {item.links.length ? <ul className="space-y-1">{item.links.map(link => <li key={link.url}>
            {t(link.kind === 'provider-citation' ? 'providerCitation' : 'textLink')}: <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">{link.title || link.url}</a><span className="block text-xs">{link.url}</span>
          </li>)}</ul> : <p>{t('citationsMissing')}</p>}
        </li>)}</ul>
        {reply.scan && <p className="mt-3">{t('scanId')}: {reply.scan.id} · {t('recordedAt')}: {date(reply.scan.recordedAt)}</p>}
      </details>
      <p className="mt-3 text-xs">{t('liveLimit')}</p>
    </details>
  </article>
}
