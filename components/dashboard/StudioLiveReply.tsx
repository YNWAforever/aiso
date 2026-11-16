import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { OpenStudioEvidence } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { safeEvidenceUrl } from '@/lib/pulse/provider-citations'
import { StudioMarkdown } from './StudioMarkdown'

export function StudioLiveReplyView({ reply, pending, error, stream, number = 1, onOpenEvidence, onRefresh, refreshing = false, onStop, onRetry }: {
  reply?: StudioLiveReply
  pending?: boolean
  error?: string
  stream?: Record<string, string>
  number?: number
  onOpenEvidence?: OpenStudioEvidence
  onRefresh?: () => void
  refreshing?: boolean
  /** Only the turn currently streaming owns the stop action. */
  onStop?: () => void
  /** Refill the composer with this turn's question after a failed or stopped answer. */
  onRetry?: () => void
}) {
  const t = useTranslations('conversationStudio.live')
  const evidence = useTranslations('conversationStudio.evidence')
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<string | null>(null)
  const partial = stream && Object.keys(stream).length ? Object.entries(stream) : []

  async function copyAnswer(platform: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(platform)
      setCopyFailed(null)
      window.setTimeout(() => setCopied(current => current === platform ? null : current), 2000)
    } catch {
      setCopyFailed(platform)
      setCopied(null)
    }
  }

  return <section aria-label={t('replyLabel', { number })} className="as-result as-live-result min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="as-result-kicker">{t('title')}</p>
      {onStop && <button type="button" className="as-button px-3" onClick={onStop}>{t('stop')}</button>}
    </div>
    <h3>{t('unverifiedTitle')}</h3>
    <p className="as-note">{t('unverified')}</p>
    {pending && partial.length === 0 && <p role="status">{t('pending')}</p>}
    {partial.length > 0 && <div role="status" aria-live="polite" className="space-y-3">
      <p className="as-note">{t('streaming')}</p>
      {partial.map(([platform, text]) => <div key={platform} className="space-y-1">
        <h4 className="font-semibold">{platform}</h4>
        {text ? <div className="as-answer-body"><StudioMarkdown text={text} /></div> : <p className="as-note">{t('streamingPending')}</p>}
      </div>)}
    </div>}
    {error && <p role={error === 'STUDIO_ANSWER_PENDING' ? 'status' : 'alert'} className={error === 'STUDIO_QUOTA_EXCEEDED' ? 'as-note as-live-exhausted' : 'as-note'}>{t(error === 'STUDIO_QUOTA_EXCEEDED' ? 'exhausted' : error === 'STUDIO_BUDGET_EXCEEDED' ? 'budget' : error === 'INVALID_STUDIO_INPUT' ? 'invalid' : error === 'UPGRADE_REQUIRED' ? 'upgrade' : error === 'STUDIO_ATTACH_UNAVAILABLE' ? 'attachUnavailable' : error === 'STUDIO_ANSWER_PENDING' ? 'pending' : error === 'STUDIO_ANSWER_UNKNOWN' ? 'answerUnknown' : error === 'STUDIO_ANSWER_CONFLICT' ? 'answerConflict' : 'unavailable')}</p>}
    <div className="flex flex-wrap gap-2">
      {onRefresh && (pending || error) && <button type="button" className="as-button px-3" disabled={refreshing} onClick={onRefresh}>{t(refreshing ? 'refreshingReply' : 'refreshReply')}</button>}
      {onRetry && error && <button type="button" className="as-button px-3" onClick={onRetry}>{t('retryPrompt')}</button>}
    </div>
    {reply && <>
      <p className="as-muted as-small">{t('remaining', { count: reply.quota.remaining })}</p>
      {reply.attachment && <p className="as-muted as-small">{reply.attachment.truncated
        ? t('attachTruncated', { label: reply.attachment.label, included: reply.attachment.entriesIncluded, total: reply.attachment.entriesTotal })
        : t('attachIncluded', { label: reply.attachment.label, version: reply.attachment.versionNumber })}</p>}
      <ul className="space-y-3">{reply.answers.map((item, index) => <li key={item.platform} className="as-live-answer space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">{item.platform}</h4>
          <span className={item.coverage === 'present' ? 'as-badge as-badge-blue' : item.coverage === 'missing' ? 'as-badge as-badge-amber' : 'as-badge'}>{t('coverage')}: {t(`status.${item.coverage}`)}</span>
        </div>
        {item.answer ? <div className="as-answer-body"><StudioMarkdown text={item.answer} /></div> : <p className="as-note">{t('missing')}</p>}
        <div className="as-result-actions">
          <button type="button" className="as-button px-3" aria-haspopup="dialog" onClick={event => onOpenEvidence?.(event.currentTarget, `live-${index}`)}>{evidence('open')} · {item.platform}</button>
          {item.answer && <button type="button" className="as-button px-3" onClick={() => void copyAnswer(item.platform, item.answer!)}>{t(copied === item.platform ? 'copied' : 'copy')}</button>}
          {copyFailed === item.platform && <span role="status" className="as-muted as-small">{t('copyFailed')}</span>}
        </div>
      </li>)}</ul>
    </>}
  </section>
}

/** Provider metadata and safe citations, kept separate from saved search performance. */
export function StudioLiveEvidence({ reply, id }: { reply?: StudioLiveReply; id: string }) {
  const t = useTranslations('conversationStudio.live')
  const evidence = useTranslations('conversationStudio.evidence')
  return <section className="space-y-3">
    <h3>{t('unverifiedTitle')}</h3>
    <p className="as-note">{t('unverified')}</p>
    {!reply && <p>{evidence('unknown')}</p>}
    {reply && <ul className="space-y-4">{reply.answers.map((item, index) => <li key={item.platform} id={`${id}-live-${index}`} tabIndex={-1} className="as-divider space-y-1 pt-3">
      <p className="font-semibold">{item.platform}</p>
      <p>{t('coverage')}: {t(`status.${item.coverage}`)}</p>
      {!item.answer && <p className="as-note">{t('missing')}</p>}
        <p>{t('model')}: {item.model}</p>
        <p><time dateTime={item.startedAt}>{item.startedAt}</time> · {t('duration', { ms: item.durationMs })}</p>
        <p>{t('finish')}: {item.finishReason ?? t('unknown')}</p>
        <p>{t('grounding')}: {t(`groundingValues.${item.grounding}`)}</p>
        <p>{t('search')}: {t(item.searchEvidence.execution === 'confirmed' ? 'confirmed' : 'searchUnknown')}</p>
        {item.citations.length ? <ul>{item.citations.map(citation => {
          const url = safeEvidenceUrl(citation.url)
          return url ? <li key={url}><a className="underline" href={url} target="_blank" rel="noopener noreferrer">{citation.title || url}</a></li> : null
        })}</ul> : <p>{t('noCitations')}</p>}
    </li>)}</ul>}
  </section>
}
