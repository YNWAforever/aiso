import { entityErrorResponse, entityJson, loadAuthenticatedEntityPage, saveAuthenticatedEntity } from '@/lib/entities/service'

type Context = {params: Promise<{clientId: string}>}

export async function GET(_request: Request, {params}: Context) {
  try {
    const {clientId} = await params
    const {entity} = await loadAuthenticatedEntityPage(clientId)
    return entityJson({entity})
  } catch (error) { return entityErrorResponse(error) }
}

export async function PUT(request: Request, {params}: Context) {
  try {
    const {clientId} = await params
    return entityJson({entity: await saveAuthenticatedEntity(clientId, request)})
  } catch (error) { return entityErrorResponse(error) }
}
