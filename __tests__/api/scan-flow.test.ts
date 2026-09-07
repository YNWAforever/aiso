/**
 * TDD: Full scan flow
 * Tests the complete path: POST /api/scan → score → DB insert → n8n webhook fire
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Set required env vars before any module is loaded
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

const dbState = vi.hoisted(() => ({ insertValues: [] as unknown[], failInsert: false }))

// ── Mocks ───────────────────────────────────────────────────────
// Mock all 20 checks to return known values
vi.mock('@/lib/checks/robots',          () => ({ checkRobots:          vi.fn().mockResolvedValue({
  status: 'pass',
  message: 'robots_ai_allowed',
  raw: 'PRIVATE_RAW_SENTINEL',
  details: {
    private: 'PRIVATE_DETAIL_SENTINEL',
    url: 'https://private.example.test/internal',
  },
}) }))
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

// Tagged-template SQL mock for the Neon client — the scan insert returns the new row id
vi.mock('@/lib/db', () => {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = Array.from(strings).join(' ')
    if (/insert into scans/i.test(q)) {
      if (dbState.failInsert) throw new Error('mock database write failure')
      dbState.insertValues = values
      return [{ id: 'scan-abc' }]
    }
    return []
  }
  return { db: () => sql }
})


vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: 2_000_000_000 }),
  rateLimitHeaders: () => new Headers({
    'RateLimit-Limit': '5',
    'RateLimit-Remaining': '4',
    'RateLimit-Reset': '2000000000',
  }),
}))

vi.mock('@/lib/auth', () => ({
  getProfile: vi.fn().mockResolvedValue(null), // anonymous scan
}))

// Track fetch calls (for n8n webhook)
const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

// ── Tests ────────────────────────────────────────────────────────
describe('POST /api/scan — full scan flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    // Clear call history only — don't wipe mock implementations
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    dbState.insertValues = []
    dbState.failInsert = false
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

  it('returns 400 for malformed JSON', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: '{"url":',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' })
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
    expect(body.results).not.toHaveProperty('evidence')
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

  it('returns only anonymous scan continuation fields without private scan details', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const json = await res.json()

    expect(Object.keys(json).sort()).toEqual(['grade', 'id', 'score'])
    expect(json).not.toHaveProperty('results')
    expect(json).not.toHaveProperty('raw')
    expect(json).not.toHaveProperty('details')
    expect(json).not.toHaveProperty('url')
    expect(json).not.toHaveProperty('private')
    expect(JSON.stringify(json)).not.toContain('PRIVATE_RAW_SENTINEL')
    expect(JSON.stringify(json)).not.toContain('PRIVATE_DETAIL_SENTINEL')
    expect(JSON.stringify(json)).not.toContain('private.example.test')
  })

  it('persists full scan details even though the response is gated', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req)

    const persistedResults = dbState.insertValues[3]
    expect(typeof persistedResults).toBe('string')
    expect(persistedResults).toContain('PRIVATE_RAW_SENTINEL')
    expect(persistedResults).toContain('PRIVATE_DETAIL_SENTINEL')
    expect(persistedResults).toContain('private.example.test')
  })

  it('persists a versioned pillar snapshot alongside the check results', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req)

    const persistedResults = JSON.parse(dbState.insertValues[3] as string)
    const { readScanEvidence } = await import('@/lib/scan-evidence')
    expect(readScanEvidence(persistedResults.evidence)).toEqual(persistedResults.evidence)
    expect(Object.keys(persistedResults.evidence.checks)).toHaveLength(20)
    expect(JSON.stringify(persistedResults.evidence)).not.toMatch(/PRIVATE_RAW_SENTINEL|PRIVATE_DETAIL_SENTINEL|private.example.test/)
    expect(persistedResults.pillarScores).toBeDefined()
    expect(persistedResults.pillarScores.methodologyVersion).toBe('2026-09-05.v2')
    const { calculatePillarScores } = await import('@/lib/pillar-scores')
    expect(persistedResults.pillarScores).toEqual(calculatePillarScores(persistedResults, persistedResults.evidence.checks))
  })
  it('keeps write failure non-success and does not dispatch a webhook', async () => {
    dbState.failInsert = true
    process.env.N8N_SCAN_WEBHOOK_URL = 'https://n8n.example.com/webhook/aiso-scan'
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(new NextRequest('http://localhost/api/scan', { method:'POST', body:JSON.stringify({url:'https://example.com'}) }))
    expect(res.status).toBe(500)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('n8n.example.com'))).toBe(false)
    delete process.env.N8N_SCAN_WEBHOOK_URL
  })
  it('does not insert evidence for a blocked input and preserves 400', async () => {
    const { PublicUrlError } = await import('@/lib/security/public-url')
    fetchMock.mockRejectedValueOnce(new PublicUrlError('blocked', 'UNSAFE_URL'))
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(new NextRequest('http://localhost/api/scan', { method:'POST', body:JSON.stringify({url:'https://example.com'}) }))
    expect(res.status).toBe(400)
    expect(dbState.insertValues).toEqual([])
  })
  it('preserves a rejected check benchmark while recording failed collection', async () => {
    const { checkLlmsTxt } = await import('@/lib/checks/llmsTxt')
    vi.mocked(checkLlmsTxt).mockRejectedValueOnce(new Error('private rejection'))
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(new NextRequest('http://localhost/api/scan', { method:'POST', body:JSON.stringify({url:'https://example.com/private?secret'}) }))
    expect(res.status).toBe(200)
    const result = JSON.parse(dbState.insertValues[3] as string)
    expect(result.c2_llms_txt).toEqual({status:'fail',message:'check_error'})
    expect(result.evidence.checks.c2_llms_txt.collection).toBe('failed')
    expect(JSON.stringify(result.evidence)).not.toMatch(/private|secret/)
  })

})
