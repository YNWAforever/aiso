import type { StudioHomeTemplate } from './home'
import type { StudioLiveReply } from './live-types'
import type { StudioReply } from './types'

export type StudioThreadKind = 'research' | 'brief'

/** Metadata projection used by the sidebar, home continue list and /studio/threads. */
export type StudioThreadRecord = {
  id: string
  title: string
  goal: string
  week: string | null
  kind: StudioThreadKind
  sourceTitle: string | null
  createdAt: string
  updatedAt: string
  turnCount: number
  /** The skill (home task) of the first turn, if any. Derived on read; no column. */
  skill: StudioHomeTemplate | null
}

export type StudioTurnRecord = {
  id: string
  position: number
  prompt: string
  task: StudioHomeTemplate | null
  reply: StudioReply
  attached: { label: string; versionNumber: number } | null
  live: { reply: StudioLiveReply } | { error: string } | null
  createdAt: string
}

export type StudioThreadDetail = {
  thread: StudioThreadRecord
  turns: StudioTurnRecord[]
}

export type StudioThreadCreateInput = {
  kind: StudioThreadKind
  title: string
  goal: string
  week: string | null
  sourceTitle?: string | null
}

export type StudioTurnCreateInput = {
  prompt: string
  task: StudioHomeTemplate | null
  reply: StudioReply
  attached?: { label: string; versionNumber: number } | null
}

export type StudioTurnLiveInput = { reply: StudioLiveReply } | { error: string }

export type StudioThreadsError = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INVALID_STUDIO_THREAD' | 'STUDIO_THREAD_FULL' | 'STUDIO_THREADS_UNAVAILABLE'
