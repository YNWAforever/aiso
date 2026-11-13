'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { FilePenLine, FileText, ScanSearch } from 'lucide-react'
import { useStudioSession, type StudioTurn } from '@/components/dashboard/StudioSession'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import { evidenceForHomeTask, HOME_TASKS, type StudioHomeTemplate } from '@/lib/conversation-studio/home'
import { STUDIO_ACTION_SKILLS } from '@/lib/conversation-studio/skills'
import { hongKongMonthKey, studioActionBlocker } from '@/lib/conversation-studio/skill-actions'
import { requestStudioAction, studioActionHref, type ActionScope, type ActionOutcome, type StudioActionId } from '@/lib/conversation-studio/action-outcomes'
import type { StudioTurnCreateInput } from '@/lib/conversation-studio/threads-types'
import type { StudioEvidence } from '@/lib/conversation-studio/types'
import type { PlanFeatures } from '@/lib/plans/catalog'
import { trackFunnelEvent } from '@/lib/funnel-client'

type SaveContext = { threadId: string; turnId: number; input: StudioTurnCreateInput }
type RecordState = { phase: 'running' | ActionOutcome['phase']; scope: ActionScope; error?: string; save?: 'saving' | 'saved' | 'retry' | 'unknown'; context?: SaveContext }

/** State belongs to the parent hook, so opening a conversation does not discard action/save recovery. */
export function useStudioActions({ clientId, brandName, brandDomain, features, evidence, enabled }: { clientId?: string; brandName: string; brandDomain?: string | null; features?: PlanFeatures; evidence: StudioEvidence; enabled: boolean }) {
  const t = useTranslations('conversationStudio'), language = useLocale()
  const { setThreads, saveThread, saveTurn, allocateThreadId, allocateId } = useStudioSession()
  const [selected, setSelected] = useState<StudioActionId | null>(null)
  const [previewScope, setPreviewScope] = useState<ActionScope | null>(null)
  const confirmationPanel = useRef<HTMLDivElement>(null)
  const openingButtons = useRef<Partial<Record<StudioActionId, HTMLButtonElement | null>>>({})
  const headings = useRef<Partial<Record<StudioActionId, HTMLHeadingElement | null>>>({})
  const [focusRequest, setFocusRequest] = useState<{ kind: 'confirmation' | 'open' | 'heading'; id: StudioActionId } | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    const node = focusRequest.kind === 'confirmation' ? confirmationPanel.current : focusRequest.kind === 'open' ? openingButtons.current[focusRequest.id] : headings.current[focusRequest.id]
    node?.focus()
  }, [focusRequest])
  function cancelAction(id: StudioActionId) { setSelected(null); setFocusRequest({ kind: 'open', id }) }
  function openAction(id: StudioActionId) {
    if (!clientId || writing.current) return
    setPreviewScope({ skillId: id, clientId, domain: brandDomain ?? undefined, scanId: id === 'improve_page' ? evidence.scan?.id : undefined, month: id === 'monthly_report' ? hongKongMonthKey(new Date()) : undefined })
    setSelected(id)
    setFocusRequest({ kind: 'confirmation', id })
  }
  const [records, setRecords] = useState<Partial<Record<StudioActionId, RecordState>>>({})
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const locale = language === 'zh-HK' ? 'zh-HK' : 'en'
  const patch = (id: StudioActionId, change: Partial<RecordState>) => setRecords(previous => ({ ...previous, [id]: { ...previous[id]!, ...change } }))

  async function appendOnly(id: StudioActionId, context: SaveContext) {
    patch(id, { save: 'saving' })
    try {
      const result = await saveTurn(context.threadId, context.turnId, context.input)
      patch(id, { save: result.ok ? 'saved' : 'retry', context })
    } catch { patch(id, { save: 'retry', context }) }
  }
  async function retrySave(id: StudioActionId, context: SaveContext) {
    if (writing.current) return
    writing.current = true; setBusy(true)
    setFocusRequest({ kind: 'heading', id })
    try { await appendOnly(id, context) } finally { writing.current = false; setBusy(false) }
  }
  async function saveAction(outcome: ActionOutcome) {
    const { skillId, scanId, month } = outcome.scope
    const task: StudioHomeTemplate = skillId === 'monthly_report' ? 'report' : 'improve'
    const label = t(skillId === 'scan_brand' ? 'skills.scan_brand.label' : `skills.${skillId}.actionLabel`)
    const scopeText = month ? t('actions.scopeMonth', { month }) : t('actions.scopeScan', { scanId: scanId ?? '' })
    const prompt = [t(`skills.${skillId}.turnPrompt`), scopeText, t('actions.summaryScope')].join('\n')
    const title = label.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '')
    const threadId = allocateThreadId()
    const turn: StudioTurn = { id: allocateId(), requestId: crypto.randomUUID(), prompt, task, reply: composeSavedReply(prompt, HOME_TASKS[task].capability, evidenceForHomeTask(evidence, task)) }
    const input: StudioTurnCreateInput = { prompt, task, requestId: turn.requestId, language: locale }
    setThreads(previous => [{ id: threadId, title, goal: prompt, week: evidence.week, kind: 'research', turns: [turn], draft: '', template: null, saveState: 'unsaved', turnsLoaded: true, skill: skillId, visibility: 'private', pinned: false, archived: false, mine: true, branchOf: null }, ...previous])
    patch(skillId, { save: 'saving' })
    try {
      const serverId = await saveThread(threadId, { kind: 'research', title, goal: prompt, week: evidence.week, sourceTitle: null, skill: skillId })
      // Create has no idempotency key. Lost acknowledgement is unknown, never a recreate/append using a local id.
      if (!serverId) { patch(skillId, { save: 'unknown' }); return }
      await appendOnly(skillId, { threadId: serverId, turnId: turn.id, input })
    } catch { patch(skillId, { save: 'unknown' }) }
  }
  async function run(id: StudioActionId) {
    if (!enabled || !clientId || writing.current || records[id] && records[id]?.phase !== 'rejected') return
    const scope = previewScope
    if (!scope || scope.skillId !== id || scope.clientId !== clientId) return
    const blocker = studioActionBlocker({ skillId: id, brandDomain: scope.domain, latestScanId: scope.scanId, features })
    if (blocker) { setRecords(previous => ({ ...previous, [id]: { phase: 'rejected', scope, error: t(`skills.${id}.${blocker}`) } })); return }
    writing.current = true; setBusy(true)
    setFocusRequest({ kind: 'heading', id })
    setRecords(previous => ({ ...previous, [id]: { phase: 'running', scope } }))
    trackFunnelEvent({ name: 'skill_action_confirmed', locale })
    try {
      const outcome = await requestStudioAction(scope)
      patch(id, { ...outcome, error: outcome.phase === 'rejected' ? t('actions.notAllowed') : undefined })
      if (outcome.phase === 'done') { trackFunnelEvent({ name: 'skill_action_completed', locale }); await saveAction(outcome) }
      else if (outcome.phase !== 'pending') trackFunnelEvent({ name: 'skill_action_failed', locale })
    } finally { writing.current = false; setBusy(false) }
  }

  if (!enabled || !clientId) return null
  return <section aria-labelledby="studio-actions-title" className="space-y-3">
    <div className="as-section-heading"><h2 id="studio-actions-title">{t('actions.title')}</h2><p className="as-muted as-small">{t('actions.note')}</p></div>
    <div className="as-template-grid">{STUDIO_ACTION_SKILLS.map(skill => {
      const id = skill.id as StudioActionId, state = records[id], open = selected === id
      const Icon = id === 'scan_brand' ? ScanSearch : id === 'monthly_report' ? FileText : FilePenLine
      const label = t(id === 'scan_brand' ? 'skills.scan_brand.label' : `skills.${id}.actionLabel`)
      return <div key={id} data-studio-action={id} className="as-template space-y-2">
        <h3 ref={node => { headings.current[id] = node }} tabIndex={-1} className="flex items-start gap-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"><Icon className="as-blue mt-0.5 size-4 shrink-0" aria-hidden="true" />{label}</h3>
        <span className="as-muted as-small block">{t(`skills.${id}.outcome`)}</span>
        {!open && (!state || state.phase === 'rejected') && <button ref={node => { openingButtons.current[id] = node }} type="button" className="as-button px-3 font-semibold" disabled={busy} onClick={() => openAction(id)}>{t('actions.open')}</button>}
        {open && (!state || state.phase === 'rejected') && <div ref={confirmationPanel} tabIndex={-1} role="group" aria-label={label} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelAction(id) } }} className="space-y-2 rounded-lg border border-border p-3 focus-visible:outline-2 focus-visible:outline-offset-2">
          <p className="font-semibold">{t(id === 'scan_brand' ? 'skills.scan_brand.confirmTitle' : `skills.${id}.actionConfirmTitle`)}</p>
          <p>{brandName}</p><p className="as-muted as-small">{id === 'scan_brand' ? t('skills.scan_brand.confirmBody', { domain: previewScope?.domain ?? '' }) : t(`skills.${id}.actionConfirmBody`)}</p>
          {(previewScope?.month || previewScope?.scanId) && <p className="as-muted as-small [overflow-wrap:anywhere]">{previewScope.month ? t('actions.scopeMonth', { month: previewScope.month }) : t('actions.scopeScan', { scanId: previewScope.scanId! })}</p>}
          <div className="flex flex-wrap gap-2"><button type="button" className="as-button as-primary px-3 font-semibold" disabled={busy} onClick={() => void run(id)}>{t('actions.runNow')}</button><button type="button" className="as-button px-3" disabled={busy} onClick={() => cancelAction(id)}>{t('actions.cancel')}</button></div>
        </div>}
        {state && <div className="space-y-2" aria-live="polite">
          <p role={state.phase === 'unknown' || state.phase === 'rejected' ? 'alert' : 'status'} className="as-note">{state.phase === 'unknown' ? t('actions.unknown') : state.phase === 'rejected' ? state.error : state.phase === 'running' ? t(`skills.${id}.running`) : state.phase === 'pending' ? t('actions.pending') : t(`skills.${id}.done`)}</p>
          {state.phase !== 'running' && state.phase !== 'rejected' && <Link className="as-button inline-flex px-3 underline" href={studioActionHref(state.scope, language)}>{t(state.phase === 'done' ? 'actions.openResult' : 'actions.checkRecords')}</Link>}
          {(state.scope.month || state.scope.scanId) && <p className="as-muted as-small [overflow-wrap:anywhere]">{state.scope.month ? t('actions.scopeMonth', { month: state.scope.month }) : t('actions.scopeScan', { scanId: state.scope.scanId! })}</p>}
          {state.save && <p role="status" className="as-small">{t(`actions.save.${state.save}`)}</p>}
          {state.phase === 'done' && <p className="as-muted as-small">{t('actions.summaryScope')}</p>}
          {state.save === 'retry' && state.context && <button type="button" className="as-button px-3" disabled={busy} onClick={() => void retrySave(id, state.context!)}>{t('actions.retrySave')}</button>}
          {state.save === 'unknown' && <Link className="as-button inline-flex px-3 underline" href={`/${language}/dashboard/${encodeURIComponent(clientId)}/studio/threads`}>{t('actions.reloadHistory')}</Link>}
        </div>}
      </div>
    })}</div>
  </section>
}
