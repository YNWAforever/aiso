import 'server-only'
import { db } from '@/lib/db'
import { boundEnterpriseWorkspace } from './budget'
import { object,uuid,text,OutcomeError,parseOutcomeWindow } from '@/lib/outcome-integrations/input'
import { readOutcomeJson,readOutcomeBody } from '@/lib/outcome-integrations/request'
import { loadOutcomeMeasurements } from '@/lib/outcome-integrations/measurements'
import { loadVisibilityWorkspace } from '@/lib/visibility/store'
import { authorizeEnterprise,enterpriseErrorResponse,enterpriseHeaders,type EnterpriseCapability } from './guard'
import { parsePortalConfig,parseExecutiveSchedule,parseEnterpriseKey,parseAdapterConfig,parseAdapterObservation,parseDecision,locale } from './input'
import { loadEnterpriseWorkspace,saveEnterpriseBranding,createExecutiveReport,saveEnterpriseArtifact,decideEnterpriseArtifact,publishEnterprisePortal,revokeEnterpriseResource,readEnterpriseBranding,readEnterpriseArtifact,missing } from './store'
import { createEnterpriseKey,authenticateEnterpriseApi,consumeEnterpriseApi } from './credentials'
import { createEnterpriseAdapter,createAdapterRun,ingestAdapterObservation,readMarketBenchmarks,readAdapterRuns } from './adapters'
import { createEnterpriseWebhook,retryEnterpriseDelivery } from './delivery'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:enterpriseHeaders})
const actions:Record<string,{capability:EnterpriseCapability;role:'viewer'|'editor'|'manager'}>={branding:{capability:'white_label_portals',role:'manager'},reports:{capability:'scheduled_reports',role:'editor'},schedules:{capability:'scheduled_reports',role:'manager'},decision:{capability:'enterprise_workflows',role:'viewer'},publish:{capability:'white_label_portals',role:'manager'},revoke:{capability:'enterprise_workflows',role:'manager'},keys:{capability:'public_api',role:'manager'},webhooks:{capability:'webhooks',role:'manager'},adapters:{capability:'custom_adapters',role:'manager'},'adapter-run':{capability:'custom_adapters',role:'editor'},'draft-review':{capability:'enterprise_workflows',role:'editor'},retry:{capability:'webhooks',role:'manager'}}
export async function readEnterprise(clientId:string){try{const access=await authorizeEnterprise(clientId);return json(boundEnterpriseWorkspace({...await loadEnterpriseWorkspace(access.scope,access.profile.id,access.role,access.profile.is_admin),platformAdmin:access.profile.is_admin,canManageRoles:access.profile.is_admin||access.role==='manager',accountId:access.profile.is_admin?access.scope.accountId:null,benchmarks:await readMarketBenchmarks(access.scope)}))}catch(error){return enterpriseErrorResponse(error)}}
export async function mutateEnterprise(clientId:string,action:string,request:Request){try{
 const rule=actions[action];if(!rule)missing();const{scope,profile,client}=await authorizeEnterprise(clientId,rule.capability,rule.role),raw=await readOutcomeJson(request),actor=profile.id
 if(client.status!=='active'&&action!=='revoke')throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 if(action==='branding')return json(await saveEnterpriseBranding(scope,actor,parsePortalConfig(raw)))
 if(action==='reports'){const b=object(raw,['start','end','locale']),lang=locale(b.locale),params=new URLSearchParams({start:text(b.start,10),end:text(b.end,10)});return json(await createExecutiveReport(scope,actor,parseOutcomeWindow(params),lang),201)}
 if(action==='schedules'){const input=parseExecutiveSchedule(raw);return json(await saveEnterpriseArtifact(scope,actor,'schedule',{...input,branding:{...await readEnterpriseBranding(scope,input.locale),locale:input.locale}}),201)}
 if(action==='decision')return json(await decideEnterpriseArtifact(scope,actor,parseDecision(raw)))
 if(action==='publish'){const b=object(raw,['artifactId']);return json(await publishEnterprisePortal(scope,actor,uuid(b.artifactId)),201)}
 if(action==='revoke'){const b=object(raw,['kind','id']);if(!['portal','key','webhook','adapter','schedule'].includes(String(b.kind)))throw new OutcomeError('INVALID_ENTERPRISE_INPUT');return json(await revokeEnterpriseResource(scope,actor,b.kind as 'portal'|'key'|'webhook'|'adapter'|'schedule',uuid(b.id)))}
 if(action==='keys')return json(await createEnterpriseKey(scope,actor,parseEnterpriseKey(raw)),201)
 if(action==='webhooks'){const b=object(raw,['name','url','events']);return json(await createEnterpriseWebhook(scope,actor,b),201)}
 if(action==='adapters')return json(await createEnterpriseAdapter(scope,actor,parseAdapterConfig(raw)),201)
 if(action==='adapter-run'){const b=object(raw,['adapterId','promptIds']);if(!Array.isArray(b.promptIds)||!b.promptIds.length||b.promptIds.length>50)throw new OutcomeError('INVALID_ENTERPRISE_INPUT');return json(await createAdapterRun(scope,actor,uuid(b.adapterId),[...new Set(b.promptIds.map(uuid))]),201)}
 if(action==='draft-review'){
  const b=object(raw,['draftId']),sql=db();const[row]=await sql`select id,kind,artifact,evidence_hash,created_by,locale from visibility_drafts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and id=${uuid(b.draftId)}::uuid`;if(!row)missing()
  return json(await saveEnterpriseArtifact(scope,actor,'visibility_draft',{version:'visibility-approval.v1',draftId:row.id,kind:row.kind,artifact:row.artifact,evidenceHash:row.evidence_hash,locale:row.locale},String(row.id),String(row.created_by)),201)
 }
 if(action==='retry'){const b=object(raw,['deliveryId']);return json(await retryEnterpriseDelivery(scope,actor,uuid(b.deliveryId)))}
 return missing()
}catch(error){return enterpriseErrorResponse(error)}}
export async function publicEnterpriseApi(request:Request,clientId:string,resource:string){try{
 const methods:Record<string,string>={outcomes:'GET',visibility:'GET',reports:'GET',adapters:'GET',results:'POST'}
 if(methods[resource]!==request.method)throw new OutcomeError('ENTERPRISE_NOT_FOUND',404)
 const body=request.method==='POST'?await readOutcomeBody(request):'',scope=resource==='results'?'adapter:write':resource==='adapters'?'visibility:read':`${resource}:read` as 'outcomes:read'|'visibility:read'|'reports:read'
 const access=await authenticateEnterpriseApi(request,clientId,scope,body),params=new URL(request.url).searchParams
 let input:ReturnType<typeof parseAdapterObservation>|null=null,window:ReturnType<typeof parseOutcomeWindow>|null=null
 if(resource==='results'){if([...params].length)throw new OutcomeError('INVALID_ENTERPRISE_INPUT');let raw;try{raw=JSON.parse(body)}catch{throw new OutcomeError('INVALID_ENTERPRISE_INPUT')};input=parseAdapterObservation(raw);if(!access.adapterId)throw new OutcomeError('ENTERPRISE_SCOPE_REQUIRED',403)}
 else if(resource==='outcomes'){for(const key of params.keys())if(!['start','end'].includes(key)||params.getAll(key).length!==1)throw new OutcomeError('INVALID_ENTERPRISE_INPUT');window=parseOutcomeWindow(params)}
 else if(resource==='reports'){for(const key of params.keys())if(key!=='id'||params.getAll(key).length!==1)throw new OutcomeError('INVALID_ENTERPRISE_INPUT');if(params.has('id'))uuid(params.get('id'))}
 else if([...params].length)throw new OutcomeError('INVALID_ENTERPRISE_INPUT')
 if(resource==='adapters'&&!access.adapterId)throw new OutcomeError('ENTERPRISE_SCOPE_REQUIRED',403)
 // Bad input has no nonce/rate/business/provider side effects.
 await consumeEnterpriseApi(access,scope)
 if(resource==='results')return json({version:'v1',...await ingestAdapterObservation(access.scope,access.adapterId!,input!)},201)
 if(resource==='outcomes')return json({version:'v1',window,data:await loadOutcomeMeasurements(access.scope,window!)})
 if(resource==='visibility')return json({version:'v1',data:await loadVisibilityWorkspace(access.scope)})
 if(resource==='adapters')return json({version:'v1',runs:await readAdapterRuns(access.scope,access.adapterId!)})
 if(params.has('id')){const report=await readEnterpriseArtifact(access.scope,uuid(params.get('id')));if(!report||report.kind!=='executive_report')missing();return json({version:'v1',report})}
 const sql=db();const rows=await sql`select a.id,a.payload,a.content_hash,a.created_at,d.decision from enterprise_artifacts a left join enterprise_decisions d on d.artifact_id=a.id and d.account_id=a.account_id and d.client_id=a.client_id and d.content_hash=a.content_hash where a.account_id=${access.scope.accountId}::uuid and a.client_id=${access.scope.clientId}::uuid and a.kind='executive_report' order by a.created_at desc,a.id desc limit 20`
 return json({version:'v1',reports:rows})
}catch(error){return enterpriseErrorResponse(error)}}
