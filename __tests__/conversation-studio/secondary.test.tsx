import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sql: vi.fn(), documents: vi.fn(), work: vi.fn(), binding: vi.fn(), panel: vi.fn(), brands: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))
vi.mock('@/lib/conversation-studio/inspector', () => ({ loadStudioDocuments: mocks.documents }))
vi.mock('@/lib/work-items/service', () => ({ listAuthenticatedDrafts: mocks.work }))
vi.mock('@/lib/integrations/search-console/store', () => ({ loadBinding: mocks.binding, loadPanelData: mocks.panel }))
vi.mock('@/lib/workspace/list-owned-brands', () => ({ listOwnedBrands: mocks.brands }))
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw Error(`REDIRECT:${href}`) }, notFound: () => { throw Error('NOT_FOUND') } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import { requireStudioBrand, loadStudioOutputs, loadStudioConnection } from '@/lib/conversation-studio/secondary'
import ThreadsPage from '@/app/[lang]/dashboard/[clientId]/studio/threads/page'
import DocumentsPage from '@/app/[lang]/dashboard/[clientId]/studio/documents/page'
import ConnectionsPage from '@/app/[lang]/dashboard/[clientId]/studio/connections/page'
import ToolsPage from '@/app/[lang]/dashboard/[clientId]/studio/tools/page'
import StudioLayout from '@/app/[lang]/dashboard/[clientId]/studio/layout'

const clientId = '11111111-1111-4111-8111-111111111111'
const params = Promise.resolve({ lang: 'en', clientId })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '1')
  mocks.auth.mockResolvedValue({ account_id: 'account-a', accounts: { override_plan: 'pro' } })
  mocks.sql.mockResolvedValue([{ id: clientId, brand_name: 'Owned Brand' }])
  mocks.documents.mockResolvedValue({ items: [], truncated: false })
  mocks.work.mockResolvedValue({ items: [], nextCursor: null })
  mocks.binding.mockResolvedValue(null)
  mocks.brands.mockResolvedValue([{ id: clientId, name: 'Owned Brand' }])
})
afterEach(() => vi.unstubAllEnvs())

it('checks account ownership with a tagged query', async () => {
  await requireStudioBrand('en', clientId)
  const [strings, ...values] = mocks.sql.mock.calls[0]
  expect(strings.join('?')).toMatch(/where id = \? and account_id = \?/)
  expect(values).toEqual([clientId, 'account-a'])
})
it('keys the temporary layout by account and brand and loads only account-owned brands', async () => {
  const layout = await StudioLayout({ params, children: <p>content</p> })
  expect(layout.key).toBe(`account-a:${clientId}`)
  expect(mocks.brands).toHaveBeenCalledWith('account-a')
  expect(layout.props.children.props.admin).toBe(false)
  mocks.auth.mockResolvedValue({ account_id: 'account-b', is_admin: true, accounts: { override_plan: 'pro' } })
  expect((await StudioLayout({ params, children: null })).key).toBe(`account-b:${clientId}`)
})
it.each([ThreadsPage, DocumentsPage, ConnectionsPage, ToolsPage])('treats failed ownership reads as unavailable, with no secondary reads: %s', async Page => {
  mocks.sql.mockRejectedValueOnce(Error('DB_UNAVAILABLE'))
  await expect(Page({ params })).rejects.toThrow('DB_UNAVAILABLE')
  expect(mocks.work).not.toHaveBeenCalled()
  expect(mocks.documents).not.toHaveBeenCalled()
  expect(mocks.binding).not.toHaveBeenCalled()
})
it('reads approved documents and work items only after ownership succeeds', async () => {
  const page = await DocumentsPage({ params })
  expect(page.props.documents).toEqual({ items: [], truncated: false })
  expect(page.props.outputs).toEqual({ items: [], truncated: false })
  expect(mocks.documents).toHaveBeenCalledWith(clientId)
  expect(mocks.sql.mock.invocationCallOrder[0]).toBeLessThan(mocks.documents.mock.invocationCallOrder[0])
  mocks.documents.mockRejectedValueOnce(Error('source-unavailable'))
  expect((await DocumentsPage({ params })).props.documents).toBeNull()
})
it.each([ThreadsPage, DocumentsPage, ConnectionsPage, ToolsPage])('denies foreign brand before any secondary reader: %s', async Page => {
  mocks.sql.mockResolvedValue([])
  await expect(Page({ params })).rejects.toThrow('NOT_FOUND')
  expect(mocks.work).not.toHaveBeenCalled()
  expect(mocks.documents).not.toHaveBeenCalled()
  expect(mocks.binding).not.toHaveBeenCalled()
})
it.each([ThreadsPage, DocumentsPage, ConnectionsPage, ToolsPage])('fails closed on flag/auth/invalid ID: %s', async Page => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '0')
  await expect(Page({ params })).rejects.toThrow('REDIRECT:/en/dashboard/')
  expect(mocks.sql).not.toHaveBeenCalled()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  await expect(Page({ params: Promise.resolve({ lang: 'en', clientId: 'bad-id' }) })).rejects.toThrow('NOT_FOUND')
  expect(mocks.sql).not.toHaveBeenCalled()
  mocks.auth.mockRejectedValueOnce(Error('AUTH'))
  await expect(Page({ params })).rejects.toThrow('AUTH')
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('projects work-item metadata only and preserves truncation/failure versus empty', async () => {
  mocks.work.mockResolvedValue({ items: [{ id: 'item-id', title: 'Owned output', status: 'draft', revision: 2, updatedAt: '2026-10-29', notes: 'private-notes', evidenceSnapshot: { secret: 'private-evidence' } }], nextCursor: 'more' })
  const result = await loadStudioOutputs(clientId)
  expect(result).toEqual({ items: [{ id: 'item-id', title: 'Owned output', status: 'draft', revision: 2, updatedAt: '2026-10-29' }], truncated: true })
  expect(mocks.work).toHaveBeenCalledWith(clientId, new URLSearchParams({ limit: '50' }))
  mocks.work.mockRejectedValueOnce(Error('private-error'))
  expect(await loadStudioOutputs(clientId)).toBeNull()
  mocks.work.mockResolvedValue({ items: [], nextCursor: null })
  expect(await loadStudioOutputs(clientId)).toEqual({ items: [], truncated: false })
})
it('reads saved GSC state with session account and never exposes binding/metrics', async () => {
  const profile = await mocks.auth()
  mocks.binding.mockResolvedValue({ connectionStatus: 'active', siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com', currentDomain: 'example.com', boundAt: '2026-10-27T00:00:00Z', connectionId: 'private-connection' })
  mocks.panel.mockResolvedValue({ latest: { outcome: 'ok', dataThrough: '2026-10-26', ranAt: '2026-10-28T00:00:00Z' }, lastGoodDataThrough: '2026-10-26', clicks: 888 })
  expect(await loadStudioConnection(profile, clientId)).toEqual({ sourceStatus: 'bound', state: { kind: 'synced', dataThrough: '2026-10-26' } })
  expect(mocks.binding).toHaveBeenCalledWith('account-a', clientId)
  expect(mocks.panel).toHaveBeenCalledWith('account-a', clientId)
  mocks.panel.mockRejectedValueOnce(Error('private-error'))
  expect(await loadStudioConnection(profile, clientId)).toEqual({ sourceStatus: 'bound', state: null })
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '0')
  mocks.binding.mockClear()
  expect(await loadStudioConnection(profile, clientId)).toEqual({ sourceStatus: 'unavailable', state: null })
  expect(mocks.binding).not.toHaveBeenCalled()
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '1')
  expect(await loadStudioConnection({ ...profile, accounts: { plan: 'free' } }, clientId)).toEqual({ sourceStatus: 'unavailable', state: null })
  expect(mocks.binding).not.toHaveBeenCalled()
})
