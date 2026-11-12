import { extractTurnUrl } from './firecrawl-url'
import type { StudioSourceStatus } from './home'

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
}

export interface ExecutionPreview {
  savesTurn: boolean
  readsSearchDemand: boolean
  readsPublicPage: boolean
  liveAnswers: number
}

export function buildExecutionPreview(input: ExecutionPreviewInput): ExecutionPreview {
  // A staff view reads no provider or Google data: those routes bill and scope
  // to the viewer's own account.
  const allowed = Boolean(input.clientId) && !input.staffView
  const liveAllowed = input.live && allowed && input.platforms.length > 0 && input.liveExhausted !== true
  const url = allowed ? extractTurnUrl(input.prompt) : null
  return {
    savesTurn: allowed,
    readsSearchDemand: allowed && input.sourceStatus === 'bound',
    readsPublicPage: Boolean(url),
    liveAnswers: liveAllowed ? input.platforms.length : 0,
  }
}
