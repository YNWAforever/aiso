import {projectPrimaryNextStep,type PrimaryNextStep} from './primary-next-step'
import type { PulseDisplayState, PulseCoverageView } from '@/lib/pulse/observed-summary'
import { projectScanStatus } from '@/lib/view-models/scan-status'
import { isPillarScoreSnapshot, type PillarScoreSnapshot } from '@/lib/pillar-scores'
import type { OwnedWorkspace, WorkspaceClient, WorkspaceRead } from '@/lib/workspace/load-owned-workspace'
import { buildOwnerPriorities, type OwnerPriorities } from '@/lib/view-models/owner-priorities'
import type { AgentRecommendation, ClientOverview } from '@/lib/types'
import { buildDailyWorkSummary,type DailyWorkSummary } from './daily-work'

export type WorkspaceSection<T> = {
  state: 'ready' | 'locked' | PulseDisplayState
  coverage?:PulseCoverageView|null
  data: T | null
  observedAt: string | null
  freshness: 'unknown'
}
export type WorkspaceHome = {
  client: WorkspaceClient
  /**
   * What to do now. Derived from the same stored scan as siteHealth, but from its
   * evidence rather than its score, so a check nobody could observe never becomes
   * work to do. Carries its own state, because "nothing to do" and "could not
   * tell" are different answers and must not render the same way.
   */
  priorities: OwnerPriorities
  nextStep?:PrimaryNextStep
  dailyWork?:DailyWorkSummary
  siteHealth: WorkspaceSection<{ scanId: string; domain: string; score: number | null; displayState?: import('@/lib/view-models/scan-status').ScanDisplayState; grade: string | null; pillarScores: PillarScoreSnapshot | null }>
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
  const display = projectScanStatus({ score: row?.score ?? null, grade: row?.grade ?? null, evidence: row?.results?.evidence })
  return {
    client: workspace.client,
    // From the evidence envelope, not the score: an unobservable check must not
    // become a priority. buildOwnerPriorities returns 'unavailable' for a scan
    // that predates evidence recording rather than falling back to raw verdicts.
    priorities: buildOwnerPriorities(row?.results?.evidence),
    nextStep:projectPrimaryNextStep({lang:"__locale__",clientId:workspace.client.id,availability:workspace.monitoring?.status==='ok'?workspace.monitoring.data:null,setup:workspace.setup?.status==='ok'?workspace.setup.data:null,daily:buildDailyWorkSummary(workspace.maintenance?.status==='ok'?workspace.maintenance.data:null)}),
    dailyWork:buildDailyWorkSummary(workspace.maintenance?.status==='ok'?workspace.maintenance.data:null),
    siteHealth: section(scan, row ? { scanId: row.id, domain: row.domain, score: display.score, grade: display.grade, displayState: display.state,
      pillarScores: isPillarScoreSnapshot(persisted) ? persisted : null } : null, row?.created_at || null),
    history: section(history, history.data.length ? history.data : null, history.data[0]?.created_at || null),
    visibility: {...section(pulse,pulse.data.kpi,pulse.data.latestWeek),state:pulse.status==='error'?'error':pulse.status==='locked'?'locked':pulse.data.state??(pulse.data.kpi?'complete':'empty'),coverage:pulse.status==='ok'?pulse.data.coverage:null},
    recommendations: { ...section(recommendations, recommendations.data.length ? recommendations.data : null,
      recommendations.data.map(row => row.created_at).filter(Boolean).sort().at(-1) ?? null), generated: true },
  }
}
