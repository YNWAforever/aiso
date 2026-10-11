import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), readHealth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/admin/schema-health', () => ({ readAdminSchemaHealth: mocks.readHealth }))
vi.mock('next-intl/server', () => ({ getMessages: async () => ({}), getTranslations: async () => (key: string) => key }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found') } }))
import AdminPage from '@/app/admin/page'
describe('admin page diagnostic boundary', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('denies a non-admin before constructing the streamed diagnostic', async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error('redirect:dashboard'))
    await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:dashboard')
    expect(mocks.readHealth).not.toHaveBeenCalled()
  })
  it('rejects malformed directory scope before reading metadata', async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ is_admin: true })
    await expect(AdminPage({ searchParams: Promise.resolve({ accountId: 'invalid' }) })).rejects.toThrow('not found')
    expect(mocks.readHealth).not.toHaveBeenCalled()
  })
})
