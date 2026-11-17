import { STUDIO_HOME_TEMPLATES, type StudioHomeTemplate } from './home'
import { STUDIO_PROMPT_LIMIT } from './live-types'

/**
 * The one handoff from an action card or report into Chat. It carries the
 * question and the task the question is about, so Chat opens on the same unit
 * the member clicked rather than a blank generic conversation.
 *
 * It only prefills; Send remains the sole write/provider path.
 */
export const STUDIO_TASK_PARAM = 'task'
export const STUDIO_ASK_PARAM = 'ask'
export const STUDIO_THREAD_PARAM = 'thread'

export function readStudioTask(value: unknown): StudioHomeTemplate | null {
  return typeof value === 'string' && (STUDIO_HOME_TEMPLATES as readonly string[]).includes(value)
    ? value as StudioHomeTemplate
    : null
}

export function readStudioAsk(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const ask = value.trim().slice(0, STUDIO_PROMPT_LIMIT)
  return ask || undefined
}

export function studioTaskHref(input: {
  lang: string
  clientId: string
  ask?: string | null
  task?: StudioHomeTemplate | null
}): string {
  const params = new URLSearchParams()
  const ask = readStudioAsk(input.ask)
  const task = readStudioTask(input.task)
  if (ask) params.set(STUDIO_ASK_PARAM, ask)
  if (task) params.set(STUDIO_TASK_PARAM, task)
  const base = `/${input.lang}/dashboard/${encodeURIComponent(input.clientId)}/studio`
  return params.size ? `${base}?${params.toString()}` : base
}

/** The return path: reopen the exact saved Studio thread rather than a new one. */
export function studioThreadHref(input: { lang: string; clientId: string; threadId: string }): string {
  const base = `/${input.lang}/dashboard/${encodeURIComponent(input.clientId)}/studio`
  return input.threadId ? `${base}?${STUDIO_THREAD_PARAM}=${encodeURIComponent(input.threadId)}` : base
}
