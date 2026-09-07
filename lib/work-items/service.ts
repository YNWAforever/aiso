import { buildInitialDraftSnapshot } from './snapshot'
import 'server-only'
import { getProfile } from '@/lib/auth'
import { opportunityKey } from '@/lib/opportunities/fingerprint'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import type { DraftSnapshotV1 } from '@/lib/opportunities/types'
import { CREATE_DRAFT_BODY_LIMIT, EDIT_DRAFT_BODY_LIMIT, parseCreateDraft, parseDraftEdit } from './schema'
import { parseWorkItemListQuery } from './query'
import { loadOwnedDraftClient, loadOwnedDraftSource, findOwnedDraft, createDraftIfEvidenceCurrent, updateOwnedDraft, readOwnedDraft, listOwnedDrafts } from './store'

const statuses={UNAUTHENTICATED:401,INVALID_WORK_ITEM_INPUT:400,CLIENT_NOT_FOUND:404,WORK_ITEM_NOT_FOUND:404,EVIDENCE_CHANGED:409,WORK_ITEM_CONFLICT:409,WORK_ITEMS_UNAVAILABLE:503} as const
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class WorkItemServiceError extends Error {
 readonly status:number
 constructor(readonly code:keyof typeof statuses){super(code);this.name='WorkItemServiceError';this.status=statuses[code]}
}
async function safely<T>(operation:()=>Promise<T>):Promise<T> {
 try{return await operation()}catch(error){
  if(error instanceof WorkItemServiceError)throw error
  console.error({event:'work_items_unavailable'})
  throw new WorkItemServiceError('WORK_ITEMS_UNAVAILABLE')
 }
}
function parse<T>(read:()=>T):T {try{return read()}catch{throw new WorkItemServiceError('INVALID_WORK_ITEM_INPUT')}}
async function owned(clientId:string,itemId?:string) {
 const profile=await getProfile()
 if(!profile)throw new WorkItemServiceError('UNAUTHENTICATED')
 if(!UUID.test(clientId)||(itemId!==undefined&&!UUID.test(itemId)))throw new WorkItemServiceError('INVALID_WORK_ITEM_INPUT')
 if(!await loadOwnedDraftClient(profile.account_id,clientId))throw new WorkItemServiceError('CLIENT_NOT_FOUND')
 return profile
}
async function body(request:Request,limit:number):Promise<unknown> {
 const reader=request.body?.getReader()
 if(!reader)throw new WorkItemServiceError('INVALID_WORK_ITEM_INPUT')
 const chunks:Uint8Array[]=[];let size=0
 try {
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength
   if(size>limit){await reader.cancel();throw new WorkItemServiceError('INVALID_WORK_ITEM_INPUT')}
   chunks.push(value)
  }
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }catch{throw new WorkItemServiceError('INVALID_WORK_ITEM_INPUT')}finally{reader.releaseLock()}
}
export async function saveAuthenticatedDraft(clientId:string,request:Request) {
 return safely(async()=>{
  const profile=await owned(clientId)
  const value=await body(request,CREATE_DRAFT_BODY_LIMIT)
  const input=parse(()=>parseCreateDraft(value))
  const existing=await findOwnedDraft(profile.account_id,clientId,opportunityKey(input.ruleVersion,input.source))
  if(existing)return {item:existing,created:false}
  const selected=await loadOwnedDraftSource(profile.account_id,clientId,input.source)
  const suggestion=selected&&deriveSuggestions(selected.source).find(item=>item.key===opportunityKey(input.ruleVersion,input.source))
  if(!selected||!suggestion||suggestion.fingerprint!==input.fingerprint)throw new WorkItemServiceError('EVIDENCE_CHANGED')
  let snapshot:DraftSnapshotV1
  try{snapshot=buildInitialDraftSnapshot(suggestion,selected.source,input.locale)}catch{throw new WorkItemServiceError('EVIDENCE_CHANGED')}
  const result=await createDraftIfEvidenceCurrent(profile.account_id,clientId,profile.id,input,snapshot,selected.version)
  if(result)return result
  if(!await loadOwnedDraftClient(profile.account_id,clientId))throw new WorkItemServiceError('CLIENT_NOT_FOUND')
  throw new WorkItemServiceError('EVIDENCE_CHANGED')
 })
}
export async function editAuthenticatedDraft(clientId:string,itemId:string,request:Request) {
 return safely(async()=>{
  const profile=await owned(clientId,itemId)
  const value=await body(request,EDIT_DRAFT_BODY_LIMIT)
  const input=parse(()=>parseDraftEdit(value))
  const item=await updateOwnedDraft(profile.account_id,clientId,itemId,profile.id,input)
  if(item)return {item}
  if(!await readOwnedDraft(profile.account_id,clientId,itemId))throw new WorkItemServiceError('WORK_ITEM_NOT_FOUND')
  throw new WorkItemServiceError('WORK_ITEM_CONFLICT')
 })
}
export async function listAuthenticatedDrafts(clientId:string,params:URLSearchParams) {
 return safely(async()=>{
  const profile=await owned(clientId)
  return listOwnedDrafts(profile.account_id,clientId,parse(()=>parseWorkItemListQuery(params)))
 })
}
export async function readAuthenticatedDraft(clientId:string,itemId:string) {
 return safely(async()=>{
  const profile=await owned(clientId,itemId)
  const item=await readOwnedDraft(profile.account_id,clientId,itemId)
  if(!item)throw new WorkItemServiceError('WORK_ITEM_NOT_FOUND')
  return {item}
 })
}
export function workItemResponse(value:unknown,status=200) {return Response.json(value,{status,headers:{'Cache-Control':'no-store'}})}
export function workItemErrorResponse(error:unknown) {
 const safe=error instanceof WorkItemServiceError?error:new WorkItemServiceError('WORK_ITEMS_UNAVAILABLE')
 return workItemResponse({error:safe.code},safe.status)
}
