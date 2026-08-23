import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: h.db }))

async function importRoute(path: string) {
  vi.resetModules()
  return import(path)
}

function request(body: unknown, header?: string) {
  return new Request('https://app.example/api/clients/client-1/agents/competitors', {
    method: 'POST',
    headers: header ? { 'x-cron-secret': header, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CLIENT_ID = 'client-1'
const params = Promise.resolve({ clientId: CLIENT_ID })

describe('POST /api/clients/[clientId]/agents/competitors', () => {
  const originalSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let queries: string[]
  let nextResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    queries = []
    nextResults = []
    mockSql = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'))
      const result = nextResults.shift()
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result ?? [])
    })
    h.db.mockReturnValue(mockSql)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  const ROUTE = '@/app/api/clients/[clientId]/agents/competitors/route'
  const COMPETITOR = {
    platform: 'chatgpt', competitorDomain: 'rival.com', competitorName: 'Rival Co',
    mentionRate: 42, yourRate: 10, gapAnalysis: 'They rank for X, you do not',
  }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [] }, 'anything'), { params })

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong x-cron-secret', async () => {
    const { POST } = await importRoute(ROUTE)

    expect((await POST(request({ scanId: 'scan-1', competitors: [] }), { params })).status).toBe(401)
    expect((await POST(request({ scanId: 'scan-1', competitors: [] }, 'wrong'), { params })).status).toBe(401)
  })

  it('returns 400 when scanId or competitors is missing/malformed', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1' }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 400 for a null or non-object JSON body, not an unhandled crash', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request(null, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 503 when the scan lookup itself fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(503)
  })

  it('returns 404 when the scan does not exist or belongs to another client', async () => {
    nextResults = [[]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(404)
  })

  it('scopes the scan lookup to both the scanId and the URL clientId', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    await POST(request({ scanId: 'scan-1', competitors: [] }, 'test-cron-secret-0123'), { params })

    expect(queries[0]).toMatch(/from scans/i)
    expect(queries[0]).toMatch(/client_id = \?/i)
    const [, ...lookupParams] = mockSql.mock.calls[0]!
    expect(lookupParams).toEqual(['scan-1', CLIENT_ID])
  })

  it('returns { count: 0 } for an empty array without upserting or checking completion', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockSql).toHaveBeenCalledTimes(1) // the scan lookup only
  })

  it('upserts each competitor and returns 500 if the write fails', async () => {
    nextResults = [[{ id: 'scan-1' }], new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(500)
    expect(queries[1]).toMatch(/insert into agent_competitors/i)
    expect(queries[1]).toMatch(/on conflict \(scan_id, platform, competitor_domain\)/i)
  })

  it('upserts successfully and checks completion, returning the count', async () => {
    nextResults = [
      [{ id: 'scan-1' }],          // scan lookup
      [],                          // upsert (no rows returned)
      [{ exists: 1 }], [], [{ exists: 1 }], // markCompleteIfAllPresent: recs, progress, competitors — not all present, no update
    ]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', competitors: [COMPETITOR] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    const [, ...upsertParams] = mockSql.mock.calls[1]!
    expect(upsertParams).toEqual(['scan-1', 'chatgpt', 'rival.com', 'Rival Co', 42, 10, 'They rank for X, you do not'])
  })

  it('accepts a competitor with no competitorName, inserting null', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [{ exists: 1 }], [], [{ exists: 1 }],
    ]
    const { POST } = await importRoute(ROUTE)
    const noName = { platform: 'chatgpt', competitorDomain: 'rival.com', mentionRate: 42, yourRate: 10, gapAnalysis: 'gap' }

    const res = await POST(request({ scanId: 'scan-1', competitors: [noName] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    const [, ...upsertParams] = mockSql.mock.calls[1]!
    expect(upsertParams).toEqual(['scan-1', 'chatgpt', 'rival.com', null, 42, 10, 'gap'])
  })
})

describe('POST /api/clients/[clientId]/agents/progress', () => {
  const originalSecret = process.env.CRON_SECRET
  let mockSql: ReturnType<typeof vi.fn>
  let queries: string[]
  let nextResults: unknown[][]

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret-0123'
    queries = []
    nextResults = []
    mockSql = vi.fn((strings: TemplateStringsArray) => {
      queries.push(strings.join('?'))
      const result = nextResults.shift()
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result ?? [])
    })
    h.db.mockReturnValue(mockSql)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  const ROUTE = '@/app/api/clients/[clientId]/agents/progress/route'
  const METRIC = { platform: 'chatgpt', metric: 'sov', currentValue: 25, previousValue: 20 }

  it('returns 500 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [] }, 'anything'), { params })

    expect(res.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or wrong x-cron-secret', async () => {
    const { POST } = await importRoute(ROUTE)

    expect((await POST(request({ scanId: 'scan-1', progress: [] }), { params })).status).toBe(401)
    expect((await POST(request({ scanId: 'scan-1', progress: [] }, 'wrong'), { params })).status).toBe(401)
  })

  it('returns 400 when scanId or progress is missing/malformed', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1' }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 400 for a null or non-object JSON body, not an unhandled crash', async () => {
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request(null, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(400)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 503 when the scan lookup itself fails', async () => {
    nextResults = [new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(503)
  })

  it('returns 404 when the scan does not exist or belongs to another client', async () => {
    nextResults = [[]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(404)
  })

  it('returns { count: 0 } for an empty array without upserting or checking completion', async () => {
    nextResults = [[{ id: 'scan-1' }]]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0 })
    expect(mockSql).toHaveBeenCalledTimes(1)
  })

  it('computes delta from currentValue - previousValue when delta is not provided', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], // all present
    ]
    const { POST } = await importRoute(ROUTE)

    await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    const [, ...upsertParams] = mockSql.mock.calls[1]!
    // scan_id, platform, metric, current_value, previous_value, delta
    expect(upsertParams).toEqual(['scan-1', 'chatgpt', 'sov', 25, 20, 5])
  })

  it('upserts each metric and returns 500 if the write fails', async () => {
    nextResults = [[{ id: 'scan-1' }], new Error('connection terminated') as never]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(500)
    expect(queries[1]).toMatch(/insert into agent_progress/i)
    expect(queries[1]).toMatch(/on conflict \(scan_id, platform, metric\)/i)
  })

  it('upserts successfully, marks complete when all three tables have data, returns the count', async () => {
    nextResults = [
      [{ id: 'scan-1' }],
      [],
      [{ exists: 1 }], [{ exists: 1 }], [{ exists: 1 }], // all three present
      [],
    ]
    const { POST } = await importRoute(ROUTE)

    const res = await POST(request({ scanId: 'scan-1', progress: [METRIC] }, 'test-cron-secret-0123'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(queries[queries.length - 1]).toMatch(/update scans set agent_status = 'complete'/i)
  })
})
