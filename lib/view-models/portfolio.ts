import type { OwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import type { WorkspaceSection } from '@/lib/view-models/workspace-home'
import type { WorkspaceClient } from '@/lib/workspace/load-owned-workspace'
import type { ClientOverview } from '@/lib/types'
import type { EffectivePlan } from '@/lib/tier'

export type Portfolio = {
  clients: Array<WorkspaceClient & { visibility: WorkspaceSection<NonNullable<ClientOverview['pulseKpi']>> }>
  history: WorkspaceSection<ClientOverview['scanHistory']>
  capacity: { state: 'known' | 'unknown'; count: number | null; limit: number; canCreate: boolean | null; plan: EffectivePlan }
}

/** Narrow, pure display projection: no raw observations, rankings or improvement inference. */
export function buildPortfolio(owned: OwnedPortfolio): Portfolio {
  const known = owned.count.status === 'ok' && owned.count.data !== null
  return {
    clients: owned.clients.map(client => {
      const pulse = owned.pulse.data[client.id]
      const state = owned.pulse.status === 'error' ? 'error' : pulse?.kpi ? 'ready' : 'empty'
      return { ...client, visibility: { state, data: state === 'ready' ? pulse!.kpi : null, observedAt: pulse?.latestWeek ?? null, freshness: 'unknown' } }
    }),
    history: { state: owned.history.status === 'error' ? 'error' : owned.history.data.length ? 'ready' : 'empty',
      data: owned.history.status === 'ok' && owned.history.data.length ? owned.history.data : null,
      observedAt: owned.history.data[0]?.created_at || null, freshness: 'unknown' },
    capacity: { state: known ? 'known' : 'unknown', count: known ? owned.count.data : null, limit: owned.limit,
      canCreate: known ? owned.count.data! < owned.limit : null, plan: owned.plan },
  }
}
