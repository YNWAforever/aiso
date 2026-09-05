import type { WorkspaceHome as HomeDto } from '../../lib/view-models/workspace-home'
import { calculatePillarScores } from '../../lib/pillar-scores'

/** Synthetic component acceptance data; never loaded by application routes. */
export function workspaceHomeFixture(state: 'empty'|'error'|'locked'|'ready', lang: string = 'en'): HomeDto {
      const section = {state,data:null,observedAt:null,freshness:'unknown' as const}
      const workspace = {client:{id:'fixture-client',brand_name:'Example Brand',domain:'example.com',industry:'technology',status:'active'},siteHealth:section,history:section,visibility:section,recommendations:{...section,generated:true}} as HomeDto
      if (state === 'ready') {
        workspace.siteHealth = {state,data:{scanId:'fixture-scan',domain:'example.com',score:62,grade:'C',pillarScores:calculatePillarScores({})},observedAt:'2026-09-05T10:00:00.000Z',freshness:'unknown'}
        workspace.visibility = {state,data:{sovScore:25,brandMentions:1,totalQueries:4,platformCount:1,scanWeek:'2026-09-01'},observedAt:'2026-09-01',freshness:'unknown'}
        workspace.history = {state,data:[{id:'fixture-scan',domain:'example.com',score:62,grade:'C',created_at:'2026-09-05T10:00:00.000Z'}],observedAt:'2026-09-05T10:00:00.000Z',freshness:'unknown'}
        workspace.recommendations = {state,data:[{id:'fixture-rec',scan_id:'fixture-scan',platform:'gemini',category:'content',priority:'high',recommendation:lang==='en'?'Explain the product clearly.':'清楚說明產品用途。',impact_score:4,created_at:'2026-09-05T10:00:00.000Z'}],observedAt:'2026-09-05T10:00:00.000Z',freshness:'unknown',generated:true}
      }
  return workspace
}
