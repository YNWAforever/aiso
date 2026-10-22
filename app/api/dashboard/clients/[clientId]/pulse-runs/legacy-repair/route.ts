import {readLimitedJson} from '@/lib/approvals/request'
import {isFeatureEnabled} from '@/lib/flags'
import {authorizeUserPulse,userPulseError} from '@/lib/pulse/runs/user-access'
import {repairLegacyClassifications} from '@/lib/pulse/runs/legacy-repair'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function POST(req:Request,{params}:{params:Promise<{clientId:string}>}){
 try{
  const access=await authorizeUserPulse((await params).clientId);if(!access.ok)return access.response
  let body:{observationIds:string[];intentKey:string;runId?:string}
  try{body=await readLimitedJson(req,8192) as typeof body;if(!Array.isArray(body?.observationIds)||typeof body.intentKey!=='string')throw new Error('invalid')}catch{return Response.json({error:'INVALID_LEGACY_REPAIR'},{status:400})}
  // A scoped, versioned assessment of existing run evidence cannot collect any
  // answers. It remains available while deployment-wide collection is paused.
  if(body.runId===undefined&&!isFeatureEnabled('pulse_attempts'))throw new Error('PULSE_WORKER_DISABLED')
  const result=await repairLegacyClassifications(access.scope,{...body,deadlineAt:Date.now()+45000})
  return Response.json(result,{headers:{'Cache-Control':'no-store'}})
 }catch(error){const code=error instanceof Error?error.message:'';if(code==='INVALID_LEGACY_REPAIR')return Response.json({error:code},{status:400});if(code==='LEGACY_REPAIR_NOT_FOUND')return Response.json({error:'Not found'},{status:404});return userPulseError(error)}
}
