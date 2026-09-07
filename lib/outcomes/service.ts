import 'server-only'

import { getProfile } from '@/lib/auth'
import { deliveryId } from '@/lib/delivery/input'
import { parseOutcomeResponse } from './dto'
import { evaluateOutcomes } from './evaluate'
import { readOutcomeInput } from './store'
import type { OutcomeScope } from './types'

const headers = { 'Cache-Control': 'private, no-store' }
const statuses = {
  OUTCOMES_INVALID_INPUT: 400,
  OUTCOMES_UNAUTHENTICATED: 401,
  OUTCOMES_DENIED: 403,
  OUTCOMES_NOT_FOUND: 404,
  OUTCOMES_UNAVAILABLE: 503,
} as const

class OutcomeServiceError extends Error {
  constructor(readonly code: keyof typeof statuses) {
    super(code)
    this.name = 'OutcomeServiceError'
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers })
}

function errorResponse(error: unknown): Response {
  const code = error instanceof OutcomeServiceError ? error.code : 'OUTCOMES_UNAVAILABLE'
  return json({ error: code }, statuses[code])
}

function unavailable(category: 'authentication' | 'read' | 'projection'): OutcomeServiceError {
  // Never log driver messages, SQL, identities, source rows, or retained evidence.
  console.error({ event: 'outcomes_unavailable', category })
  return new OutcomeServiceError('OUTCOMES_UNAVAILABLE')
}

async function authenticate(params: {
  clientId: string
  workItemId: string
  versionId: string
}): Promise<OutcomeScope> {
  let profile
  try { profile = await getProfile() }
  catch { throw unavailable('authentication') }
  if (!profile) throw new OutcomeServiceError('OUTCOMES_UNAUTHENTICATED')

  let clientId: string, itemId: string, versionId: string
  try {
    clientId = deliveryId(params.clientId)
    itemId = deliveryId(params.workItemId)
    versionId = deliveryId(params.versionId)
  } catch {
    throw new OutcomeServiceError('OUTCOMES_INVALID_INPUT')
  }

  let accountId: string, actorId: string
  try {
    accountId = deliveryId(profile.account_id)
    actorId = deliveryId(profile.id)
  } catch {
    throw unavailable('authentication')
  }
  return { accountId, actorId, clientId, itemId, versionId }
}

export async function getOutcomes(
  request: Request,
  params: { clientId: string; workItemId: string; versionId: string },
): Promise<Response> {
  try {
    const scope = await authenticate(params)
    if (new URL(request.url).searchParams.size !== 0) {
      throw new OutcomeServiceError('OUTCOMES_INVALID_INPUT')
    }

    let result
    try { result = await readOutcomeInput(scope) }
    catch { throw unavailable('read') }
    if (!('value' in result)) {
      if (result.kind === 'not_found') throw new OutcomeServiceError('OUTCOMES_NOT_FOUND')
      if (result.kind === 'denied') throw new OutcomeServiceError('OUTCOMES_DENIED')
      throw unavailable('read')
    }

    const value = result.value
    if (value.clientId !== scope.clientId || value.itemId !== scope.itemId || value.versionId !== scope.versionId) {
      throw unavailable('projection')
    }
    try {
      return json(parseOutcomeResponse(evaluateOutcomes(value)))
    } catch {
      throw unavailable('projection')
    }
  } catch (error) {
    return errorResponse(error)
  }
}
