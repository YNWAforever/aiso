import { scanUrlFor } from './skill-actions'

export type StudioActionId = 'scan_brand' | 'improve_page' | 'monthly_report'
export type ActionScope = { skillId: StudioActionId; clientId: string; scanId?: string; month?: string; domain?: string }
export type ActionOutcome = { phase: 'done' | 'pending' | 'unknown' | 'rejected'; scope: ActionScope }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** One explicit operation, one POST. A lost acknowledgement is never permission to repeat it. */
export async function requestStudioAction(scope: ActionScope, request: typeof fetch = fetch): Promise<ActionOutcome> {
  const unknown: ActionOutcome = { phase: 'unknown', scope }
  try {
    const path = `/api/clients/${encodeURIComponent(scope.clientId)}`
    const headers = { 'Content-Type': 'application/json' }
    const init: RequestInit = { method: 'POST', signal: AbortSignal.timeout(65_000) }
    const response = scope.skillId === 'scan_brand'
      ? await request('/api/scan', { ...init, headers, body: JSON.stringify({ url: scanUrlFor(scope.domain ?? ''), clientId: scope.clientId }) })
      : scope.skillId === 'improve_page'
        ? await request(`${path}/agents/generate`, { ...init, headers, body: JSON.stringify({ scanId: scope.scanId }) })
        : await request(`${path}/months/${encodeURIComponent(scope.month ?? '')}`, init)
    if (response.status === 403) return { phase: 'rejected', scope }
    if (response.status === 202) return { phase: 'pending', scope }
    if (!response.ok) return unknown
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') return unknown
    const body = data as Record<string, unknown>
    if (scope.skillId === 'scan_brand') return typeof body.id === 'string' && uuid.test(body.id) ? { phase: 'done', scope: { ...scope, scanId: body.id } } : unknown
    if (scope.skillId === 'improve_page') return body.scanId === scope.scanId && body.state === 'complete' ? { phase: 'done', scope } : unknown
    return Array.isArray(body.recorded) && body.recorded.every(item => typeof item === 'string') ? { phase: 'done', scope } : unknown
  } catch { return unknown }
}

/** Exact result links only when the acknowledged/submitted identity is known. */
export function studioActionHref(scope: ActionScope, language: string): string {
  const base = `/${language}/dashboard/${encodeURIComponent(scope.clientId)}`
  if (scope.skillId === 'monthly_report') return `${base}/month?m=${encodeURIComponent(scope.month ?? '')}`
  return `${base}?step=${scope.skillId === 'scan_brand' ? 'results' : 'improve'}${scope.scanId ? '&scanId=' + encodeURIComponent(scope.scanId) : ''}`
}
