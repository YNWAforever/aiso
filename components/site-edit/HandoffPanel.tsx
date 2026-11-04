'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { VersionDetail } from '@/lib/change-sets/types'

type Handoff = {
  state: 'none' | 'sending' | 'sent' | 'failed' | 'unknown'
  jobId: string | null
  executorRef: string | null
  lastEventAt: string | null
  canSend: boolean
  block: 'not_approved' | 'superseded' | 'no_edit_spec' | 'not_connected' | 'in_flight' | 'already_sent' | null
}
const STATES = ['none', 'sending', 'sent', 'failed', 'unknown']
const BLOCKS = [null, 'not_approved', 'superseded', 'no_edit_spec', 'not_connected', 'in_flight', 'already_sent']
const ERRORS = ['HANDOFF_NOT_APPROVED', 'HANDOFF_SUPERSEDED', 'HANDOFF_NO_EDIT_SPEC', 'HANDOFF_DOMAIN_UNVERIFIED', 'HANDOFF_CONFLICT', 'HANDOFF_IN_FLIGHT', 'HANDOFF_NOT_CONNECTED']

function parse(value: unknown): Handoff {
  const h = (value as { handoff?: Handoff })?.handoff
  if (!h || !STATES.includes(h.state) || !BLOCKS.includes(h.block) || typeof h.canSend !== 'boolean' || h.canSend !== (h.block === null)) throw Error()
  return h
}

/**
 * Site-edit S2: send this approved version's edit spec to the developer who
 * applies it. The state is honest about what AISO knows: "sent" means the
 * developer accepted the job, never that the page changed (that is S3/S4).
 */
export function HandoffPanel({ clientId, version }: { clientId: string; version: VersionDetail }) {
  const t = useTranslations('siteEditHandoff')
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(version.workItemId)}/versions/${encodeURIComponent(version.id)}/handoff`

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) throw Error()
      const next = parse(await res.json())
      if (alive.current) { setHandoff(next); setError(null) }
    } catch { if (alive.current) { setHandoff(null); setError('HANDOFF_UNAVAILABLE') } }
  }, [endpoint])

  useEffect(() => {
    alive.current = true
    const start = setTimeout(() => { void load() }, 0)
    return () => { alive.current = false; clearTimeout(start) }
  }, [load])

  async function send() {
    if (busy || !handoff?.canSend) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentHash: version.contentHash }) })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(ERRORS.includes(body?.error) ? body.error : 'HANDOFF_UNAVAILABLE'); await load(); return }
      if (alive.current) setHandoff(parse(body))
    } catch { if (alive.current) setError('HANDOFF_UNAVAILABLE') }
    finally { if (alive.current) setBusy(false) }
  }

  const resend = handoff?.state === 'failed' || handoff?.state === 'unknown'
  return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="site-edit-handoff-heading" aria-busy={busy || !handoff}>
      <h2 id="site-edit-handoff-heading" className="text-xl font-semibold">{t('title')}</h2>
      {handoff && (
        <p role="status" aria-live="polite">
          {t(`state.${handoff.state}`)}
          {handoff.executorRef && <> · <span className="break-all">{t('reference', { ref: handoff.executorRef })}</span></>}
        </p>
      )}
      {handoff?.block && handoff.block !== 'already_sent' && handoff.block !== 'in_flight' && <p className="text-muted-foreground">{t(`block.${handoff.block}`)}</p>}
      {error && <p role="alert">{t(`errors.${error}`)}</p>}
      {handoff && handoff.state !== 'sent' && (
        <button type="button" onClick={send} disabled={busy || !handoff.canSend}
          className="min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50">
          {busy ? t('sending') : resend ? t('resend') : t('send')}
        </button>
      )}
    </section>
  )
}
