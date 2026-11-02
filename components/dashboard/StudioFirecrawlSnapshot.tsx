import { useTranslations } from 'next-intl'
import type { StudioFirecrawlRead } from '@/lib/conversation-studio/firecrawl-types'

const NOTES = new Set(['noUrl', 'urlTooLong', 'urlNotPublic', 'urlUnresolved', 'pageError', 'empty'])

function safeHref(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch { return null }
}

/** Chrome for one turn's public-page scrape. Only the bounded excerpt is shown, never raw HTML. */
export function StudioFirecrawlSnapshotView({ firecrawl }: { firecrawl?: StudioFirecrawlRead }) {
  const t = useTranslations('conversationStudio.firecrawl')
  if (!firecrawl) return null
  if (firecrawl.pending) return <p role="status" className="as-muted as-small">{t('pending')}</p>
  const snapshot = firecrawl.snapshot
  if (!snapshot) return <p role="status" className="as-note">{t('failed')}</p>

  const note = snapshot.messageKey?.startsWith('firecrawl.') ? snapshot.messageKey.slice('firecrawl.'.length) : null
  const href = safeHref(snapshot.url)
  return <section className="as-note space-y-2 [overflow-wrap:anywhere]">
    <p className="as-small font-semibold">{t('title')}</p>
    <p className="as-small">{t(`status.${snapshot.status}`)}</p>
    {note && NOTES.has(note) && <p className="as-muted as-small">{t(`notes.${note}`)}</p>}
    {href && <p className="as-small"><a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{snapshot.title ?? href}</a></p>}
    {snapshot.excerpt && <blockquote className="as-small whitespace-pre-wrap border-l-2 pl-3">{snapshot.excerpt}</blockquote>}
  </section>
}
