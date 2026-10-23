/**
 * The four first-run steps for one brand, each ticked from stored state only:
 *   brand      the brand exists (it does, on its own page)
 *   scan       at least one scan is stored
 *   fixes      at least one task (work item) was saved from the findings
 *   questions  the brand has active questions in its question bank
 *
 * "Questions", not "weekly Pulse": until Pulse is scheduled in production the
 * checklist must not claim that weekly tracking runs.
 *
 * Null means do not show the checklist: either every step is done, or a read
 * failed and the honest answer is "could not tell", which a checklist with
 * unticked boxes would misstate.
 */
export const GETTING_STARTED_STEPS = ['brand', 'scan', 'fixes', 'questions'] as const
export type GettingStartedKey = (typeof GETTING_STARTED_STEPS)[number]
export type GettingStartedStep = { key: GettingStartedKey; state: 'done' | 'current' | 'todo' }
export type GettingStarted = { steps: GettingStartedStep[]; done: number } | null

type Read<T> = { status: 'ok' | 'error' | 'locked'; data: T } | undefined

export function buildGettingStarted(input: {
  scans: Read<unknown[]>
  tasks: Read<number>
  setup: Read<{ active: number } | null>
}): GettingStarted {
  const { scans, tasks, setup } = input
  if (!scans || !tasks || !setup || [scans, tasks, setup].some(read => read.status !== 'ok')) return null
  const done: Record<GettingStartedKey, boolean> = {
    brand: true,
    scan: scans.data.length > 0,
    fixes: tasks.data > 0,
    questions: (setup.data?.active ?? 0) > 0,
  }
  const count = GETTING_STARTED_STEPS.filter(key => done[key]).length
  if (count === GETTING_STARTED_STEPS.length) return null
  const current = GETTING_STARTED_STEPS.find(key => !done[key])
  return {
    done: count,
    steps: GETTING_STARTED_STEPS.map(key => ({ key, state: done[key] ? 'done' : key === current ? 'current' : 'todo' })),
  }
}
