import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  evidence: vi.fn(),
  opportunities: vi.fn(),
  sources: vi.fn(),
  drafts: vi.fn(),
  binding: vi.fn(),
  panel: vi.fn(),
  ownerState: vi.fn(),
  matchesDomain: vi.fn(),
}))
vi.mock('@/lib/conversation-studio/evidence', () => ({ loadStudioEvidence: mocks.evidence }))
vi.mock('@/lib/conversation-studio/opportunities', () => ({ loadStudioOpportunities: mocks.opportunities }))
vi.mock('@/lib/sources/store', () => ({ listAgentUsableSources: mocks.sources }))
vi.mock('@/lib/work-items/store', () => ({ listOwnedDrafts: mocks.drafts }))
vi.mock('@/lib/integrations/search-console/store', () => ({ loadBinding: mocks.binding, loadPanelData: mocks.panel }))
vi.mock('@/lib/integrations/search-console/state', () => ({ deriveOwnerState: mocks.ownerState }))
vi.mock('@/lib/integrations/search-console/binding', () => ({ bindingMatchesDomain: mocks.matchesDomain }))
import { executeStudioMcpTool } from '@/lib/conversation-studio/mcp/execute'
import type { StudioMcpPrincipal } from '@/lib/conversation-studio/mcp/types'

const accountId = '10000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000002'
const profileId = '30000000-0000-4000-8000-000000000003'

const principal: StudioMcpPrincipal = {
  accountId,
  clientId,
  profileId,
  entitlements: { search_console: true },
}

const evidence = {
  week: '2026-10-26',
  totalRecorded: 12,
  truncated: true,
  observations: [{
    id: '40000000-0000-4000-8000-000000000004',
    question: 'Best AEO agency in Hong Kong?',
    platform: 'chatgpt',
    scanWeek: '2026-10-26',
    recordedAt: '2026-10-27T03:00:00Z',
    collectedAt: '2026-10-27T02:00:00Z',
    model: 'gpt-5',
    market: 'hk',
    result: 'success',
    brandMentioned: false,
    excerpt: 'A short recorded excerpt',
    links: [{ url: 'https://example.com/a', title: 'Example', kind: 'provider-citation' }],
    searchEvidence: { requested: 'web', execution: 'unknown', basis: 'request-only' },
  }],
  scan: {
    id: '50000000-0000-4000-8000-000000000005',
    recordedAt: '2026-10-27T01:00:00Z',
    evidence: {
      collection: 'partial',
      completedPages: 3,
      collectedAt: '2026-10-27T00:30:00Z',
      limited: true,
      scannerVersion: 'scanner.v1',
      methodologyVersion: 'method.v1',
      pillarInputs: {},
      checks: [
        { key: 'c1_robots', collection: 'complete', assessment: 'pass' },
        { key: 'c2_llms_txt', collection: 'unavailable', assessment: 'unknown' },
      ],
    },
  },
}

const opportunity = {
  key: 'pulse:best-aeo-agency',
  title: 'Answer the missing question',
  action: 'Add a page that answers it.',
  recordedAt: '2026-10-27T03:00:00Z',
  evidenceRefs: [{ kind: 'pulse-metric', id: '40000000-0000-4000-8000-000000000004' }],
  source: { kind: 'pulse-metric', id: '40000000-0000-4000-8000-000000000004' },
  ruleVersion: 'pulse-brand-absent.v1',
  fingerprint: 'a'.repeat(64),
  savedDraftId: null,
  savedState: 'unsaved',
  saveAvailability: 'available',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.ownerState.mockImplementation((input: unknown) => ({ kind: 'ready', input }))
  mocks.matchesDomain.mockReturnValue(true)
})

describe('executeStudioMcpTool', () => {
  it('rejects unknown tools and invalid arguments before any read', async () => {
    expect(await executeStudioMcpTool({ principal, name: 'drop_everything', args: {} })).toMatchObject({ ok: false, error: 'INVALID_ARGUMENTS' })
    expect(await executeStudioMcpTool({ principal, name: 'work_item_drafts', args: { limit: 99 } })).toMatchObject({ ok: false, error: 'INVALID_ARGUMENTS' })
    expect(mocks.evidence).not.toHaveBeenCalled()
    expect(mocks.drafts).not.toHaveBeenCalled()
  })

  it('reads brand evidence with the principal scope and reports the recorded week only', async () => {
    mocks.evidence.mockResolvedValue(evidence)
    const result = await executeStudioMcpTool({ principal, name: 'brand_evidence', args: {} })
    expect(mocks.evidence).toHaveBeenCalledWith(accountId, clientId)
    expect(result).toMatchObject({
      ok: true,
      data: {
        state: 'available',
        week: '2026-10-26',
        totalRecorded: 12,
        truncated: true,
        observations: [{ question: 'Best AEO agency in Hong Kong?', brandMentioned: false, excerpt: 'A short recorded excerpt' }],
        scan: { id: '50000000-0000-4000-8000-000000000005', collection: 'partial', limited: true },
      },
    })
    expect(JSON.stringify(result)).not.toContain('rawAnswer')
  })

  it('reports unavailable rather than empty when the saved snapshot cannot be read', async () => {
    mocks.evidence.mockResolvedValue(null)
    expect(await executeStudioMcpTool({ principal, name: 'brand_evidence', args: {} })).toEqual({ ok: true, data: { state: 'unavailable' } })
    expect(await executeStudioMcpTool({ principal, name: 'scan_checks', args: {} })).toEqual({ ok: true, data: { state: 'unavailable' } })
  })

  it('distinguishes a brand with no retained scan from a failed read', async () => {
    mocks.evidence.mockResolvedValue({ ...evidence, scan: null })
    expect(await executeStudioMcpTool({ principal, name: 'scan_checks', args: {} })).toEqual({ ok: true, data: { state: 'no_scan' } })
  })

  it('returns the check assessments without points or inferred verdicts', async () => {
    mocks.evidence.mockResolvedValue(evidence)
    const result = await executeStudioMcpTool({ principal, name: 'scan_checks', args: {} })
    expect(result).toMatchObject({
      ok: true,
      data: {
        state: 'available',
        collection: 'partial',
        checks: [
          { key: 'c1_robots', collection: 'complete', assessment: 'pass' },
          { key: 'c2_llms_txt', collection: 'unavailable', assessment: 'unknown' },
        ],
      },
    })
  })

  it('passes the requested language and keeps the opportunity provenance', async () => {
    mocks.opportunities.mockResolvedValue({
      state: 'ready', partial: false, pulseWeek: '2026-10-26',
      sourceStates: { pulse: 'ok', scan: 'empty' }, suggestions: [opportunity],
    })
    const result = await executeStudioMcpTool({ principal, name: 'content_opportunities', args: { language: 'zh-HK' } })
    expect(mocks.opportunities).toHaveBeenCalledWith(clientId, 'zh-HK')
    expect(result).toMatchObject({
      ok: true,
      data: { state: 'ready', pulseWeek: '2026-10-26', suggestions: [{ key: opportunity.key, fingerprint: 'a'.repeat(64), savedState: 'unsaved' }] },
    })
  })

  it('lists usable sources with the principal as the acting member and no bodies', async () => {
    mocks.sources.mockResolvedValue([{
      id: '60000000-0000-4000-8000-000000000006', sourceKey: 'brand-guide', kind: 'brand',
      label: 'Brand guide', agentUseAllowed: true, revokedAt: null, latestVersion: 2,
      freshness: 'current', updatedAt: '2026-10-01T00:00:00Z',
      current: {
        id: '70000000-0000-4000-8000-000000000007', versionNumber: 2, contentHash: 'b'.repeat(64),
        importMethod: 'paste', originRef: null, importedAt: '2026-10-01T00:00:00Z',
        approvedAt: null, entries: [{ heading: 'Tone', body: 'SECRET BODY' }],
      },
    }])
    const result = await executeStudioMcpTool({ principal, name: 'brand_sources', args: {} })
    expect(mocks.sources).toHaveBeenCalledWith({ accountId, clientId, actorId: profileId })
    expect(result).toMatchObject({
      ok: true,
      data: { state: 'available', sources: [{ label: 'Brand guide', latestVersion: 2, current: { versionNumber: 2 } }] },
    })
    expect(JSON.stringify(result)).not.toContain('SECRET BODY')
  })

  it('bounds and scopes the draft list', async () => {
    mocks.drafts.mockResolvedValue({
      items: [{
        id: '80000000-0000-4000-8000-000000000008', clientId, status: 'draft', title: 'Draft title',
        action: 'Action', notes: 'SECRET NOTES', locale: 'en', revision: 3,
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
        evidenceSnapshot: { secret: true },
      }],
      nextCursor: null,
    })
    const result = await executeStudioMcpTool({ principal, name: 'work_item_drafts', args: { limit: 2 } })
    expect(mocks.drafts).toHaveBeenCalledWith(accountId, clientId, { limit: 2, cursor: null })
    expect(result).toMatchObject({ ok: true, data: { state: 'available', items: [{ title: 'Draft title', revision: 3 }] } })
    expect(JSON.stringify(result)).not.toContain('SECRET NOTES')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('refuses Search Console when the plan does not grant it, before reading anything', async () => {
    const result = await executeStudioMcpTool({
      principal: { ...principal, entitlements: { search_console: false } },
      name: 'search_console_status',
      args: {},
    })
    expect(result).toMatchObject({ ok: false, error: 'FEATURE_UNAVAILABLE' })
    expect(mocks.binding).not.toHaveBeenCalled()
    expect(mocks.panel).not.toHaveBeenCalled()
  })

  it('reports an unbound Search Console without inventing a sync state', async () => {
    mocks.binding.mockResolvedValue(null)
    expect(await executeStudioMcpTool({ principal, name: 'search_console_status', args: {} })).toEqual({ ok: true, data: { state: { kind: 'unbound' } } })
    expect(mocks.panel).not.toHaveBeenCalled()
  })

  it('derives the saved owner state only from the binding it just read', async () => {
    mocks.binding.mockResolvedValue({
      connectionId: '90000000-0000-4000-8000-000000000009', siteUrl: 'sc-domain:example.com',
      permissionLevel: 'siteOwner', boundDomain: 'example.com', backfillPending: false,
      connectionStatus: 'active', currentDomain: 'example.com', boundAt: '2026-10-01T00:00:00Z',
    })
    mocks.panel.mockResolvedValue({ latest: { outcome: 'ok', dataThrough: '2026-10-26', ranAt: '2026-10-27T00:00:00Z' }, lastGoodDataThrough: '2026-10-26', property: null, pages: [] })
    await executeStudioMcpTool({ principal, name: 'search_console_status', args: {} })
    expect(mocks.ownerState).toHaveBeenCalledWith(expect.objectContaining({
      bound: true, entitled: true, connectionStatus: 'active', boundAt: '2026-10-01T00:00:00Z', lastGoodDataThrough: '2026-10-26',
    }))
  })

  it('fails closed as unavailable when a loader throws, without echoing the error', async () => {
    mocks.evidence.mockRejectedValue(new Error('postgres://user:secret@host/db'))
    const result = await executeStudioMcpTool({ principal, name: 'brand_evidence', args: {} })
    expect(result).toMatchObject({ ok: false, error: 'UNAVAILABLE' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(console.error).toHaveBeenCalled()
  })
})
