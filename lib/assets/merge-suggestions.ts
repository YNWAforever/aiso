/**
 * Which two pieces of work a registered page says might be one job.
 *
 * Both sides are read from evidence already frozen on the source row, joined
 * against current registrations — so registering a page surfaces suggestions
 * for items that predate it, which is correct.
 *
 * A suggestion is never acted on automatically. The owner confirms.
 */

export type SuggestionSource = {
  itemId: string
  opportunityKey: string
  sourceKind: 'pulse-metric' | 'scan-check' | 'agent-recommendation'
  snapshot: Record<string, unknown>
  hasDraft: boolean
}

export type RegisteredPage = { id: string; origin: string; label: string; promptIds: string[] }

export type MergeSuggestion = {
  assetId: string
  label: string
  itemIds: string[]
  mergeable: boolean
  reason: 'ready' | 'both-already-drafted'
}

const originOf = (snapshot: Record<string, unknown>): string | null => {
  const final = (snapshot.final as { origin?: string } | null)?.origin
  const evaluated = (snapshot.evaluated as { origin?: string } | undefined)?.origin
  return final ?? evaluated ?? null
}

const promptOf = (snapshot: Record<string, unknown>): string | null =>
  typeof snapshot.promptId === 'string' ? snapshot.promptId : null

export function buildMergeSuggestions(input: {
  assets: RegisteredPage[]
  sources: SuggestionSource[]
}): MergeSuggestion[] {
  return input.assets.flatMap(asset => {
    const scans = input.sources.filter(
      source => source.sourceKind === 'scan-check' && originOf(source.snapshot) === asset.origin,
    )
    const questions = input.sources.filter(source => {
      const promptId = promptOf(source.snapshot)
      return source.sourceKind === 'pulse-metric' && promptId !== null && asset.promptIds.includes(promptId)
    })
    if (scans.length === 0 || questions.length === 0) return []

    const itemIds = [...new Set([...scans, ...questions].map(source => source.itemId))].sort()
    if (itemIds.length < 2) return []

    // Out of scope: absorbing an item that already exists. Stated, not hidden.
    const bothDrafted = scans.every(scan => scan.hasDraft) && questions.every(question => question.hasDraft)
    return [{
      assetId: asset.id,
      label: asset.label,
      itemIds,
      mergeable: !bothDrafted,
      reason: bothDrafted ? 'both-already-drafted' as const : 'ready' as const,
    }]
  })
}
