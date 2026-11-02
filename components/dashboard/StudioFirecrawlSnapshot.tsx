import { useTranslations } from 'next-intl'
import type { StudioFirecrawlRead } from '@/lib/conversation-studio/firecrawl-types'

/** Chrome for one turn's single public-page scrape; never a site crawl. */
export function StudioFirecrawlSnapshotView({ firecrawl }: { firecrawl?: StudioFirecrawlRead }) {
  const t = useTranslations('conversationStudio.firecrawl')
  if (!firecrawl) return null
  if (firecrawl.pending) return <p role="status" className="as-muted as-small">{t('pending')}</p>
  const snapshot = firecrawl.snapshot
  if (!snapshot) return <p role="status" className="as-note">{t('failed')}</p>

  const reasonKey = snapshot.messageKey?.startsWith('firecrawl.')
    ? snapshot.messageKey.slice('firecrawl.'.length)
    : null
  const description = reasonKey ? t(reasonKey) : t(`status.${snapshot.status}`)

  return <section className="as-note space-y-2">
    <p className="as-small font-semibold">{t('title')}</p>
    <p className="as-small">{description}</p>
    {snapshot.status === 'empty' && <p className="as-muted as-small">{t('empty')}</p>}
    {snapshot.url && <p className="as-muted as-small [overflow-wrap:anywhere]">{t('url')}: <a href={snapshot.url} target="_blank" rel="noopener noreferrer" className="underline">{snapshot.url}</a></p>}
    {snapshot.title && <p className="as-small">{snapshot.title}</p>}
    {snapshot.contentType && <p className="as-muted as-small">{t('contentType', { contentType: snapshot.contentType })}</p>}
    {snapshot.excerpt && <blockquote className="as-muted as-small whitespace-pre-wrap [overflow-wrap:anywhere]">{snapshot.excerpt}</blockquote>}
  </section>
}
