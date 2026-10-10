import {loadAuthenticatedObservationDetail,observationErrorResponse} from '@/lib/observations/service'
type Context={params:Promise<{clientId:string;observationId:string}>}
export async function GET(_request:Request,{params}:Context):Promise<Response>{
  try{
    const {clientId,observationId}=await params
    const observation=await loadAuthenticatedObservationDetail(clientId,observationId)
    return Response.json({observation},{headers:{'Cache-Control':'no-store'}})
  }catch(error){return observationErrorResponse(error)}
}
