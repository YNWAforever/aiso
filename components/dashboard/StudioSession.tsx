'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { StudioReply } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import type { StudioGscRead } from '@/lib/conversation-studio/gsc-types'
import type { StudioDfsRead } from '@/lib/conversation-studio/dfs-types'
import type { StudioFirecrawlRead } from '@/lib/conversation-studio/firecrawl-types'
import type { StudioHomeTemplate } from '@/lib/conversation-studio/home'
import type { StudioReceipt } from '@/lib/conversation-studio/receipts'
import type { StudioSkillId } from '@/lib/conversation-studio/skills'
import { appendStudioTurn, createStudioThread, fetchStudioThread, fetchStudioThreads, finalizeStudioTurn, updateStudioThread } from '@/lib/conversation-studio/threads-client'
import type {
  StudioThreadCreateInput,
  StudioThreadRecord,
  StudioThreadUpdateInput,
  StudioTurnCreateInput,
  StudioTurnLiveInput,
  StudioTurnRecord,
} from '@/lib/conversation-studio/threads-types'

export type StudioTurn = {
  id: number
  prompt: string
  reply: StudioReply
  task: StudioHomeTemplate | null
  attached?: { label: string; versionNumber: number }
  live?: { pending?: boolean; reply?: StudioLiveReply; error?: string; /** Partial answer text per platform while SSE is open. */ stream?: Record<string, string> }
  gsc?: StudioGscRead
  dfs?: StudioDfsRead
  firecrawl?: StudioFirecrawlRead
  /** Client idempotency key; the server composes and deduplicates this append. */
  requestId?: string
  /** Server-owned answer state; a pending/unknown attempt must only be read back. */
  answerState?: 'pending' | 'complete' | 'failed' | 'unknown'
  /** Server-composed provenance for this turn, once saved. */
  receipts?: StudioReceipt[] | null
  serverId?: string
  position?: number
  saveState?: 'saved' | 'failed'
}
export type StudioThread = {
  id: string
  title: string
  goal: string
  week: string | null
  kind: 'research' | 'brief'
  sourceTitle?: string
  turns: StudioTurn[]
  draft: string
  template: StudioHomeTemplate | null
  saveState: 'persisted' | 'unsaved' | 'failed'
  /**
   * Why the last save failed, when the server said so ('STUDIO_THREAD_FULL', …).
   * Absent when the outcome is unknown (network loss), which is never retried.
   */
  saveError?: string
  turnsLoaded: boolean
  turnsError?: boolean
  /** Server metadata projection for list items; local unsaved threads have none. */
  createdAt?: string
  updatedAt?: string
  turnCount?: number
  /** Skill the thread started from (first turn's task). Absent while unknown. */
  skill?: StudioSkillId | null
  /** Saved visibility; a shared thread is read-only to everyone but its creator. */
  visibility: 'private' | 'shared'
  pinned: boolean
  archived: boolean
  /** False for a teammate's shared thread. */
  mine: boolean
  /** The message this thread branched from, or null when it started fresh. */
  branchOf: { threadId: string; turnId: string } | null
}

function fromRecord(record: StudioThreadRecord): StudioThread {
  return {
    id: record.id,
    title: record.title,
    goal: record.goal,
    week: record.week,
    kind: record.kind,
    sourceTitle: record.sourceTitle ?? undefined,
    turns: [],
    draft: '',
    template: null,
    saveState: 'persisted',
    turnsLoaded: false,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    turnCount: record.turnCount,
    skill: record.skill ?? null,
    visibility: record.visibility,
    pinned: record.pinned,
    archived: record.archived,
    mine: record.mine,
    branchOf: record.branchOf ?? null,
  }
}

function turnFromRecord(record: StudioTurnRecord, id: number): StudioTurn {
  return {
    id,
    prompt: record.prompt,
    reply: record.reply,
    task: record.task,
    attached: record.attached ?? undefined,
    live: record.live ?? undefined,
    requestId: record.requestId ?? undefined,
    answerState: record.answerState,
    receipts: record.receipts,
    serverId: record.id,
    position: record.position,
    saveState: 'saved',
  }
}

type StudioNavigation = { activeId: string | null; version: number }

function useSessionState(clientId?: string, initialDraft = '') {
  const [threads, setThreads] = useState<StudioThread[]>([])
  // The one archive that can still be undone (the API accepts archived:false; no list shows archived threads).
  const [archivedUndo, setArchivedUndo] = useState<{ threadId: string; title: string; failed: boolean } | null>(null)
  const [navigation, setNavigationState] = useState<StudioNavigation>({ activeId: null, version: 0 })
  const navigationIntent = useRef(navigation)
  // Record intent before React can flush an older commit's passive URL effect.
  const setNavigation = useCallback((update: (previous: StudioNavigation) => StudioNavigation) => {
    const next = update(navigationIntent.current)
    navigationIntent.current = next
    setNavigationState(next)
  }, [])
  const [feedback, setFeedback] = useState<{ id: number; threadId: string; key: 'briefOpened' | 'branchOpened' | 'branchUnavailable' | 'followUpSent' | 'live.stopped' } | null>(null)
  const [newDraft, setNewDraft] = useState(initialDraft)
  const [newTemplate, setNewTemplate] = useState<StudioHomeTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(!clientId)
  const [readFailed, setReadFailed] = useState(false)
  const [refreshingThreadId, setRefreshingThreadId] = useState<string | null>(null)
  const [readErrorId, setReadErrorId] = useState<string | null>(null)
  const [locationReady, setLocationReady] = useState(!clientId)
  const loadGenerations = useRef(new Map<string, number>())
  const inFlight = useRef(false)
  const nextTurnId = useRef(1)
  const nextThreadId = useRef(1)
  const loadedThreads = useRef(new Set<string>())
  const pendingCreates = useRef(new Map<string, Promise<string | null>>())
  const allocateId = useCallback(() => nextTurnId.current++, [])
  const allocateThreadId = () => `local-${nextThreadId.current++}`

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    void fetchStudioThreads(clientId).then(result => {
      if (cancelled) return
      if (!result.ok) { setReadFailed(true); setHydrated(true); return }
      const records = result.data.threads.map(fromRecord)
      setThreads(previous => {
        // A late initial GET must not delete a thread created or edited while it ran.
        const existing = new Set(previous.map(thread => thread.id))
        return [...previous, ...records.filter(thread => !existing.has(thread.id))]
      })
      setReadFailed(false)
      setHydrated(true)
    })
    return () => { cancelled = true }
  }, [clientId])

  const loadThread = useCallback(async (id: string, force = false) => {
    if (!clientId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || (!force && loadedThreads.current.has(id))) return
    const generation = (loadGenerations.current.get(id) ?? 0) + 1
    loadGenerations.current.set(id, generation)
    loadedThreads.current.add(id)
    setRefreshingThreadId(id)
    const result = await fetchStudioThread(clientId, id)
    if (loadGenerations.current.get(id) !== generation) return
    setRefreshingThreadId(previous => previous === id ? null : previous)
    if (!result.ok) {
      loadedThreads.current.delete(id)
      setReadErrorId(id)
      setThreads(previous => ['UNAUTHENTICATED', 'NOT_FOUND'].includes(result.error)
        ? previous.filter(item => item.id !== id)
        : previous.map(item => item.id === id ? { ...item, turnsError: true } : item))
      return
    }
    setReadErrorId(previous => previous === id ? null : previous)
    setThreads(previous => {
      const existing = previous.find(item => item.id === id)
      const serverTurns = result.data.turns.map(record => {
        const local = existing?.turns.find(turn => turn.serverId === record.id || Boolean(record.requestId && turn.requestId === record.requestId))
        const saved = turnFromRecord(record, local?.id ?? allocateId())
        // A GET snapshot may precede a response or append already acknowledged
        // in this tab. An absent/older model state cannot erase that knowledge.
        const keepLive = local?.live && (!saved.live || Boolean(local.live.reply && (record.answerState === 'pending' || record.answerState === 'unknown')))
        return { ...local, ...saved, ...(keepLive ? { live: local.live, answerState: local.answerState } : {}) }
      })
      const savedIds = new Set(serverTurns.map(turn => turn.serverId))
      const savedRequests = new Set(serverTurns.map(turn => turn.requestId).filter(Boolean))
      // Turns are append-only. Keep even a newly ACKed turn missing from an
      // older read; requestId deduplicates an append whose acknowledgement was lost.
      const unsaved = existing?.turns.filter(turn => !savedIds.has(turn.serverId) && (!turn.requestId || !savedRequests.has(turn.requestId))) ?? []
      const updated: StudioThread = { ...(existing ?? fromRecord(result.data.thread)), ...fromRecord(result.data.thread), draft: existing?.draft ?? '', template: existing?.template ?? null,
        turns: [...serverTurns, ...unsaved], turnsLoaded: true, turnsError: false,
        saveState: unsaved.some(turn => turn.saveState === 'failed') ? 'failed' : 'persisted' }
      return existing ? previous.map(item => item.id === id ? updated : item) : [updated, ...previous]
    })
  }, [clientId, allocateId])

  const selectThread = useCallback((id: string) => {
    setNavigation(previous => ({ activeId: id, version: previous.version + 1 }))
    setFeedback(null)
    void loadThread(id)
  }, [loadThread, setNavigation])

  // Keep a saved discussion addressable across refresh and browser Back/Forward.
  // Other Studio destinations and offline embeds do not rewrite their route.
  useEffect(() => {
    if (!clientId) return
    function restore(event?: PopStateEvent) {
      const url = new URL(window.location.href)
      if (!url.pathname.endsWith(`/dashboard/${encodeURIComponent(clientId!)}/studio`)) { setLocationReady(true); return }
      const requested = url.searchParams.get('thread')
      const id = requested && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requested) ? requested : null
      setNavigation(previous => !event && previous.version > 0 ? previous : { activeId: id, version: previous.version + 1 })
      setLocationReady(true)
      if (id) void loadThread(id)
    }
    const start = setTimeout(restore, 0)
    window.addEventListener('popstate', restore)
    return () => { clearTimeout(start); window.removeEventListener('popstate', restore) }
  }, [clientId, loadThread, setNavigation])

  useEffect(() => {
    if (!clientId || !locationReady || navigation !== navigationIntent.current) return
    const url = new URL(window.location.href)
    if (!url.pathname.endsWith(`/dashboard/${encodeURIComponent(clientId)}/studio`)) return
    const id = navigation.activeId
    if (id && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) { url.searchParams.set('thread', id); url.searchParams.delete('ask') }
    else url.searchParams.delete('thread')
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [clientId, locationReady, navigation])

  async function saveThread(localId: string, input: StudioThreadCreateInput): Promise<string | null> {
    if (!clientId) return null
    const existing = pendingCreates.current.get(localId)
    if (existing) return existing
    const creation = createStudioThread(clientId, input).then(result => {
      if (!result.ok || !result.data?.thread || typeof result.data.thread.id !== 'string' || !result.data.thread.id || result.data.thread.id.startsWith('local-')) {
        // A definite client-error answer (4xx) means nothing was created; anything else
        // (5xx, network) is unknown and stays unknown — create has no idempotency key.
        const definite = !result.ok && result.status >= 400 && result.status < 500
        setThreads(previous => previous.map(thread => thread.id === localId ? { ...thread, saveState: 'failed', saveError: definite ? result.error : undefined } : thread))
        return null
      }
      const record = result.data.thread
      loadedThreads.current.add(record.id)
      setThreads(previous => previous.map(thread => thread.id === localId
        ? { ...thread, id: record.id, saveState: 'persisted', updatedAt: record.updatedAt, branchOf: record.branchOf ?? thread.branchOf ?? null }
        : thread))
      setReadFailed(false)
      setNavigation(previous => previous.activeId === localId ? { ...previous, activeId: record.id } : previous)
      setFeedback(previous => previous && previous.threadId === localId ? { ...previous, threadId: record.id } : previous)
      return record.id
    }).catch(() => {
      setThreads(previous => previous.map(thread => thread.id === localId ? { ...thread, saveState: 'failed' } : thread))
      return null
    })
    // Retain even an unacknowledged create: the server may already have inserted it.
    pendingCreates.current.set(localId, creation)
    return creation
  }

  async function saveTurn(threadIdHint: string, turnId: number, input: StudioTurnCreateInput): Promise<{ ok: true; position: number; threadId: string } | { ok: false; error?: string }> {
    if (!clientId) return { ok: false }
    const pending = pendingCreates.current.get(threadIdHint)
    const threadId = pending ? await pending : threadIdHint
    if (!threadId) {
      markTurnFailed(turnId)
      return { ok: false }
    }
    const result = await appendStudioTurn(clientId, threadId, input)
    if (!result.ok) {
      markTurnFailed(turnId, result.status >= 400 && result.status < 500 ? result.error : undefined)
      return { ok: false, error: result.status >= 400 && result.status < 500 ? result.error : undefined }
    }
    const record = result.data.turn
    setThreads(previous => previous.map(thread => {
      if (!thread.turns.some(turn => turn.id === turnId)) return thread
      const turns = thread.turns.map(turn => turn.id === turnId
        ? { ...turn, reply: record.reply, receipts: record.receipts, serverId: record.id, position: record.position, saveState: 'saved' as const }
        : turn)
      return {
        ...thread,
        saveState: turns.some(turn => turn.saveState === 'failed') ? 'failed' as const : 'persisted' as const,
        updatedAt: new Date().toISOString(),
        turnCount: turns.length,
        turns,
      }
    }))
    setReadFailed(false)
    return { ok: true, position: record.position, threadId }
  }

  function markTurnFailed(turnId: number, error?: string) {
    setThreads(previous => previous.map(thread => thread.turns.some(turn => turn.id === turnId)
      ? { ...thread, saveState: 'failed', saveError: error, turns: thread.turns.map(turn => turn.id === turnId ? { ...turn, saveState: 'failed' } : turn) }
      : thread))
  }

  async function saveLive(threadId: string, position: number, live: StudioTurnLiveInput): Promise<boolean> {
    if (!clientId) return false
    const result = await finalizeStudioTurn(clientId, threadId, position, live)
    if (!result.ok) {
      setThreads(previous => previous.map(thread => thread.id === threadId ? { ...thread, saveState: 'failed' } : thread))
      return false
    }
    return true
  }

  /** Owner-only lifecycle; a teammate's shared thread is read-only server-side too. */
  async function updateThread(id: string, patch: StudioThreadUpdateInput): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!clientId) return { ok: false, error: 'STUDIO_THREADS_UNAVAILABLE' }
    const result = await updateStudioThread(clientId, id, patch)
    if (!result.ok) return { ok: false, error: result.error }
    const record = result.data.thread
    setThreads(previous => previous.map(thread => thread.id === id
      ? { ...thread, title: record.title, visibility: record.visibility, pinned: record.pinned, archived: record.archived, mine: record.mine, updatedAt: record.updatedAt }
      : thread))
    return { ok: true }
  }

  /** Archive and remember it so the person can undo straight away. */
  async function archiveThread(id: string, title: string): Promise<boolean> {
    const result = await updateThread(id, { archived: true })
    if (result.ok) setArchivedUndo({ threadId: id, title, failed: false })
    return result.ok
  }
  async function undoArchive(): Promise<boolean> {
    if (!archivedUndo) return false
    const result = await updateThread(archivedUndo.threadId, { archived: false })
    setArchivedUndo(result.ok ? null : { ...archivedUndo, failed: true })
    return result.ok
  }

  // Keep mutable refs private to their owning hook. Consumers use actions.
  return { threads, setThreads, activeId: navigation.activeId, navigationVersion: navigation.version,
    setActiveId: (activeId: string | null) => { setNavigation(previous => ({ activeId, version: previous.version + 1 })); setFeedback(null) },
    selectThread, refreshThread: (id: string) => loadThread(id, true), refreshingThreadId,
    selectionError: readErrorId === navigation.activeId, saveThread, saveTurn, saveLive, updateThread, archiveThread, undoArchive, archivedUndo, dismissArchivedUndo: () => setArchivedUndo(null), hydrated, readFailed,
    feedback, setFeedback, newDraft, setNewDraft, newTemplate, setNewTemplate, busy,
    allocateId, allocateThreadId,
    isInFlight: () => inFlight.current,
    beginLive: () => { inFlight.current = true; setBusy(true) },
    endLive: () => { inFlight.current = false; setBusy(false) },
  }
}
const Session = createContext<ReturnType<typeof useSessionState> | null>(null)

/**
 * Hydrates the owning principal's saved threads; the guarded layout keys this provider by
 * account AND brand. `persist={false}` keeps every thread in this tab only (no thread
 * endpoint is read or written); the Studio layout no longer uses it, since a staff view
 * now exists only under a live grant and saves like any other, but offline fixtures do.
 */
export function StudioSessionProvider({ children, clientId, persist = true, initialDraft = '' }: { children: ReactNode; clientId?: string; persist?: boolean; initialDraft?: string }) {
  const value = useSessionState(persist ? clientId : undefined, persist ? initialDraft : '')
  return <Session.Provider value={value}>{children}</Session.Provider>
}
export function useOptionalStudioSession() { return useContext(Session) }
export function useStudioSession() {
  const value = useContext(Session)
  if (!value) throw Error('StudioSessionProvider required')
  return value
}
