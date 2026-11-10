/**
 * Studio redesign R1: the evidence trace shown above each answer. It lists
 * only reads this turn actually asked for, in the order they run, with their
 * real state. Nothing is listed for a source the turn never queried, and a
 * pending or failed read is never shown as done.
 */
type Read = { pending?: boolean; error?: string } | undefined

export type TraceStepKey = 'saved' | 'attached' | 'gsc' | 'dfs' | 'firecrawl' | 'live'
export type TraceStatus = 'done' | 'pending' | 'unavailable'
export type TraceStep = { key: TraceStepKey; status: TraceStatus }

type TraceTurn = {
  attached?: { label: string } | undefined
  gsc?: Read
  dfs?: Read
  firecrawl?: Read
  live?: Read
}

function status(read: NonNullable<Read>): TraceStatus {
  if (read.pending) return 'pending'
  return read.error ? 'unavailable' : 'done'
}

export function traceSteps(turn: TraceTurn): TraceStep[] {
  // Saved evidence is composed for every turn (server-side once saved), so it always ran.
  const steps: TraceStep[] = [{ key: 'saved', status: 'done' }]
  if (turn.attached) steps.push({ key: 'attached', status: 'done' })
  for (const key of ['gsc', 'dfs', 'firecrawl', 'live'] as const) {
    const read = turn[key]
    if (read) steps.push({ key, status: status(read) })
  }
  return steps
}
