'use client'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { VersionDetail } from '@/lib/change-sets/types'
import { deliveryHash, deliveryText, deliveryTime } from '@/lib/delivery/input'
import type { AttestInput } from '@/lib/delivery/types'
import { MEASURE_PAGES_MAX, type MeasureOptions } from '@/lib/attribution/types'
import { buildMeasure, toggleAsset, NO_MEASURE, type MeasureChoice } from '@/lib/attribution/measure-choice'
export type DeliveryFields = { destination: string; deliveredAt: string; note: string; measure: MeasureChoice }
export const EMPTY_DELIVERY_FIELDS: DeliveryFields = { destination: '', deliveredAt: '', note: '', measure: NO_MEASURE }
export function DeliveryForm({ clientId, version, values, canAttest, busy, measureOptions, onChange, onSubmit }: {
  clientId: string; version: VersionDetail; values: DeliveryFields; canAttest: boolean; busy: boolean
  /** Null hides the whole "what to measure" field (attribution off, not entitled, or the lookup failed). */
  measureOptions: MeasureOptions | null
  onChange: (value: DeliveryFields) => void; onSubmit: (input: Omit<AttestInput, 'requestId'>) => void
}) {
  const t = useTranslations('delivery'), a = useTranslations('attribution'), lang = useLocale(), id = useId(), focus = useRef<HTMLParagraphElement>(null)
  const [error, setError] = useState<'' | 'invalid' | 'measure'>('')
  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !canAttest) return
    try {
      const time = values.deliveredAt.length === 16 ? values.deliveredAt + ':00' : values.deliveredAt
      const input = { contentHash: deliveryHash(version.contentHash), destination: deliveryText(values.destination, 500, false),
        deliveredAt: deliveryTime(time + 'Z'), note: deliveryText(values.note, 2000, true) }
      const measure = buildMeasure(values.measure, measureOptions)
      if (!measure.ok) { setError('measure'); requestAnimationFrame(() => focus.current?.focus()); return }
      setError(''); onSubmit(measure.measure ? { ...input, measure: measure.measure } : input)
    } catch { setError('invalid'); requestAnimationFrame(() => focus.current?.focus()) }
  }
  const field = 'w-full rounded border border-border bg-background p-3'
  const choice = values.measure
  const setMode = (mode: MeasureChoice['mode']) => onChange({ ...values, measure: { ...choice, mode } })
  const atMax = choice.assetIds.length >= MEASURE_PAGES_MAX
  const noPages = measureOptions !== null && measureOptions.pages.length === 0
  const radio = (mode: MeasureChoice['mode'], label: string, disabled = false) => <label className="flex items-center gap-2">
    <input type="radio" name={id + 'measure'} value={mode} checked={choice.mode === mode} disabled={busy || disabled} onChange={() => setMode(mode)} />
    <span>{label}</span>
  </label>
  return <form onSubmit={submit} className="space-y-3" aria-busy={busy}>
    <h3 className="text-lg font-semibold">{t('record')}</h3>
    <label className="block" htmlFor={id + 'destination'}>{t('destination')}</label>
    <input id={id + 'destination'} className={field} required value={values.destination} readOnly={busy} onChange={e => onChange({ ...values, destination: e.target.value })} />
    <p className="text-sm">{t('destinationHelp')}</p>
    <label className="block" htmlFor={id + 'time'}>{t('timeUtc')}</label>
    <input id={id + 'time'} className={field} type="datetime-local" step="1" required value={values.deliveredAt} readOnly={busy} onChange={e => onChange({ ...values, deliveredAt: e.target.value })} />
    <p className="text-sm">{t('timeHelp')}</p>
    <label className="block" htmlFor={id + 'note'}>{t('note')}</label>
    <textarea id={id + 'note'} className={field} required rows={3} value={values.note} readOnly={busy} onChange={e => onChange({ ...values, note: e.target.value })} />
    {measureOptions && <fieldset className="space-y-2 rounded border border-border p-3">
      <legend className="px-1 font-semibold">{a('measureTitle')}</legend>
      <p className="text-sm">{a('measureHelp')}</p>
      {radio('page', a('measurePages'), noPages)}
      {noPages && <p className="text-sm">{a('noPages')} <a className="underline" href={`/${lang}/dashboard/${encodeURIComponent(clientId)}/assets`}>{a('assetsLink')}</a></p>}
      {choice.mode === 'page' && !noPages && <div className="space-y-2 pl-6">
        <p className="text-sm">{a('pickPages', { max: MEASURE_PAGES_MAX })}</p>
        <ul className="space-y-1">
          {measureOptions.pages.map((page, index) => {
            const checked = choice.assetIds.includes(page.id)
            // Search Console syncs only the oldest registered pages: a newer one is shown, not offered.
            const note = page.synced ? undefined : `${id}page-${index}-not-synced`
            return <li key={page.id}><label className="flex items-start gap-2">
              <input type="checkbox" aria-label={a('pageAria', { label: page.label, url: page.url })} aria-describedby={note} checked={checked}
                disabled={busy || !page.synced || (atMax && !checked)}
                onChange={() => onChange({ ...values, measure: toggleAsset(choice, page.id) })} />
              <span><span className="block">{page.label}</span><span className="block break-all text-sm">{page.url}</span>
                {note && <span id={note} className="block text-sm text-muted-foreground">{a('pageNotSynced')}</span>}</span>
            </label></li>
          })}
        </ul>
        {atMax && <p className="text-sm">{a('maxReached', { max: MEASURE_PAGES_MAX })}</p>}
      </div>}
      {radio('site', a('measureSite'))}
      {radio('none', a('measureNone'))}
    </fieldset>}
    {error && <p role="alert" tabIndex={-1} ref={focus}>{error === 'measure' ? a('measureInvalid') : t('invalid')}</p>}
    <button type="submit" disabled={busy || !canAttest} className="min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50">{t('record')}</button>
  </form>
}
