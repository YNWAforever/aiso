/**
 * A bounded, one-line excerpt of the answer already stored on a Studio turn.
 *
 * This is a projection of stored JSON only: it never calls a model, starts a
 * turn or re-composes a reply. The newest turn is preferred; a turn whose saved
 * reply has no usable observation gets no excerpt and the row falls back to its
 * turn count instead of inventing a result.
 */
export const SAVED_OUTCOME_EXCERPT_MAX = 160

function normalizeLine(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstLine(value: string): string {
  for (const raw of value.split(/\r?\n/)) {
    const line = normalizeLine(raw)
    if (line) return line
  }
  return normalizeLine(value)
}

function excerptFromText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const line = firstLine(value)
  if (!line) return null
  const chars = Array.from(line)
  return chars.length > SAVED_OUTCOME_EXCERPT_MAX
    ? `${chars.slice(0, SAVED_OUTCOME_EXCERPT_MAX).join('')}…`
    : line
}

export function storedOutcomeExcerpt(reply: unknown): string | null {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return null
  const observations = (reply as { observations?: unknown }).observations
  if (!Array.isArray(observations)) return null
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) continue
    const excerpt = excerptFromText((observation as { excerpt?: unknown }).excerpt)
    if (excerpt) return excerpt
  }
  return null
}
