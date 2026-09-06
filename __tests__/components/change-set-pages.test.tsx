import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  draft: vi.fn(),
  versions: vi.fn(),
  access: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth, requireAdmin: m.admin }))
vi.mock('@/lib/work-items/service', () => ({
  readAuthenticatedDraft: m.draft,
  WorkItemServiceError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))
vi.mock('@/lib/change-sets/service', () => ({
  listAuthenticatedVersions: m.versions,
}))
vi.mock('@/lib/approvals/access-service', () => ({
  getApproverAccess: m.access,
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getMessages: vi.fn(async () => ({})),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('not-found')
  },
  redirect: () => {
    throw Error('redirect')
  },
}))
import VersionsPage from '@/app/[lang]/dashboard/[clientId]/work-items/[workItemId]/versions/page'
import ApproversPage from '@/app/admin/accounts/[accountId]/approvers/page'
import { draft, clientId, initial, access } from './c9d-fixtures'
beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue({ account_id: clientId })
  m.admin.mockResolvedValue({})
  m.draft.mockResolvedValue({ item: draft })
  m.versions.mockResolvedValue(Response.json(initial))
  m.access.mockResolvedValue(Response.json(access))
})
describe('review page guards', () => {
  it('auth precedes any draft read', async () => {
    m.auth.mockRejectedValue(Error('login'))
    await expect(
      VersionsPage({
        params: Promise.resolve({ lang: 'en', clientId, workItemId: draft.id }),
      }),
    ).rejects.toThrow('login')
    expect(m.draft).not.toHaveBeenCalled()
  })
  it('unavailable ownership never discloses workspace', async () => {
    m.draft.mockRejectedValue(Error('outage'))
    const result = await VersionsPage({
      params: Promise.resolve({ lang: 'en', clientId, workItemId: draft.id }),
    })
    expect(result.type).toBe('main')
    expect(m.versions).not.toHaveBeenCalled()
  })
  it('admin guard precedes roster', async () => {
    m.admin.mockRejectedValue(Error('denied'))
    await expect(
      ApproversPage({
        params: Promise.resolve({ accountId: clientId }),
        searchParams: Promise.resolve({ lang: 'en' }),
      }),
    ).rejects.toThrow('denied')
    expect(m.access).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh-HK', 'invalid'])(
    'uses validated admin query locale %s',
    async (lang) => {
      const result = await ApproversPage({
        params: Promise.resolve({ accountId: clientId }),
        searchParams: Promise.resolve({ lang }),
      })
      expect(result.props.locale).toBe(lang === 'zh-HK' ? 'zh-HK' : 'en')
    },
  )
})
