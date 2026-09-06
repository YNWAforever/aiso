import type { Observation, PulseSourceRow, Question } from '@/lib/observations/types'

const POSTGRES_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const POSTGRES_SPACE_ONLY = /^[\t\n\v\f\r ]*$/

function validTimestamp(value: string): boolean {
  const match = POSTGRES_TIMESTAMP.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function projectObservation(row: PulseSourceRow, currentPrompt: Question | null): Observation {
  const hasAnswer = typeof row.has_answer === 'boolean'
    ? row.has_answer
    : typeof row.raw_answer === 'string' && !POSTGRES_SPACE_ONLY.test(row.raw_answer)
  const classified = typeof row.brand_mentioned === 'boolean'
  const promptId = row.prompt_id?.toLowerCase() ?? null
  const linkedPrompt = promptId !== null && currentPrompt?.id.toLowerCase() === promptId
    ? { ...currentPrompt, id: currentPrompt.id.toLowerCase() }
    : null
  const limitations = ['model-unrecorded', 'market-unrecorded', 'collection-time-unrecorded']
  if (!hasAnswer) limitations.push('answer-unavailable')
  if (!classified) limitations.push('classification-unavailable')

  return {
    id: row.id.toLowerCase(),
    sourceKind: 'pulse-metric',
    promptId,
    question: row.question,
    platform: row.platform,
    scanWeek: row.scan_week,
    recordedAt: typeof row.created_at === 'string' && validTimestamp(row.created_at) ? row.created_at : null,
    collectedAt: null,
    model: null,
    market: null,
    result: hasAnswer && classified ? 'success' : 'incomplete',
    hasAnswer,
    brandMentioned: classified ? row.brand_mentioned : null,
    currentPrompt: linkedPrompt,
    limitations,
  }
}
