'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { StudioReply } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import type { StudioHomeTemplate } from '@/lib/conversation-studio/home'
import { appendStudioTurn, createStudioThread, fetchStudioThread, fetchStudioThreads, finalizeStudioTurn } from '@/lib/conversation-studio/threads-client'
import type {
  StudioThreadCreateInput,
  StudioThreadRecord,
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
  live?: { pending?: boolean; reply?: StudioLiveReply; error?: string }
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
  turnsLoaded: boolean
  turnsError?: boolean
  updatedAt?: string
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
    updatedAt: record.updatedAt,
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
    serverId: record.id,
    position: record.position,
    saveState: 'saved',
  }
}

function useSessionState(clientId?: string) {
  const [threads, setThreads] = useState<StudioThread[]>([])
  const threadsRef = useRef(threads)
  useEffect(() => { threadsRef.current = threads }, [threads])
  const [navigation, setNavigation] = useState<{ activeId: string | null; version: number }>({ activeId: null, version: 0 })
  const [feedback, setFeedback] = useState<{ id: number; threadId: string; key: 'briefOpened' | 'followUpSent' } | null>(null)
  const [newDraft, setNewDraft] = useState('')
  const [newTemplate, setNewTemplate] = useState<StudioHomeTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [hydrated, setHydrated] = useState(!clientId)
  const [readFailed, setReadFailed] = useState(false)
  const inFlight = useRef(false)
  const nextTurnId = useRef(1)
  const nextThreadId = useRef(1)
  const loadedThreads = useRef(new Set<string>())
  const pendingCreates = useRef(new Map<string, Promise<string | null>>())
  const allocateId = () => nextTurnId.current++
  const allocateThreadId = () => `local-${nextThreadId.current++}`

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    void fetchStudioThreads(clientId).then(result => {
      if (cancelled) return
      if (!result.ok) { setReadFailed(true); setHydrated(true); return }
      const records = result.data.threads.map(fromRecord)
      setThreads(previous => {
        const unsaved = previous.filter(thread => thread.saveState !== 'persisted')
        const existing = new Set(previous.map(thread => thread.id))
        return [...unsaved, ...records.filter(thread => !existing.has(thread.id))]
      })
      setReadFailed(false)
      setHydrated(true)
    })
    return () => { cancelled = true }
  }, [clientId])

  async function loadThread(id: string) {
    if (!clientId || loadedThreads.current.has(id)) return
    const thread = threadsRef.current.find(item => item.id === id)
    if (!thread || thread.saveState !== 'persisted') return
    loadedThreads.current.add(id)
    const result = await fetchStudioThread(clientId, id)
    if (!result.ok) {
      loadedThreads.current.delete(id)
      setThreads(previous => previous.map(item => item.id === id ? { ...item, turnsError: true } : item))
      return
    }
    const turns = result.data.turns.map(record => turnFromRecord(record, allocateId()))
    setThreads(previous => previous.map(item => item.id === id
      ? { ...item, title: result.data.thread.title, goal: result.data.thread.goal, week: result.data.thread.week, sourceTitle: result.data.thread.sourceTitle ?? undefined, updatedAt: result.data.thread.updatedAt, turns, turnsLoaded: true, turnsError: false }
      : item))
  }

  function selectThread(id: string) {
    setNavigation(previous => ({ activeId: id, version: previous.version + 1 }))
    setFeedback(null)
    void loadThread(id)
  }

  async function saveThread(localId: string, input: StudioThreadCreateInput): Promise<string | null> {
    if (!clientId) return null
    const creation = createStudioThread(clientId, input).then(result => {
      if (!result.ok) {
        setThreads(previous => previous.map(thread => thread.id === localId ? { ...thread, saveState: 'failed' } : thread))
        return null
      }
      const record = result.data.thread
      loadedThreads.current.add(record.id)
      setThreads(previous => previous.map(thread => thread.id === localId
        ? { ...thread, id: record.id, saveState: 'persisted', updatedAt: record.updatedAt }
        : thread))
      setNavigation(previous => previous.activeId === localId ? { ...previous, activeId: record.id } : previous)
      setFeedback(previous => previous && previous.threadId === localId ? { ...previous, threadId: record.id } : previous)
      return record.id
    })
    pendingCreates.current.set(localId, creation)
    return creation
  }

  async function saveTurn(threadIdHint: string, turnId: number, input: StudioTurnCreateInput): Promise<{ ok: true; position: number; threadId: string } | { ok: false }> {
    if (!clientId) return { ok: false }
    const pending = pendingCreates.current.get(threadIdHint)
    const threadId = pending ? await pending : threadIdHint
    if (!threadId) {
      markTurnFailed(turnId)
      return { ok: false }
    }
    const result = await appendStudioTurn(clientId, threadId, input)
    if (!result.ok) {
      markTurnFailed(turnId)
      return { ok: false }
    }
    const record = result.data.turn
    setThreads(previous => previous.map(thread => thread.turns.some(turn => turn.id === turnId)
      ? {
          ...thread,
          saveState: 'persisted',
          updatedAt: new Date().toISOString(),
          turns: thread.turns.map(turn => turn.id === turnId
            ? { ...turn, serverId: record.id, position: record.position, saveState: 'saved' }
            : turn),
        }
      : thread))
    return { ok: true, position: record.position, threadId }
  }

  function markTurnFailed(turnId: number) {
    setThreads(previous => previous.map(thread => thread.turns.some(turn => turn.id === turnId)
      ? { ...thread, saveState: 'failed', turns: thread.turns.map(turn => turn.id === turnId ? { ...turn, saveState: 'failed' } : turn) }
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

  // Keep mutable refs private to their owning hook. Consumers use actions.
  return { threads, setThreads, activeId: navigation.activeId, navigationVersion: navigation.version,
    setActiveId: (activeId: string | null) => { setNavigation(previous => ({ activeId, version: previous.version + 1 })); setFeedback(null) },
    selectThread, saveThread, saveTurn, saveLive, hydrated, readFailed,
    feedback, setFeedback, newDraft, setNewDraft, newTemplate, setNewTemplate, busy,
    allocateId, allocateThreadId,
    isInFlight: () => inFlight.current,
    beginLive: () => { inFlight.current = true; setBusy(true) },
    endLive: () => { inFlight.current = false; setBusy(false) },
  }
}
const Session = createContext<ReturnType<typeof useSessionState> | null>(null)

/** Hydrates the owning principal's saved threads; the guarded layout keys this provider by account AND brand. */
export function StudioSessionProvider({ children, clientId }: { children: ReactNode; clientId?: string }) {
  const value = useSessionState(clientId)
  return <Session.Provider value={value}>{children}</Session.Provider>
}
export function useOptionalStudioSession() { return useContext(Session) }
export function useStudioSession() {
  const value = useContext(Session)
  if (!value) throw Error('StudioSessionProvider required')
  return value
}
