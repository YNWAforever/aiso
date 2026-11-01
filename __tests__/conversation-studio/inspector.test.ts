import { beforeEach, expect, it, vi } from 'vitest'
import { loadStudioAttachCandidates, loadStudioDocuments } from '@/lib/conversation-studio/inspector'

const mocks = vi.hoisted(() => ({ sources: vi.fn(), agentSources: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/sources/service', () => ({ listClientSources: mocks.sources }))
vi.mock('@/lib/sources/store', () => ({ listAgentUsableSources: mocks.agentSources }))
beforeEach(() => vi.resetAllMocks())

it('uses the owned source service and projects only approved current versions without prompt contents', async () => {
  const current = { id: 'version-2', versionNumber: 2, approvedAt: '2026-10-28', importedAt: '2026-10-27', entries: ['private-facts'], approvedBy: 'private-actor' }
  mocks.sources.mockResolvedValue(Response.json({ items: [
    { id: 'approved', label: 'Brand facts', revokedAt: null, current, agentUseAllowed: false },
    { id: 'revoked', label: 'Revoked', revokedAt: '2026-10-29', current },
    { id: 'draft', label: 'Unapproved', revokedAt: null, current: { ...current, approvedAt: null } },
    { id: 'empty', label: 'No version', revokedAt: null, current: null },
  ], nextCursor: 'next' }))
  const data = await loadStudioDocuments('owned-client')
  expect(mocks.sources).toHaveBeenCalledWith('owned-client')
  expect(data).toEqual({ items: [{ id: 'approved', label: 'Brand facts', versionId: 'version-2', versionNumber: 2, approvedAt: '2026-10-28', importedAt: '2026-10-27' }], truncated: true })
  expect(JSON.stringify(data)).not.toMatch(/private-facts|private-actor|Revoked|Unapproved/)
})
it.each([404, 503])('keeps a %s source read unknown, never empty or approved', async status => {
  mocks.sources.mockResolvedValue(new Response(null, { status }))
  expect(await loadStudioDocuments('foreign-or-unavailable')).toBeNull()
})
it('distinguishes a successful empty snapshot from a failed read', async () => {
  mocks.sources.mockResolvedValue(Response.json({ items: [], nextCursor: null }))
  expect(await loadStudioDocuments('empty')).toEqual({ items: [], truncated: false })
})

it('keeps attach candidates to id, label, version and hash without entry bodies', async () => {
  const scope = { accountId: 'account-a', clientId: 'owned-client', actorId: 'actor-a' }
  mocks.agentSources.mockResolvedValue([
    { id: 'source-a', label: 'Brand facts', current: { versionNumber: 2, contentHash: 'a'.repeat(64), entries: [{ question: 'private-q', answer: 'private-a' }] } },
    { id: 'source-b', label: 'No version', current: null },
  ])
  const data = await loadStudioAttachCandidates(scope)
  expect(mocks.agentSources).toHaveBeenCalledWith(scope)
  expect(data).toEqual([{ id: 'source-a', label: 'Brand facts', versionNumber: 2, contentHash: 'a'.repeat(64) }])
  expect(JSON.stringify(data)).not.toMatch(/private-q|private-a/)
})
