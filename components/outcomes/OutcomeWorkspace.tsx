'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import type { OutcomeResponse } from '@/lib/outcomes/types'
import { OutcomeWindows } from './OutcomeWindows'
type ReadState = { key: string; value: OutcomeResponse | null; error: string; loading: boolean }
export function OutcomeWorkspace({ clientId, itemId, versionId, refreshKey }: { clientId: string; itemId: string; versionId: string; refreshKey: number }) {
  const t = useTranslations('outcomes')
  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<ReadState | null>(null)
  const generation = useRef(0)
  const key = JSON.stringify([clientId, itemId, versionId, refreshKey, retry])
  // Hide old scope/anchor results during render, before effect cleanup.
  const current = read?.key === key ? read : null
  const loading = !current || current.loading
  useEffect(() => {
    const controller = new AbortController()
    const requests = generation
    const token = ++requests.current
    const active = () => !controller.signal.aborted && token === requests.current
    async function load() {
      if (!active()) return
      setRead({ key, value: null, error: '', loading: true })
      try {
        const response = await fetch('/api/clients/' + encodeURIComponent(clientId) + '/work-items/' + encodeURIComponent(itemId) + '/versions/' + encodeURIComponent(versionId) + '/outcomes', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw Error(response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'denied' : 'unavailable')
        const value = parseOutcomeResponse(await response.json())
        if (value.clientId !== clientId || value.itemId !== itemId || value.versionId !== versionId) throw Error('unavailable')
        if (active()) setRead({ key, value, error: '', loading: false })
      } catch (error) {
        if (active()) setRead({ key, value: null, error: error instanceof Error && ['unauthenticated', 'denied'].includes(error.message) ? error.message : 'unavailable', loading: false })
      }
    }
    const start = setTimeout(() => { void load() }, 0)
    return () => { clearTimeout(start); controller.abort(); requests.current++ }
  }, [clientId, itemId, versionId, refreshKey, retry, key])
  return <section className="min-w-0 space-y-4 rounded-xl border border-border p-4 break-words" aria-label={t('title')} aria-busy={loading}>
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <p>{t('limitation')}</p>
    <button type="button" className="min-h-11 rounded border border-border px-4 py-2 font-semibold" onClick={() => setRetry(value => value + 1)}>{current?.error ? t('retry') : t('refresh')}</button>
    <p aria-live="polite" aria-atomic="true">{loading ? t('loading') : current?.error ? '' : t('loaded')}</p>
    {current?.error && <p role="alert">{t(current.error)}</p>}
    {current?.value && <OutcomeWindows value={current.value} />}
  </section>
}
