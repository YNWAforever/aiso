import type { StudioHomeTemplate } from './home'
import type { StudioSkillId } from './skills'
import type { StudioLiveReply } from './live-types'
import type { StudioReceipt } from './receipts'
import type { StudioReply } from './types'

export type StudioThreadKind = 'research' | 'brief'
export type StudioThreadVisibility = 'private' | 'shared'

/** Composition locale for opportunity copy; anything else reads as en. */
export type StudioTurnLanguage = 'en' | 'zh-HK'

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
  /** The registry skill this thread started from (migration 109), else derived from first_task. */
  skill: StudioSkillId | null
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
  /** Server-composed receipts. Null means the turn predates server composition. */
  receipts: StudioReceipt[] | null
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
  /** Registry skill id; validated against the closed vocabulary, never free text. */
  skill?: StudioSkillId | null
}

export type StudioTurnCreateInput = {
  prompt: string
  task: StudioHomeTemplate | null
  /**
   * Legacy client-composed reply. The B1 client omits it and sends `requestId`
   * instead, so the server composes the stored reply and its receipts itself.
   */
  reply?: StudioReply
  attached?: { label: string; versionNumber: number } | null
  /** Client idempotency key. With it, the server composes and deduplicates the append. */
  requestId?: string
  language?: StudioTurnLanguage
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
