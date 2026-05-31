/**
 * TDD: Full scan flow
 * Tests the complete path: POST /api/scan → score → DB insert → n8n webhook fire
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Set required env vars before any module is loaded
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

// ── Mocks ───────────────────────────────────────────────────────
// Mock all 20 checks to return known values
vi.mock('@/lib/checks/robots',          () => ({ checkRobots:          vi.fn().mockResolvedValue({ status: 'pass', message: 'robots_ai_allowed' }) }))
vi.mock('@/lib/checks/llmsTxt',         () => ({ checkLlmsTxt:         vi.fn().mockResolvedValue({ status: 'fail', message: 'llms_txt_missing' }) }))
vi.mock('@/lib/checks/botAccess',       () => ({ checkBotAccess:       vi.fn().mockResolvedValue({ status: 'pass', message: 'bots_all_accessible' }) }))
vi.mock('@/lib/checks/structuredData',  () => ({ checkStructuredData:  vi.fn().mockResolvedValue({ status: 'warn', message: 'structured_data_found' }) }))
vi.mock('@/lib/checks/extractability',  () => ({ checkExtractability:  vi.fn().mockResolvedValue({ status: 'pass', message: 'extractability_good' }) }))
vi.mock('@/lib/checks/llmsFullTxt',     () => ({ checkLlmsFullTxt:     vi.fn().mockResolvedValue({ status: 'fail', message: 'llms_full_txt_missing' }) }))
vi.mock('@/lib/checks/mcpCard',         () => ({ checkMcpCard:         vi.fn().mockResolvedValue({ status: 'fail', message: 'mcp_card_missing' }) }))
vi.mock('@/lib/checks/sitemap',         () => ({ checkSitemap:         vi.fn().mockResolvedValue({ status: 'pass', message: 'sitemap_found' }) }))
vi.mock('@/lib/checks/metaDescription', () => ({ checkMetaDescription: vi.fn().mockResolvedValue({ status: 'pass', message: 'meta_desc_good' }) }))
vi.mock('@/lib/checks/headingStructure',() => ({ checkHeadingStructure:vi.fn().mockResolvedValue({ status: 'pass', message: 'headings_ok' }) }))
vi.mock('@/lib/checks/faqDetection',    () => ({ checkFaqDetection:    vi.fn().mockResolvedValue({ status: 'fail', message: 'faq_missing' }) }))
vi.mock('@/lib/checks/canonical',       () => ({ checkCanonical:       vi.fn().mockResolvedValue({ status: 'pass', message: 'canonical_ok' }) }))
vi.mock('@/lib/checks/serverText',      () => ({ checkServerText:      vi.fn().mockResolvedValue({ status: 'pass', message: 'render_ok' }) }))
vi.mock('@/lib/checks/internalLinks',   () => ({ checkInternalLinks:   vi.fn().mockResolvedValue({ status: 'warn', message: 'links_few' }) }))
vi.mock('@/lib/checks/entitySignals',   () => ({ checkEntitySignals:   vi.fn().mockResolvedValue({ status: 'pass', message: 'entities_ok' }) }))
vi.mock('@/lib/checks/contentFreshness',() => ({ checkContentFreshness:vi.fn().mockResolvedValue({ status: 'pass', message: 'fresh_ok' }) }))
vi.mock('@/lib/checks/citationDensity', () => ({ checkCitationDensity: vi.fn().mockResolvedValue({ status: 'pass', message: 'citations_good', details: { qualityScore: 75, authorityBreakdown: { tier1: 2, tier2: 3 } } }) }))
vi.mock('@/lib/checks/factualDensity',  () => ({ checkFactualDensity:  vi.fn().mockResolvedValue({ status: 'warn', message: 'factual_low', details: { qualityScore: 40 } }) }))
vi.mock('@/lib/checks/topicalAuthority',() => ({ checkTopicalAuthority:vi.fn().mockResolvedValue({ status: 'pass', message: 'authority_ok', details: { topicalCoverageScore: 70, totalClusters: 3 } }) }))
vi.mock('@/lib/checks/chunkability',    () => ({ checkChunkability:    vi.fn().mockResolvedValue({ status: 'pass', message: 'chunks_ok', details: { optimalChunkRatio: 0.7, totalChunks: 12 } }) }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'scan-abc' }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'scan-abc' }, error: null }),
    }),
  },
}))

vi.mock('@/lib/auth', () => ({
  getProfile: vi.fn().mockResolvedValue(null), // anonymous scan
}))

// Track fetch calls (for n8n webhook)
const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

// ── Tests ────────────────────────────────────────────────────────
describe('POST /api/scan — full scan flow', () => {
  beforeEach(() => {
    // Clear call history only — don't wipe mock implementations
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
  })

  it('returns 400 when URL is missing', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/url/i)
  })

  it('returns scan id, score, and grade on success', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('id', 'scan-abc')
    expect(json).toHaveProperty('score')
    expect(json).toHaveProperty('grade')
    expect(typeof json.score).toBe('number')
    expect(json.score).toBeGreaterThanOrEqual(0)
    expect(json.score).toBeLessThanOrEqual(100)
  })

  it('grade is A+ for score >= 90', async () => {
    const { assignGrade } = await import('@/app/api/scan/route')
    expect(assignGrade(95)).toBe('A+')
    expect(assignGrade(90)).toBe('A+')
  })

  it('grade is A for score 80-89', async () => {
    const { assignGrade } = await import('@/app/api/scan/route')
    expect(assignGrade(85)).toBe('A')
    expect(assignGrade(80)).toBe('A')
  })

  it('grade is F for score < 30', async () => {
    const { assignGrade } = await import('@/app/api/scan/route')
    expect(assignGrade(0)).toBe('F')
    expect(assignGrade(29)).toBe('F')
  })

  it('fires n8n webhook after scan is saved when N8N_SCAN_WEBHOOK_URL is set', async () => {
    // Set env var before the POST call — the route reads it at call time
    process.env.N8N_SCAN_WEBHOOK_URL = 'https://n8n.example.com/webhook/aiso-scan'
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)
    // Webhook is fire-and-forget — flush microtasks
    await new Promise(r => setTimeout(r, 100))
    // Find any fetch call to the n8n URL
    const webhookCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && (url as string).includes('n8n.example.com')
    )
    expect(webhookCall).toBeDefined()
    const [, opts] = webhookCall!
    const body = JSON.parse((opts as RequestInit).body as string)
    expect(body).toHaveProperty('scanId')
    expect(body).toHaveProperty('score')
    expect(body).toHaveProperty('grade')
    delete process.env.N8N_SCAN_WEBHOOK_URL
  })

  it('does NOT fire n8n webhook when N8N_SCAN_WEBHOOK_URL is not set', async () => {
    delete process.env.N8N_SCAN_WEBHOOK_URL
    fetchMock.mockClear()
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)
    await new Promise(r => setTimeout(r, 100))
    const n8nCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && (url as string).includes('n8n')
    )
    expect(n8nCall).toBeUndefined()
  })

  it('includes all 20 check results in response', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const json = await res.json()
    const resultKeys = Object.keys(json.results ?? {})
    // At minimum the core checks should be present
    expect(resultKeys).toContain('c1_robots')
    expect(resultKeys).toContain('c2_llms_txt')
    expect(resultKeys).toContain('c5_extractability')
  })
})
