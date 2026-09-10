/**
 * Bounded model spend.
 *
 * `callOpenRouter` took a model, messages and a token count. Nothing identified
 * who was spending or how much had already gone, so no per-task or per-account
 * cap could exist anywhere above it — `maxTokens` bounds one call, not a task,
 * and a caller in a loop was unbounded.
 *
 * Two controls, because they fail differently:
 *
 *  1. A CEILING on any single call, read from the environment. It applies
 *     everywhere with no plumbing, so a caller cannot opt out by forgetting, and
 *     it is the backstop against one prompt asking for an enormous completion.
 *  2. A per-task BUDGET the caller threads through a unit of work, capping both
 *     the number of calls and the total tokens. This is what bounds a fan-out or
 *     a retry loop, which no per-call limit can.
 *
 * Cost is not modelled. Token prices differ per model and change without notice,
 * so a monetary cap here would be a number that looks authoritative and is wrong.
 * The plan's own guidance is to use explicit token and call ceilings while cost is
 * unknown, which is what these are. When real usage is measured, a monetary cap
 * belongs on top of this, not instead of it.
 */

export class BudgetExceededError extends Error {
  constructor(readonly kind: 'calls' | 'tokens', readonly limit: number) {
    super(`Model budget exhausted: ${kind} limit of ${limit} reached`)
    this.name = 'BudgetExceededError'
  }
}

/** Deliberately generous defaults; the point is that a bound exists at all. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000
export const DEFAULT_TASK_CALLS = 3
export const DEFAULT_TASK_TOKENS = 12_000

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  // A malformed cap falls back rather than throwing: an unparseable value should
  // not take the application down, and the fallback is still a bound.
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * The hard ceiling on any single completion. Deployer-configured, read at call
 * time rather than at module load, so a test or a running process can change it.
 */
export function maxOutputTokens(): number {
  return positiveInt(process.env.AISO_LLM_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)
}

/** Clamps a requested completion size to the ceiling. Never raises it. */
export function clampOutputTokens(requested: number): number {
  const ceiling = maxOutputTokens()
  if (!Number.isSafeInteger(requested) || requested <= 0) return Math.min(1, ceiling)
  return Math.min(requested, ceiling)
}

export type TaskBudget = {
  /**
   * Reserves one call of `tokens`. Throws BudgetExceededError when either cap
   * would be passed — reserving BEFORE the call, so an over-budget request is
   * never sent. Charging afterwards would spend the money and then complain.
   */
  reserve(tokens: number): void
  readonly calls: number
  readonly tokens: number
  readonly limits: { calls: number; tokens: number }
}

export function createTaskBudget(overrides: { calls?: number; tokens?: number } = {}): TaskBudget {
  const limits = {
    calls: overrides.calls ?? positiveInt(process.env.AISO_LLM_TASK_CALLS, DEFAULT_TASK_CALLS),
    tokens: overrides.tokens ?? positiveInt(process.env.AISO_LLM_TASK_TOKENS, DEFAULT_TASK_TOKENS),
  }
  let calls = 0
  let tokens = 0
  return {
    reserve(requested: number) {
      const cost = clampOutputTokens(requested)
      if (calls + 1 > limits.calls) throw new BudgetExceededError('calls', limits.calls)
      if (tokens + cost > limits.tokens) throw new BudgetExceededError('tokens', limits.tokens)
      calls += 1
      tokens += cost
    },
    get calls() { return calls },
    get tokens() { return tokens },
    limits,
  }
}
