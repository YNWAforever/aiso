import { useTranslations } from 'next-intl'
import type { StudioGscRead } from '@/lib/conversation-studio/gsc-types'

/** Chrome for one turn's Hong Kong Search Console read; never property-wide Neon totals. */
export function StudioGscSnapshotView({ gsc }: { gsc?: StudioGscRead }) {
  const t = useTranslations('conversationStudio.gsc')
  if (!gsc) return null
  if (gsc.pending) return <p role="status" className="as-muted as-small">{t('pending')}</p>
  const snapshot = gsc.snapshot
  if (!snapshot) return <p role="status" className="as-note">{t('failed')}</p>

  const window = snapshot.window
  const neverQueried = snapshot.status === 'unbound' || snapshot.status === 'reconnect'
    || snapshot.status === 'rebind' || snapshot.status === 'unentitled' || snapshot.status === 'disabled'
  return <section className="as-note space-y-2">
    <p className="as-small font-semibold">{t('title')}</p>
    <p className="as-muted as-small">{t('country')} · {t('timeZone')}{window ? ` · ${t('period', window)}` : ''}</p>
    <p className="as-small">{t(`status.${snapshot.status}`)}{window && snapshot.completeness !== 'unknown' ? ` · ${t('complete', { date: window.endDate })}` : ''}</p>
    {neverQueried && <p className="as-muted as-small">{t('notRun')}</p>}
    {snapshot.status === 'empty' && <p className="as-muted as-small">{t('empty')}</p>}
    {snapshot.totals && <div className="flex flex-wrap gap-2">
      <span className="as-badge">{t('clicks')}: {snapshot.totals.clicks}</span>
      <span className="as-badge">{t('impressions')}: {snapshot.totals.impressions}</span>
      {snapshot.totals.ctr !== undefined && <span className="as-badge">{t('ctr')}: {(snapshot.totals.ctr * 100).toFixed(2)}%</span>}
      {snapshot.totals.position !== undefined && <span className="as-badge">{t('position')}: {snapshot.totals.position.toFixed(1)}</span>}
    </div>}
    {snapshot.topQueries?.length ? <details>
      <summary>{t('topQueries')}</summary>
      <ul className="space-y-1 pb-3">{snapshot.topQueries.map(row => <li key={row.query}>{row.query} · {t('clicks')} {row.clicks} · {t('impressions')} {row.impressions}</li>)}</ul>
    </details> : null}
  </section>
}
