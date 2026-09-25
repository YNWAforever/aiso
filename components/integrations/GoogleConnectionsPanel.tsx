'use client'

import { useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { ConnectionSummary } from '@/lib/integrations/search-console/store'
import type { ConsentErrorReason } from '@/lib/integrations/google/consent-reasons'

export function GoogleConnectionsPanel({
  lang, connections: initial, entitled, notice,
}: {
  lang: string
  connections: ConnectionSummary[]
  entitled: boolean
  notice: ConsentErrorReason | null
}) {
  const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
  const [connections, setConnections] = useState(initial)
  const [revokeWarning, setRevokeWarning] = useState(false)

  async function disconnect(id: string) {
    const res = await fetch(`/api/account/integrations/google?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) return
    const body = await res.json() as { googleRevoked: boolean }
    setRevokeWarning(!body.googleRevoked)
    setConnections(list => list.filter(c => c.id !== id))
  }

  return (
    <section id="google" className="scroll-mt-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.connections_title}</h2>
      {!entitled ? (
        <>
          <p className="mt-2 font-semibold text-foreground">{copy.upgrade_title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.upgrade_body}</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{copy.connections_body}</p>
          {notice && <p role="status" className="mt-3 text-sm text-foreground">{copy[`error_${notice}`]}</p>}
          {revokeWarning && <p role="status" className="mt-3 text-sm text-foreground">{copy.google_revoke_failed}</p>}
          <ul className="mt-4 space-y-2">
            {connections.filter(c => c.status !== 'revoked').map(c => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  {copy.connected_as.replace('{email}', c.googleEmail ?? '—')}
                  {c.status === 'needs_reconnect' && <> · {copy.status_needs_reconnect}</>}
                </span>
                <button
                  type="button"
                  onClick={() => void disconnect(c.id)}
                  className="min-h-11 rounded-lg border border-border px-4 text-sm"
                >
                  {copy.disconnect}
                </button>
              </li>
            ))}
          </ul>
          <a
            href={`/api/integrations/google/start?return=/${lang}/dashboard/settings`}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {copy.connect}
          </a>
        </>
      )}
    </section>
  )
}
