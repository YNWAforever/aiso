import { requireApiAdmin } from '@/lib/admin-guard'
import { parseApproverAccess } from './input'
import { listApproverAccess, mutateApproverAccess, parseAccessQuery } from './access-store'
import { approvalErrorResponse, readLimitedJson } from './request'
import type { StoreResult } from '@/lib/change-sets/types'

const headers = { 'Cache-Control': 'no-store' }

function response<T>(result: StoreResult<T>, createdStatus = 200): Response {
  if ('value' in result) return Response.json(result.value, { status: result.kind === 'created' ? createdStatus : 200, headers })
  const statuses = { denied: 403, not_found: 404, conflict: 409, validation_failed: 400 }
  return Response.json({ error: `APPROVAL_${result.kind.toUpperCase()}` }, { status: statuses[result.kind], headers })
}
export async function getApproverAccess(accountId: string, params: URLSearchParams): Promise<Response> {
  try {
    const auth = await requireApiAdmin()
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store')
      return auth.response
    }
    return response(await listApproverAccess(auth.profile.id, accountId, parseAccessQuery(params)))
  } catch (error) { return approvalErrorResponse(error) }
}
export async function changeApproverAccess(accountId: string, request: Request): Promise<Response> {
  try {
    const auth = await requireApiAdmin()
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store')
      return auth.response
    }
    const input = parseApproverAccess(await readLimitedJson(request, 16 * 1024))
    return response(await mutateApproverAccess(auth.profile.id, accountId, input), 201)
  } catch (error) { return approvalErrorResponse(error) }
}
