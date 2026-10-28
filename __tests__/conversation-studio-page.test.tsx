import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), sql: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))
vi.mock('next/navigation', () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
import Page from '@/app/[lang]/dashboard/[clientId]/studio/page'
import { ConversationStudio } from '@/components/dashboard/ConversationStudio'

const clientId = '11111111-1111-4111-8111-111111111111'
const render = (id = clientId) => Page({ params: Promise.resolve({ lang: 'en', clientId: id }) })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  mocks.auth.mockResolvedValue({ account_id: 'account-a' })
  mocks.sql.mockResolvedValue([{ id: clientId, brand_name: 'Example Brand' }])
})
afterEach(() => vi.unstubAllEnvs())

it.each([undefined, '0', 'true'])('redirects to the existing home with flag %s before brand reads', async value => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', value)
  await expect(render()).rejects.toThrow(`REDIRECT:/en/dashboard/${clientId}?step=home`)
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('renders only the owned brand shell when enabled', async () => {
  const page = await render()
  expect(page.type).toBe(ConversationStudio)
  expect(page.key).toBe(clientId)
  expect(page.props.brandName).toBe('Example Brand')
  expect(mocks.auth).toHaveBeenCalledWith('en')
  const [strings, ...values] = mocks.sql.mock.calls[0]
  expect(strings.join('?')).toMatch(/where id = \? and account_id = \?/)
  expect(values).toEqual([clientId, 'account-a'])
  expect(mocks.sql).toHaveBeenCalledTimes(1)
})
it('stops at authentication before any brand read', async () => {
  mocks.auth.mockRejectedValueOnce(new Error('AUTH_REDIRECT'))
  await expect(render()).rejects.toThrow('AUTH_REDIRECT')
  expect(mocks.sql).not.toHaveBeenCalled()
})
it('returns 404 for a missing or foreign brand', async () => {
  mocks.sql.mockResolvedValueOnce([])
  await expect(render()).rejects.toThrow('NOT_FOUND')
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
