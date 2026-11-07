'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type Copy = { shared: string; notShared: string; shareLink: string; publish: string; revoke: string; failed: string; stale: string }

/**
 * Publishes the draft on screen (its version id is what the server checks), or
 * stops sharing. The share link comes from the server and is shown only while
 * the report is published.
 */
export function MonthlyReportPublish({ clientId, month, versionId, latestIsPublished, shareUrl, copy, canPublish = true }: {
  clientId: string; month: string; versionId: string; latestIsPublished: boolean; shareUrl: string | null; copy: Copy
  /** False for a month outside the view's lookback: it can still stop sharing, never publish. */
  canPublish?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/clients/${encodeURIComponent(clientId)}/months/${encodeURIComponent(month)}/report`
  async function call(path: string, body?: unknown) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      if (!res.ok) { setError(res.status === 409 ? copy.stale : copy.failed); return }
      router.refresh()
    } catch { setError(copy.failed) } finally { setBusy(false) }
  }
  return (
    <section className="space-y-3 rounded-lg border border-border p-5" aria-label={copy.shareLink}>
      <p className="text-sm font-medium">{shareUrl ? copy.shared : copy.notShared}</p>
      {shareUrl ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{copy.shareLink}</span>
          <input readOnly value={shareUrl} className="block min-h-11 w-full rounded-md border border-border bg-background px-3" onFocus={e => e.currentTarget.select()} />
        </label>
      ) : null}
      {error ? <p role="alert" className="text-sm text-tone-danger-fg">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canPublish && !latestIsPublished ? <Button type="button" className="min-h-11" disabled={busy} aria-busy={busy} onClick={() => void call('publish', { versionId })}>{copy.publish}</Button> : null}
        {shareUrl ? <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void call('revoke')}>{copy.revoke}</Button> : null}
      </div>
    </section>
  )
}
