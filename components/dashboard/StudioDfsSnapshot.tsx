import { useTranslations } from 'next-intl'
import type { StudioDfsRead } from '@/lib/conversation-studio/dfs-types'

/** Chrome for one turn's in-plan Google organic search read; never a Mentions score. */
export function StudioDfsSnapshotView({ dfs }: { dfs?: StudioDfsRead }) {
  const t = useTranslations('conversationStudio.dfs')
  const honesty = useTranslations('conversationStudio.honesty')
  if (!dfs) return null
  if (dfs.pending) return <p role="status" className="as-muted as-small">{t('pending')}</p>
  const snapshot = dfs.snapshot
  if (!snapshot) return <p role="status" className="as-note">{t('failed')}</p>

  const week = snapshot.week
  return <section className="as-note space-y-2">
    <p className="as-small font-semibold">{t('title')}</p>
    <p className="as-muted as-small">
      {/* Vendor location/language codes stay server-side (post–Stage 6 vendor opacity). */}
      {t('market')}{' · '}<span className="as-badge as-badge-amber">{honesty('pending')}</span>
    </p>
    <p className="as-small">{t(`status.${snapshot.status}`)}</p>
    {week && week.remaining !== undefined && <p className="as-muted as-small">{t('weeklyCap', { remaining: week.remaining, cap: week.cap })}</p>}
    {snapshot.status === 'capped' && <p className="as-note">{t('capped')}</p>}
    {snapshot.status === 'empty' && <p className="as-muted as-small">{t('empty')}</p>}
    {snapshot.keyword && <p className="as-muted as-small">{t('keyword')}: {snapshot.keyword}</p>}
    {snapshot.items?.length ? <details>
      <summary>{t('items')}</summary>
      <ol className="space-y-1 pb-3">{snapshot.items.map(item => <li key={`${item.rank}-${item.url}`}>
        {t('rank')} {item.rank} · <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{item.title}</a>
        {item.domain ? <span className="as-small as-muted block">{item.domain}</span> : null}
      </li>)}</ol>
    </details> : null}
  </section>
}
