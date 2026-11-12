'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy, Plug } from 'lucide-react'

type Minted = { token: string; expiresAt: number; endpoint?: string }

/**
 * "Connect your assistant" (approved SME copilot redesign, slice 3).
 *
 * Mints the existing one-hour MCP bearer token from the member's own session and
 * explains exactly what an external assistant can read: the six read-only tools,
 * re-authorised per call, rate-limited to 30 calls a minute, and audited before
 * every result. The card never claims write access and never renders when the
 * transport is disabled for the brand.
 */
export function StudioConnectAssistant({ clientId }: { clientId: string }) {
  const t = useTranslations('conversationStudio.connectAssistant')
  const [minted, setMinted] = useState<Minted | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function mint() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/mcp-token`, { method: 'POST', cache: 'no-store' })
      const data = await response.json().catch(() => null) as Minted | { error?: string } | null
      if (response.ok && data && 'token' in data && typeof data.token === 'string') {
        setMinted(data as Minted)
      } else {
        const code = data && 'error' in data ? data.error : null
        setError(code === 'STUDIO_MCP_UNCONFIGURED' ? t('unconfigured') : t('failed'))
      }
    } catch {
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Copy is a convenience; the token stays selectable text.
    }
  }

  return <section className="as-card space-y-3" aria-labelledby="studio-connect-assistant-title">
    <h2 id="studio-connect-assistant-title" className="flex items-center gap-2 text-lg font-semibold"><Plug className="as-blue size-5" aria-hidden="true" />{t('title')}</h2>
    <p>{t('body')}</p>
    <p className="as-muted as-small">{t('readOnly')}</p>
    {!minted && <button type="button" onClick={mint} disabled={busy} className="as-button as-primary px-4 font-semibold disabled:opacity-50">
      {busy ? t('minting') : t('mint')}
    </button>}
    {minted && <div className="space-y-2">
      <p className="as-small"><span className="font-semibold">{t('endpoint')}</span> <code>{minted.endpoint ?? '/api/mcp/studio'}</code></p>
      <p className="as-small"><span className="font-semibold">{t('expires')}</span> {new Date(minted.expiresAt).toLocaleTimeString()}</p>
      <code className="block w-full break-all rounded-lg border border-border bg-muted p-3 text-xs">{minted.token}</code>
      <button type="button" onClick={copy} className="as-button inline-flex items-center gap-2 px-3">
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        {copied ? t('copied') : t('copy')}
      </button>
    </div>}
    {error && <p role="alert" className="as-note">{error}</p>}
  </section>
}
