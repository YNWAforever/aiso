import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { parseReviewDecision } from '@/lib/approvals/input'
import { decideVersion } from '@/lib/approvals/decision-store'
import { parseSubmission, parseVersionQuery } from './input'
import { submitVersion, listVersions, readVersion } from './store'
import type { StoreResult } from './types'

const headers = {'Cache-Control':'no-store'}
function json(value: unknown, status = 200) { return Response.json(value,{status,headers}) }
function result<T>(value: StoreResult<T>, mutation = false, envelope = true): Response {
  if ('value' in value) return json(envelope ? {version:value.value} : value.value,mutation && value.kind === 'created' ? 201 : 200)
  const status = {not_found:404,denied:403,conflict:409,validation_failed:422}[value.kind]
  return json({error:`CHANGE_SET_${value.kind.toUpperCase()}`},status)
}
function errorResponse(error: unknown): Response {
  const message = (error as Error)?.message
  if (message === 'UNAUTHENTICATED') return json({error:'UNAUTHENTICATED'},401)
  if (message === 'APPROVAL_BODY_TOO_LARGE') return json({error:'CHANGE_SET_BODY_TOO_LARGE'},413)
  if (message === 'INVALID_APPROVAL_INPUT' || message === 'INVALID_CHANGE_SET_INPUT') return json({error:'INVALID_CHANGE_SET_INPUT'},400)
  if (message === 'REVIEW_VALIDATION_FAILED') return json({error:'CHANGE_SET_VALIDATION_FAILED'},422)
  return json({error:'CHANGE_SET_UNAVAILABLE'},503)
}
async function authenticate(...ids: string[]) {
  const profile = await getProfile()
  if (!profile) throw new Error('UNAUTHENTICATED')
  if (!ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new Error('INVALID_CHANGE_SET_INPUT')
  return profile
}
export async function submitAuthenticatedVersion(clientId: string, itemId: string, request: Request): Promise<Response> {
  try {
    const p = await authenticate(clientId,itemId)
    const input = parseSubmission(await readLimitedJson(request,4096))
    return result(await submitVersion(p.account_id,clientId,itemId,p.id,input.expectedRevision),true)
  } catch (error) { return errorResponse(error) }
}
export async function listAuthenticatedVersions(clientId: string, itemId: string, params: URLSearchParams): Promise<Response> {
  try {
    const p = await authenticate(clientId,itemId)
    return result(await listVersions(p.account_id,clientId,itemId,p.id,parseVersionQuery(params)),false,false)
  } catch (error) { return errorResponse(error) }
}
export async function readAuthenticatedVersion(clientId: string, itemId: string, versionId: string): Promise<Response> {
  try {
    const p = await authenticate(clientId,itemId,versionId)
    return result(await readVersion(p.account_id,clientId,itemId,versionId,p.id))
  } catch (error) { return errorResponse(error) }
}
export async function decideAuthenticatedVersion(clientId: string, itemId: string, versionId: string, request: Request): Promise<Response> {
  try {
    const p = await authenticate(clientId,itemId,versionId)
    const input = parseReviewDecision(await readLimitedJson(request,16384))
    return result(await decideVersion(p.account_id,clientId,itemId,versionId,p.id,input),true)
  } catch (error) { return errorResponse(error) }
}
