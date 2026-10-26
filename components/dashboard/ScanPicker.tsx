import { useTranslations } from 'next-intl'
import type { ScanChoice } from '@/lib/workspace/scan-choices'

/** A native GET form keeps selection bookmarkable and works before hydration. */
export function ScanPicker({ lang, action, step, scans, selectedScanId }: {
  lang: string
  action: string
  step?: 'results' | 'improve'
  scans: ScanChoice[]
  selectedScanId?: string | null
}) {
  const t = useTranslations('dashboard')
  const selected = scans.some(scan => scan.id === selectedScanId) ? selectedScanId! : ''
  return (
    <form action={action} method="get" className="mb-5 flex min-w-0 flex-wrap items-end gap-3">
      {step && <input type="hidden" name="step" value={step} />}
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor="workspace-scan-picker" className="mb-2 block text-sm font-medium">{t('choose_saved_scan')}</label>
        <select id="workspace-scan-picker" name="scanId" defaultValue={selected} required disabled={!scans.length}
          className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="" disabled>{t(scans.length ? 'select_saved_scan' : 'no_completed_scans')}</option>
          {scans.map(scan => <option key={scan.id} value={scan.id}>
            {new Date(scan.created_at).toLocaleString(lang, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })} · {scan.domain} · {scan.score}{scan.grade ? ` (${scan.grade})` : ''}
          </option>)}
        </select>
      </div>
      <button type="submit" disabled={!scans.length} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('open_selected_scan')}</button>
    </form>
  )
}
