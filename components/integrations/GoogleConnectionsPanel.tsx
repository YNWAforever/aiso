'use client'

import { useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { ConnectionSummary } from '@/lib/integrations/search-console/store'
import type { ConsentErrorReason } from '@/lib/integrations/google/consent-reasons'

type Copy = typeof en.searchConsole
const copyFor = (lang: string): Copy => (lang === 'zh-HK' ? zhHK : en).searchConsole

/**
 * The DELETE route (app/api/account/integrations/google/route.ts) returns ad
 * hoc human strings ("Not found", "Lookup failed", "Revoke failed", …) rather
 * than a stable enum, so — unlike bind's structured GOOGLE/INELIGIBLE body —
 * there is nothing safe to key per-reason without echoing server text into
 * the UI. One generic message covers every non-2xx and every thrown network
 * failure.
 */
export function DisconnectErrorNotice({ lang }: { lang: string }) {
  const copy = copyFor(lang)
  return <p role="alert" className="mt-3 text-sm font-medium text-destructive">{copy.disconnect_error}</p>
}

/**
 * One connection row. Pulled out of GoogleConnectionsPanel for the same
 * reason as SearchConsolePanel's PropertySiteRow: the busy/disabled/
 * aria-label logic is otherwise only reachable through a component whose
 * state only ever changes from a live fetch, which renderToStaticMarkup
 * cannot exercise.
 */
export function ConnectionRow({
  connection, onDisconnect, pending, disabled, lang,
}: { connection: ConnectionSummary; onDisconnect: () => void; pending: boolean; disabled: boolean; lang: string }) {
  const copy = copyFor(lang)
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">
        {copy.connected_as.replace('{email}', connection.googleEmail ?? '—')}
        {connection.status === 'needs_reconnect' && <> · {copy.status_needs_reconnect}</>}
      </span>
      <button
        type="button"
        onClick={onDisconnect}
        disabled={disabled}
        aria-label={`${copy.disconnect}: ${connection.googleEmail ?? connection.id}`}
        className="min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-60"
      >
        {pending ? copy.disconnecting : copy.disconnect}
      </button>
    </li>
  )
}

export function GoogleConnectionsPanel({
  lang, connections: initial, entitled, notice,
}: {
  lang: string
  connections: ConnectionSummary[]
  entitled: boolean
  notice: ConsentErrorReason | null
}) {
  const copy = copyFor(lang)
  const [connections, setConnections] = useState(initial)
  const [revokeWarning, setRevokeWarning] = useState(false)
  const [disconnectError, setDisconnectError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function disconnect(id: string) {
    setBusy(id)
    setDisconnectError(false)
    try {
      const res = await fetch(`/api/account/integrations/google?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setDisconnectError(true)
        return
      }
      const body = await res.json() as { googleRevoked: boolean }
      setRevokeWarning(!body.googleRevoked)
      setConnections(list => list.filter(c => c.id !== id))
    } catch {
      setDisconnectError(true)
    } finally {
      setBusy(null)
    }
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
          {disconnectError && <DisconnectErrorNotice lang={lang} />}
          <ul className="mt-4 space-y-2">
            {connections.filter(c => c.status !== 'revoked').map(c => (
              <ConnectionRow
                key={c.id}
                connection={c}
                onDisconnect={() => void disconnect(c.id)}
                pending={busy === c.id}
                disabled={busy !== null}
                lang={lang}
              />
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
