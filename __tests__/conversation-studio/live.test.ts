import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), sql: vi.fn(), answerUsage: new Map<string, number>() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

const clientId = '11111111-1111-4111-8111-111111111111'
const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const prompt = 'PRIVATE QUESTION: What does this brand do?'
const reply = 'PRIVATE MODEL REPLY'
let outbound: ReturnType<typeof vi.fn>
let info: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
const body = (platforms = ['gemini-flash']) => ({ prompt, platforms, language: 'zh-HK' })
const attachedSourceId = '33333333-3333-4333-8333-333333333333'
const attachRow = {
  id: attachedSourceId, label: 'Approved brand facts', version_id: '44444444-4444-4444-8444-444444444444',
  version_number: 2, content_hash: 'b'.repeat(64),
  content: { schemaVersion: 1, entries: [{ question: 'Which flour?', answer: 'Rice flour.' }] },
}

function answerQuota(strings: TemplateStringsArray, values: unknown[]) {
  if (!strings.join('').includes('studio_live_weekly_usage')) return undefined
  const [accountId, brandId, week, count, cap] = values as [string, string, string, number, number]
  const key = `${accountId}:${brandId}:${week}`
  const current = mocks.answerUsage.get(key) ?? 0
  if (current + count > cap) return [{ allowed: false, answer_count: current }]
  const next = current + count
  mocks.answerUsage.set(key, next)
  return [{ allowed: true, answer_count: next }]
}

function defaultSql(strings: TemplateStringsArray, ...values: unknown[]) {
  const quota = answerQuota(strings, values)
  if (quota) return quota
  if (strings.join('').includes('as used')) return [{ used: 0 }]
  return [{ id: clientId, brand_name: 'Example Brand' }]
}

function attachSql(row: typeof attachRow | null) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('')
    if (text.includes('from client_sources s') && text.includes('v.version_number = s.latest_version')) return row ? [row] : []
    return defaultSql(strings, ...values)
  }
}

async function send(input: unknown = body(), id = clientId, raw = false) {
  const { POST } = await import('@/app/api/dashboard/clients/[clientId]/studio/answer/route')
  const response = await POST(new Request('https://app.example/api/studio', { method: 'POST', body: raw ? input as string : JSON.stringify(input) }), { params: Promise.resolve({ clientId: id }) })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  return response
}

function completion(finish = 'stop') {
  return Response.json({ id: prompt, model: reply, usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001 },
    choices: [{ finish_reason: finish, message: { content: reply, annotations: [
      { type: 'url_citation', url_citation: { url: 'https://source.example/article', title: 'Source' } },
      { type: 'url_citation', url_citation: { url: 'http://127.0.0.1/private' } },
    ] } }] })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', '1')
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', '1')
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '0')
  vi.stubEnv('AISO_LLM_TASK_CALLS', '3')
  vi.stubEnv('AISO_LLM_TASK_TOKENS', '12000')
  vi.stubEnv('AISO_LLM_MAX_OUTPUT_TOKENS', '4000')
  vi.stubEnv('OPENROUTER_API_KEY', 'mock-only')
  mocks.profile.mockResolvedValue({ account_id: accountA, accounts: { override_plan: 'pro' } })
  mocks.answerUsage.clear()
  mocks.sql.mockImplementation(defaultSql)
  outbound = vi.fn(async () => completion())
  vi.stubGlobal('fetch', outbound)
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it.each([['0', '1'], ['1', '0'], ['0', '0'], ['1', 'true'], ['1', undefined]])('returns 404 with no auth, SQL or outbound when flags are %s/%s', async (studio, live) => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', studio)
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO_LIVE', live)
  expect((await send()).status).toBe(404)
  expect(mocks.profile).not.toHaveBeenCalled()
  expect(mocks.sql).not.toHaveBeenCalled()
  expect(outbound).not.toHaveBeenCalled()
})
it('requires authentication before validating UUID or ownership', async () => {
  mocks.profile.mockResolvedValue(null)
  expect((await send(body(), 'bad')).status).toBe(401)
  expect(mocks.sql).not.toHaveBeenCalled()
  expect(outbound).not.toHaveBeenCalled()
})
it('rejects bad UUID and foreign ownership before entitlement or calls', async () => {
  expect((await send(body(), 'bad')).status).toBe(404)
  expect(mocks.sql).not.toHaveBeenCalled()
  mocks.profile.mockResolvedValue({ account_id: 'other', accounts: null })
  mocks.sql.mockResolvedValue([])
  expect((await send()).status).toBe(404)
  expect(mocks.sql.mock.calls[0].slice(1)).toEqual([clientId, 'other'])
  expect(outbound).not.toHaveBeenCalled()
})
it('returns UPGRADE_REQUIRED only after owned-brand lookup', async () => {
  mocks.profile.mockResolvedValue({ account_id: accountA, accounts: { plan: 'free' } })
  const response = await send()
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'UPGRADE_REQUIRED' })
  expect(outbound).not.toHaveBeenCalled()
})
it.each([null, [], {}, { ...body(), prompt: '' }, { ...body(), prompt: ' '.repeat(10) },
  { ...body(), prompt: 'x'.repeat(1001) }, { ...body(), platforms: [] }, { ...body(), platforms: ['gemini'] },
  { ...body(), platforms: ['gemini-flash', 'gemini-flash'] }, { ...body(), platforms: [1] },
  { ...body(), language: 'zh-TW' }, { ...body(), language: ['en'] }, { ...body(), accountId: 'foreign' },
  { ...body(), attachedSourceId: 'not-a-uuid' }, { ...body(), attachedSourceId: { id: attachedSourceId } },
])('rejects invalid input %# without outbound', async input => {
  const response = await send(input)
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'INVALID_STUDIO_INPUT' })
  expect(outbound).not.toHaveBeenCalled()
})
it('bounds actual bytes and rejects malformed JSON at stable 400', async () => {
  for (const text of ['{bad', ' '.repeat(4097), JSON.stringify({ ...body(), prompt: '文'.repeat(1000), extra: 'x'.repeat(1500) })]) {
    expect((await send(text, clientId, true)).status).toBe(400)
  }
  expect(outbound).not.toHaveBeenCalled()
})
it('accepts only Basic plan Gemini, without altering entitlement logic', async () => {
  mocks.profile.mockResolvedValue({ account_id: accountA, accounts: { override_plan: 'basic' } })
  expect((await send(body(['gpt-4o']))).status).toBe(400)
  expect(outbound).not.toHaveBeenCalled()
  expect((await send()).status).toBe(200)
  expect(outbound).toHaveBeenCalledTimes(1)
})
it('fails closed when the brand-week LIVE allowance is already spent', async () => {
  // The cap is a fixed business rule (10 per brand per week), not an env knob:
  // the only way to be refused is for this brand's counter to be at the cap.
  const week = (await import('@/lib/conversation-studio/live-quota')).studioWeek()
  mocks.answerUsage.set(`${accountA}:${clientId}:${week}`, 10)
  const response = await send()
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ error: 'STUDIO_QUOTA_EXCEEDED' })
  expect(outbound).not.toHaveBeenCalled()
})
it('reserves the entire fan-out budget before sending anything', async () => {
  vi.stubEnv('AISO_LLM_TASK_CALLS', '1')
  const response = await send(body(['gemini-flash', 'gpt-4o']))
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ error: 'STUDIO_BUDGET_EXCEEDED' })
  expect(outbound).not.toHaveBeenCalled()
})
it('reserves token budget before the provider and clamps each completion', async () => {
  vi.stubEnv('AISO_LLM_TASK_TOKENS', '100')
  expect((await send()).status).toBe(429)
  expect(outbound).not.toHaveBeenCalled()
  vi.stubEnv('AISO_LLM_MAX_OUTPUT_TOKENS', '50')
  const response = await send()
  expect(response.status).toBe(200)
  const options = outbound.mock.calls[0][1] as RequestInit
  expect(JSON.parse(options.body as string).max_tokens).toBe(50)
  expect(options.signal).toBeInstanceOf(AbortSignal)
})
it('sends one localized question, preserves safe citations and logs only studio metadata', async () => {
  const response = await send()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ quota: { cap: 10, remaining: 9, scope: 'brand' }, answers: [{
    platform: 'gemini-flash', coverage: 'present', answer: reply, finishReason: 'stop', grounding: 'none',
    searchEvidence: { requested: 'none', execution: 'unknown' }, citations: [{ url: 'https://source.example/article', title: 'Source' }],
  }] })
  const sent = JSON.parse((outbound.mock.calls[0][1] as RequestInit).body as string)
  expect(sent.messages).toHaveLength(2)
  expect(sent.messages[0].content).toContain('zh-HK')
  expect(sent.messages[0].content).toContain('Example Brand')
  expect(sent.messages[1]).toEqual({ role: 'user', content: prompt })
  expect(sent.messages[0].content).toContain('Do not claim access to saved records or conversation history.')
  expect(sent.messages[0].content).not.toContain('studio_attached_source')
  expect(sent.plugins).toBeUndefined()
  expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: 'openrouter_usage', label: 'studio.answer', promptTokens: 10 }))
  expect(JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls])).not.toMatch(/PRIVATE QUESTION|PRIVATE MODEL/)
})
it('attaches only the explicitly selected usable source as fenced data', async () => {
  mocks.sql.mockImplementation(attachSql(attachRow))
  const response = await send({ ...body(), attachedSourceId })
  expect(response.status).toBe(200)
  const data = await response.json()
  expect(data.attachment).toMatchObject({
    sourceId: attachedSourceId, label: 'Approved brand facts', versionId: attachRow.version_id,
    versionNumber: 2, contentHash: attachRow.content_hash, entriesIncluded: 1, entriesTotal: 1, truncated: false,
  })
  const sent = JSON.parse((outbound.mock.calls[0][1] as RequestInit).body as string)
  expect(sent.messages).toHaveLength(2)
  expect(sent.messages[0].content).toContain('Example Brand')
  expect(sent.messages[0].content).toContain('beyond this attached source')
  expect(sent.messages[0].content).toContain('<studio_attached_source')
  expect(sent.messages[0].content).toContain('Which flour?')
  expect(sent.messages[0].content).toContain('Rice flour.')
  expect(sent.messages[1]).toEqual({ role: 'user', content: prompt })
  const sourceCall = mocks.sql.mock.calls.find(call => call[0].join('').includes('from client_sources s'))!
  const text = sourceCall[0].join('?')
  expect(text).toMatch(/s\.account_id = \? and s\.client_id = \?/)
  expect(text).toMatch(/s\.agent_use_allowed = true/)
  expect(text).toMatch(/s\.revoked_at is null/)
  expect(text).toMatch(/v\.approved_at is not null/)
  expect(sourceCall.slice(1)).toEqual([accountA, clientId, attachedSourceId])
})
it.each(['foreign', 'unapproved', 'revoked', 'not-agent-usable'])('rejects a %s source before any provider call', async () => {
  mocks.sql.mockImplementation(attachSql(null))
  const response = await send({ ...body(), attachedSourceId })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'STUDIO_ATTACH_UNAVAILABLE' })
  expect(outbound).not.toHaveBeenCalled()
})
it('still stops LIVE when the brand-week allowance is spent, even with a source attached', async () => {
  const week = (await import('@/lib/conversation-studio/live-quota')).studioWeek()
  mocks.answerUsage.set(`${accountA}:${clientId}:${week}`, 10)
  mocks.sql.mockImplementation(attachSql(attachRow))
  const response = await send({ ...body(), attachedSourceId })
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({ error: 'STUDIO_QUOTA_EXCEEDED' })
  expect(outbound).not.toHaveBeenCalled()
})
it('honours the attach inject budget and reports truncation in metadata', async () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({ question: `Q${index}`, answer: 'A'.repeat(1000) }))
  mocks.sql.mockImplementation(attachSql({ ...attachRow, content: { schemaVersion: 1, entries } }))
  const data = await (await send({ ...body(), attachedSourceId })).json()
  expect(data.attachment).toMatchObject({ entriesTotal: 20, truncated: true })
  expect(data.attachment.entriesIncluded).toBeLessThan(20)
  expect(data.attachment.characters).toBeLessThanOrEqual(8000)
  const sent = JSON.parse((outbound.mock.calls[0][1] as RequestInit).body as string)
  expect(sent.messages[0].content).toContain('Q0')
  expect(sent.messages[0].content.length).toBeLessThan(9000)
})
it('keeps partial and total failures explicit and charges attempted calls without retry', async () => {
  outbound.mockResolvedValueOnce(Response.json({ error: prompt }, { status: 503 }))
  const partial = await (await send(body(['gemini-flash', 'gpt-4o']))).json()
  expect(partial.answers.map((a: { coverage: string }) => a.coverage).sort()).toEqual(['missing', 'present'])
  expect(partial.answers.find((a: { coverage: string }) => a.coverage === 'missing')).toMatchObject({ answer: null, error: 'PROVIDER_UNAVAILABLE' })
  outbound.mockRejectedValue(new Error(prompt))
  const failed = await (await send()).json()
  expect(failed.answers[0]).toMatchObject({ coverage: 'missing', answer: null })
  expect(outbound).toHaveBeenCalledTimes(3)
  expect(failed.quota.remaining).toBe(7)
  expect(JSON.stringify([info.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain(prompt)
})
it('meters LIVE per brand in one account and keeps another account separate', async () => {
  const week = (await import('@/lib/conversation-studio/live-quota')).studioWeek()
  mocks.answerUsage.set(`${accountA}:${clientId}:${week}`, 10)
  expect((await send()).status).toBe(429)
  expect((await send(body(), '22222222-2222-4222-8222-222222222222')).status).toBe(200)
  expect(outbound).toHaveBeenCalledTimes(1)
  mocks.profile.mockResolvedValue({ account_id: accountB, accounts: { override_plan: 'pro' } })
  expect((await send()).status).toBe(200)
})
it('only enables web search within the existing allowance and its local Studio reservation', async () => {
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
  vi.stubEnv('PULSE_GROUNDED_ANSWERS_PER_WEEK', '1')
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('').includes('as used')) return [{ used: 0 }]
    return answerQuota(strings, values) ?? [{ id: clientId, brand_name: 'Brand' }]
  })
  await send()
  await send()
  const requests = outbound.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string))
  expect(requests[0].plugins).toEqual([{ id: 'web', max_results: 5 }])
  expect(requests[1].plugins).toBeUndefined()
})
it('fails closed to no web search on allowance lookup failure; native search stays honest', async () => {
  vi.stubEnv('FEATURE_PULSE_GROUNDING', '1')
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join('').includes('as used')) throw new Error('private DB details')
    return answerQuota(strings, values) ?? [{ id: clientId, brand_name: 'Brand' }]
  })
  const data = await (await send(body(['perplexity-sonar', 'gemini-flash']))).json()
  expect(data.answers.map((a: { grounding: string }) => a.grounding).sort()).toEqual(['native', 'none'])
  expect(outbound.mock.calls.every(call => !JSON.parse((call[1] as RequestInit).body as string).plugins)).toBe(true)
})
it('returns unavailable on SQL failure, never a false foreign-brand result', async () => {
  mocks.sql.mockRejectedValue(new Error(prompt))
  expect((await send()).status).toBe(503)
  expect(outbound).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
})

it('aborts stalled provider calls at the shared timeout with no retry', async () => {
  // Load modules before fake time so module loading does not race the clock.
  await import('@/app/api/dashboard/clients/[clientId]/studio/answer/route')
  vi.useFakeTimers()
  // Node's native AbortSignal.timeout uses internal timers, so wire its public
  // contract to fake time while keeping request.signal composition real.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    return controller.signal
  })
  outbound.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
  }))
  const pending = send()
  await vi.advanceTimersByTimeAsync(20_001)
  const response = await pending
  expect(response.status).toBe(200)
  expect((await response.json()).answers[0]).toMatchObject({ coverage: 'missing', error: 'PROVIDER_UNAVAILABLE' })
  expect(outbound).toHaveBeenCalledTimes(1)
})

it('uses the existing UTC Monday boundary for the durable brand-week', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
  const { reserveStudioAnswers, studioWeek } = await import('@/lib/conversation-studio/live-quota')
  expect(studioWeek()).toBe('2026-10-26')
  expect((await reserveStudioAnswers(accountA, clientId, 10, studioWeek())).remaining).toBe(0)
  vi.setSystemTime(new Date('2026-11-01T23:59:59Z'))
  await expect(reserveStudioAnswers(accountA, clientId, 1, studioWeek())).rejects.toThrow('STUDIO_QUOTA_EXCEEDED')
  vi.setSystemTime(new Date('2026-11-02T00:00:00Z'))
  expect(studioWeek()).toBe('2026-11-02')
  expect((await reserveStudioAnswers(accountA, clientId, 1, studioWeek())).remaining).toBe(9)
})
