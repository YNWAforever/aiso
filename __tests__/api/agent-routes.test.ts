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
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  }
  if (table === 'agent_recommendations') return { upsert: mockUpsert }
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
