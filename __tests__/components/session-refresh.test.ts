import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ effect: null as null | (() => (() => void)), getSession: vi.fn(), refresh: vi.fn() }))
vi.mock('react', () => ({ useEffect: (effect: () => (() => void)) => { state.effect = effect } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/zh-HK/dashboard/fixture/sources', useRouter: () => ({ refresh: state.refresh }) }))
vi.mock('@/lib/auth-client', () => ({ authClient: { getSession: state.getSession } }))
beforeEach(() => { vi.clearAllMocks(); state.effect = null })
async function mounted() {
  const { SessionRefresh } = await import('@/components/auth/SessionRefresh')
  expect(SessionRefresh()).toBeNull()
  if (!state.effect) throw new Error('Protected session renewal effect missing')
  const cleanup = state.effect()
  await new Promise(resolve => setTimeout(resolve, 0))
  return cleanup
}
describe('protected browser session renewal', () => {
  it('renews through the SDK browser Auth route with cookie cache disabled', async () => {
    state.getSession.mockResolvedValue({ data: { session: { id: 'fixture' }, user: { id: 'fixture' } }, error: null })
    await mounted()
    expect(state.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } })
    expect(state.refresh).not.toHaveBeenCalled()
  })
  it('refreshes the server gate when the current session has expired', async () => {
    state.getSession.mockResolvedValue({ data: null, error: null })
    await mounted()
    expect(state.refresh).toHaveBeenCalledTimes(1)
  })
  it('does not turn Auth service failure into a signed-out redirect or expose error text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.getSession.mockResolvedValue({ data: null, error: { status: 503, message: 'sensitive-service-detail' } })
    await mounted()
    expect(state.refresh).not.toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-service-detail')
    expect(warn).toHaveBeenCalledWith('[auth] session renewal unavailable', { status: 503 })
    warn.mockRestore()
  })
  it('ignores a late expired result after the protected page unmounts', async () => {
    let finish!: (result: unknown) => void
    state.getSession.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const cleanup = await mounted()
    cleanup()
    finish({ data: null, error: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(state.refresh).not.toHaveBeenCalled()
  })
})
