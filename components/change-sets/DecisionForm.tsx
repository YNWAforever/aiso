'use client'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import type {
  VersionDetail,
  ReviewDecisionInput,
} from '@/lib/change-sets/types'
export function DecisionForm({
  endpoint,
  version,
  onCompleted,
  onDirty,
}: {
  endpoint: string
  version: VersionDetail
  onCompleted: (value: VersionDetail) => void
  onDirty: (dirty: boolean) => void
}) {
  const t = useTranslations('changeSets'),
    id = useId(),
    reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState(''),
    [decision, setDecision] =
      useState<ReviewDecisionInput['decision']>('approved'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef<{ payload: string; requestId: string } | null>(null),
    lock = useRef(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    const normalized = reason.trim().normalize('NFC')
    if (!normalized || [...normalized].length > 2000) {
      setError('invalidReason')
      reasonRef.current?.focus()
      return
    }
    const payload = JSON.stringify({ decision, reason: normalized })
    if (request.current?.payload !== payload)
      request.current = { payload, requestId: crypto.randomUUID() }
    lock.current = true
    setBusy(true)
    setError('')
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
        setError(
          res.status === 409
            ? 'conflict'
            : res.status === 403
              ? 'denied'
              : 'unavailable',
        )
        return
      }
      const data = await res.json()
      request.current = null
      setReason('')
      onDirty(false)
      onCompleted(data.version)
      completed = true
    } catch {
      setError('unavailable')
    } finally {
      lock.current = false
      setBusy(false)
      if (!completed) reasonRef.current?.focus()
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border border-border p-4"
      aria-busy={busy}
    >
      <label className="block" htmlFor={id + 'decision'}>
        {t('decision')}
      </label>
      <select
        id={id + 'decision'}
        className="min-h-11 w-full border border-border bg-background p-2"
        value={decision}
        disabled={busy}
        onChange={(e) => {
          setDecision(e.target.value as ReviewDecisionInput['decision'])
          onDirty(true)
        }}
      >
        <option value="approved">{t('approved')}</option>
        <option value="changes_requested">{t('changes_requested')}</option>
      </select>
      <label className="block" htmlFor={id + 'reason'}>
        {t('reason')}
      </label>
      <textarea
        ref={reasonRef}
        id={id + 'reason'}
        className="w-full rounded border border-border bg-background p-3"
        rows={4}
        required
        value={reason}
        readOnly={busy}
        onChange={(e) => {
          setReason(e.target.value)
          onDirty(true)
        }}
      />
      <p>{t('reasonLimit')}</p>
      {error && <p role="alert">{t(error)}</p>}
      <button
        type="submit"
        className="min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50"
        disabled={busy || !version.capabilities.canDecide}
      >
        {t('recordDecision')}
      </button>
      <button
        type="button"
        className="min-h-11 rounded border border-border px-4 py-2"
        disabled={busy}
        onClick={() => {
          setReason('')
          setDecision('approved')
          setError('')
          onDirty(false)
        }}
      >
        {t('discardReason')}
      </button>
    </form>
  )
}
