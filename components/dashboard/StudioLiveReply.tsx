import { useTranslations } from 'next-intl'
import type { OpenStudioEvidence } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { safeEvidenceUrl } from '@/lib/pulse/provider-citations'

export function StudioLiveReplyView({ reply, pending, error, number = 1, onOpenEvidence }: { reply?: StudioLiveReply; pending?: boolean; error?: string; number?: number; onOpenEvidence?: OpenStudioEvidence }) {
  const t = useTranslations('conversationStudio.live')
  const evidence = useTranslations('conversationStudio.evidence')
  return <section aria-label={t('replyLabel', { number })} className="as-result as-live-result min-w-0 space-y-3 [overflow-wrap:anywhere]">
    <p className="as-result-kicker">{t('title')}</p>
    <h3>{t('unverifiedTitle')}</h3>
    <p className="as-note">{t('unverified')}</p>
    {pending && <p role="status">{t('pending')}</p>}
    {error && <p role="alert" className="as-note">{t(error === 'STUDIO_QUOTA_EXCEEDED' ? 'exhausted' : error === 'STUDIO_BUDGET_EXCEEDED' ? 'budget' : error === 'INVALID_STUDIO_INPUT' ? 'invalid' : error === 'UPGRADE_REQUIRED' ? 'upgrade' : 'unavailable')}</p>}
    {reply && <>
      <p className="as-muted as-small">{t('remaining', { count: reply.quota.remaining })}</p>
      <ul className="space-y-4">{reply.answers.map((item, index) => <li key={item.platform} className="as-result space-y-2">
        <h4 className="font-semibold">{item.platform}</h4>
        <p className={item.coverage === 'present' ? 'as-badge as-badge-blue' : item.coverage === 'missing' ? 'as-badge as-badge-amber' : 'as-badge'}>{t('coverage')}: {t(`status.${item.coverage}`)}</p>
        {item.answer ? <p className="whitespace-pre-wrap">{item.answer}</p> : <p className="as-note">{t('missing')}</p>}
        <button type="button" className="as-button px-3" aria-haspopup="dialog" onClick={event => onOpenEvidence?.(event.currentTarget, `live-${index}`)}>{evidence('open')} · {item.platform}</button>
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
