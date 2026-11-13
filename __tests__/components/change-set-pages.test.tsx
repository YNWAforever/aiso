import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  draft: vi.fn(),
  versions: vi.fn(),
  version: vi.fn(),
  sme: false,
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
vi.mock('@/lib/flags', () => ({ isSmeCopilotUiEnabled: () => m.sme }))
vi.mock('@/lib/change-sets/service', () => ({
  listAuthenticatedVersions: m.versions,
  readAuthenticatedVersion: m.version,
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
import { draft, clientId, initial, access, version } from './c9d-fixtures'
beforeEach(() => {
  vi.resetAllMocks()
  m.sme = false
  m.version.mockResolvedValue(Response.json({ version }))
  m.auth.mockResolvedValue({ account_id: clientId })
  m.admin.mockResolvedValue({})
  m.draft.mockResolvedValue({ item: draft })
  m.versions.mockResolvedValue(Response.json(initial))
  m.access.mockResolvedValue(Response.json(access))
})
const page = (lang = 'en', itemId = draft.id) => VersionsPage({ params: Promise.resolve({ lang, clientId, workItemId: itemId }) })
describe('review page guards', () => {
  it.each(['en', 'zh-HK'])('SME selects the independently identified latest, not first row, in %s', async lang => {
    m.sme = true
    const latest = { ...version, id: '77777777-7777-4777-8777-777777777777', versionNumber: 7 }
    const list = { ...initial, versions: [version, latest], latestVersionId: latest.id }
    m.versions.mockResolvedValue(Response.json(list))
    m.version.mockResolvedValue(Response.json({ version: latest }))
    const result = await page(lang)
    expect(result.key).toBe(`${clientId}:${draft.id}`)
    expect(result.props.smeCopilot).toBe(true)
    expect(result.props.initial).toEqual(list)
    expect(result.props.initialVersion).toEqual(latest)
    expect(result.props.initialError).toBe('')
    expect(m.version).toHaveBeenCalledExactlyOnceWith(clientId, draft.id, latest.id)
    expect(m.auth.mock.invocationCallOrder[0]).toBeLessThan(m.draft.mock.invocationCallOrder[0])
    expect(m.draft.mock.invocationCallOrder[0]).toBeLessThan(m.versions.mock.invocationCallOrder[0])
    expect(m.versions.mock.invocationCallOrder[0]).toBeLessThan(m.version.mock.invocationCallOrder[0])
  })
  it.each([false, true])('canonicalizes valid uppercase UUID route scopes, SME=%s', async sme => {
    m.sme = sme
    const brandId = 'abcdefab-cdef-4abc-8def-abcdefabcdef', itemId = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba'
    const saved = { ...version, workItemId: itemId }
    m.draft.mockResolvedValue({ item: { ...draft, clientId: brandId, id: itemId } })
    m.versions.mockResolvedValue(Response.json({ ...initial, versions: [saved] }))
    m.version.mockResolvedValue(Response.json({ version: saved }))
    const result = await VersionsPage({ params: Promise.resolve({ lang: 'en', clientId: brandId.toUpperCase(), workItemId: itemId.toUpperCase() }) })
    expect(result.props.clientId).toBe(brandId)
    expect(result.props.workItemId).toBe(itemId)
    expect(result.key).toBe(`${brandId}:${itemId}`)
    expect(m.draft).toHaveBeenCalledExactlyOnceWith(brandId, itemId)
    expect(m.versions).toHaveBeenCalledWith(brandId, itemId, expect.any(URLSearchParams))
    if (sme) expect(result.props.initialVersion).toEqual(saved)
    else expect(m.version).not.toHaveBeenCalled()
  })
  it.each(['approved','changes_requested'])('retains exact newer %s detail when list was read before the decision', async decision => {
    m.sme = true
    const terminal = { ...version, decision: { decision, reason: 'Newer independent decision', decidedAt: '2026-09-07T00:00:00.123456Z', decidedBy: { profileId: '88888888-8888-4888-8888-888888888888', displayName: 'Independent reviewer', role: 'account_approver' } }, capabilities: { canDecide: false } }
    m.version.mockResolvedValue(Response.json({ version: terminal }))
    const result = await page()
    expect(result.props.initial.versions[0].decision).toBeNull()
    expect(result.props.initialVersion).toEqual(terminal)
    expect(result.props.initialError).toBe('')
  })
  it('legacy leaves initial selection empty without adding a detail read', async () => {
    const result = await page()
    expect(result.props.smeCopilot).toBe(false)
    expect(result.props.initialVersion).toBeNull()
    expect(m.version).not.toHaveBeenCalled()
  })
  it('confirmed empty SME history does not request a fabricated latest', async () => {
    m.sme = true
    m.versions.mockResolvedValue(Response.json({ versions: [], nextCursor: null, latestVersionId: null }))
    const result = await page()
    expect(result.props.initialVersion).toBeNull()
    expect(result.props.initialError).toBe('')
    expect(m.version).not.toHaveBeenCalled()
  })
  it.each([401,403,404])('keeps exact latest detail %s access failure closed', async status => {
    m.sme = true
    m.version.mockResolvedValue(Response.json({}, { status }))
    await expect(page()).rejects.toThrow(status === 401 ? 'redirect' : 'not-found')
  })
  it.each(['network','json','503','foreign-item','foreign-id','changed-hash','changed-revision','changed-number'])('retains list and draft but not unavailable SME detail: %s', async kind => {
    m.sme = true
    if (kind === 'network') m.version.mockRejectedValue(Error('offline'))
    else if (kind === 'json') m.version.mockResolvedValue(new Response('{', { headers: { 'content-type': 'application/json' } }))
    else if (kind === '503') m.version.mockResolvedValue(Response.json({}, { status: 503 }))
    else m.version.mockResolvedValue(Response.json({ version: { ...version, ...(kind === 'foreign-item' ? { workItemId: clientId } : kind === 'foreign-id' ? { id: clientId } : kind === 'changed-revision' ? { draftRevision: version.draftRevision + 1 } : kind === 'changed-number' ? { versionNumber: version.versionNumber + 1 } : { contentHash: 'b'.repeat(64) }) } }))
    const result = await page()
    expect(result.props.initialDraft).toEqual(draft)
    expect(result.props.initial).toEqual(initial)
    expect(result.props.initialVersion).toBeNull()
    expect(result.props.initialError).toBe('unavailable')
  })
  it.each(['network','json','503','null'])('does not disguise unavailable SME history as no versions: %s', async kind => {
    m.sme = true
    if (kind === 'network') m.versions.mockRejectedValue(Error('offline'))
    else if (kind === 'json') m.versions.mockResolvedValue(new Response('{'))
    else m.versions.mockResolvedValue(Response.json(kind === 'null' ? null : {}, { status: kind === '503' ? 503 : 200 }))
    const result = await page()
    expect(result.props.initial).toBeNull()
    expect(result.props.initialError).toBe('unavailable')
    expect(result.props.initialDraft).toEqual(draft)
    expect(m.version).not.toHaveBeenCalled()
  })

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
