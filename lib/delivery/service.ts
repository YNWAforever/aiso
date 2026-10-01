import 'server-only'
import { getProfile } from '@/lib/auth'
import { isAttributionEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { ProfileWithAccount } from '@/lib/types'
import { readLimitedJson } from '@/lib/approvals/request'
import { createDeliveryExport, EXPORT_RENDERER_VERSION } from './export'
import { deliveryId, parseAttest, parseDeliveryQuery, parseExportFormat, parseWithdraw } from './input'
import { attestDelivery, readDelivery, readDeliveryVersion, recordExportEvent, withdrawDelivery } from './store'
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
  // The one failure that names its reason: the owner picked a page this brand has
  // not registered (or that another brand owns), and nothing was written.
  if (result.kind === 'unknown_page') return json({ error: 'DELIVERY_VALIDATION_FAILED', reason: 'unknown_page' }, statuses.DELIVERY_VALIDATION_FAILED)
  const codes = { not_found: 'DELIVERY_NOT_FOUND', denied: 'DELIVERY_DENIED', conflict: 'DELIVERY_CONFLICT', validation_failed: 'DELIVERY_VALIDATION_FAILED' } as const
  return errorResponse(new DeliveryServiceError(codes[result.kind]))
}
function parse<T>(parser: () => T): T {
  try { return parser() } catch { throw new DeliveryServiceError('DELIVERY_INVALID_INPUT') }
}
async function authenticate(clientId: string, itemId: string, versionId: string): Promise<DeliveryScope> {
  return (await session(clientId, itemId, versionId)).scope
}
async function session(clientId: string, itemId: string, versionId: string): Promise<{ scope: DeliveryScope; profile: ProfileWithAccount }> {
  // Dependency exceptions remain 503; only an absent session is 401.
  const profile = await getProfile()
  if (!profile) throw new DeliveryServiceError('DELIVERY_UNAUTHENTICATED')
  const paths = parse(() => ({ clientId: deliveryId(clientId), itemId: deliveryId(itemId), versionId: deliveryId(versionId) }))
  // Invalid server-owned identity is an unavailable dependency, never caller input.
  let accountId: string, actorId: string
  try { accountId = deliveryId(profile.account_id); actorId = deliveryId(profile.id) }
  catch { throw new DeliveryServiceError('DELIVERY_UNAVAILABLE') }
  return { scope: { ...paths, accountId, actorId }, profile }
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
    // Record the receipt BEFORE handing the bytes over. The artifact hash used to
    // be computed, returned in a header and discarded, so nothing recorded that an
    // approved package had left the system. A failure here fails the export: a 2xx
    // must mean the write happened, and approved content leaving with no receipt
    // is exactly what this prevents.
    let recorded: boolean
    try {
      recorded = await recordExportEvent(scope, {
        contentHash: result.value.contentHash,
        artifactHash: artifact.exportHash,
        format,
        rendererVersion: EXPORT_RENDERER_VERSION,
        // The DOWNLOADER, not the submitter. 045 ties actor->>'profileId' to
        // actor_id, so naming the submitter here would both misattribute the
        // download and fail the constraint whenever the two differ.
        actor: { profileId: scope.actorId, displayName: null, role: 'account_member' },
      })
    } catch { throw new DeliveryServiceError('DELIVERY_UNAVAILABLE') }
    // Zero rows means the version no longer matches the payload we just rendered.
    if (!recorded) throw new DeliveryServiceError('DELIVERY_CONFLICT')

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
    const { scope, profile } = await session(clientId, itemId, versionId)
    const raw = await body(request)
    // With attribution off (flag or plan) the measure is not part of the API at
    // all: it is removed before parsing, so a stale or newer client can neither
    // fail delivery with it nor have it recorded.
    const input = parse(() => parseAttest(measuresEnabled(profile) ? raw : withoutMeasure(raw)))
    const result = await attestDelivery(scope, input)
    return 'value' in result ? json({ event: result.value }, result.kind === 'created' ? 201 : 200) : failure(result)
  } catch (error) { return errorResponse(error) }
}

function measuresEnabled(profile: ProfileWithAccount): boolean {
  return isAttributionEnabled() && resolveCommercialEntitlement(profile.accounts).features.search_console
}
function withoutMeasure(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, 'measure')) return raw
  const { measure: _ignored, ...rest } = raw as Record<string, unknown>
  void _ignored
  return rest
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
