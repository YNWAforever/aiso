import { extractTurnUrl } from './firecrawl-url'
import type { StudioHomeTemplate, StudioSourceStatus } from './home'

/**
 * What one Send (or one skill tap) will read, derived from the same conditions
 * that actually dispatch the reads in ConversationStudio. The preview is a
 * promise about behaviour only; it never predicts content or cost.
 *
 * `saved` is always true: every turn is composed from the brand's saved records.
 */
export interface ExecutionPreviewInput {
  clientId?: string | null
  staffView?: boolean
  sourceStatus: StudioSourceStatus
  prompt: string
  live: boolean
  platforms: string[]
  liveExhausted?: boolean
  task?: StudioHomeTemplate | null
}

export interface ExecutionPreview {
  savesTurn: boolean
  readsSearchDemand: boolean
  readsKeywordDemand: boolean
  readsPublicPage: boolean
  liveAnswers: number
}

/** Research providers run only for an explicitly selected research task. */
export function studioResearchReads(task?: StudioHomeTemplate | null) {
  return {
    searchConsole: task === 'opportunity' || task === 'pulse' || task === 'report',
    keywords: task === 'opportunity' || task === 'competitors',
    publicPage: task === 'improve' || task === 'opportunity' || task === 'competitors',
  }
}

export function buildExecutionPreview(input: ExecutionPreviewInput): ExecutionPreview {
  // A staff view reads no provider or Google data: those routes bill and scope
  // to the viewer's own account.
  const allowed = Boolean(input.clientId) && !input.staffView
  const liveAllowed = input.live && allowed && input.platforms.length > 0 && input.liveExhausted !== true
  const research = studioResearchReads(input.task)
  const url = allowed && research.publicPage ? extractTurnUrl(input.prompt) : null
  return {
    savesTurn: allowed,
    readsSearchDemand: allowed && research.searchConsole && input.sourceStatus === 'bound',
    readsKeywordDemand: allowed && research.keywords,
    readsPublicPage: Boolean(url),
    liveAnswers: liveAllowed ? input.platforms.length : 0,
  }
}
