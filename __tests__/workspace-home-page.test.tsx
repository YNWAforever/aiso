import { beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), project: vi.fn(), sql: vi.fn(), roi: vi.fn(), pulse: vi.fn() }))
vi.mock('@/lib/workspace/load-owned-pulse', () => ({ loadOwnedPulse: mocks.pulse }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/workspace/load-owned-workspace', () => ({ loadOwnedWorkspace: mocks.load }))
vi.mock('@/lib/view-models/workspace-home', () => ({ buildWorkspaceHome: mocks.project }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))
vi.mock('@/lib/localTrust/store', () => ({ getLocalTrustProfile: vi.fn(), getOrCreateLocalTrustSnapshot: mocks.roi }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/components/dashboard/WorkspaceHome', () => ({ WorkspaceHome: () => null }))
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import type { ReactElement } from 'react'
import Page from '@/app/[lang]/dashboard/[clientId]/page'
const profile = { account_id: 'account-a', accounts: { plan: 'free' } }
const render = (search = {}) => Page({ params: Promise.resolve({ lang: 'en', clientId: 'client-a' }), searchParams: Promise.resolve(search) })
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(profile); mocks.load.mockResolvedValue({ client: {} }); mocks.project.mockReturnValue({ client: { id: 'client-a' } }); mocks.sql.mockResolvedValue([]); mocks.pulse.mockResolvedValue(null) })
it('defaults to the independently authenticated read-only home and preserves selected scan', async () => {
  const page = await render({ scanId: 'selected-scan' })
  expect(mocks.auth).toHaveBeenCalledWith('en')
  expect(mocks.load).toHaveBeenCalledWith({ clientId: 'client-a', profile, scanId: 'selected-scan' })
  expect(page.props.workspace.client.id).toBe('client-a')
  expect(mocks.sql).not.toHaveBeenCalled()
  expect(mocks.roi).not.toHaveBeenCalled()
})
it('stops before owned data lookup when auth fails', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('AUTH_REDIRECT'))
  await expect(render()).rejects.toThrow('AUTH_REDIRECT')
  expect(mocks.load).not.toHaveBeenCalled()
})
it('retains owned missing versus whole-page load failure', async () => {
  mocks.load.mockResolvedValueOnce(null)
  await expect(render()).rejects.toThrow('NOT_FOUND')
  mocks.load.mockRejectedValueOnce(new Error('private-database-details'))
  const page = await render()
  expect(JSON.stringify(page)).toContain('workspace_load_error_title')
  expect(JSON.stringify(page)).not.toContain('private-database-details')
})
it.each(['scan', 'results', 'improve', 'roi'])('preserves explicit legacy %s routing', async step => {
  await expect(render({ step })).rejects.toThrow('NOT_FOUND')
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.sql).toHaveBeenCalled()
})
it('provides a home navigation entry without removing explicit legacy links', () => {
  const source = readFileSync('components/dashboard/DashboardSidebar.tsx', 'utf8')
  expect(source).toContain("{ key: 'home'")
  expect(source).toContain("?? 'home'")
  expect(source).toContain('md:w-60')
  expect(source).toContain('aria-expanded')
})

it('keeps expanded mobile navigation scrollable inside the fixed viewport', () => {
  const source = readFileSync('components/dashboard/DashboardSidebar.tsx', 'utf8')
  expect(source).toContain('max-h-[60dvh]')
  expect(source).toContain('overflow-y-auto md:max-h-none')
})

function findImprove(node: unknown): ReactElement<{ recommendations: {platform:string}[]; progress: unknown[]; competitors: unknown[] }> | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) return node.map(findImprove).find(Boolean)
  const element = node as ReactElement<{ children?: unknown }>
  if (element.type === ImproveStep) return element as ReturnType<typeof findImprove>
  return findImprove(element.props?.children)
}
it.each([
  ['free', 0, 0, 0], ['basic', 1, 0, 0], ['pro', 2, 1, 0],
] as const)('gates direct improve client props for %s at the server boundary', async (plan, recCount, progressCount, compCount) => {
  mocks.auth.mockResolvedValue({ account_id:'account-a', accounts:{plan,status:'active',stripe_subscription_id:'sub'} })
  const queries: string[] = []
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join('?'); queries.push(query)
    if (query.includes('from clients')) return [{id:'client-a',brand_name:'Example',domain:'example.com'}]
    if (query.includes('agent_recommendations')) return [{platform:'gemini'}, {platform:'gpt4o'}]
    if (query.includes('agent_progress')) return [{platform:'openai'}]
    if (query.includes('agent_competitors')) return [{platform:'openai'}]
    if (query.includes('from scans')) return [{id:'scan-a',results:{},created_at:'2026-09-05'}]
    return []
  })
  const improve = findImprove(await render({step:'improve'}))!
  expect(improve).toBeDefined()
  expect(improve.props.recommendations).toHaveLength(recCount)
  expect(improve.props.progress).toHaveLength(progressCount)
  expect(improve.props.competitors).toHaveLength(compCount)
  expect(queries.some(query => query.includes('agent_recommendations'))).toBe(recCount > 0)
  expect(queries.some(query => query.includes('agent_progress'))).toBe(progressCount > 0)
  expect(queries.some(query => query.includes('agent_competitors'))).toBe(false)
})

it('routes explicit monitor through the owned Pulse loader before legacy reads', async () => {
  await expect(render({step:'monitor'})).rejects.toThrow('NOT_FOUND')
  expect(mocks.pulse).toHaveBeenCalledWith({clientId:'client-a',profile})
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.sql).not.toHaveBeenCalled()
  expect(mocks.roi).not.toHaveBeenCalled()
})
