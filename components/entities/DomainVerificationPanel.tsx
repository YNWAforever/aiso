'use client'

import { useEffect, useRef, useState } from 'react'

export type DomainVerificationView = {
  state: 'verified' | 'unverified'
  domain: string | null
  token: string | null
  path: string
  lastCheckedAt: string | null
  lastOutcome: 'verified' | 'token_absent' | 'unreachable' | 'redirected' | 'too_large' | null
}

export type DomainVerificationCopy = {
  verifyTitle: string
  verifyHow: string
  verifyPathLabel: string
  verifyTokenLabel: string
  verifyGetContent: string
  verifyGettingContent: string
  verifyNeedsContent: string
  verifyCopy: string
  verifyCopied: string
  verifyCopyFailed: string
  verifyCheck: string
  verifyChecking: string
  verifyLastChecked: string
  verifyNoDomain: string
  verifyOutcomeVerified: string
  verifyOutcomeTokenAbsent: string
  verifyOutcomeUnreachable: string
  verifyOutcomeRedirected: string
  verifyOutcomeTooLarge: string
  unavailable: string
}

const OUTCOME_KEY = {
  verified: 'verifyOutcomeVerified',
  token_absent: 'verifyOutcomeTokenAbsent',
  unreachable: 'verifyOutcomeUnreachable',
  redirected: 'verifyOutcomeRedirected',
  too_large: 'verifyOutcomeTooLarge',
} as const

const CONTROL =
  'min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2'

/**
 * The owner's half of domain verification.
 *
 * Every outcome gets a sentence that says what to do next, because the
 * failures here are almost all the owner's to fix and a bare status word
 * ("failed") would leave them guessing. `redirected` in particular explains
 * WHY the redirect was refused — otherwise it reads as a bug in the checker
 * rather than the deliberate refusal that makes the proof mean anything.
 */
export function DomainVerificationPanel({
  clientId,
  initial,
  copy,
}: {
  clientId: string
  initial: DomainVerificationView
  copy: DomainVerificationCopy
}) {
  return <VerificationContent key={`${clientId}:${initial.domain}:${initial.token ?? ''}`} clientId={clientId} initial={initial} copy={copy} />
}

function VerificationContent({ clientId, initial, copy }: { clientId: string; initial: DomainVerificationView; copy: DomainVerificationCopy }) {
  const [view, setView] = useState(initial)
  const [pending, setPending] = useState<'GET' | 'POST' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const ready = Boolean(view.token && /^aiso-site-verification=[0-9a-f]{32}$/.test(view.token))

  async function request(method: 'GET' | 'POST') {
    if (active.current || (method === 'POST' && !ready)) return
    const controller = new AbortController()
    active.current = controller
    const timer = setTimeout(() => controller.abort(), 15_000)
    setPending(method); setError(null)
    try {
      const response = await fetch(
        `/api/dashboard/clients/${encodeURIComponent(clientId)}/domain-verification`,
        { method, cache: 'no-store', signal: controller.signal },
      )
      if (!response.ok) throw new Error('VERIFICATION_UNAVAILABLE')
      const next: DomainVerificationView = await response.json()
      if (controller.signal.aborted) return
      if (!next || next.domain !== view.domain || next.path !== initial.path ||
        typeof next.token !== 'string' || !/^aiso-site-verification=[0-9a-f]{32}$/.test(next.token) ||
        !['verified', 'unverified'].includes(next.state) ||
        (next.lastOutcome !== null && !Object.hasOwn(OUTCOME_KEY, next.lastOutcome)) ||
        (next.lastCheckedAt !== null && (typeof next.lastCheckedAt !== 'string' || !Number.isFinite(Date.parse(next.lastCheckedAt))))) {
        throw new Error('VERIFICATION_UNAVAILABLE')
      }
      setView(next)
    } catch {
      setError(copy.unavailable)
    } finally {
      clearTimeout(timer)
      if (active.current === controller) active.current = null
      setPending(null)
    }
  }

  async function copyToken() {
    try { await navigator.clipboard.writeText(view.token!); setClipboard(copy.verifyCopied) }
    catch { setClipboard(copy.verifyCopyFailed) }
  }

  if (!view.domain) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 md:p-6" aria-label={copy.verifyTitle}>
        <h2 className="text-lg font-bold text-foreground">{copy.verifyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.verifyNoDomain}</p>
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-6" aria-label={copy.verifyTitle}>
      <div>
        <h2 className="text-lg font-bold text-foreground">{copy.verifyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {(ready ? copy.verifyHow : copy.verifyNeedsContent).replace('{domain}', view.domain)}
        </p>
      </div>

      {ready ? <>
      <dl className="space-y-2 text-sm">
        <dt className="font-medium text-foreground">{copy.verifyPathLabel}</dt>
        <dd className="break-all rounded bg-secondary px-3 py-2 font-mono text-foreground">{view.path}</dd>
        <dt className="font-medium text-foreground">{copy.verifyTokenLabel}</dt>
        <dd className="break-all rounded bg-secondary px-3 py-2 font-mono text-foreground">{view.token}</dd>
      </dl>
      <button type="button" onClick={copyToken} className={CONTROL}>{copy.verifyCopy}</button>
      {clipboard && <p role="status" className="text-sm text-muted-foreground">{clipboard}</p>}

      <button
        type="button"
        onClick={() => request('POST')}
        disabled={pending !== null}
        className={`${CONTROL} bg-primary text-primary-foreground disabled:opacity-60`}
      >
        {pending === 'POST' ? copy.verifyChecking : copy.verifyCheck}
      </button>
      </> : <button type="button" onClick={() => request('GET')} disabled={pending !== null} className={`${CONTROL} bg-primary text-primary-foreground disabled:opacity-60`}>
        {pending === 'GET' ? copy.verifyGettingContent : copy.verifyGetContent}
      </button>}

      {ready && view.lastOutcome && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy[OUTCOME_KEY[view.lastOutcome]]}
          {view.lastCheckedAt && ` · ${copy.verifyLastChecked} ${view.lastCheckedAt.slice(0, 10)}`}
        </p>
      )}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </section>
  )
}
