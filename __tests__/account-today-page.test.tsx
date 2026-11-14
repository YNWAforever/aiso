import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ auth: vi.fn(), portfolio: vi.fn(), projectPortfolio: vi.fn(), workspace: vi.fn(), projectHome: vi.fn(), activation: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/workspace/load-owned-portfolio', () => ({ loadOwnedPortfolio: mocks.portfolio }))
vi.mock('@/lib/view-models/portfolio', () => ({ buildPortfolio: mocks.projectPortfolio }))
vi.mock('@/lib/workspace/load-owned-workspace', () => ({ loadOwnedWorkspace: mocks.workspace }))
vi.mock('@/lib/view-models/workspace-home', () => ({ buildWorkspaceHome: mocks.projectHome }))
vi.mock('@/lib/telemetry/activation', () => ({ readActivation: mocks.activation }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/components/dashboard/PortfolioView', () => ({ PortfolioView: () => null }))
vi.mock('@/components/dashboard/AddBrandWizard', () => ({ AddBrandWizard: () => null }))
vi.mock('@/components/dashboard/today/BrandToday', () => ({ BrandToday: () => null }))

import Page from '@/app/[lang]/dashboard/page'
import { BrandToday } from '@/components/dashboard/today/BrandToday'
import { PortfolioView } from '@/components/dashboard/PortfolioView'

const profile = { account_id: 'account-a', accounts: { plan: 'free' } }
const render = () => Page({ params: Promise.resolve({ lang: 'zh-HK' }) })
function portfolio(count: number) {
  return { clients: Array.from({ length: count }, (_, i) => ({ id: `client-${i + 1}` })), capacity: { state: 'known', canCreate: false } }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FEATURE_SME_COPILOT_UI', '1')
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '0')
  mocks.auth.mockResolvedValue(profile)
  mocks.portfolio.mockResolvedValue({})
  mocks.projectPortfolio.mockReturnValue(portfolio(1))
  mocks.workspace.mockResolvedValue({ client: { id: 'client-1' } })
  mocks.projectHome.mockReturnValue({ client: { id: 'client-1' } })
  mocks.activation.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

it('loads saved work once only in the authenticated one-brand SME Today branch', async () => {
  const page = await render()
  expect(page.type).toBe(BrandToday)
  expect(page.props).toMatchObject({ accountHome: true, lang: 'zh-HK' })
  expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith({ clientId: 'client-1', profile, scanId: undefined, withTaskCount: true, withSavedWork: true })
  expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.portfolio.mock.invocationCallOrder[0]!)
  expect(mocks.portfolio.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0]!)
})

it.each([[0, '1'], [2, '1'], [1, '0']] as const)('does not fan out workspace reads for %i brands with SME flag %s', async (count, flag) => {
  mocks.projectPortfolio.mockReturnValue(portfolio(count))
  vi.stubEnv('FEATURE_SME_COPILOT_UI', flag)
  expect((await render()).type).toBe(PortfolioView)
  expect(mocks.workspace).not.toHaveBeenCalled()
  expect(mocks.projectHome).not.toHaveBeenCalled()
})

it('stops before any portfolio or saved-work lookup when authentication fails', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('AUTH_REDIRECT'))
  await expect(render()).rejects.toThrow('AUTH_REDIRECT')
  expect(mocks.portfolio).not.toHaveBeenCalled()
  expect(mocks.workspace).not.toHaveBeenCalled()
})

it('keeps the existing safe fallback when the owned one-brand workspace disappears', async () => {
  mocks.workspace.mockResolvedValueOnce(null)
  expect((await render()).type).toBe(PortfolioView)
  expect(mocks.projectHome).not.toHaveBeenCalled()
  expect(mocks.workspace).toHaveBeenCalledTimes(1)
})

it('reports a failed workspace read without disclosing its private error or retrying other brands', async () => {
  mocks.workspace.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_ERROR'))
  const page = await render()
  expect(JSON.stringify(page)).toContain('loadError')
  expect(JSON.stringify(page)).not.toContain('PRIVATE_DATABASE_ERROR')
  expect(mocks.workspace).toHaveBeenCalledTimes(1)
  expect(mocks.projectHome).not.toHaveBeenCalled()
})
