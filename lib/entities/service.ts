import 'server-only'
import { sanitizeDatabaseError } from '@/lib/observability/database-error'
import { getProfile } from '@/lib/auth'
import { ENTITY_BODY_LIMIT, normalizeEntityInput } from './schema'
import { loadEntity, loadOwnedEntityClient, saveEntity } from './store'

const statuses = {UNAUTHENTICATED:401, INVALID_ENTITY_INPUT:400, CLIENT_NOT_FOUND:404, ENTITY_CONFLICT:409, ENTITY_UNAVAILABLE:500} as const
export class EntityServiceError extends Error {
  readonly status: number
  constructor(readonly code: keyof typeof statuses) { super(code); this.name = 'EntityServiceError'; this.status = statuses[code] }
}

async function operation<T>(name: 'load' | 'save', work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    if (error instanceof EntityServiceError) throw error
    const diagnostic = sanitizeDatabaseError(error, {correlationId:crypto.randomUUID(),route:'/api/clients/[clientId]/entity'})
    console.error({event:'entity_operation_failed',operation:name,correlationId:diagnostic.correlationId,database:{code:diagnostic.code,category:diagnostic.category}})
    throw new EntityServiceError('ENTITY_UNAVAILABLE')
  }
}

async function owned(clientId: string) {
  const profile = await getProfile()
  if (!profile) throw new EntityServiceError('UNAUTHENTICATED')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) throw new EntityServiceError('INVALID_ENTITY_INPUT')
  const client = await loadOwnedEntityClient(profile.account_id, clientId)
  if (!client) throw new EntityServiceError('CLIENT_NOT_FOUND')
  return {profile, client}
}

export async function loadAuthenticatedEntityPage(clientId: string) {
  return operation('load', async () => {
    const {profile, client} = await owned(clientId)
    return {client, entity: await loadEntity(profile.account_id, clientId)}
  })
}

async function readInput(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new EntityServiceError('INVALID_ENTITY_INPUT')
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const {done,value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ENTITY_BODY_LIMIT) { await reader.cancel(); throw new Error('too large') }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength }
    return normalizeEntityInput(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)))
  } catch { throw new EntityServiceError('INVALID_ENTITY_INPUT') }
  finally { reader.releaseLock() }
}

export async function saveAuthenticatedEntity(clientId: string, request: Request) {
  return operation('save', async () => {
    const {profile} = await owned(clientId)
    const input = await readInput(request)
    const entity = await saveEntity(profile.account_id, clientId, profile.id, input)
    if (!entity) {
      if (!await loadOwnedEntityClient(profile.account_id, clientId)) throw new EntityServiceError('CLIENT_NOT_FOUND')
      throw new EntityServiceError('ENTITY_CONFLICT')
    }
    return entity
  })
}

export function entityJson(value: unknown, status = 200) {
  return Response.json(value, {status, headers:{'Cache-Control':'no-store'}})
}
export function entityErrorResponse(error: unknown) {
  const safe = error instanceof EntityServiceError ? error : new EntityServiceError('ENTITY_UNAVAILABLE')
  return entityJson({error:safe.code},safe.status)
}
