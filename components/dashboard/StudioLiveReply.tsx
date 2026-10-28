import { useTranslations } from 'next-intl'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import { safeEvidenceUrl } from '@/lib/pulse/provider-citations'

export function StudioLiveReplyView({ reply, pending, error, number = 1 }: { reply?: StudioLiveReply; pending?: boolean; error?: string; number?: number }) {
  const t = useTranslations('conversationStudio.live')
  return <section aria-label={t('replyLabel', { number })} className="min-w-0 space-y-3 rounded-xl border border-border p-4 text-sm [overflow-wrap:anywhere]">
    <h3 className="font-semibold">{t('title')}</h3>
    <p>{t('unverified')}</p>
    {pending && <p role="status">{t('pending')}</p>}
    {error && <p role="alert">{t(error === 'STUDIO_QUOTA_EXCEEDED' ? 'exhausted' : error === 'STUDIO_BUDGET_EXCEEDED' ? 'budget' : error === 'INVALID_STUDIO_INPUT' ? 'invalid' : error === 'UPGRADE_REQUIRED' ? 'upgrade' : 'unavailable')}</p>}
    {reply && <>
      <p>{t('remaining', { count: reply.quota.remaining })}</p>
      <ul className="space-y-4">{reply.answers.map(item => <li key={item.platform} className="space-y-2 rounded-lg bg-secondary p-3">
        <h4 className="font-semibold">{item.platform}</h4>
        <p>{t('coverage')}: {t(`status.${item.coverage}`)}</p>
        {item.answer ? <p className="whitespace-pre-wrap">{item.answer}</p> : <p>{t('missing')}</p>}
        <p>{t('model')}: {item.model}</p>
        <p><time dateTime={item.startedAt}>{item.startedAt}</time> · {t('duration', { ms: item.durationMs })}</p>
        <p>{t('finish')}: {item.finishReason ?? t('unknown')}</p>
        <p>{t('grounding')}: {t(`groundingValues.${item.grounding}`)}</p>
        <p>{t('search')}: {t(item.searchEvidence.execution === 'confirmed' ? 'confirmed' : 'searchUnknown')}</p>
        {item.citations.length ? <ul>{item.citations.map(citation => {
          const url = safeEvidenceUrl(citation.url)
          return url ? <li key={url}><a className="underline" href={url} target="_blank" rel="noopener noreferrer">{citation.title || url}</a></li> : null
        })}</ul> : <p>{t('noCitations')}</p>}
      </li>)}</ul>
    </>}
  </section>
}
