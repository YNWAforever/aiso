import type { StudioHomeTemplate } from './home'
import type { StudioLiveReply } from './live-types'
import type { StudioReply } from './types'

export type StudioThreadKind = 'research' | 'brief'
export type StudioThreadVisibility = 'private' | 'shared'

/** The message a thread was branched from. Both ids are stored together. */
export type StudioThreadBranchOf = { threadId: string; turnId: string }

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
  visibility: StudioThreadVisibility
  pinned: boolean
  archived: boolean
  /** False for a teammate's shared thread: readable, never writable by this viewer. */
  mine: boolean
  /** Where this thread branched from, or null when it started fresh. */
  branchOf: StudioThreadBranchOf | null
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
  /** Branch lineage. The origin must be visible to the creator (own or shared). */
  branchOf?: StudioThreadBranchOf
}

export type StudioTurnCreateInput = {
  prompt: string
  task: StudioHomeTemplate | null
  reply: StudioReply
  attached?: { label: string; versionNumber: number } | null
}

export type StudioTurnLiveInput = { reply: StudioLiveReply } | { error: string }

/** PATCH a thread you own. At least one key. Visibility is refused for staff threads. */
export type StudioThreadUpdateInput = {
  title?: string
  pinned?: boolean
  archived?: boolean
  visibility?: StudioThreadVisibility
}

export type StudioThreadsError = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INVALID_STUDIO_THREAD' | 'STUDIO_THREAD_FULL' | 'STUDIO_THREADS_UNAVAILABLE'
