import {authorizeUserPulse,userPulseError} from '@/lib/pulse/runs/user-access'
import {readUserPulseRun} from '@/lib/pulse/runs/user-dispatch'
export const dynamic='force-dynamic'
export async function GET(_req:Request,{params}:{params:Promise<{clientId:string;runId:string}>}){
 try{const {clientId,runId}=await params;const access=await authorizeUserPulse(clientId);if(!access.ok)return access.response;if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId))return Response.json({error:'Not found'},{status:404});const result=await readUserPulseRun(access.scope,runId);return result?Response.json(result,{headers:{'Cache-Control':'no-store'}}):Response.json({error:'Not found'},{status:404})}catch(error){return userPulseError(error)}
}
