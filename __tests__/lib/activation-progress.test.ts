import { describe, expect, it, vi } from 'vitest'

// The projection imports ACTIVATION_MILESTONES from lib/telemetry/activation,
// which is `server-only`. Same mock as __tests__/lib/activation.test.ts.
vi.mock('server-only', () => ({}))

import { buildActivationProgress } from '@/lib/view-models/activation-progress'
import { ACTIVATION_MILESTONES, type Activation, type ActivationMilestone } from '@/lib/telemetry/activation'

/**
 * The display projection over derived activation.
 *
 * `readActivation` has had no caller since it was written, so nothing has ever
 * had to decide what an owner should be told. Two decisions carry this file:
 *
 *  1. A read that FAILED and an account that has done NOTHING must not look the
 *     same. `readActivation` throws rather than returning nulls precisely so that
 *     distinction survives; a projection that turned the throw into zeros would
 *     spend that care immediately.
 *  2. Progress is the furthest CONSECUTIVE milestone. A milestone reached out of
 *     order is real — the row exists — but counting it would report a funnel that
 *     never happened. It is neither counted nor hidden: it is named.
 */

const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`

function activation(reached: Partial<Record<ActivationMilestone, string | null>>): Activation {
  const full = Object.fromEntries(
    ACTIVATION_MILESTONES.map(milestone => [milestone, reached[milestone] ?? null]),
  ) as Record<ActivationMilestone, string | null>
  let furthest: ActivationMilestone | null = null
  for (const milestone of ACTIVATION_MILESTONES) {
    if (full[milestone] === null) break
    furthest = milestone
  }
  return { accountId: 'account-1', observedAt: at(9), reached: full, furthest }
}

describe('buildActivationProgress', () => {
  it('reports a brand-new account as zero of six, not as unavailable', () => {
    const progress = buildActivationProgress(activation({}))

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.reached).toBe(0)
    expect(progress.total).toBe(6)
    expect(progress.furthest).toBeNull()
    expect(progress.next).toBe('first_scan')
  })

  it('counts consecutive milestones and names the next one', () => {
    const progress = buildActivationProgress(
      activation({ first_scan: at(1), first_workspace: at(2) }),
    )

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.reached).toBe(2)
    expect(progress.furthest).toBe('first_workspace')
    expect(progress.next).toBe('first_source')
  })

  it('does not count a milestone reached out of order', () => {
    // An export with no approval behind it. The row is real, so the count must
    // not rise: reporting 5 of 6 here would describe a funnel nobody walked.
    const progress = buildActivationProgress(
      activation({ first_scan: at(1), first_workspace: at(2), first_export: at(3) }),
    )

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.reached).toBe(2)
    expect(progress.next).toBe('first_source')
  })

  it('names the out-of-order milestone rather than hiding it', () => {
    // Hiding it would make the screen contradict the database, which is the
    // other half of the same mistake.
    const progress = buildActivationProgress(
      activation({ first_scan: at(1), first_workspace: at(2), first_export: at(3) }),
    )

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.outOfOrder).toEqual(['first_export'])
  })

  it('leaves outOfOrder empty when every reached milestone is consecutive', () => {
    const progress = buildActivationProgress(activation({ first_scan: at(1) }))

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.outOfOrder).toEqual([])
  })

  it('reports a completed funnel with no next step', () => {
    const progress = buildActivationProgress(
      activation(Object.fromEntries(ACTIVATION_MILESTONES.map(m => [m, at(1)]))),
    )

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.reached).toBe(6)
    expect(progress.next).toBeNull()
    expect(progress.furthest).toBe('first_declared_delivery')
  })

  it('keeps every milestone in the declared order, with its timestamp', () => {
    const progress = buildActivationProgress(activation({ first_scan: at(1) }))

    expect(progress.state).toBe('ready')
    if (progress.state !== 'ready') return
    expect(progress.milestones.map(milestone => milestone.key)).toEqual([...ACTIVATION_MILESTONES])
    expect(progress.milestones[0]).toEqual({ key: 'first_scan', reachedAt: at(1), counted: true })
    expect(progress.milestones[1]).toEqual({ key: 'first_workspace', reachedAt: null, counted: false })
  })

  it('is unavailable when the read failed, and says nothing about progress', () => {
    // The distinction the whole module exists to protect: a database incident
    // must never render as an account that did nothing.
    const progress = buildActivationProgress(null)

    expect(progress.state).toBe('unavailable')
    expect(progress).not.toHaveProperty('reached')
  })
})
