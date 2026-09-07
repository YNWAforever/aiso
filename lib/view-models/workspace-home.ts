import { isPillarScoreSnapshot, type PillarScoreSnapshot } from '@/lib/pillar-scores'
import type { OwnedWorkspace, WorkspaceClient, WorkspaceRead } from '@/lib/workspace/load-owned-workspace'
import type { AgentRecommendation, ClientOverview } from '@/lib/types'

export type WorkspaceSection<T> = {
  state: 'ready' | 'empty' | 'error' | 'locked'
  data: T | null
  observedAt: string | null
  freshness: 'unknown'
}
export type WorkspaceHome = {
  client: WorkspaceClient
  siteHealth: WorkspaceSection<{ scanId: string; domain: string; score: number; grade: string | null; pillarScores: PillarScoreSnapshot | null }>
  history: WorkspaceSection<ClientOverview['scanHistory']>
  visibility: WorkspaceSection<NonNullable<ClientOverview['pulseKpi']>>
  recommendations: WorkspaceSection<AgentRecommendation[]> & { generated: true }
}
function section<T>(read: WorkspaceRead<unknown>, data: T | null, observedAt: string | null): WorkspaceSection<T> {
  const state = read.status === 'ok' ? data === null ? 'empty' : 'ready' : read.status
  return { state, data: state === 'ready' ? data : null, observedAt, freshness: 'unknown' }
}

/** Pure display adapter. It never recalculates historical diagnostics or asserts outcomes. */
export function buildWorkspaceHome(workspace: OwnedWorkspace): WorkspaceHome {
  const { scan, history, pulse, recommendations } = workspace
  const row = scan.data
  const persisted = row?.results?.pillarScores
  return {
    client: workspace.client,
    siteHealth: section(scan, row ? { scanId: row.id, domain: row.domain, score: row.score, grade: row.grade ?? null,
      pillarScores: isPillarScoreSnapshot(persisted) ? persisted : null } : null, row?.created_at || null),
    history: section(history, history.data.length ? history.data : null, history.data[0]?.created_at || null),
    visibility: section(pulse, pulse.data.kpi, pulse.data.latestWeek),
    recommendations: { ...section(recommendations, recommendations.data.length ? recommendations.data : null,
      recommendations.data.map(row => row.created_at).filter(Boolean).sort().at(-1) ?? null), generated: true },
  }
}
