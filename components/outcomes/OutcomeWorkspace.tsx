'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { VersionDetail } from '@/lib/change-sets/types'
import { parseSelectedOutcome, selectedOutcomeExpectation, selectedOutcomeReadKey, type SelectedOutcomeExpectation, type SelectedOutcomeResponse } from '@/lib/outcomes/client-context'
import { OutcomeReadError, OutcomeWindows } from './OutcomeWindows'
import { MultiSourceOutcomeWindows } from '@/components/outcomes/MultiSourceOutcomeWindows'
type ReadState = { key: string; value: SelectedOutcomeResponse | null; error: string; loading: boolean }
export function OutcomeWorkspace({ clientId, itemId, version, viewerKey, refreshKey, smeCopilot = false }: {
  clientId: string; itemId: string; version: VersionDetail; viewerKey: string; refreshKey: number; smeCopilot?: boolean
}) {
  const t = useTranslations('outcomes')
  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<ReadState | null>(null)
  const generation = useRef(0)
  let expectationJson = '', key = JSON.stringify(['invalid-outcome-context', clientId, itemId, version.id, version.contentHash, version.schemaVersion, viewerKey, refreshKey, retry])
  try {
    const expected = selectedOutcomeExpectation(clientId, itemId, version)
    key = selectedOutcomeReadKey(expected, viewerKey, refreshKey, retry)
    expectationJson = JSON.stringify(expected)
  } catch { /* An invalid selected context cannot start a read or retain another context's data. */ }
  // Hide old hash/schema/source/viewer/anchor results during render, before effect cleanup.
  const current: ReadState | null = expectationJson ? read?.key === key ? read : null
    : { key, value: null, error: 'unavailable', loading: false }
  const loading = !current || current.loading
  useEffect(() => {
    const controller = new AbortController()
    const requests = generation
    const token = ++requests.current
    const active = () => !controller.signal.aborted && token === requests.current
    // Serialized selected-side values avoid refetching when only an unrelated decision object changes.
    const expected: SelectedOutcomeExpectation | null = expectationJson ? JSON.parse(expectationJson) : null
    async function load() {
      if (!active() || !expected) return
      setRead({ key, value: null, error: '', loading: true })
      try {
        const scope = expected.context
        const response = await fetch('/api/clients/' + encodeURIComponent(scope.clientId) + '/work-items/' + encodeURIComponent(scope.itemId) + '/versions/' + encodeURIComponent(scope.versionId) + '/outcomes', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw Error(response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'denied' : 'unavailable')
        const raw = await response.json()
        if (!active()) return
        const value = parseSelectedOutcome(raw, expected)
        if (active()) setRead({ key, value, error: '', loading: false })
      } catch (error) {
        if (active()) setRead({ key, value: null, error: error instanceof Error && ['unauthenticated', 'denied'].includes(error.message) ? error.message : 'unavailable', loading: false })
      }
    }
    const start = expected ? setTimeout(() => { void load() }, 0) : undefined
    return () => { clearTimeout(start); controller.abort(); requests.current++ }
  }, [expectationJson, key])
  return <section className="min-w-0 space-y-4 rounded-xl border border-border p-4 break-words" aria-label={t('title')} aria-busy={loading}>
    <h2 className="text-xl font-semibold">{t('title')}</h2>
    <p>{t('limitation')}</p>
    <button type="button" className={smeCopilot ? 'min-h-11 max-w-full whitespace-normal rounded border border-border px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' : 'min-h-11 rounded border border-border px-4 py-2 font-semibold'} onClick={() => setRetry(value => value + 1)}>{current?.error ? t('retry') : t('refresh')}</button>
    <p aria-live="polite" aria-atomic="true">{loading ? t('loading') : current?.error ? '' : t('loaded')}</p>
    {current?.error && <OutcomeReadError error={current.error} smeCopilot={smeCopilot} versionSchema={version.schemaVersion} />}
    {current?.value && (current.value.schemaVersion === 2
      ? <MultiSourceOutcomeWindows value={current.value} snapshots={version.schemaVersion === 2 ? version.evidenceSnapshots : [version.evidenceSnapshot]} smeCopilot={smeCopilot} />
      : <OutcomeWindows value={current.value} smeCopilot={smeCopilot} />)}
  </section>
}
