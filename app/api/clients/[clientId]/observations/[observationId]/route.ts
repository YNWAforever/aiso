import {loadAuthenticatedObservationDetail,observationErrorResponse} from '@/lib/observations/service'
type Context={params:Promise<{clientId:string;observationId:string}>}
export async function GET(request:Request,{params}:Context):Promise<Response>{
  try{
    const {clientId,observationId}=await params
    const run = new URL(request.url).searchParams.get('run')
    const observation = run === null
      ? await loadAuthenticatedObservationDetail(clientId, observationId)
      : await loadAuthenticatedObservationDetail(clientId, observationId, run)
    return Response.json({observation},{headers:{'Cache-Control':'no-store'}})
  }catch(error){return observationErrorResponse(error)}
}
