import {after} from 'next/server'
import {readLimitedJson} from '@/lib/approvals/request'
import {isFeatureEnabled} from '@/lib/flags'
import {authorizeUserPulse,userPulseError} from '@/lib/pulse/runs/user-access'
import {parsePulseIntent,readUserPulseOptions,startOrResumeUserPulse,wakeUserPulse} from '@/lib/pulse/runs/user-dispatch'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(_req:Request,{params}:{params:Promise<{clientId:string}>}){
 try{const access=await authorizeUserPulse((await params).clientId);if(!access.ok)return access.response;return Response.json(await readUserPulseOptions(access.scope),{headers:{'Cache-Control':'no-store'}})}catch(error){return userPulseError(error)}
}
export async function POST(req:Request,{params}:{params:Promise<{clientId:string}>}){
 try{
  const access=await authorizeUserPulse((await params).clientId);if(!access.ok)return access.response
  if(!isFeatureEnabled('pulse_attempts'))throw new Error('PULSE_WORKER_DISABLED')
  let intent:ReturnType<typeof parsePulseIntent>
  try{intent=parsePulseIntent(await readLimitedJson(req,4096))}catch{return Response.json({error:'INVALID_PULSE_INTENT'},{status:400})}
  const result=await startOrResumeUserPulse(access.scope,intent)
  // Registration failure cannot undo an accepted transaction or invite a new intent.
  try{after(()=>wakeUserPulse(access.scope,result))}catch{console.error('[pulse/user] wake registration unavailable; durable run retained')}
  return Response.json(result,{status:202,headers:{'Cache-Control':'no-store'}})
 }catch(error){return userPulseError(error)}
}
