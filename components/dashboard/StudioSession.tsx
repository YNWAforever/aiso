'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import type { StudioReply } from '@/lib/conversation-studio/types'
import type { StudioLiveReply } from '@/lib/conversation-studio/live-types'
import type { StudioHomeTemplate } from '@/lib/conversation-studio/home'

export type StudioTurn = { id: number; prompt: string; reply: StudioReply; task: StudioHomeTemplate | null; live?: { pending?: boolean; reply?: StudioLiveReply; error?: string } }
export type StudioThread = { id: number; title: string; goal: string; week: string | null; kind: 'research' | 'brief'; sourceTitle?: string; turns: StudioTurn[]; draft: string; template: StudioHomeTemplate | null }

function useSessionState() {
  const [threads, setThreads] = useState<StudioThread[]>([])
  const [navigation, setNavigation] = useState<{ activeId: number | null; version: number }>({ activeId: null, version: 0 })
  const [feedback, setFeedback] = useState<{ id: number; threadId: number; key: 'briefOpened' | 'followUpSent' } | null>(null)
  const [newDraft, setNewDraft] = useState('')
  const [newTemplate, setNewTemplate] = useState<StudioHomeTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const nextId = useRef(1)
  // Keep mutable refs private to their owning hook. Consumers use actions.
  return { threads, setThreads, activeId: navigation.activeId, navigationVersion: navigation.version,
    setActiveId: (activeId: number | null) => { setNavigation(previous => ({ activeId, version: previous.version + 1 })); setFeedback(null) },
    feedback, setFeedback, newDraft, setNewDraft, newTemplate, setNewTemplate, busy,
    allocateId: () => nextId.current++,
    isInFlight: () => inFlight.current,
    beginLive: () => { inFlight.current = true; setBusy(true) },
    endLive: () => { inFlight.current = false; setBusy(false) },
  }
}
const Session = createContext<ReturnType<typeof useSessionState> | null>(null)

/** Memory only. The guarded layout keys this provider by account AND brand. */
export function StudioSessionProvider({ children }: { children: ReactNode }) {
  const value = useSessionState()
  return <Session.Provider value={value}>{children}</Session.Provider>
}
export function useOptionalStudioSession() { return useContext(Session) }
export function useStudioSession() {
  const value = useContext(Session)
  if (!value) throw Error('StudioSessionProvider required')
  return value
}
