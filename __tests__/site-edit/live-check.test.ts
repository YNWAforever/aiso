import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S4: the payload matcher, the one capped GET, and the route's gate
 * order. The store is mocked (its SQL is proven in live-check-sql.test.ts) and
 * the fetcher is injected/mocked: nothing here touches the network.
 */

const m = vi.hoisted(() => ({ getProfile: vi.fn(), readHandoff: vi.fn(), checkEditSpecDomainPinned: vi.fn(), recordLiveCheck: vi.fn(), fetchLivePage: vi.fn(), loadAutoCheckScope: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: m.getProfile }))
vi.mock('@/lib/site-edit/handoff-store', () => ({ readHandoff: m.readHandoff, claimHandoff: vi.fn(), recordHandoffOutcome: vi.fn() }))
vi.mock('@/lib/site-edit/live-check-store', () => ({ recordLiveCheck: m.recordLiveCheck, loadAutoCheckScope: m.loadAutoCheckScope }))
vi.mock('@/lib/site-edit/domain', () => ({ checkEditSpecDomainPinned: m.checkEditSpecDomainPinned }))
vi.mock('@/lib/site-edit/live-check', async () => {
  const actual = await vi.importActual<typeof import('@/lib/site-edit/live-check')>('@/lib/site-edit/live-check')
  return { ...actual, fetchLivePage: m.fetchLivePage }
})

import { POST } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/handoff/live-check/route'
import { autoCheckAfterReceipt } from '@/lib/site-edit/handoff-service'
const live = await vi.importActual<typeof import('@/lib/site-edit/live-check')>('@/lib/site-edit/live-check')

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const PROFILE = '20000000-0000-4000-8000-000000000001'
const CLIENT = '30000000-0000-4000-8000-000000000001'
const ITEM = '40000000-0000-4000-8000-000000000001'
const VERSION = '50000000-0000-4000-8000-000000000001'
const JOB = '60000000-0000-4000-8000-000000000001'
const HASH = 'a'.repeat(64)
const payload = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Bakery', sameAs: ['https://x.example'] }
const spec = { schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.bakery.hk/', schemaType: 'Organization', payload }
const ctx = { params: Promise.resolve({ clientId: CLIENT, workItemId: ITEM, versionId: VERSION }) }
const post = (body: unknown = { contentHash: HASH }) => POST(new Request('https://x/live-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx)
const sent = [{ seq: 1, kind: 'claim', at: '2026-11-04T00:00:00Z', executorStatus: null, executorRef: null }, { seq: 2, kind: 'sent', at: '2026-11-04T00:00:01Z', executorStatus: 202, executorRef: 'R-1' }]
const read = (over: Record<string, unknown> = {}) => ({
  kind: 'ok', latestId: VERSION, clientName: 'Bakery', job: { id: JOB }, events: sent, receipt: null, liveCheck: null,
  monthSends: { others: 0, selfCounted: true },
  version: { id: VERSION, contentHash: HASH, editSpec: spec, decision: { decision: 'approved', decidedAt: '2026-11-04T00:00:00.000000Z', decidedBy: { profileId: PROFILE, displayName: null, role: 'account_approver' } } }, ...over,
})
const page = (body: string, init: ResponseInit = { headers: { 'content-type': 'text/html; charset=utf-8' } }) => new Response(body, init)
const block = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`

beforeEach(() => {
  vi.clearAllMocks()
  m.getProfile.mockResolvedValue({ id: PROFILE, account_id: ACCOUNT, accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } })
  m.readHandoff.mockResolvedValue(read())
  m.checkEditSpecDomainPinned.mockResolvedValue({ result: 'ok', pin: {} })
  m.fetchLivePage.mockResolvedValue({ outcome: 'found', httpStatus: 200, pageSha256: 'c'.repeat(64), checkedAt: new Date() })
  m.recordLiveCheck.mockResolvedValue({ kind: 'recorded', outcome: 'found', attested: true, alreadyAttested: false })
})

describe('payload matcher', () => {
  it('finds the approved payload regardless of key order, inside arrays and @graph, and ignores broken blocks', () => {
    const reordered = { sameAs: ['https://x.example'], name: 'Bakery', '@type': 'Organization', '@context': 'https://schema.org/' }
    expect(live.pageHasPayload(`<html>${block(reordered)}</html>`, payload)).toBe(true)
    expect(live.pageHasPayload(block([{ '@type': 'WebSite' }, reordered]), payload)).toBe(true)
    expect(live.pageHasPayload(block({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: 'Bakery', sameAs: ['https://x.example'] }] }), payload)).toBe(true)
    expect(live.pageHasPayload(`<script type='application/ld+json'>{broken</script>${block(payload)}`, payload)).toBe(true)
  })

  it('counts only real ld+json script elements: not commented out, not data-type, not inside <template>', () => {
    expect(live.pageHasPayload(`<!-- ${block(payload)} -->`, payload)).toBe(false)
    expect(live.pageHasPayload(`<script data-type="application/ld+json">${JSON.stringify(payload)}</script>`, payload)).toBe(false)
    expect(live.pageHasPayload(`<template>${block(payload)}</template>`, payload)).toBe(false)
    expect(live.pageHasPayload(`<script type=" Application/LD+JSON ">${JSON.stringify(payload)}</script>`, payload)).toBe(true)
  })

  it('requires the block to be read as schema.org: its own context, or the @graph wrapper it inherits', () => {
    expect(live.pageHasPayload(block({ ...payload, '@context': 'https://example.com/' }), payload)).toBe(false)
    const { '@context': _context, ...bare } = payload
    expect(live.pageHasPayload(block(bare), payload)).toBe(false)
    expect(live.pageHasPayload(block({ '@context': 'https://example.com/', '@graph': [bare] }), payload)).toBe(false)
    expect(live.pageHasPayload(block({ '@context': 'http://schema.org', '@graph': [bare] }), payload)).toBe(true)
    expect(live.pageHasPayload(block({ '@context': { '@vocab': 'https://schema.org/' }, '@graph': [bare] }), payload)).toBe(false)
  })

  it('searches every block on the page, so a match after many others is still found (no cap to hide behind)', () => {
    const filler = Array.from({ length: 80 }, (_, i) => block({ '@context': 'https://schema.org', '@type': 'Thing', name: `n${i}` })).join('')
    expect(live.pageHasPayload(filler + block(payload), payload)).toBe(true)
  })

  it('does not match a changed, partial or non-JSON-LD copy', () => {
    expect(live.pageHasPayload(block({ ...payload, name: 'Other' }), payload)).toBe(false)
    expect(live.pageHasPayload(block({ '@type': 'Organization', name: 'Bakery' }), payload)).toBe(false)
    expect(live.pageHasPayload(block({ ...payload, extra: 1 }), payload)).toBe(false)
    expect(live.pageHasPayload(`<script type="application/json">${JSON.stringify(payload)}</script><p>${JSON.stringify(payload)}</p>`, payload)).toBe(false)
  })

  it('maps the single GET: found, missing, and fetch_failed for non-2xx, non-HTML, oversized or thrown', async () => {
    const run = (response: Response | Error) => live.fetchLivePage(spec.targetUrl, spec as never, vi.fn(async () => { if (response instanceof Error) throw response; return response }))
    expect(await run(page(block(payload)))).toMatchObject({ outcome: 'found', httpStatus: 200, pageSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await run(page('<html></html>'))).toMatchObject({ outcome: 'missing', httpStatus: 200, structuredData: { status: 'fail', message: 'structured_data_missing' } })
    expect(await run(page(block(payload)))).toMatchObject({ structuredData: { status: 'pass', message: 'structured_data_found' } })
    expect(await run(page(block(payload), { status: 404, headers: { 'content-type': 'text/html' } }))).toMatchObject({ outcome: 'fetch_failed', httpStatus: 404, pageSha256: null })
    expect(await run(page(block(payload), { headers: { 'content-type': 'application/json' } }))).toMatchObject({ outcome: 'fetch_failed' })
    expect(await run(page('x'.repeat(live.LIVE_CHECK_BODY_LIMIT + 1)))).toMatchObject({ outcome: 'fetch_failed', pageSha256: null })
    expect(await run(new Error('UNSAFE_URL'))).toMatchObject({ outcome: 'fetch_failed', httpStatus: null })
    expect((await run(page('<html></html>', { status: 500, headers: { 'content-type': 'text/html' } }))).structuredData).toBeUndefined()
  })
})

describe('POST …/handoff/live-check', () => {
  it('refuses anonymous, bad input and a stale hash before any fetch', async () => {
    m.getProfile.mockResolvedValueOnce(null)
    expect((await post()).status).toBe(401)
    for (const body of [{}, { contentHash: 'x' }, { contentHash: HASH, url: 'https://evil.example' }]) expect((await post(body)).status).toBe(400)
    expect((await post({ contentHash: 'b'.repeat(64) })).status).toBe(409)
    expect(m.fetchLivePage).not.toHaveBeenCalled()
  })

  it('checks only an open job: never handed off, refused, declined, superseded or off-domain is refused without a fetch', async () => {
    const closed = [read({ job: null, events: [] }), read({ events: [sent[0], { ...sent[1], kind: 'failed', executorStatus: 503 }] }),
      read({ receipt: { status: 'rejected', completedAt: '2026-11-04T01:00:00Z' } }), read({ latestId: 'other' })]
    for (const value of closed) {
      m.readHandoff.mockResolvedValueOnce(value)
      const response = await post()
      expect([response.status, (await response.json()).error]).toEqual([409, 'LIVE_CHECK_NOT_OPEN'])
    }
    m.checkEditSpecDomainPinned.mockResolvedValueOnce({ result: 'domain_mismatch' })
    expect((await (await post()).json()).error).toBe('HANDOFF_DOMAIN_UNVERIFIED')
    expect(m.fetchLivePage).not.toHaveBeenCalled()
  })

  it('spaces checks a minute apart', async () => {
    m.readHandoff.mockResolvedValueOnce(read({ liveCheck: { outcome: 'missing', checkedAt: new Date().toISOString(), attested: false } }))
    const response = await post()
    expect([response.status, (await response.json()).error]).toEqual([429, 'LIVE_CHECK_TOO_SOON'])
    expect(m.fetchLivePage).not.toHaveBeenCalled()
  })

  it('fetches the frozen target (never a caller URL), records against the session account, and 201s only after the write', async () => {
    m.readHandoff.mockResolvedValueOnce(read({ events: [], job: { id: JOB }, receipt: { status: 'completed', completedAt: '2026-11-04T01:00:00Z' } }))
    const response = await post()
    expect(response.status).toBe(201)
    expect(m.fetchLivePage).toHaveBeenCalledWith('https://www.bakery.hk/', expect.objectContaining({ kind: 'jsonld', payload }))
    expect(m.recordLiveCheck).toHaveBeenCalledWith({ accountId: ACCOUNT, actorId: PROFILE, clientId: CLIENT, itemId: ITEM, versionId: VERSION }, HASH,
      expect.objectContaining({ outcome: 'found', targetUrl: 'https://www.bakery.hk/', kind: 'jsonld' }))
    expect((await response.json()).check).toEqual({ outcome: 'found', attested: true, alreadyAttested: false })
    m.recordLiveCheck.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post()).status).toBe(503)
    spy.mockRestore()
    m.recordLiveCheck.mockResolvedValueOnce({ kind: 'ineligible' })
    expect((await post()).status).toBe(409)
  })
})

describe('S6 autoCheckAfterReceipt', () => {
  const scope = { accountId: ACCOUNT, actorId: PROFILE, clientId: CLIENT, itemId: ITEM, versionId: VERSION }
  const completed = read({ receipt: { status: 'completed', completedAt: '2026-11-04T01:00:00Z' } })

  it('runs one check as the sender, through the same gates, marked as receipt-triggered', async () => {
    m.loadAutoCheckScope.mockResolvedValueOnce(scope)
    m.readHandoff.mockResolvedValueOnce(completed)
    await autoCheckAfterReceipt(JOB, ACCOUNT)
    expect(m.loadAutoCheckScope).toHaveBeenCalledWith(JOB, ACCOUNT)
    expect(m.readHandoff).toHaveBeenCalledWith(scope)
    expect(m.fetchLivePage).toHaveBeenCalledWith('https://www.bakery.hk/', expect.objectContaining({ kind: 'jsonld', payload }))
    expect(m.recordLiveCheck).toHaveBeenCalledWith(scope, HASH, expect.objectContaining({ trigger: 'receipt', kind: 'jsonld' }))
  })

  it('does nothing when the job has no sender, is another version, is spaced out, superseded or off-domain — and never throws', async () => {
    m.loadAutoCheckScope.mockResolvedValueOnce(null)
    await autoCheckAfterReceipt(JOB, ACCOUNT)
    for (const value of [read({ job: { id: 'other' } }), read({ latestId: 'other' }),
      read({ liveCheck: { outcome: 'missing', checkedAt: new Date().toISOString(), attested: false } }), { kind: 'denied' }]) {
      m.loadAutoCheckScope.mockResolvedValueOnce(scope)
      m.readHandoff.mockResolvedValueOnce(value)
      await autoCheckAfterReceipt(JOB, ACCOUNT)
    }
    expect(m.fetchLivePage).not.toHaveBeenCalled()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.loadAutoCheckScope.mockResolvedValueOnce(scope)
    m.readHandoff.mockResolvedValueOnce(completed)
    m.checkEditSpecDomainPinned.mockResolvedValueOnce({ result: 'mismatch' })
    await expect(autoCheckAfterReceipt(JOB, ACCOUNT)).resolves.toBeUndefined()
    m.loadAutoCheckScope.mockRejectedValueOnce(new Error('db down'))
    await expect(autoCheckAfterReceipt(JOB, ACCOUNT)).resolves.toBeUndefined()
    expect(m.fetchLivePage).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

describe('S9 meta matcher', () => {
  const head = (inner: string) => `<!doctype html><html><head>${inner}</head><body><p>Hi</p></body></html>`
  const meta = { title: 'Menu · Example Bakery', description: 'Fresh bread daily.' }
  it('matches the document title and every meta description, whitespace-collapsed', () => {
    expect(live.pageHasMeta(head('<title>\n  Menu ·   Example Bakery </title><meta name="Description" content=" Fresh  bread daily. ">'), meta)).toBe(true)
    expect(live.pageHasMeta(head('<title>Menu &middot; Example Bakery</title>'), { title: meta.title, description: null })).toBe(true) // entities decode
    expect(live.pageHasMeta(head('<meta name="description" content="Fresh bread daily.">'), { title: null, description: meta.description })).toBe(true)
  })
  it('does not match a different, missing, SVG-only or template-only title, or a stale duplicate description', () => {
    expect(live.pageHasMeta(head('<title>Old menu</title><meta name="description" content="Fresh bread daily.">'), meta)).toBe(false)
    expect(live.pageHasMeta(head('<meta name="description" content="Fresh bread daily.">'), meta)).toBe(false)
    expect(live.pageHasMeta(`<html><head></head><body><svg><title>${meta.title}</title></svg></body></html>`, { title: meta.title, description: null })).toBe(false)
    expect(live.pageHasMeta(head(`<template><title>${meta.title}</title></template>`), { title: meta.title, description: null })).toBe(false)
    // The FIRST title is the document title.
    expect(live.pageHasMeta(head(`<title>Old</title><title>${meta.title}</title>`), { title: meta.title, description: null })).toBe(false)
    expect(live.pageHasMeta(head(`<title>${meta.title}</title><meta name="description" content="Fresh bread daily."><meta name="description" content="Old text">`), meta)).toBe(false)
    expect(live.pageHasMeta(head(`<title>${meta.title}</title>`), meta)).toBe(false) // no description at all
    expect(live.pageHasMeta(head(`<title>${meta.title}</title><meta property="description" content="Fresh bread daily.">`), meta)).toBe(false)
  })
  it('fetchLivePage dispatches on the spec kind', async () => {
    const spec = { schemaVersion: 1, kind: 'meta', targetUrl: 'https://www.bakery.hk/', ...meta } as const
    const html = head(`<title>${meta.title}</title><meta name="description" content="${meta.description}">`)
    const fetcher = vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(await live.fetchLivePage(spec.targetUrl, spec, fetcher)).toMatchObject({ outcome: 'found', httpStatus: 200, structuredData: null })
    const stale = vi.fn(async () => new Response(head('<title>Old</title>'), { status: 200, headers: { 'content-type': 'text/html' } }))
    expect(await live.fetchLivePage(spec.targetUrl, spec, stale)).toMatchObject({ outcome: 'missing' })
  })
})

describe('S10 llms.txt matcher', () => {
  const content = '# Example Bakery\n\n> Fresh bread daily.  \n- [Menu](https://www.bakery.hk/menu)\n'
  it('matches the served file up to line endings, a BOM and trailing whitespace at the end', () => {
    expect(live.fileHasLlmsTxt(content, content)).toBe(true)
    expect(live.fileHasLlmsTxt('\uFEFF' + content.replace(/\n/g, '\r\n') + '\n\n', content)).toBe(true)
    expect(live.fileHasLlmsTxt(content.trimEnd(), content)).toBe(true)
  })
  it('does not match changed, partial or reformatted text', () => {
    expect(live.fileHasLlmsTxt(content.replace('daily', 'weekly'), content)).toBe(false)
    expect(live.fileHasLlmsTxt('# Example Bakery\n', content)).toBe(false)
    expect(live.fileHasLlmsTxt(content.replace('daily.  ', 'daily.'), content)).toBe(false) // Markdown line break kept
    expect(live.fileHasLlmsTxt('  ' + content, content)).toBe(false)
  })
  it('fetches the file as text, and treats an HTML page in its place as not loaded', async () => {
    const spec = { schemaVersion: 1, kind: 'llms_txt', targetUrl: 'https://www.bakery.hk/llms.txt', content } as const
    const serve = (body: string, type: string) => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('accept')).toBe('text/plain, text/markdown')
      return new Response(body, { status: 200, headers: { 'content-type': type } })
    })
    expect(await live.fetchLivePage(spec.targetUrl, spec, serve(content, 'text/plain; charset=utf-8'))).toMatchObject({ outcome: 'found', structuredData: null })
    expect(await live.fetchLivePage(spec.targetUrl, spec, serve(content, 'text/markdown'))).toMatchObject({ outcome: 'found' })
    expect(await live.fetchLivePage(spec.targetUrl, spec, serve('# Old\n', 'text/plain'))).toMatchObject({ outcome: 'missing' })
    // A soft 404 (the site's HTML page answering 200) is not the file.
    expect(await live.fetchLivePage(spec.targetUrl, spec, serve(`<html><body>${content}</body></html>`, 'text/html'))).toMatchObject({ outcome: 'fetch_failed', httpStatus: 200 })
    expect(await live.fetchLivePage(spec.targetUrl, spec, serve(content, 'application/octet-stream'))).toMatchObject({ outcome: 'fetch_failed' })
  })
})
