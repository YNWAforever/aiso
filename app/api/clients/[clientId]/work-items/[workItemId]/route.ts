import { readAuthenticatedDraft, editAuthenticatedDraft, workItemResponse, workItemErrorResponse } from '@/lib/work-items/service'
type Context={params:Promise<{clientId:string;workItemId:string}>}
export async function GET(_request:Request,{params}:Context) {
 try {const {clientId,workItemId}=await params;return workItemResponse(await readAuthenticatedDraft(clientId,workItemId))}
 catch(error){return workItemErrorResponse(error)}
}
export async function PATCH(request:Request,{params}:Context) {
 try {const {clientId,workItemId}=await params;return workItemResponse(await editAuthenticatedDraft(clientId,workItemId,request))}
 catch(error){return workItemErrorResponse(error)}
}
