'use client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { handoffRecovery } from '@/lib/site-edit/handoff-guidance'
import type { VersionDetail } from '@/lib/change-sets/types'
import {
  acceptHandoffMutation, acceptHandoffRead, beginHandoffMutation, beginHandoffRead, decodeHandoff,
  failHandoffMutation, failHandoffRead, handoffCanCheck, handoffCanSend, handoffPrimaryAction,
  handoffResponseError, handoffTimestamp, initialHandoffReadState,
  type HandoffAction, type HandoffReadState,
} from '@/lib/site-edit/handoff-read-view'

type HandoffScope = { endpoint: string; contentHash: string; decisionKey: string }
type Session = { scope: HandoffScope; active: boolean; state: HandoffReadState; controller: AbortController }
type HandoffPanelProps = {
  clientId: string
  version: VersionDetail
  smeCopilot?: boolean
  emphasize?: boolean
  /**
   * Invalidates existing delivery/outcome READS; do not remount their forms.
   * The first validated GET in each client/item/version/hash/decision scope
   * notifies once when receipt/check observations already exist, so a concurrent
   * initial delivery read cannot leave older history visible. An empty first read
   * is silent. Later accepted GETs notify only for changed receipt/latest-check
   * fields, not identical reads or cooldown/capability changes.
   * Every validated successful member live-check POST notifies once, including
   * checks that insert no delivery event. Send responses notify only for changed
   * recorded observations. Stale, failed or malformed completions never notify.
   * This is not a promise that a receipt's after-response check has finished.
   */
  onRecordedChange?: () => void
  onViewManualOptions?: () => void
}

/** Server capabilities authorize actions; receipts remain developer claims. */
export function HandoffPanel({ clientId, version, smeCopilot = false, emphasize = true, onRecordedChange, onViewManualOptions }: HandoffPanelProps) {
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/work-items/${encodeURIComponent(version.workItemId)}/versions/${encodeURIComponent(version.id)}/handoff`
  const decisionKey = JSON.stringify(version.decision)
  const scope = useMemo(() => ({ endpoint, contentHash: version.contentHash, decisionKey }), [endpoint, version.contentHash, decisionKey])
  const sessionRef = useRef<Session | null>(null)
  const callbackRef = useRef(onRecordedChange)
  const [snapshot, setSnapshot] = useState(() => ({ scope, state: initialHandoffReadState() }))
  // A committed scope change invalidates old callbacks before passive effects.
  // Snapshot identity also hides old observations/authority during the new render.
  useLayoutEffect(() => { callbackRef.current = onRecordedChange })
  useLayoutEffect(() => {
    const session: Session = { scope, active: true, state: initialHandoffReadState(), controller: new AbortController() }
    sessionRef.current = session
    return () => {
      session.active = false
      session.controller.abort()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [scope])
  const current = useCallback((session: Session) => session.active && sessionRef.current === session, [])
  const publish = useCallback((session: Session, state: HandoffReadState | null) => {
    if (!state || !current(session)) return
    // Ref first: even two clicks before React renders cannot start two writes.
    session.state = state
    setSnapshot({ scope: session.scope, state })
  }, [current])

  const load = useCallback(async (explicit = false) => {
    const session = sessionRef.current
    if (!session || session.scope !== scope || !current(session)) return
    const started = beginHandoffRead(session.state)
    if (!started) return
    publish(session, started.state)
    let notify = false
    try {
      const res = await fetch(endpoint, { cache: 'no-store', signal: session.controller.signal })
      if (!res.ok) throw Error()
      const handoff = decodeHandoff(await res.json())
      if (!current(session)) return
      const accepted = acceptHandoffRead(session.state, started.token, handoff, explicit)
      if (accepted) { publish(session, accepted.state); notify = accepted.recordedChange }
    } catch {
      if (current(session)) publish(session, failHandoffRead(session.state, started.token))
    }
    if (notify && current(session)) callbackRef.current?.()
  }, [endpoint, scope, current, publish])

  useEffect(() => {
    const start = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(start)
  }, [load])
  const state = snapshot.scope === scope ? snapshot.state : initialHandoffReadState()
  // One cooldown GET, never a POST poll or automatic resend.
  const cooldownFrom = state.handoff?.checkBlock === 'too_soon' ? state.handoff.liveCheck?.checkedAt ?? null : null
  useEffect(() => {
    if (!cooldownFrom) return
    const wait = Math.max(0, Date.parse(cooldownFrom) + 60_000 - Date.now()) + 1_000
    const timer = setTimeout(() => { void load() }, wait)
    return () => clearTimeout(timer)
  }, [cooldownFrom, load])

  async function post(action: HandoffAction) {
    const session = sessionRef.current
    if (!session || session.scope !== scope || !current(session)) return
    const started = beginHandoffMutation(session.state, action)
    if (!started) return
    publish(session, started.state)
    let notify = false, reconcile = false
    try {
      const res = await fetch(endpoint + (action === 'check' ? '/live-check' : ''), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentHash: version.contentHash }), signal: session.controller.signal,
      })
      const body: unknown = await res.json().catch(() => null)
      if (!current(session)) return
      if (!res.ok) {
        const error = handoffResponseError(body)
        publish(session, failHandoffMutation(session.state, started.token, error))
        // Reconcile known server refusals, retaining their error until an
        // explicit successful refresh acknowledges the newly read status.
        reconcile = error !== 'HANDOFF_UNAVAILABLE'
      } else {
        const handoff = decodeHandoff(body, action === 'check')
        const accepted = acceptHandoffMutation(session.state, started.token, handoff)
        if (accepted) { publish(session, accepted.state); notify = accepted.recordedChange }
      }
    } catch {
      if (current(session)) publish(session, failHandoffMutation(session.state, started.token, 'HANDOFF_UNAVAILABLE'))
    }
    // No finally writes: a late old-scope completion cannot unlock a new scope.
    if (notify && current(session)) callbackRef.current?.()
    if (reconcile && current(session)) await load()
  }

  return <HandoffPanelView version={version} state={state} smeCopilot={smeCopilot} emphasize={emphasize} onSend={() => { void post('send') }} onCheck={() => { void post('check') }} onRefresh={() => { void load(true) }} onViewManualOptions={onViewManualOptions} />
}

type HandoffPanelViewProps = {
  version: VersionDetail
  state: HandoffReadState
  smeCopilot?: boolean
  emphasize?: boolean
  onSend: () => void
  onCheck: () => void
  onRefresh: () => void
  onViewManualOptions?: () => void
}
/** Presentation export also permits SSR contract tests without mocking hooks. */
export function HandoffPanelView({ version, state, smeCopilot = false, emphasize = true, onSend, onCheck, onRefresh, onViewManualOptions }: HandoffPanelViewProps) {
  const t = useTranslations('siteEditHandoff'), lang = useLocale()
  const recovery = smeCopilot ? handoffRecovery(state) : null
  const handoff = state.handoff, busy = state.busy !== null
  const removal = version.editSpec?.kind === 'jsonld_remove'
  const primary = handoffPrimaryAction(state, removal)
  const button = 'min-h-11 rounded border border-border px-4 py-2 font-semibold disabled:opacity-50'
  const smeButton = button + ' max-w-full whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  const actionClass = (action: 'send' | 'check' | 'refresh') => smeButton + (emphasize && primary === action ? ' bg-primary text-primary-foreground' : '')
  const canSend = handoffCanSend(state), canCheck = handoffCanCheck(state)
  const matched = handoff?.liveCheck?.outcome === (removal ? 'missing' : 'found')
  if (!smeCopilot) return (
    <section className="space-y-3 rounded-xl border border-border p-4" aria-labelledby="site-edit-handoff-heading" aria-busy={busy || state.loading}>
      <h2 id="site-edit-handoff-heading" className="text-xl font-semibold">{t('title')}</h2>
      {handoff?.receipt && (
        <p role="status" aria-live="polite">
          {t(`receipt.${handoff.receipt.status}`, { date: handoff.receipt.completedAt.slice(0, 10) })}
        </p>
      )}
      {handoff && !handoff.receipt && !state.reconcileRequired && (
        <p role="status" aria-live="polite">
          {t(`state.${handoff.state}`)}
          {handoff.executorRef && <> · <span className="break-all">{t('reference', { ref: handoff.executorRef })}</span></>}
        </p>
      )}
      {handoff?.liveCheck && (
        <p role="status" aria-live="polite">
          {t(`${removal ? 'live.removeResult' : 'live.result'}.${handoff.liveCheck.attested ? 'verified' : handoff.liveCheck.outcome}`, { date: handoff.liveCheck.checkedAt.slice(0, 10) })}
        </p>
      )}
      {handoff?.liveCheck?.structuredData && <p>{t(`live.structuredData.${handoff.liveCheck.structuredData}`)}</p>}
      {handoff?.block && handoff.block !== 'already_sent' && handoff.block !== 'in_flight' && <p className="text-muted-foreground">{t(`block.${handoff.block}`)}</p>}
      {state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
      {handoff && !state.reconcileRequired && handoff.state !== 'sent' && handoff.state !== 'unknown' && !handoff.receipt && (
        <button type="button" onClick={onSend} disabled={!canSend}
          className={button}>
          {state.busy === 'send' ? t('sending') : handoff.state === 'failed' ? t('resend') : t('send')}
        </button>
      )}
      {handoff && handoff.checkBlock !== 'not_open' && (
        <button type="button" onClick={onCheck} disabled={!canCheck}
          className={button}>
          {state.busy === 'check' ? t('live.checking') : t('live.check')}
        </button>
      )}
      {(state.reconcileRequired || handoff?.state === 'unknown') && <button type="button" onClick={onRefresh} disabled={busy || state.loading} className={button}>{t('sme.refresh')}</button>}
    </section>
  )
  return (
    <section className="min-w-0 space-y-3 break-words rounded-xl border border-border bg-background p-4 text-foreground" aria-labelledby="site-edit-handoff-heading" aria-busy={busy || state.loading}>
      <h2 id="site-edit-handoff-heading" className="text-xl font-semibold">{t('sme.title')}</h2>
      {state.loading && <p role="status" aria-live="polite">{t('sme.loading')}</p>}
      {state.reconcileRequired && handoff?.state !== 'unknown' ? <p role="status" aria-live="polite">{t('sme.unconfirmed')}</p>
        : handoff && (!handoff.receipt || handoff.state === 'unknown') && <p role="status" aria-live="polite">{t(`sme.state.${state.busy === 'send' ? 'sending' : handoff.state}`)}</p>}
      {handoff?.executorRef && <p className="break-all">{t('reference', { ref: handoff.executorRef })}</p>}
      {handoff?.receipt && <p role="status" aria-live="polite" className="break-words">{t(`sme.receipt.${handoff.receipt.status}`, { date: handoffTimestamp(handoff.receipt.completedAt) })}</p>}
      {handoff?.liveCheck && <>
        <p role="status" aria-live="polite" className="break-words">{t(`sme.${removal ? 'removeResult' : 'result'}.${handoff.liveCheck.outcome}`, { date: handoffTimestamp(handoff.liveCheck.checkedAt) })}</p>
        {handoff.liveCheck.attested ? <p>{t('sme.recordedByCheck')}</p> : matched && <p>{t('sme.noNewDelivery')}</p>}
        <p className="text-muted-foreground">{t('sme.checkLimitation')}</p>
        {handoff.liveCheck.structuredData && <p>{t(`sme.structuredData.${handoff.liveCheck.structuredData}`)}</p>}
      </>}
      {handoff?.block && handoff.block !== 'already_sent' && handoff.block !== 'in_flight' && <p className="text-muted-foreground">{t(`block.${handoff.block}`)}</p>}
      {handoff?.checkBlock === 'too_soon' && <p>{t('sme.cooldown')}</p>}
      {state.reconcileRequired && (handoff?.receipt || handoff?.liveCheck) && <p>{t('sme.historical')}</p>}
      {state.error && <p role="alert">{t(`errors.${state.error}`)}</p>}
      <div className="flex flex-wrap gap-2">
        {handoff && !state.reconcileRequired && !handoff.receipt && (handoff.state === 'none' || handoff.state === 'failed' || handoff.state === 'sending') && <button type="button" onClick={onSend} disabled={!canSend} className={actionClass('send')}>
          {state.busy === 'send' ? t('sending') : handoff.state === 'failed' ? t('sme.retrySend') : t('send')}
        </button>}
        {handoff && handoff.checkBlock !== 'not_open' && <button type="button" onClick={onCheck} disabled={!canCheck} className={actionClass('check')}>
          {state.busy === 'check' ? t('live.checking') : t('live.check')}
        </button>}
        <button type="button" onClick={onRefresh} disabled={busy || state.loading} className={actionClass('refresh')}>{t('sme.refresh')}</button>
        {recovery === 'plan' && <a className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/settings#settings-plan`}>{t('sme.viewPlan')}</a>}
        {recovery === 'manual' && onViewManualOptions && <button type="button" onClick={onViewManualOptions} className={smeButton + ' underline'}>{t('sme.viewManualOptions')}</button>}
      </div>
    </section>
  )
}
