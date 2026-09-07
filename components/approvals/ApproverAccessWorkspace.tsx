'use client'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type {
  AccessPageDTO,
  AccessEventDTO,
} from '@/lib/approvals/access-store'
export function ApproverAccessWorkspace({
  accountId,
  initial,
  verified,
}: {
  accountId: string
  initial: AccessPageDTO | null
  verified: boolean
}) {
  const t = useTranslations('approverAccess'),
    id = useId(),
    [page, setPage] = useState(initial),
    [authority, setAuthority] = useState(verified),
    [hasVerifiedAccess, setHasVerifiedAccess] = useState(verified),
    [profileId, setProfileId] = useState(initial?.members[0]?.profileId ?? ''),
    [action, setAction] = useState<'grant' | 'revoke'>('grant'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initial ? '' : 'unavailable'),
    [status, setStatus] = useState('')
  const cursors = useRef({
      memberCursor: null as string | null,
      eventCursor: null as string | null,
    }),
    request = useRef<{ payload: string; requestId: string } | null>(null),
    lock = useRef(false),
    reasonRef = useRef<HTMLTextAreaElement>(null),
    statusRef = useRef<HTMLParagraphElement>(null)
  const endpoint = `/api/admin/accounts/${encodeURIComponent(accountId)}/approvers`,
    member = page?.members.find((m) => m.profileId === profileId)
  const button =
      'min-h-11 rounded-lg border border-border px-4 py-2 font-semibold disabled:opacity-50',
    field = 'w-full min-h-11 rounded border border-border bg-background p-3'
  async function load(kind: 'members' | 'events' | 'reload') {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setAuthority(false)
    setError('')
    const next = { ...cursors.current }
    if (kind === 'members') next.memberCursor = page?.nextMemberCursor ?? null
    if (kind === 'events') next.eventCursor = page?.nextEventCursor ?? null
    if (kind === 'reload') {
      next.memberCursor = null
      next.eventCursor = null
    }
    const params = new URLSearchParams()
    if (next.memberCursor) params.set('memberCursor', next.memberCursor)
    if (next.eventCursor) params.set('eventCursor', next.eventCursor)
    try {
      const res = await fetch(endpoint + '?' + params, { cache: 'no-store' })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) setHasVerifiedAccess(false)
        setError('unavailable')
        return
      }
      const data: AccessPageDTO = await res.json()
      setAuthority(true)
      setHasVerifiedAccess(true)
      cursors.current = next
      setPage((old) =>
        !old || kind === 'reload'
          ? data
          : kind === 'members'
            ? {
                ...old,
                members: [...old.members, ...data.members].filter(
                  (m, i, a) =>
                    a.findIndex((v) => v.profileId === m.profileId) === i,
                ),
                nextMemberCursor: data.nextMemberCursor,
              }
            : {
                ...old,
                events: [...old.events, ...data.events].filter(
                  (m, i, a) => a.findIndex((v) => v.id === m.id) === i,
                ),
                nextEventCursor: data.nextEventCursor,
              },
      )
      if (!profileId) setProfileId(data.members[0]?.profileId ?? '')
    } catch {
      setError('unavailable')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current || !member || !authority) return
    const normalized = reason.trim().normalize('NFC')
    if (!normalized || [...normalized].length > 2000) {
      setError('invalidReason')
      reasonRef.current?.focus()
      return
    }
    const payload = JSON.stringify({
      profileId,
      action,
      reason: normalized,
      expectedRevision: member.revision,
    })
    if (request.current?.payload !== payload)
      request.current = { payload, requestId: crypto.randomUUID() }
    lock.current = true
    setBusy(true)
    setError('')
    setStatus('')
    let completed = false
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...JSON.parse(payload),
          requestId: request.current.requestId,
        }),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setAuthority(false)
          setHasVerifiedAccess(false)
        }
        setError(
          res.status === 409
            ? 'conflict'
            : res.status === 403
              ? 'denied'
              : 'unavailable',
        )
        return
      }
      const event: AccessEventDTO = await res.json()
      setPage((old) =>
        old
          ? {
              ...old,
              members: old.members.map((m) =>
                m.profileId === event.profileId
                  ? {
                      ...m,
                      active: event.action === 'grant',
                      revision: event.newRevision,
                    }
                  : m,
              ),
              events: [event, ...old.events.filter((v) => v.id !== event.id)],
            }
          : old,
      )
      request.current = null
      setReason('')
      setStatus('accessRecorded')
      completed = true
      requestAnimationFrame(() => statusRef.current?.focus())
    } catch {
      setError('unavailable')
    } finally {
      lock.current = false
      setBusy(false)
      if (!completed) reasonRef.current?.focus()
    }
  }
  return (
    <main
      className="mx-auto max-w-5xl space-y-6 p-4 text-foreground sm:p-8"
      aria-busy={busy}
    >
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p>{t('scope')}</p>
      {error && <p role="alert">{t(error)}</p>}
      <p role="status" tabIndex={-1} ref={statusRef}>
        {busy ? t('loading') : status ? t(status) : ''}
      </p>
      <button className={button} disabled={busy} onClick={() => load('reload')}>
        {t('reload')}
      </button>
      {page && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{t('members')}</h2>
            {!page.nextMemberCursor && !page.members.some((m) => m.active) && (
              <p>{t('noApprovers')}</p>
            )}
            <ul>
              {page.members.map((m) => (
                <li className="break-words py-2" key={m.profileId}>
                  {m.displayName ?? m.profileId} —{' '}
                  {t(m.active ? 'active' : 'inactive')} ·{' '}
                  {t('revision', { revision: m.revision })}
                </li>
              ))}
            </ul>
            {page.nextMemberCursor && (
              <button
                className={button}
                disabled={busy}
                onClick={() => load('members')}
              >
                {t('moreMembers')}
              </button>
            )}
          </section>
          {hasVerifiedAccess && page.members.length > 0 && (
            <form
              onSubmit={submit}
              className="space-y-3 rounded-xl border border-border p-4"
            >
              <label className="block" htmlFor={id + 'member'}>
                {t('member')}
              </label>
              <select
                id={id + 'member'}
                className={field}
                disabled={busy}
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value)
                }}
              >
                {page.members.map((m) => (
                  <option key={m.profileId} value={m.profileId}>
                    {m.displayName ?? m.profileId}
                  </option>
                ))}
              </select>
              <label className="block" htmlFor={id + 'action'}>
                {t('action')}
              </label>
              <select
                id={id + 'action'}
                className={field}
                disabled={busy}
                value={action}
                onChange={(e) => {
                  setAction(e.target.value as 'grant' | 'revoke')
                }}
              >
                <option value="grant">{t('grant')}</option>
                <option value="revoke">{t('revoke')}</option>
              </select>
              <p>{t('revision', { revision: member?.revision ?? 0 })}</p>
              <label className="block" htmlFor={id + 'reason'}>
                {t('reason')}
              </label>
              <textarea
                ref={reasonRef}
                id={id + 'reason'}
                className={field}
                required
                rows={4}
                value={reason}
                readOnly={busy}
                onChange={(e) => {
                  setReason(e.target.value)
                }}
              />
              <p>{t('reasonLimit')}</p>
              <button
                className={button}
                type="submit"
                disabled={busy || !member || !authority}
              >
                {t('saveAccess')}
              </button>
            </form>
          )}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{t('history')}</h2>
            {!page.events.length && <p>{t('noEvents')}</p>}
            <ul>
              {page.events.map((event) => (
                <li
                  className="space-y-2 border-b border-border py-3"
                  key={event.id}
                >
                  <p>
                    {t(event.action)} · {event.profileId} · {event.createdAt}
                  </p>
                  <p>
                    {event.administrator.displayName ??
                      event.administrator.profileId}
                  </p>
                  <p>{t('revision', { revision: event.newRevision })}</p>
                  <p className="whitespace-pre-wrap break-words">
                    {event.reason}
                  </p>
                </li>
              ))}
            </ul>
            {page.nextEventCursor && (
              <button
                className={button}
                disabled={busy}
                onClick={() => load('events')}
              >
                {t('moreEvents')}
              </button>
            )}
          </section>
        </>
      )}
    </main>
  )
}
