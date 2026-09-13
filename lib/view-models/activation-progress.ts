import { ACTIVATION_MILESTONES, type Activation, type ActivationMilestone } from '@/lib/telemetry/activation'

/**
 * Display projection over derived activation.
 *
 * `readActivation` throws on a failed read rather than returning nulls, so that
 * a database incident can never be mistaken for an account that did nothing.
 * This keeps that distinction: the caller passes `null` for a failed read and
 * gets `unavailable`, which carries no counts at all — there is no zero to
 * misread.
 */

export type ActivationMilestoneView = {
  key: ActivationMilestone
  reachedAt: string | null
  /** Reached AND consecutive — the only kind that moves the count. */
  counted: boolean
}

export type ActivationProgress =
  | { state: 'unavailable' }
  | {
      state: 'ready'
      reached: number
      total: number
      furthest: ActivationMilestone | null
      next: ActivationMilestone | null
      milestones: ActivationMilestoneView[]
      /**
       * Reached, but ahead of a milestone that has not been. Counting these
       * would report a funnel nobody walked; hiding them would make the screen
       * contradict the rows. So they are named separately and counted nowhere.
       */
      outOfOrder: ActivationMilestone[]
    }

export function buildActivationProgress(activation: Activation | null): ActivationProgress {
  if (!activation) return { state: 'unavailable' }

  const furthestIndex = activation.furthest === null
    ? -1
    : ACTIVATION_MILESTONES.indexOf(activation.furthest)

  const milestones = ACTIVATION_MILESTONES.map((key, index) => ({
    key,
    reachedAt: activation.reached[key],
    counted: index <= furthestIndex,
  }))

  return {
    state: 'ready',
    reached: furthestIndex + 1,
    total: ACTIVATION_MILESTONES.length,
    furthest: activation.furthest,
    next: ACTIVATION_MILESTONES[furthestIndex + 1] ?? null,
    milestones,
    outOfOrder: milestones
      .filter(milestone => !milestone.counted && milestone.reachedAt !== null)
      .map(milestone => milestone.key),
  }
}
