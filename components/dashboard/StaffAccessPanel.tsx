'use client'

import { FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { StaffAuditDto, StaffGrantDto } from '@/lib/staff-grants/schema'

export type StaffAccessPanelProps = {
  grants: StaffGrantDto[]
  audit: StaffAuditDto[]
  loadFailed?: boolean
}

const KNOWN = ['INVALID_STAFF_GRANT', 'STAFF_GRANT_BODY_TOO_LARGE', 'STAFF_NOT_ELIGIBLE', 'STAFF_GRANT_EXISTS', 'STAFF_GRANT_NOT_FOUND']
const CONTROL = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
/** ISO days, so server and client render the same text. */
const day = (iso: string) => iso.slice(0, 10)

/**
 * Studio R3 A2a: who at Fimmick may open this account's brands in Studio.
 * Any member grants, renews (another 90 days) or revokes; the audit lists the
 * latest grant changes and staff opens. The list reloads from the server after
 * each change rather than guessing dates locally.
 */
export function StaffAccessPanel({ grants, audit, loadFailed = false }: StaffAccessPanelProps) {
  const t = useTranslations('staffAccess')
  const [rows, setRows] = useState(grants)
  const [log, setLog] = useState(audit)
  const [failed, setFailed] = useState(loadFailed)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const say = (code: unknown) => t(`errors.${typeof code === 'string' && KNOWN.includes(code) ? code : 'STAFF_GRANTS_UNAVAILABLE'}`)

  async function reload() {
    const response = await fetch('/api/account/staff-grants', { cache: 'no-store' })
    if (!response.ok) { setFailed(true); return }
    const body = await response.json()
    setRows(body.grants); setLog(body.audit); setFailed(false)
  }

  async function send(key: string, input: RequestInfo, init: RequestInit) {
    setBusy(key); setError(null)
    try {
      const response = await fetch(input, init)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(say(body?.error)); return false
      }
      await reload()
      return true
    } catch {
      setError(say(null)); return false
    } finally {
      setBusy(null)
    }
  }

  async function grant(event: FormEvent) {
    event.preventDefault()
    const ok = await send('grant', '/api/account/staff-grants', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    })
    if (ok) setEmail('')
  }

  return (
    <section id="staff-access" className="scroll-mt-6 space-y-4" aria-labelledby="staff-access-heading">
      <h2 id="staff-access-heading" className="text-lg font-bold text-foreground">{t('title')}</h2>

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <form onSubmit={grant} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="staff-access-email" className="block text-sm font-medium text-foreground">{t('emailLabel')}</label>
            <input
              id="staff-access-email" type="email" required autoComplete="off" value={email}
              disabled={busy !== null} placeholder={t('emailPlaceholder')}
              onChange={event => setEmail(event.target.value)}
              className={`mt-1 w-full bg-background text-foreground ${CONTROL}`}
            />
          </div>
          <button type="submit" disabled={busy !== null} className={`${CONTROL} bg-primary font-semibold text-primary-foreground disabled:opacity-60`}>
            {busy === 'grant' ? t('granting') : t('grant')}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{error}</p>}

        {failed
          ? <p role="status" className="mt-4 text-sm text-muted-foreground">{t('errors.STAFF_GRANTS_UNAVAILABLE')}</p>
          : rows.length === 0
            ? <p className="mt-4 text-sm text-muted-foreground">{t('none')}</p>
            : (
              <ul className="mt-4 divide-y divide-border">
                {rows.map(row => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    <span className="min-w-0 break-all font-medium text-foreground">{row.grantee.name || row.grantee.email || t('unknown')}</span>
                    <span className="text-sm text-muted-foreground">{t(`status.${row.status}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.status === 'revoked' && row.revokedAt ? `${t('revokedOn')} ${day(row.revokedAt)}` : `${t('expiresOn')} ${day(row.expiresAt)}`}
                    </span>
                    {row.status !== 'revoked' && (
                      <span className="ml-auto flex gap-2">
                        <button type="button" disabled={busy !== null}
                          onClick={() => send(`renew:${row.id}`, `/api/account/staff-grants/${row.id}`, { method: 'PATCH' })}
                          className={`${CONTROL} bg-secondary font-semibold text-foreground disabled:opacity-60`}
                          aria-label={t('renewFor', { name: row.grantee.name || row.grantee.email || '' })}>
                          {busy === `renew:${row.id}` ? t('renewing') : t('renew')}
                        </button>
                        <button type="button" disabled={busy !== null}
                          onClick={() => send(`revoke:${row.id}`, `/api/account/staff-grants/${row.id}`, { method: 'DELETE' })}
                          className={`${CONTROL} bg-secondary font-semibold text-foreground disabled:opacity-60`}
                          aria-label={t('revokeFor', { name: row.grantee.name || row.grantee.email || '' })}>
                          {busy === `revoke:${row.id}` ? t('revoking') : t('revoke')}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </div>

      {!failed && log.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h3 className="text-base font-semibold text-foreground">{t('auditHeading')}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {log.map(entry => (
              <li key={entry.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-xs tabular-nums">{day(entry.at)}</span>
                <span className="text-foreground">{entry.actor ?? t('unknown')}</span>
                <span>{t(`audit.${entry.action}`)}</span>
                {entry.brand && <span className="text-foreground">{entry.brand}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
