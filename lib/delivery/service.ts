import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { createDeliveryExport } from './export'
import { deliveryId, parseAttest, parseDeliveryQuery, parseExportFormat, parseWithdraw } from './input'
import { attestDelivery, readDelivery, readDeliveryVersion, withdrawDelivery } from './store'
import type { DeliveryResult, DeliveryScope } from './types'

const headers = { 'Cache-Control': 'no-store' }
const statuses = {
  DELIVERY_UNAUTHENTICATED: 401,
  DELIVERY_INVALID_INPUT: 400,
  DELIVERY_NOT_FOUND: 404,
  DELIVERY_DENIED: 403,
  DELIVERY_CONFLICT: 409,
  DELIVERY_NOT_APPROVED: 409,
  DELIVERY_BODY_TOO_LARGE: 413,
  DELIVERY_VALIDATION_FAILED: 422,
  DELIVERY_UNAVAILABLE: 503,
} as const
class DeliveryServiceError extends Error {
  constructor(readonly code: keyof typeof statuses) { super(code) }
}
function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers }) }
function errorResponse(error: unknown): Response {
  const code = error instanceof DeliveryServiceError ? error.code : 'DELIVERY_UNAVAILABLE'
  return json({ error: code }, statuses[code])
}
function failure(result: Exclude<DeliveryResult<unknown>, { value: unknown }>): Response {
  const codes = { not_found: 'DELIVERY_NOT_FOUND', denied: 'DELIVERY_DENIED', conflict: 'DELIVERY_CONFLICT', validation_failed: 'DELIVERY_VALIDATION_FAILED' } as const
  return errorResponse(new DeliveryServiceError(codes[result.kind]))
}
function parse<T>(parser: () => T): T {
  try { return parser() } catch { throw new DeliveryServiceError('DELIVERY_INVALID_INPUT') }
}
async function authenticate(clientId: string, itemId: string, versionId: string): Promise<DeliveryScope> {
  // Dependency exceptions remain 503; only an absent session is 401.
  const profile = await getProfile()
  if (!profile) throw new DeliveryServiceError('DELIVERY_UNAUTHENTICATED')
  const paths = parse(() => ({ clientId: deliveryId(clientId), itemId: deliveryId(itemId), versionId: deliveryId(versionId) }))
  // Invalid server-owned identity is an unavailable dependency, never caller input.
  let accountId: string, actorId: string
  try { accountId = deliveryId(profile.account_id); actorId = deliveryId(profile.id) }
  catch { throw new DeliveryServiceError('DELIVERY_UNAVAILABLE') }
  return { ...paths, accountId, actorId }
}
async function body(request: Request): Promise<unknown> {
  try { return await readLimitedJson(request, 16_384) }
  catch (error) {
    throw new DeliveryServiceError(error instanceof Error && error.message === 'APPROVAL_BODY_TOO_LARGE'
      ? 'DELIVERY_BODY_TOO_LARGE' : 'DELIVERY_INVALID_INPUT')
  }
}

export async function exportAuthenticatedDelivery(clientId: string, itemId: string, versionId: string, params: URLSearchParams): Promise<Response> {
  try {
    const scope = await authenticate(clientId, itemId, versionId)
    const format = parse(() => parseExportFormat(params))
    const result = await readDeliveryVersion(scope)
    if (!('value' in result)) return failure(result)
    let artifact
    try { artifact = createDeliveryExport(result.value, format) }
    catch (error) {
      throw new DeliveryServiceError(error instanceof Error && error.message === 'DELIVERY_NOT_APPROVED'
        ? 'DELIVERY_NOT_APPROVED' : 'DELIVERY_VALIDATION_FAILED')
    }
    return new Response(artifact.body, { headers: {
      ...headers,
      'Content-Type': artifact.contentType,
      'Content-Disposition': `attachment; filename="${artifact.filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'X-Aiso-Export-Sha256': artifact.exportHash,
    } })
  } catch (error) { return errorResponse(error) }
}

export async function listAuthenticatedDelivery(clientId: string, itemId: string, versionId: string, params: URLSearchParams): Promise<Response> {
  try {
    const scope = await authenticate(clientId, itemId, versionId)
    const query = parse(() => parseDeliveryQuery(params))
    const result = await readDelivery(scope, query)
    if (!('value' in result)) return failure(result)
    const { events, activeAttestationId, capabilities, nextCursor } = result.value
    return json({ events, activeAttestationId, capabilities, nextCursor })
  } catch (error) { return errorResponse(error) }
}

export async function attestAuthenticatedDelivery(clientId: string, itemId: string, versionId: string, request: Request): Promise<Response> {
  try {
    const scope = await authenticate(clientId, itemId, versionId)
    const raw = await body(request)
    const input = parse(() => parseAttest(raw))
    const result = await attestDelivery(scope, input)
    return 'value' in result ? json({ event: result.value }, result.kind === 'created' ? 201 : 200) : failure(result)
  } catch (error) { return errorResponse(error) }
}

export async function withdrawAuthenticatedDelivery(clientId: string, itemId: string, versionId: string, attestationId: string, request: Request): Promise<Response> {
  try {
    const scope = await authenticate(clientId, itemId, versionId)
    const target = parse(() => deliveryId(attestationId))
    const raw = await body(request)
    const input = parse(() => parseWithdraw(raw))
    const result = await withdrawDelivery(scope, target, input)
    return 'value' in result ? json({ event: result.value }, result.kind === 'created' ? 201 : 200) : failure(result)
  } catch (error) { return errorResponse(error) }
}
