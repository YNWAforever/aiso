'use client'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
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
  smeCopilot = false,
  emphasize = true,
}: {
  smeCopilot?: boolean
  emphasize?: boolean
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
      useState<ReviewDecisionInput['decision'] | ''>(smeCopilot ? '' : 'approved'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef<{ payload: string; requestId: string } | null>(null),
    lock = useRef(false), alive = useRef(true), decisionRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lock.current || !version.capabilities.canDecide || version.decision) return
    if (decision !== 'approved' && decision !== 'changes_requested') {
      setError('sme.chooseDecision')
      decisionRef.current?.focus()
      return
    }
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
      if (!alive.current) return
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
      const confirmed = parseVersionDetail(data?.version, version.workItemId, { id: version.id, contentHash: version.contentHash, draftRevision: version.draftRevision })
      if (confirmed.schemaVersion !== version.schemaVersion || confirmed.versionNumber !== version.versionNumber || confirmed.decision?.decision !== decision || confirmed.decision?.reason !== normalized) throw Error()
      if (!alive.current) return
      // Let the workspace reject a conflicting terminal observation before
      // discarding entered values or their retry identity.
      onCompleted(confirmed)
      request.current = null
      setReason('')
      onDirty(false)
      completed = true
    } catch {
      if (alive.current) setError('unavailable')
    } finally {
      lock.current = false
      if (alive.current) {
        setBusy(false)
        if (!completed) reasonRef.current?.focus()
      }
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
        ref={decisionRef}
        id={id + 'decision'}
        aria-invalid={error === 'sme.chooseDecision' || undefined}
        className="min-h-11 w-full border border-border bg-background p-2"
        value={decision}
        disabled={busy || (smeCopilot && (!version.capabilities.canDecide || Boolean(version.decision)))}
        onChange={(e) => {
          setDecision(e.target.value as ReviewDecisionInput['decision'])
          onDirty(true)
        }}
      >
        {smeCopilot && <option value="">{t('sme.chooseDecision')}</option>}
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
        readOnly={busy || (smeCopilot && (!version.capabilities.canDecide || Boolean(version.decision)))}
        onChange={(e) => {
          setReason(e.target.value)
          onDirty(true)
        }}
      />
      <p>{t('reasonLimit')}</p>
      {smeCopilot && <p className="text-sm text-muted-foreground">{t('sme.independentReview')}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <button
        type="submit"
        className={`min-h-11 rounded border px-4 py-2 font-semibold disabled:opacity-50 ${smeCopilot && emphasize ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
        disabled={busy || !version.capabilities.canDecide || Boolean(version.decision) || (smeCopilot && !decision)}
      >
        {t('recordDecision')}
      </button>
      <button
        type="button"
        className="min-h-11 rounded border border-border px-4 py-2"
        disabled={busy}
        onClick={() => {
          setReason('')
          setDecision(smeCopilot ? '' : 'approved')
          setError('')
          onDirty(false)
        }}
      >
        {t(smeCopilot ? 'sme.discardReview' : 'discardReason')}
      </button>
    </form>
  )
}
