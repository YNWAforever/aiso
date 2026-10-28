import { buildVisibilityReport } from './metrics'
import type { VisibilityObservation } from './report'
import { OutcomeError } from '@/lib/outcome-integrations/input'
type Data={observations:VisibilityObservation[];report:ReturnType<typeof buildVisibilityReport>;drafts:Record<string,unknown>[];jobs:Record<string,unknown>[];coverage:{limitReached:boolean;responseLimited?:boolean}}
/** Preserve newest records and recompute denominators when the bounded sample
 * is reduced. Never present the original sample's metrics over a smaller list. */
export function boundVisibilityResponse<T extends Data>(input:T,limit=2500000):T {
  const data={...input,observations:[...input.observations],drafts:[...input.drafts],jobs:[...input.jobs],coverage:{...input.coverage}}
  const size=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8')
  while(size(data)>limit) {
    const candidates=(['observations','drafts','jobs'] as const).filter(key=>data[key].length>1)
      .sort((a,b)=>size(b==='observations'?{rows:data[b],report:data.report}:data[b])-size(a==='observations'?{rows:data[a],report:data.report}:data[a]))
    const key=candidates[0]
    if(!key)throw new OutcomeError('VISIBILITY_RESPONSE_LIMIT',503)
    data[key].splice(Math.ceil(data[key].length/2))
    if(key==='observations'){data.report=buildVisibilityReport(data.observations);data.coverage.limitReached=true}
    data.coverage.responseLimited=true
  }
  return data
}
