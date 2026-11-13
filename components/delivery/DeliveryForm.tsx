'use client'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { VersionDetail } from '@/lib/change-sets/types'
import { deliveryHash, deliveryText, deliveryTime } from '@/lib/delivery/input'
import type { AttestInput } from '@/lib/delivery/types'
export type DeliveryFields = { destination: string; deliveredAt: string; note: string }
export function DeliveryForm({ version, values, canAttest, busy, onChange, onSubmit, smeCopilot = false, emphasize = true }: {
  version: VersionDetail; values: DeliveryFields; canAttest: boolean; busy: boolean; smeCopilot?: boolean; emphasize?: boolean
  onChange: (value: DeliveryFields) => void; onSubmit: (input: Omit<AttestInput, 'requestId'>) => void
}) {
  const t = useTranslations('delivery'), id = useId(), focus = useRef<HTMLParagraphElement>(null)
  const [error, setError] = useState(false)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !canAttest) return
    try {
      const time = values.deliveredAt.length === 16 ? values.deliveredAt + ':00' : values.deliveredAt
      const input = { contentHash: deliveryHash(version.contentHash), destination: deliveryText(values.destination, 500, false),
        deliveredAt: deliveryTime(time + 'Z'), note: deliveryText(values.note, 2000, true) }
      setError(false); onSubmit(input)
    } catch { setError(true); requestAnimationFrame(() => focus.current?.focus()) }
  }
  const field = 'w-full rounded border border-border bg-background p-3' + (smeCopilot ? ' min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' : '')
  return <form onSubmit={submit} className={smeCopilot ? 'space-y-3 rounded-lg border border-border p-4' : 'space-y-3'} aria-busy={busy}>
    <h3 className="text-lg font-semibold">{t('record')}</h3>
    {smeCopilot && <p className="text-sm text-neutral-11">{t('sme.manualLimitation')}</p>}
    <label className="block" htmlFor={id + 'destination'}>{t('destination')}</label>
    <input id={id + 'destination'} className={field} required value={values.destination} readOnly={busy} aria-describedby={smeCopilot ? id + 'destinationHelp' : undefined} onChange={e => onChange({ ...values, destination: e.target.value })} />
    <p id={smeCopilot ? id + 'destinationHelp' : undefined} className="text-sm">{t('destinationHelp')}</p>
    <label className="block" htmlFor={id + 'time'}>{t('timeUtc')}</label>
    <input id={id + 'time'} className={field} type="datetime-local" step="1" required value={values.deliveredAt} readOnly={busy} aria-describedby={smeCopilot ? id + 'timeHelp' : undefined} onChange={e => onChange({ ...values, deliveredAt: e.target.value })} />
    <p id={smeCopilot ? id + 'timeHelp' : undefined} className="text-sm">{t(smeCopilot ? 'sme.timeHelp' : 'timeHelp')}</p>
    <label className="block" htmlFor={id + 'note'}>{t('note')}</label>
    <textarea id={id + 'note'} className={field} required rows={3} value={values.note} readOnly={busy} onChange={e => onChange({ ...values, note: e.target.value })} />
    {error && <p role="alert" tabIndex={-1} ref={focus}>{t('invalid')}</p>}
    <button type="submit" disabled={busy || !canAttest} className={'min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50' + (smeCopilot ? (emphasize ? ' bg-primary text-primary-foreground' : '') + ' focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' : '')}>{t('record')}</button>
  </form>
}
