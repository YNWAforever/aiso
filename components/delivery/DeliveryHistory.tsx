'use client'
import { useTranslations } from 'next-intl'
import type { DeliveryEvent } from '@/lib/delivery/types'
export function DeliveryHistory({ events, activeAttestationId, nextCursor, busy, canWithdraw, onMore, onWithdraw }: {
  events: DeliveryEvent[]; activeAttestationId: string | null; nextCursor: string | null; busy: boolean; canWithdraw: boolean
  onMore: () => void; onWithdraw: (id: string) => void
}) {
  const t = useTranslations('delivery')
  const button = 'min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50'
  return <section className="space-y-3" aria-label={t('history')}>
    <h3 className="text-lg font-semibold">{t('history')}</h3>
    <p>{activeAttestationId ? t('active') : t('noActive')}</p>
    {activeAttestationId && <button type="button" className={button} disabled={busy || !canWithdraw} onClick={() => onWithdraw(activeAttestationId)}>{t('withdraw')}</button>}
    {events.length === 0 && !activeAttestationId && !nextCursor && <p>{t('empty')}</p>}
    <ol className="space-y-3">{events.map(event => <li key={event.eventId} className="space-y-2 rounded border border-border p-3 break-words">
      <h4 className="font-semibold">{t(event.kind === 'attest' ? 'attested' : 'withdrawn')}</h4>
      <p>{event.actor.displayName ?? t('unknownActor')}</p>
      <dl className="space-y-1">
        <dt className="font-semibold">{t('recordedTime')}</dt><dd><time dateTime={event.recordedAt}>{event.recordedAt}</time></dd>
        {event.kind === 'attest' ? <>
          <dt className="font-semibold">{t('declaredTime')}</dt><dd><time dateTime={event.deliveredAt}>{event.deliveredAt}</time></dd>
          <dt className="font-semibold">{t('destination')}</dt><dd className="whitespace-pre-wrap">{event.destination}</dd>
          <dt className="font-semibold">{t('note')}</dt><dd className="whitespace-pre-wrap">{event.note}</dd>
        </> : <><dt className="font-semibold">{t('withdrawReason')}</dt><dd className="whitespace-pre-wrap">{event.reason}</dd><dt>{t('target')}</dt><dd>{event.targetAttestationId}</dd></>}
      </dl>
    </li>)}</ol>
    {nextCursor && <button type="button" disabled={busy} onClick={onMore} className={button}>{t('more')}</button>}
  </section>
}
