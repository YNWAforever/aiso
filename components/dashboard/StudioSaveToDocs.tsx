'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

const MY_DRIVE = 'https://drive.google.com/drive/my-drive'

export type SaveState =
  | { kind: 'idle' | 'saving' | 'notConnected' | 'reconnect' | 'quota' | 'failed' }
  | { kind: 'saved'; link: string | null }
  | { kind: 'unknown' }
  | { kind: 'ledgerFailed'; link: string | null }

function safeDocLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'docs.google.com' || url.hostname === 'drive.google.com') ? url.href : null
  } catch { return null }
}

/** Maps the export route's answer to what the member sees. Pure, so every branch is unit-tested. */
export function saveStateFor(status: number, data: { link?: unknown; error?: string } | null): SaveState {
  if (status === 201) return { kind: 'saved', link: safeDocLink(data?.link) }
  if (status === 202) return { kind: 'unknown' }
  if (data?.error === 'DRIVE_NOT_CONNECTED') return { kind: 'notConnected' }
  if (data?.error === 'DRIVE_RECONNECT') return { kind: 'reconnect' }
  if (data?.error === 'DRIVE_QUOTA') return { kind: 'quota' }
  if (data?.error === 'DRIVE_LEDGER_FAILED') return { kind: 'ledgerFailed', link: safeDocLink(data?.link) }
  return { kind: 'failed' }
}

/**
 * One click, one request, no automatic retry: a lost response is shown as
 * "may have been created" so the member checks Drive before trying again.
 */
export function StudioSaveToDocs({ clientId, threadId, position, initial = { kind: 'idle' } }: { clientId: string; threadId: string; position: number; initial?: SaveState }) {
  const t = useTranslations('conversationStudio.drive')
  const locale = useLocale()
  const [state, setState] = useState<SaveState>(initial)

  async function save() {
    if (state.kind === 'saving') return
    setState({ kind: 'saving' })
    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/exports/google-docs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ threadId, position, locale: locale === 'zh-HK' ? 'zh-HK' : 'en' }),
      })
      const data = await response.json().catch(() => null) as { link?: unknown; error?: string } | null
      setState(saveStateFor(response.status, data))
    } catch {
      // The request may have reached Google before the connection dropped.
      setState({ kind: 'unknown' })
    }
  }

  const connections = `/${locale}/dashboard/${clientId}/studio/connections`
  const docLink = (link: string | null) => <a href={link ?? MY_DRIVE} target="_blank" rel="noopener noreferrer" className="underline">{t(link ? 'open' : 'openDrive')}</a>

  return <div className="as-save-docs space-y-2">
    {state.kind === 'saved'
      ? <p role="status" className="as-small">{t('saved')} · {docLink(state.link)}</p>
      : <button type="button" className="as-button px-3" disabled={state.kind === 'saving'} onClick={save}>{t(state.kind === 'saving' ? 'saving' : 'save')}</button>}
    {state.kind === 'unknown' && <p role="status" className="as-note">{t('unknown')} {docLink(null)}</p>}
    {state.kind === 'ledgerFailed' && <p role="alert" className="as-note">{t('ledgerFailed')} {docLink(state.link)}</p>}
    {(state.kind === 'notConnected' || state.kind === 'reconnect') && <p role="alert" className="as-note">
      {t(state.kind === 'reconnect' ? 'reconnect' : 'notConnected')} <Link href={connections} className="underline">{t('goToConnections')}</Link>
    </p>}
    {state.kind === 'quota' && <p role="alert" className="as-note">{t('quota')}</p>}
    {state.kind === 'failed' && <p role="alert" className="as-note">{t('failed')}</p>}
  </div>
}
