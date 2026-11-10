import type { StudioReply } from './types'

/**
 * The composed saved reply is stored as one JSON document and re-rendered on
 * every thread read, so it needs a bound that is independent of how much
 * evidence the brand happens to have. 32 KiB leaves room for eight
 * observation extracts and one scan evidence block; the database's hard limit
 * stays 64 KiB, and this is the point at which the server itself decides what
 * to leave out rather than letting a large week fail the append.
 */
export const STUDIO_REPLY_BUDGET_BYTES = 32 * 1024

const encoder = new TextEncoder()
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length

const USABLE_CHECK = new Set(['pass', 'warn', 'fail'])

/**
 * Trim a composed reply to the budget, deterministically and only from the
 * tail: observations are removed last-first, then the scan block, never a
 * middle record and never a rewrite of what remains. The caller records the
 * trim in the receipts, so a shorter answer is visible as a bounded read
 * rather than silently smaller. Status is recomputed after a trim, because an
 * answer that no longer carries its evidence must not still claim to be
 * evidenced.
 */
export function applyStudioReplyBudget(reply: StudioReply, budgetBytes: number = STUDIO_REPLY_BUDGET_BYTES): {
  reply: StudioReply
  trimmedObservations: number
  trimmedScan: boolean
} {
  if (bytes(reply) <= budgetBytes) return { reply, trimmedObservations: 0, trimmedScan: false }
  let next: StudioReply = { ...reply, observations: [...reply.observations] }
  let trimmedObservations = 0
  while (bytes(next) > budgetBytes && next.observations.length > 0) {
    next = { ...next, observations: next.observations.slice(0, -1) }
    trimmedObservations += 1
  }
  let trimmedScan = false
  if (bytes(next) > budgetBytes && next.scan) {
    next = { ...next, scan: null }
    trimmedScan = true
  }
  if (trimmedObservations === 0 && !trimmedScan) return { reply, trimmedObservations: 0, trimmedScan: false }
  const usablePulse = next.observations.some(item => item.result === 'success' && !!item.excerpt)
  const usableScan = next.scan?.evidence.checks.some(check => check.collection === 'complete' && USABLE_CHECK.has(check.assessment)) ?? false
  const researchSteps = next.researchSteps.filter(step => step.kind !== 'composeExtracts' || next.observations.length > 0 || next.scan !== null)
  return {
    reply: {
      ...next,
      researchSteps,
      status: next.template !== null && next.template !== 'competitors' && (usablePulse || usableScan) ? 'evidenced' : 'insufficient',
    },
    trimmedObservations,
    trimmedScan,
  }
}
