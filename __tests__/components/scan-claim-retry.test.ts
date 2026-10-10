import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import * as claimReturn from '@/components/result/ClaimScanOnReturn'
import { CLAIM_INTENT_COOKIE } from '@/lib/security/scan-claim-intent'
import type { Scan } from '@/lib/types'

const state = vi.hoisted(() => ({
  account: null as string | null, failNextUpdate: false, loseNextClaimResponse: false,
  attempts: new Set<string>(), calls: [] as string[], cookie: '',
  slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>,
  navigate: vi.fn(), replace: vi.fn(), track: vi.fn(),
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = initial
    return [state.slots[index], (value: unknown) => { state.slots[index] = value }]
  },
  useRef(initial: unknown) {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = { current: initial }
    return state.slots[index]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { state.effects.push(effect) },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams('claim=1'),
  notFound: () => { throw new Error('NOT_FOUND') },
}))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/lib/funnel-client', () => ({ trackFunnelEvent: state.track }))
vi.mock('@/components/result/ResultClient', () => ({ ResultClient: () => null }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => ({ account_id: 'owner-account' }) }))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: async () => ({ allowed: true, remaining: 4, resetAt: 2_000_000_000 }),
}))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join('?')
  if (query.includes('insert into scan_claim_attempts')) {
    const attempt = String(values[0])
    if (state.attempts.has(attempt)) return []
    state.attempts.add(attempt)
    return [{ attempt_id: attempt }]
  }
  if (query.includes('update scans')) {
    if (state.failNextUpdate) { state.failNextUpdate = false; throw new Error('Local fixture write failure') }
    if (state.account !== null) return []
    state.account = String(values[0])
    return [{ id: values[1] }]
  }
  if (query.includes('select id, account_id')) return [{ id: values[0], account_id: state.account }]
  if (query.includes('select account_id')) return [{ account_id: state.account }]
  if (query.includes('select * from scans')) return [{ id: values[0], account_id: state.account,
    domain: 'example.com', url: 'https://example.com', score: 62, grade: 'C', industry: null, region: null,
    created_at: '2026-10-08T00:00:00Z', results: {
      c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: 'PRIVATE_OWNER_EVIDENCE' },
    } }]
  throw new Error('Unexpected local fixture query')
} }))
import { POST as prepareIntent } from '@/app/api/scans/[id]/claim-intent/route'
import { POST as claimScan } from '@/app/api/scans/[id]/claim/route'
import ResultPage from '@/app/[lang]/result/[id]/page'

const scanId = '11111111-1111-4111-8111-111111111111'
async function localRequest(input: string, init?: RequestInit) {
  state.calls.push(input)
  const headers = new Headers(init?.headers)
  if (state.cookie) headers.set('cookie', `${CLAIM_INTENT_COOKIE}=${state.cookie}`)
  const request = new NextRequest(new Request(`https://aiso.test${input}`, { ...init, headers }))
  const context = { params: Promise.resolve({ id: scanId }) }
  const response: NextResponse = input.endsWith('/claim-intent')
    ? await prepareIntent(request, context) : await claimScan(request, context)
  if (input.endsWith('/claim') && response.ok && state.loseNextClaimResponse) {
    state.loseNextClaimResponse = false
    throw new Error('Response lost after the local claim committed')
  }
  const cookie = response.cookies.get(CLAIM_INTENT_COOKIE)
  if (cookie) state.cookie = cookie.value
  return response
}
beforeEach(async () => {
  state.account = null; state.failNextUpdate = false; state.loseNextClaimResponse = false; state.cookie = ''
  state.attempts.clear(); state.calls.length = 0
  state.slots = []; state.cursor = 0; state.effects = []
  state.navigate.mockClear(); state.replace.mockClear(); state.track.mockClear()
  vi.stubEnv('REPORT_SHARE_SECRET', 'local-test-signing-secret-that-is-long-enough')
  vi.stubGlobal('fetch', localRequest)
  vi.stubGlobal('window', { location: { replace: state.navigate },
    requestAnimationFrame: (callback: () => void) => { callback(); return 1 }, cancelAnimationFrame: vi.fn() })
  await localRequest(`/api/scans/${scanId}/claim-intent`, { method: 'POST', body: JSON.stringify({ lang: 'en' }) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

type Element = ReactElement<{ children?: ReactNode; role?: string; onClick?: () => void }>
function nodes(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement(child)
    ? [child as Element, ...nodes((child as Element).props.children)] : [])
}
function mountClaim(lang = 'en') {
  const render = () => { state.cursor = 0; return claimReturn.ClaimScanOnReturn({ scanId, lang }) }
  render()
  const mountedEffects = state.effects.splice(0)
  mountedEffects.forEach(effect => effect())
  return {
    message: () => nodes(render()).find(node => node.props.role === 'status')?.props.children,
    retry: () => {
      const button = nodes(render()).find(node => node.type === 'button')
      expect(button).toBeDefined()
      button!.props.onClick!()
    },
  }
}

async function canonicalResult(lang = 'en') {
  const page = await ResultPage({ params: Promise.resolve({ id: scanId, lang }) })
  return (page as ReactElement<{ fullScan?: Scan }>).props
}

describe('scan claim retry after a consumed attempt', () => {
  it('renews the signed intent after a failed write and then claims once successfully', async () => {
    expect(claimReturn.requestScanClaim).toBeTypeOf('function')
    state.failNextUpdate = true
    const first = await claimReturn.requestScanClaim(scanId, 'en')
    expect(first.status).toBe(500)
    expect(state.account).toBeNull()
    expect(state.attempts.size).toBe(1)

    const retry = await claimReturn.requestScanClaim(scanId, 'en', true)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(state.attempts.size).toBe(2)
    expect(state.account).toBe('owner-account')
    expect(state.calls).toEqual([
      `/api/scans/${scanId}/claim-intent`, `/api/scans/${scanId}/claim`,
      `/api/scans/${scanId}/claim-intent`, `/api/scans/${scanId}/claim`,
    ])
  })

  it('preserves the existing owner readback on the initial signed claim', async () => {
    expect(claimReturn.requestScanClaim).toBeTypeOf('function')
    state.account = 'owner-account'
    const response = await claimReturn.requestScanClaim(scanId, 'en')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
  })

  it('preserves denial when another account wins the initial claim race', async () => {
    expect(claimReturn.requestScanClaim).toBeTypeOf('function')
    state.account = 'foreign-account'
    const response = await claimReturn.requestScanClaim(scanId, 'en')
    expect(response.status).toBe(409)
    expect(state.account).toBe('foreign-account')
  })

  it('does not replay a spent token when renewal is refused for a foreign-owned report', async () => {
    expect(claimReturn.requestScanClaim).toBeTypeOf('function')
    state.failNextUpdate = true
    expect((await claimReturn.requestScanClaim(scanId, 'en')).status).toBe(500)
    state.account = 'foreign-account'
    const response = await claimReturn.requestScanClaim(scanId, 'en', true)
    expect(response.status).toBe(409)
    expect(state.attempts.size).toBe(1)
    expect(state.account).toBe('foreign-account')
    expect(state.calls.filter(path => path.endsWith('/claim'))).toHaveLength(1)
  })

  it.each(['en', 'zh-HK'])('rechecks the canonical result after a successful claim response was lost (%s)', async lang => {
    state.loseNextClaimResponse = true
    const view = mountClaim(lang)
    await vi.waitFor(() => expect(view.message()).toBe('claim_failed'))
    expect(state.account).toBe('owner-account')
    expect(state.attempts.size).toBe(1)
    state.track.mockClear()

    view.retry()
    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledWith(`/${lang}/result/${scanId}`))
    expect(view.message()).not.toBe('report_saved')
    expect(view.message()).not.toBe('scan_conflict')
    expect(state.replace).not.toHaveBeenCalled()
    expect(state.track.mock.calls.map(([event]) => event.name)).toEqual(['scan_retry_clicked'])
    expect(state.calls.filter(path => path.endsWith('/claim'))).toHaveLength(1)
    expect(state.attempts.size).toBe(1)
    expect((await canonicalResult(lang)).fullScan?.account_id).toBe('owner-account')
  })

  it('makes the same neutral navigation for a foreign-owned renewal and the server withholds its evidence', async () => {
    state.failNextUpdate = true
    const view = mountClaim()
    await vi.waitFor(() => expect(view.message()).toBe('claim_failed'))
    state.account = 'foreign-account'
    state.track.mockClear()

    view.retry()
    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledWith(`/en/result/${scanId}`))
    expect(view.message()).not.toBe('report_saved')
    expect(view.message()).not.toBe('scan_conflict')
    expect(state.track.mock.calls.map(([event]) => event.name)).toEqual(['scan_retry_clicked'])
    expect(state.attempts.size).toBe(1)
    expect(state.calls.filter(path => path.endsWith('/claim'))).toHaveLength(1)
    const result = await canonicalResult()
    expect(result.fullScan).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OWNER_EVIDENCE')
    expect(state.account).toBe('foreign-account')
  })

  it('keeps an actual claim conflict visible when another account wins after successful renewal', async () => {
    state.failNextUpdate = true
    const view = mountClaim()
    await vi.waitFor(() => expect(view.message()).toBe('claim_failed'))
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const response = await localRequest(input, init)
      if (input.endsWith('/claim-intent')) state.account = 'foreign-account'
      return response
    })
    view.retry()
    await vi.waitFor(() => expect(view.message()).toBe('scan_conflict'))
    expect(state.navigate).not.toHaveBeenCalled()
    expect(state.replace).not.toHaveBeenCalled()
    expect(state.track).toHaveBeenCalledWith(expect.objectContaining({ name: 'scan_claim_failed', errorCode: 'conflict' }))
    expect(state.attempts.size).toBe(2)
    expect(state.calls.filter(path => path.endsWith('/claim'))).toHaveLength(2)
    expect((await canonicalResult()).fullScan).toBeUndefined()
  })

  it('does not recheck the result for an unrelated renewal conflict', async () => {
    state.failNextUpdate = true
    const view = mountClaim()
    await vi.waitFor(() => expect(view.message()).toBe('claim_failed'))
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Unrelated conflict' }, { status: 409 }))
    view.retry()
    await vi.waitFor(() => expect(view.message()).toBe('scan_conflict'))
    expect(state.navigate).not.toHaveBeenCalled()
    expect(state.account).toBeNull()
  })
})
