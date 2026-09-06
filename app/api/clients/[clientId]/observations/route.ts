import type { NextRequest } from 'next/server'

import {
  loadAuthenticatedObservations,
  observationErrorResponse,
} from '@/lib/observations/service'

type Context = { params: Promise<{ clientId: string }> }

export async function GET(request: NextRequest, { params }: Context): Promise<Response> {
  try {
    const { clientId } = await params
    const observations = await loadAuthenticatedObservations(clientId, request.nextUrl.searchParams)
    return Response.json(observations, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return observationErrorResponse(error)
  }
}
