'use client'

import { FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AccountInvitation, AccountMember } from '@/lib/members/store'

export type MembersPanelProps = {
  self: string
  limit: number
  members: AccountMember[]
  invitations: AccountInvitation[]
}

/**
 * Invitations that can still be withdrawn: nothing has been decided about
 * them. `unclaimable` is included because the row is live in the database even
 * though nobody can ever consume it — withdrawing is exactly what a member
 * should do with one, and it frees the slot.
 */
const WITHDRAWABLE = new Set(['pending', 'unclaimable', 'expired'])

/**
 * Dates as plain ISO days. Formatting them per locale would make the server
 * and the client disagree, and a hydration mismatch is not worth a nicer date.
 */
const day = (iso: string) => iso.slice(0, 10)

const CONTROL =
  'min-h-11 rounded-lg border border-border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2'

export function MembersPanel({ self, limit, members, invitations }: MembersPanelProps) {
  const t = useTranslations('members')
  const locale = useLocale()
  const [rows, setRows] = useState(invitations)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Counted the way the server counts it (lib/members/store.ts): members plus
  // invitations that are still live. An expired one occupies no slot, because
  // creating a replacement supersedes it.
  const live = rows.filter(row => row.status === 'pending' || row.status === 'unclaimable').length
  const atCap = members.length + live >= limit

  /**
   * Server error codes are the only thing this surface trusts for wording. An
   * unrecognised one falls back to the unavailable message rather than
   * printing a raw code at somebody.
   */
  function say(code: unknown) {
    const known = [
      'INVALID_INVITATION_INPUT', 'MEMBER_ALREADY_IN_ACCOUNT', 'INVITATION_ALREADY_PENDING',
      'EMAIL_ALREADY_REGISTERED', 'MEMBER_LIMIT_REACHED', 'INVITATION_DENIED',
      'INVITATION_RATE_LIMITED', 'INVITATION_NOT_FOUND', 'INVITATION_BODY_TOO_LARGE',
    ]
    const key = typeof code === 'string' && known.includes(code) ? code : 'MEMBERS_UNAVAILABLE'
    return t(`errors.${key}`)
  }

  async function invite(event: FormEvent) {
    event.preventDefault()
    setBusy('invite'); setError(null); setNotice(null)
    try {
      const response = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) { setError(say(body?.error)); return }
      setRows(current => [body.invitation, ...current])
      setEmail('')
      // The invitation stands whether or not the mail went out, so say which
      // happened rather than implying somebody was told.
      setNotice(body.emailed ? t('created') : t('emailNotSent'))
    } catch {
      setError(t('errors.MEMBERS_UNAVAILABLE'))
    } finally {
      setBusy(null)
    }
  }

  async function withdraw(id: string) {
    setBusy(id); setError(null); setNotice(null)
    try {
      const response = await fetch(`/api/account/invitations/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(say(body?.error)); return
      }
      setRows(current => current.map(row => (row.id === id ? { ...row, status: 'revoked' } : row)))
    } catch {
      setError(t('errors.MEMBERS_UNAVAILABLE'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="members" className="scroll-mt-6 space-y-6" aria-labelledby="members-heading">
      <div>
        <h2 id="members-heading" className="text-lg font-bold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h3 className="text-base font-semibold text-foreground">{t('membersHeading')}</h3>
        <ul className="mt-3 divide-y divide-border">
          {members.map(person => (
            <li key={person.profileId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span className="font-medium text-foreground">
                {person.displayName ?? person.profileId}
              </span>
              {person.profileId === self && (
                <span className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
                  {t('you')}
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {person.approver ? t('approver') : t('notApprover')}
              </span>
            </li>
          ))}
        </ul>
        {/* Membership is not permission to approve. Saying so here is what
            keeps this panel honest: an account can have two members and still
            be unable to approve anything. */}
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          {t('approverNote')}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h3 className="text-base font-semibold text-foreground">{t('invitationsHeading')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('howItWorks')}</p>

        <form onSubmit={invite} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="members-invite-email" className="block text-sm font-medium text-foreground">
              {t('emailLabel')}
            </label>
            <input
              id="members-invite-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={atCap || busy !== null}
              placeholder={t('emailPlaceholder')}
              onChange={event => setEmail(event.target.value)}
              className={`mt-1 w-full bg-background text-foreground ${CONTROL}`}
            />
          </div>
          <button
            type="submit"
            disabled={atCap || busy !== null}
            className={`${CONTROL} bg-primary font-semibold text-primary-foreground disabled:opacity-60`}
          >
            {busy === 'invite' ? t('inviting') : t('invite')}
          </button>
        </form>
        {atCap && <p className="mt-2 text-sm text-muted-foreground">{t('capReached')}</p>}
        {error && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{error}</p>}
        {notice && <p role="status" className="mt-2 text-sm text-foreground">{notice}</p>}

        {rows.length === 0
          ? <p className="mt-4 text-sm text-muted-foreground">{t('noInvitations')}</p>
          : (
            <ul className="mt-4 divide-y divide-border">
              {rows.map(row => (
                <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span className="min-w-0 break-all font-medium text-foreground">{row.email}</span>
                  <span className="text-sm text-muted-foreground">{t(`status.${row.status}`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('invitedOn')} {day(row.invitedAt)} · {t('expiresOn')} {day(row.expiresAt)}
                  </span>
                  {row.status === 'unclaimable' && (
                    <p className="w-full text-sm text-muted-foreground">{t('unclaimableHelp')}</p>
                  )}
                  {WITHDRAWABLE.has(row.status) && (
                    <button
                      type="button"
                      onClick={() => withdraw(row.id)}
                      disabled={busy !== null}
                      className={`${CONTROL} ml-auto bg-secondary font-semibold text-foreground disabled:opacity-60`}
                    >
                      {busy === row.id ? t('revoking') : t('revoke')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  )
}
