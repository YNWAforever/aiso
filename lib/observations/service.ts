import 'server-only'

import { getProfile } from '@/lib/auth'
import { sanitizeDatabaseError } from '@/lib/observability/database-error'
import { parseObservationQuery } from '@/lib/observations/query'
import { loadObservationSnapshot } from '@/lib/observations/store'
import type { ObservationResponse } from '@/lib/observations/types'

const statuses = {
  INVALID_OBSERVATION_QUERY: 400,
  UNAUTHENTICATED: 401,
  CLIENT_NOT_FOUND: 404,
  OBSERVATIONS_UNAVAILABLE: 503,
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ObservationServiceError extends Error {
  readonly status: number

  constructor(readonly code: keyof typeof statuses) {
    super(code)
    this.name = 'ObservationServiceError'
    this.status = statuses[code]
  }
}

export async function loadAuthenticatedObservations(
  clientId: string,
  params: URLSearchParams,
): Promise<ObservationResponse> {
  try {
    const profile = await getProfile()
    if (!profile) throw new ObservationServiceError('UNAUTHENTICATED')
    if (!UUID.test(clientId)) throw new ObservationServiceError('INVALID_OBSERVATION_QUERY')

    let query
    try {
      query = parseObservationQuery(params)
    } catch {
      throw new ObservationServiceError('INVALID_OBSERVATION_QUERY')
    }

    const snapshot = await loadObservationSnapshot(profile.account_id, clientId, query)
    if (!snapshot) throw new ObservationServiceError('CLIENT_NOT_FOUND')
    return snapshot
  } catch (error) {
    if (error instanceof ObservationServiceError) throw error
    const diagnostic = sanitizeDatabaseError(error, {
      correlationId: crypto.randomUUID(),
      route: '/api/clients/[clientId]/observations',
    })
    console.error({
      event: 'observation_operation_failed',
      operation: 'load',
      correlationId: diagnostic.correlationId,
      database: { code: diagnostic.code, category: diagnostic.category },
    })
    throw new ObservationServiceError('OBSERVATIONS_UNAVAILABLE')
  }
}

function observationJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function observationErrorResponse(error: unknown): Response {
  const safe = error instanceof ObservationServiceError
    ? error
    : new ObservationServiceError('OBSERVATIONS_UNAVAILABLE')
  return observationJson({ error: safe.code }, safe.status)
}
