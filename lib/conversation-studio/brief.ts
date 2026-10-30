import { STUDIO_PROMPT_LIMIT } from './live-types'

type BriefContext = { goal: string; prompt: string; summary: string }

/** Only user text and the displayed result status/caveat, never source bodies. */
export function composeBriefDraft(context: BriefContext, format: (context: BriefContext) => string): string {
  const available = Math.max(0, STUDIO_PROMPT_LIMIT - format({ ...context, goal: '', prompt: '' }).length)
  const goalBudget = Math.min(context.goal.length, Math.max(Math.floor(available / 2), available - context.prompt.length))
  // A UTF-16 budget can end between the two halves of an emoji.
  const shorten = (text: string, budget: number) => text.length <= budget ? text : budget > 0 ? `${text.slice(0, budget - 1).replace(/[\uD800-\uDBFF]$/u, '')}…` : ''
  return format({ ...context, goal: shorten(context.goal, goalBudget), prompt: shorten(context.prompt, available - goalBudget) })
}
