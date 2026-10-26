import type { VisibilityObservation } from './report'
/** Requested search is not proof of execution. Unknown historical evidence is incomparable. */
export function visibilityGroundingKey(row:VisibilityObservation):string|null {
  const evidence=row.searchEvidence
  if(!row.grounding||!evidence||evidence.requested!==row.grounding)return null
  if(row.grounding==='none')return evidence.execution==='unknown'? 'none':null
  return evidence.execution==='confirmed'&&evidence.basis==='provider-search-event'?row.grounding:null
}
