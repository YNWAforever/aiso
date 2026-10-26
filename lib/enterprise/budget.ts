export const ENTERPRISE_RESPONSE_LIMIT=2_500_000
/** Only trim older whole records. Never truncate a signed artifact or silently
 * recompute a partial artifact's immutable metrics. Private point links persist. */
export function boundEnterpriseWorkspace<T extends{artifacts:unknown[];runs:unknown[];audit:unknown[];benchmarks:{cohorts:unknown[]};coverage:object}>(input:T){
 const output={...input,artifacts:[...input.artifacts],runs:[...input.runs],audit:[...input.audit],benchmarks:{...input.benchmarks,cohorts:[...input.benchmarks.cohorts]},coverage:{...input.coverage,responseLimited:false}} as T&{coverage:T['coverage']&{responseLimited:boolean}}
 while(Buffer.byteLength(JSON.stringify(output))>ENTERPRISE_RESPONSE_LIMIT){
  const collection=[output.runs,output.artifacts,output.audit,output.benchmarks.cohorts].find(rows=>rows.length>1)??[output.runs,output.artifacts,output.audit,output.benchmarks.cohorts].find(rows=>rows.length)
  if(!collection)break
  collection.pop();output.coverage.responseLimited=true
 }
 return output
}
