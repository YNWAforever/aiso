import { afterEach, expect, it, vi } from 'vitest'
import type { StudioReply } from '@/lib/conversation-studio/types'
import {
  appendStudioTurn,
  createStudioThread,
  fetchStudioThread,
  fetchStudioThreads,
  finalizeStudioTurn,
} from '@/lib/conversation-studio/threads-client'

const clientId = '11111111-1111-4111-8111-111111111111'
const threadId = '44444444-4444-4444-8444-444444444444'
const reply = {
  status: 'insufficient',
  template: null,
  observations: [],
  scan: null,
  researchSteps: [],
  coverage: { pulse: 'missing', citations: 'missing', scan: 'missing', live: 'missing' },
} as StudioReply

afterEach(() => vi.unstubAllGlobals())

it('talks only to the owned client thread endpoints with no-store cache', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Response.json({ threads: [], truncated: false })
  }))
  expect(await fetchStudioThreads(clientId)).toEqual({ ok: true, data: { threads: [], truncated: false } })
  expect(calls[0]).toEqual({ url: `/api/dashboard/clients/${clientId}/studio/threads`, init: { cache: 'no-store', signal: undefined } })
})

it('maps create, read, append and LIVE finalize payloads', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Response.json({ thread: { id: threadId }, turns: [], turn: { id: 'turn', position: 0 } })
  }))
  await createStudioThread(clientId, { kind: 'research', title: 'Goal', goal: 'Goal', week: null, sourceTitle: null })
  await fetchStudioThread(clientId, threadId)
  await appendStudioTurn(clientId, threadId, { prompt: 'Question', task: null, reply, attached: null })
  await finalizeStudioTurn(clientId, threadId, 0, { error: 'PROVIDER_UNAVAILABLE' })
  expect(calls.map(call => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
    `POST /api/dashboard/clients/${clientId}/studio/threads`,
    `GET /api/dashboard/clients/${clientId}/studio/threads/${threadId}`,
    `POST /api/dashboard/clients/${clientId}/studio/threads/${threadId}/turns`,
    `PATCH /api/dashboard/clients/${clientId}/studio/threads/${threadId}/turns`,
  ])
  expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ prompt: 'Question', reply })
  expect(JSON.parse(String(calls[3].init?.body))).toEqual({ position: 0, live: { error: 'PROVIDER_UNAVAILABLE' } })
})

it('returns the server error without pretending a write succeeded', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'STUDIO_THREAD_FULL' }, { status: 409 })))
  expect(await appendStudioTurn(clientId, threadId, { prompt: 'Question', task: null, reply, attached: null }))
    .toEqual({ ok: false, status: 409, error: 'STUDIO_THREAD_FULL' })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  expect(await fetchStudioThreads(clientId)).toEqual({ ok: false, status: 503, error: 'STUDIO_THREADS_UNAVAILABLE' })
})
