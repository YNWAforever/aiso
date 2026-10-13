import type { PromptBankItem } from '@/lib/types'
import { isPromptCategory } from './categories'
import type { PromptContext } from './context'
import { MAX_PROMPTS } from '@/lib/pulse/limits'

export type QuestionSuggestion = PromptContext & { question: string; category: string }
export type SuggestionWriteResult =
  | { state: 'saved'; prompt: PromptBankItem }
  | { state: 'rejected'; max?: number }
  | { state: 'unknown' }

export function parseQuestionSuggestions(body: unknown, context: PromptContext): QuestionSuggestion[] {
  const suggestions = (body as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(suggestions) || suggestions.length > 5 || !suggestions.every(s =>
    s && typeof s.question === 'string' && s.question.trim().length > 0 && s.question.trim().length <= 500
    && isPromptCategory(s.category) && s.language === context.language && s.market === context.market)) {
    throw new Error('Invalid question suggestions')
  }
  return suggestions.map(s => ({ question: s.question.trim(), category: s.category, ...context }))
}

/** A lost acknowledgement is not evidence that POST did not commit. Never auto-retry it. */
export async function saveSuggestedQuestion(clientId: string, input: QuestionSuggestion, signal: AbortSignal): Promise<SuggestionWriteResult> {
  try {
    const res = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/prompts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
    })
    if (!res.ok) {
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        return { state: 'rejected', max: Number.isSafeInteger(body?.max) && body.max > 0 ? body.max : MAX_PROMPTS }
      }
      return [400, 401, 403, 404].includes(res.status) ? { state: 'rejected' } : { state: 'unknown' }
    }
    const { prompt } = await res.json()
    if (!prompt || typeof prompt.id !== 'string' || !prompt.id || prompt.client_id !== clientId
      || prompt.question !== input.question || prompt.category !== input.category
      || prompt.language !== input.language || prompt.market !== input.market
      || prompt.is_active !== true || typeof prompt.created_at !== 'string') return { state: 'unknown' }
    return { state: 'saved', prompt }
  } catch { return { state: 'unknown' } }
}
