import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sql: vi.fn(), evidence: vi.fn(), binding: vi.fn() }))
vi.mock('@/lib/integrations/search-console/store', () => ({ loadBinding: mocks.binding }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversation-studio/evidence', () => ({ loadStudioEvidence: mocks.evidence }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))
vi.mock('next/navigation', () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import Page from '@/app/[lang]/dashboard/[clientId]/studio/page'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'
import { emptyStudioEvidence } from '@/__tests__/helpers/studio-evidence'

const clientId = '11111111-1111-4111-8111-111111111111'
const render = (id = clientId) => Page({ params: Promise.resolve({ lang: 'en', clientId: id }) })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', '0')
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '1')
  mocks.auth.mockResolvedValue({ account_id: 'account-a', accounts: { override_plan: 'pro' } })
  mocks.binding.mockResolvedValue(null)
  mocks.sql.mockResolvedValue([{ id: clientId, brand_name: 'Example Brand' }])
  mocks.evidence.mockResolvedValue(emptyStudioEvidence)
})
afterEach(() => vi.unstubAllEnvs())

it.each([undefined, '0', 'true'])('redirects to the existing home with flag %s before brand reads', async value => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', value)
  await expect(render()).rejects.toThrow(`REDIRECT:/en/dashboard/${clientId}?step=home`)
  expect(mocks.sql).not.toHaveBeenCalled()
  expect(mocks.evidence).not.toHaveBeenCalled()
  expect(mocks.binding).not.toHaveBeenCalled()
})
it('renders only the owned brand shell when enabled', async () => {
  const page = await render()
  expect(page.type).toBe(ConversationStudio)
  expect(page.key).toBe(clientId)
  expect(page.props.brandName).toBe('Example Brand')
  expect(page.props.evidence).toEqual(emptyStudioEvidence)
  expect(page.props.live).toBeUndefined()
  expect(mocks.evidence).toHaveBeenCalledWith('account-a', clientId)
  expect(mocks.auth).toHaveBeenCalledWith('en')
  const [strings, ...values] = mocks.sql.mock.calls[0]
  expect(strings.join('?')).toMatch(/where id = \? and account_id = \?/)
  expect(values).toEqual([clientId, 'account-a'])
  expect(mocks.sql).toHaveBeenCalledTimes(1)
  expect(mocks.binding).toHaveBeenCalledWith('account-a', clientId)
  expect(page.props.sourceStatus).toBe('unbound')
})

it('projects actual saved GSC binding status without metrics or provider reads', async () => {
  mocks.binding.mockResolvedValue({ connectionStatus: 'active', siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com', currentDomain: 'example.com' })
  expect((await render()).props.sourceStatus).toBe('bound')
  mocks.binding.mockResolvedValue({ connectionStatus: 'active', siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com', currentDomain: 'other.example' })
  expect((await render()).props.sourceStatus).toBe('rebind')
  mocks.binding.mockResolvedValue({ connectionStatus: 'needs_reconnect' })
  expect((await render()).props.sourceStatus).toBe('reconnect')
  mocks.binding.mockResolvedValue({ connectionStatus: 'revoked' })
  expect((await render()).props.sourceStatus).toBe('unbound')
})
it('does not turn GSC lookup errors or disabled access into an unbound claim', async () => {
  mocks.binding.mockRejectedValueOnce(new Error('private-binding-error'))
  const page = await render()
  expect(page.props.sourceStatus).toBe('unavailable')
  expect(JSON.stringify(page)).not.toContain('private-binding-error')
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '0')
  mocks.binding.mockClear()
  expect((await render()).props.sourceStatus).toBe('unavailable')
  expect(mocks.binding).not.toHaveBeenCalled()
  vi.stubEnv('FEATURE_SEARCH_CONSOLE', '1')
  mocks.auth.mockResolvedValue({ account_id: 'account-a', accounts: { plan: 'free' } })
  expect((await render()).props.sourceStatus).toBe('unavailable')
  expect(mocks.binding).not.toHaveBeenCalled()
})

it('passes only plan-granted platforms and the fail-closed cap when LIVE is on', async () => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', '1')
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', undefined)
  mocks.auth.mockResolvedValue({ account_id: 'account-a', accounts: { override_plan: 'basic' } })
  expect((await render()).props.live).toEqual({ platforms: ['gemini-flash'], cap: 0 })
  vi.stubEnv('STUDIO_LIVE_ANSWERS_PER_WEEK', '3')
  expect((await render()).props.live).toEqual({ platforms: ['gemini-flash'], cap: 3 })
})
it('stops at authentication before any brand read', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('AUTH_REDIRECT'))
  await expect(render()).rejects.toThrow('AUTH_REDIRECT')
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('returns 404 for a missing or foreign brand', async () => {
  mocks.sql.mockResolvedValueOnce([])
  await expect(render()).rejects.toThrow('NOT_FOUND')
  expect(mocks.evidence).not.toHaveBeenCalled()
  expect(mocks.binding).not.toHaveBeenCalled()
})
it('shows unavailable when evidence fails, without exposing details or a false empty reply', async () => {
  mocks.evidence.mockRejectedValueOnce(new Error('private-evidence-error'))
  const page = await render()
  expect(JSON.stringify(page)).toContain('loadError')
  expect(JSON.stringify(page)).not.toContain('private-evidence-error')
})
it('returns 404 for an invalid brand id without querying SQL', async () => {
  await expect(render('invalid')).rejects.toThrow('NOT_FOUND')
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('shows a translated unavailable state without exposing SQL errors', async () => {
  mocks.sql.mockRejectedValueOnce(new Error('private-database-details'))
  const page = await render()
  expect(JSON.stringify(page)).toContain('loadError')
  expect(JSON.stringify(page)).not.toContain('private-database-details')
})
