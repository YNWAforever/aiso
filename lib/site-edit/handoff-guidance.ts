import type { HandoffReadState } from './handoff-read-view'

export type HandoffRecovery = 'plan' | 'manual' | null

/** Navigation advice only; existing send/check and manual-export gates stay independent. */
export function handoffRecovery(state: HandoffReadState): HandoffRecovery {
  const handoff = state.handoff
  if (!state.authority || state.loading || state.busy || state.reconcileRequired || !handoff ||
    handoff.receipt || handoff.canSend || !['none', 'failed'].includes(handoff.state)) return null
  if (handoff.block === 'not_entitled') return 'plan'
  if (handoff.block === 'not_connected' || handoff.block === 'limit_reached') return 'manual'
  // In particular, not_approver means this version's recorded approving actor,
  // not an account role that member settings could grant to the current viewer.
  return null
}
