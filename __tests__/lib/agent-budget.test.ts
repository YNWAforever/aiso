import { afterEach, describe, expect, it } from 'vitest'
import {
  BudgetExceededError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TASK_CALLS,
  clampOutputTokens,
  createTaskBudget,
  maxOutputTokens,
} from '@/lib/agents/budget'

/**
 * Two controls, because they fail differently. The ceiling stops one call asking
 * for an enormous completion; the task budget stops a fan-out or a retry loop,
 * which no per-call limit can bound.
 */

const ENV_KEYS = ['AISO_LLM_MAX_OUTPUT_TOKENS', 'AISO_LLM_TASK_CALLS', 'AISO_LLM_TASK_TOKENS'] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('the per-call ceiling', () => {
  it('clamps a request above the ceiling and leaves a smaller one alone', () => {
    expect(clampOutputTokens(DEFAULT_MAX_OUTPUT_TOKENS + 10_000)).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(clampOutputTokens(500)).toBe(500)
  })

  it('never raises a request', () => {
    process.env.AISO_LLM_MAX_OUTPUT_TOKENS = '9000'

    // A ceiling that could raise a request would be a floor; a caller asking for
    // 100 tokens must still get 100.
    expect(clampOutputTokens(100)).toBe(100)
    expect(maxOutputTokens()).toBe(9000)
  })

  it('is read at call time, so a running process can be re-configured', () => {
    expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    process.env.AISO_LLM_MAX_OUTPUT_TOKENS = '250'
    expect(maxOutputTokens()).toBe(250)
  })

  it.each(['0', '-5', 'lots', '1.5', ''])('falls back to the default for the malformed value %j', value => {
    // An unparseable cap must not take the application down, and the fallback is
    // still a bound — the failure mode is "bounded by the default", not "unbounded".
    process.env.AISO_LLM_MAX_OUTPUT_TOKENS = value
    expect(maxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })

  it.each([0, -1, 1.5, Number.NaN])('treats the nonsensical request %s as the smallest possible', requested => {
    expect(clampOutputTokens(requested)).toBe(1)
  })
})

describe('the per-task budget', () => {
  it('allows work up to the call cap and refuses the one after', () => {
    const budget = createTaskBudget({ calls: 2, tokens: 10_000 })

    budget.reserve(100)
    budget.reserve(100)

    expect(() => budget.reserve(100)).toThrow(BudgetExceededError)
    expect(budget.calls).toBe(2)
  })

  it('refuses on the token cap even when calls remain', () => {
    const budget = createTaskBudget({ calls: 10, tokens: 300 })

    budget.reserve(200)

    expect(() => budget.reserve(200)).toThrow(/tokens limit of 300/)
    // The refused call is not charged: a budget that counted rejections would
    // drift away from what was actually spent.
    expect(budget.tokens).toBe(200)
    expect(budget.calls).toBe(1)
  })

  it('reserves before the call, so an over-budget request is never sent', () => {
    const budget = createTaskBudget({ calls: 1, tokens: 10_000 })
    budget.reserve(100)

    let dispatched = false
    const send = () => { budget.reserve(100); dispatched = true }

    expect(send).toThrow(BudgetExceededError)
    // Charging afterwards would spend the money and then complain.
    expect(dispatched).toBe(false)
  })

  it('charges the clamped size, not the requested one', () => {
    process.env.AISO_LLM_MAX_OUTPUT_TOKENS = '100'
    const budget = createTaskBudget({ calls: 5, tokens: 250 })

    budget.reserve(100_000)

    // The call will only ever send 100, so charging 100_000 would exhaust a
    // budget that was never actually spent.
    expect(budget.tokens).toBe(100)
  })

  it('takes its limits from the environment when the caller states none', () => {
    process.env.AISO_LLM_TASK_CALLS = '2'

    expect(createTaskBudget().limits.calls).toBe(2)
    expect(createTaskBudget({ calls: 7 }).limits.calls).toBe(7)
  })

  it('has a bound even with nothing configured at all', () => {
    // The property that matters: there is no way to obtain an unbounded budget.
    const budget = createTaskBudget()

    expect(budget.limits.calls).toBe(DEFAULT_TASK_CALLS)
    expect(budget.limits.tokens).toBeGreaterThan(0)
  })

  it('names which cap was hit, so the failure is actionable', () => {
    const budget = createTaskBudget({ calls: 1, tokens: 10_000 })
    budget.reserve(1)

    try {
      budget.reserve(1)
      expect.unreachable()
    } catch (error) {
      expect((error as BudgetExceededError).kind).toBe('calls')
      expect((error as BudgetExceededError).limit).toBe(1)
    }
  })
})
