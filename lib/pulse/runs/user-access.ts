import 'server-only'
import {getProfile} from '@/lib/auth'
import {db} from '@/lib/db'
import {resolveCommercialEntitlement} from '@/lib/tier'
import type {PulseScope} from './schema'
export async function authorizeUserPulse(clientId:string):Promise<{ok:true;scope:PulseScope}|{ok:false;response:Response}>{
 const profile=await getProfile()
 if(!profile)return{ok:false,response:Response.json({error:'Unauthorized'},{status:401})}
 if(!resolveCommercialEntitlement(profile.accounts).features.platform_access.length)return{ok:false,response:Response.json({error:'UPGRADE_REQUIRED'},{status:403})}
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId))return{ok:false,response:Response.json({error:'Not found'},{status:404})}
 const rows=await db()`select id from clients where id=${clientId}::uuid and account_id=${profile.account_id} and status='active'`
 return rows[0]?{ok:true,scope:{accountId:profile.account_id,clientId}}:{ok:false,response:Response.json({error:'Not found'},{status:404})}
}
export function userPulseError(error:unknown){
 const message=error instanceof Error?error.message:''
 const status:Record<string,number>={PULSE_CONTEXT_UNCONFIRMED:409,PULSE_NOT_CONFIGURED:409,PULSE_QUOTA_EXCEEDED:429,PULSE_INTENT_CONFLICT:409,PULSE_RUN_NOT_FOUND:404,PULSE_ENTITLEMENT_CHANGED:403,PULSE_LEGACY_REPAIR_REQUIRED:409,PULSE_WORKER_DISABLED:503}
 return Response.json({error:status[message]?message:'PULSE_UNAVAILABLE'},{status:status[message]??503,headers:{'Cache-Control':'no-store'}})
}
