import { listAuthenticatedDrafts, saveAuthenticatedDraft, workItemResponse, workItemErrorResponse } from '@/lib/work-items/service'
type Context={params:Promise<{clientId:string}>}
export async function GET(request:Request,{params}:Context) {
 try {const {clientId}=await params;return workItemResponse(await listAuthenticatedDrafts(clientId,new URL(request.url).searchParams))}
 catch(error){return workItemErrorResponse(error)}
}
export async function POST(request:Request,{params}:Context) {
 try {const {clientId}=await params;const result=await saveAuthenticatedDraft(clientId,request);return workItemResponse({item:result.item},result.created?201:200)}
 catch(error){return workItemErrorResponse(error)}
}
