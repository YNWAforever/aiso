'use client'
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FixPackBlock } from '@/components/FixPackBlock'

interface Props {
  scanId: string
  fixCta: string
  fixSubtitle: string
  copyLabel: string
  copiedLabel: string
}
type FixPack = { llms_txt: string; robots_patch: string; faq_schema: string }
function isFixPack(value: unknown): value is FixPack {
  if (!value || typeof value !== 'object') return false
  const pack = value as Record<string, unknown>
  return ['llms_txt', 'robots_patch', 'faq_schema'].every(key => typeof pack[key] === 'string' && pack[key].trim().length > 0)
}

export function FixPackClient({ scanId, fixCta, fixSubtitle, copyLabel, copiedLabel }: Props) {
  const t = useTranslations('generatedWork')
  const [scans, setScans] = useState<Record<string, { loading?: boolean; failed?: boolean; fixPack?: FixPack }>>({})
  const { loading = false, failed = false, fixPack } = scans[scanId] ?? {}
  const pending = useRef(new Set<string>())
  const update = (patch: { loading?: boolean; failed?: boolean; fixPack?: FixPack }) =>
    setScans(current => ({ ...current, [scanId]: { ...current[scanId], ...patch } }))

  async function generate() {
    if (pending.current.has(scanId)) return
    pending.current.add(scanId)
    update({ loading: true, failed: false })
    try {
      const res = await fetch('/api/fix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanId }),
      })
      if (!res.ok) throw new Error('Generation unavailable')
      const data: unknown = await res.json()
      if (!isFixPack(data)) throw new Error('Invalid generated files')
      update({ fixPack: data })
    } catch {
      update({ failed: true })
    } finally {
      pending.current.delete(scanId)
      update({ loading: false })
    }
  }

  if (fixPack) return <div key={scanId} className="space-y-4">
    <p className="text-sm text-dash-text">{t('draftNotice')}</p>
    <p className="text-xs text-dash-muted">{t('storageNotice')}</p>
    <FixPackBlock title="llms.txt" content={fixPack.llms_txt} copyLabel={copyLabel} copiedLabel={copiedLabel} />
    <FixPackBlock title="robots.txt patch" content={fixPack.robots_patch} copyLabel={copyLabel} copiedLabel={copiedLabel} />
    <FixPackBlock title="FAQ JSON-LD" content={fixPack.faq_schema} copyLabel={copyLabel} copiedLabel={copiedLabel} />
  </div>

  return <div className="rounded-xl border border-dash-border bg-dash-surface p-6 text-center" aria-busy={loading}>
    <button type="button" onClick={generate} disabled={loading} className="min-h-11 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-70">
      {loading ? t('generating') : failed ? t('retry') : fixCta}
    </button>
    <p className="mt-2 text-sm text-dash-muted">{fixSubtitle}</p>
    <p className="mt-3 text-sm text-dash-text" role="status">{failed ? t('generationFailed') : loading ? t('generating') : ''}</p>
  </div>
}
