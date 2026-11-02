import type {
  StudioThreadCreateInput,
  StudioThreadDetail,
  StudioThreadRecord,
  StudioTurnCreateInput,
  StudioTurnLiveInput,
  StudioTurnRecord,
} from './threads-types'

export type StudioRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }

function base(clientId: string) {
  return `/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/threads`
}

async function request<T>(url: string, init?: RequestInit): Promise<StudioRequestResult<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store', ...init })
    const data = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) {
      return { ok: false, status: response.status, error: typeof data?.error === 'string' ? data.error : 'REQUEST_FAILED' }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, status: 503, error: 'STUDIO_THREADS_UNAVAILABLE' }
  }
}

export function fetchStudioThreads(clientId: string, signal?: AbortSignal) {
  return request<{ threads: StudioThreadRecord[]; truncated: boolean }>(base(clientId), { signal })
}

export function fetchStudioThread(clientId: string, threadId: string, signal?: AbortSignal) {
  return request<StudioThreadDetail>(`${base(clientId)}/${encodeURIComponent(threadId)}`, { signal })
}

export function createStudioThread(clientId: string, input: StudioThreadCreateInput) {
  return request<{ thread: StudioThreadRecord }>(base(clientId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function appendStudioTurn(clientId: string, threadId: string, input: StudioTurnCreateInput) {
  return request<{ turn: StudioTurnRecord }>(`${base(clientId)}/${encodeURIComponent(threadId)}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function finalizeStudioTurn(clientId: string, threadId: string, position: number, live: StudioTurnLiveInput) {
  return request<{ turn: StudioTurnRecord }>(`${base(clientId)}/${encodeURIComponent(threadId)}/turns`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, live }),
  })
}
