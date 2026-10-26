import 'server-only'
import { authorizeVisibilityClient } from './guard'
import { outcomeErrorResponse,outcomeHeaders } from '@/lib/outcome-integrations/guard'
import { readOutcomeJson } from '@/lib/outcome-integrations/request'
import { object,uuid,canonicalOutcomeUrl,OutcomeError } from '@/lib/outcome-integrations/input'
import { parseMonitoredQuery,parseVisibilityReview,parseVisibilityDraft } from './input'
import { createVisibilityDraft,loadVisibilityWorkspace,saveMonitoredQuery,saveVisibilityReview } from './store'
import { setVisibilityAutomation,enqueueVisibilitySource,retryVisibilityJob,saveVisibilityPageSnapshot } from './jobs'
import { validateVisibilityPage } from './page'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:outcomeHeaders})
export async function readVisibility(clientId:string) {
  try {
    const {scope}=await authorizeVisibilityClient(clientId),data=await loadVisibilityWorkspace(scope)
    if(!data)throw new OutcomeError('VISIBILITY_NOT_FOUND',404)
    return json(data)
  }catch(error){return outcomeErrorResponse(error)}
}
export async function mutateVisibility(clientId:string,action:string,request:Request) {
  try {
    const {scope,profile,client}=await authorizeVisibilityClient(clientId)
    const raw=await readOutcomeJson(request),domain=client.domain??''
    if(action==='queries')return json(await saveMonitoredQuery(scope,parseMonitoredQuery(raw,domain)))
    if(action==='reviews')return json(await saveVisibilityReview(scope,profile.id,parseVisibilityReview(raw)),201)
    if(action==='drafts')return json(await createVisibilityDraft(scope,profile.id,parseVisibilityDraft(raw)),201)
    if(action==='automation') {
      const body=object(raw,['enabled'])
      if(typeof body.enabled!=='boolean')throw new OutcomeError('INVALID_VISIBILITY_INPUT')
      return json(await setVisibilityAutomation(scope,profile.id,body.enabled))
    }
    if(action==='baseline') {
      const body=object(raw,['url']),url=canonicalOutcomeUrl(body.url,domain)
      const evidence=await validateVisibilityPage(url,domain)
      await saveVisibilityPageSnapshot(scope,evidence,'manual',profile.id)
      return json({evidence},201)
    }
    if(action==='revalidate') {
      const body=object(raw,['sourceKind','sourceId'])
      if(body.sourceKind!=='deployment'&&body.sourceKind!=='work_completion')throw new OutcomeError('INVALID_VISIBILITY_INPUT')
      return json(await enqueueVisibilitySource(scope,body.sourceKind,uuid(body.sourceId),profile.id),201)
    }
    if(action==='retry') {
      const body=object(raw,['jobId'])
      return json(await retryVisibilityJob(scope,uuid(body.jobId),profile.id))
    }
    throw new OutcomeError('VISIBILITY_NOT_FOUND',404)
  }catch(error){return outcomeErrorResponse(error)}
}
