'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/** Records the month's due snapshots (idempotent on the server), then re-reads the page. */
export function RecordSnapshotsButton({ clientId, month, label, failed }: { clientId: string; month: string; label: string; failed: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function record() {
    setBusy(true); setError(false)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/months/${encodeURIComponent(month)}`, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      router.refresh()
    } catch { setError(true) } finally { setBusy(false) }
  }
  return (
    <div className="flex items-center gap-3">
      {error ? <p role="alert" className="text-sm text-tone-danger-fg">{failed}</p> : null}
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} aria-busy={busy} onClick={record}>{label}</Button>
    </div>
  )
}
