import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUpsert, mockEq, mockFrom } = vi.hoisted(() => {
  const mockUpsert = vi.fn()
  const mockEq = vi.fn()
  const mockFrom = vi.fn()
  return { mockUpsert, mockEq, mockFrom }
})

mockEq.mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'scan-1', account_id: null }, error: null }) })
mockFrom.mockImplementation((table: string) => {
  if (table === 'scans') return {
    select: vi.fn().mockReturnValue({ eq: mockEq }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ error: null }) }) }),
  }
  if (table === 'agent_recommendations') return {
    upsert: mockUpsert,
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 1 }) }),
  }
  if (table === 'agent_progress') return {
    upsert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 1 }) }),
  }
  if (table === 'agent_competitors') return {
    upsert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count: 1 }) }),
  }
  return { upsert: vi.fn().mockResolvedValue({ error: null }) }
})
mockUpsert.mockResolvedValue({ error: null })

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

import { POST } from '@/app/api/clients/[clientId]/agents/recommendations/route'

describe('POST /api/clients/[clientId]/agents/recommendations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', recommendations: [] }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('rejects when scanId is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendations: [] }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(400)
  })

  it('upserts recommendations and returns count', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const recs = [
      { platform: 'openai/gpt-4o', category: 'structured_data', priority: 'high', recommendation: 'Add FAQ schema', impactScore: 8 },
      { platform: 'openai/gpt-4o', category: 'citation', priority: 'medium', recommendation: 'Cite more sources', impactScore: 5 },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', recommendations: recs }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(mockUpsert).toHaveBeenCalled()
  })
})

import { POST as POST_PROGRESS } from '@/app/api/clients/[clientId]/agents/progress/route'

describe('POST /api/clients/[clientId]/agents/progress', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/clients/c-1/agents/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', progress: [] }),
    })
    const res = await POST_PROGRESS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('upserts progress and returns count', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const progressRows = [
      { platform: 'openai/gpt-4o', metric: 'sov', currentValue: 34, previousValue: 28, delta: 6 },
      { platform: 'openai/gpt-4o', metric: 'authority_score', currentValue: 7.2, previousValue: 6.8, delta: 0.4 },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/progress', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', progress: progressRows }),
    })
    const res = await POST_PROGRESS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
  })
})

import { POST as POST_COMPETITORS } from '@/app/api/clients/[clientId]/agents/competitors/route'

describe('POST /api/clients/[clientId]/agents/competitors', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/clients/c-1/agents/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', competitors: [] }),
    })
    const res = await POST_COMPETITORS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('upserts competitors and returns count', async () => {
    process.env.CRON_SECRET = 'test-secret'
    const competitors = [
      { platform: 'openai/gpt-4o', competitorDomain: 'rival.com', competitorName: 'Rival Inc', mentionRate: 45, yourRate: 28, gapAnalysis: 'Rival has FAQ schema' },
      { platform: 'anthropic/claude-haiku-4-5', competitorDomain: 'other.com', mentionRate: 32, yourRate: 28, gapAnalysis: 'Slight lead in topical authority' },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/competitors', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', competitors }),
    })
    const res = await POST_COMPETITORS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
  })
})
