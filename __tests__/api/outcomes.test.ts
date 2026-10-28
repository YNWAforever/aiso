import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ authorize: vi.fn(), load: vi.fn(), rate: vi.fn(), ingest: vi.fn(), deploy: vi.fn(), read: vi.fn(), summary: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/outcome-integrations/measurements', () => ({ loadOutcomeMeasurements: vi.fn(), loadOutcomeSummary: h.summary }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/outcome-integrations/indexnow', () => ({ submitIndexNow: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isFeatureEnabled: () => true }))
vi.mock('@/lib/outcome-integrations/guard', async original => ({ ...await original<typeof import('@/lib/outcome-integrations/guard')>(), authorizeOutcomeClient: h.authorize }))
vi.mock('@/lib/outcome-integrations/credentials', () => ({ loadOutcomeCredential: h.load, consumeOutcomeRate: h.rate, createOutcomeCredential: vi.fn(), listOutcomeCredentials: vi.fn(), revokeOutcomeCredential: vi.fn(), parseCredentialInput: vi.fn() }))
vi.mock('@/lib/outcome-integrations/store', () => ({ ingestAnalytics: h.ingest, recordOutcomeDeployment: h.deploy, readOutcomeData: h.read, saveCluster: vi.fn() }))
import { ingestOutcomeRequest, readOutcomes, readOutcomeSummary } from '@/lib/outcome-integrations/service'
import { signOutcomeBody } from '@/lib/outcome-integrations/signature'
import { OutcomeError } from '@/lib/outcome-integrations/input'
const scope = { accountId: 'owner', clientId: 'client' }
const event = { eventId: 'event:0001', occurredAt: new Date().toISOString(), pageUrl: 'https://example.com/a', sessions: 2, conversions: 1, revenueMinor: 200, currency: 'HKD' }
function request(body = JSON.stringify({ events: [event] }), signature?: string) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Request('https://app.example.com/api/outcomes/v1/analytics', { method: 'POST', body,
    headers: { 'x-aiso-key-id': 'key', 'x-aiso-timestamp': timestamp, 'x-aiso-signature': signature ?? signOutcomeBody('secret', timestamp, body) } })
}
beforeEach(() => {
  vi.clearAllMocks()
  h.load.mockResolvedValue({ id: 'key', scope, domain: 'example.com', secret: 'secret', scopes: ['analytics'] })
  h.ingest.mockResolvedValue({ accepted: 1, replayed: 0 })
  h.authorize.mockResolvedValue({ scope })
})
describe('outcome connector and owned reads', () => {
  it('reads the Monitor summary only in the authorized scope', async () => {
    h.summary.mockResolvedValue({ search: null,analytics: null,retrieval: 'unavailable' })
    expect((await readOutcomeSummary('client')).status).toBe(200)
    expect(h.summary).toHaveBeenCalledWith(scope)
    h.summary.mockClear(); h.authorize.mockRejectedValue(new OutcomeError('OUTCOME_NOT_FOUND',404))
    expect((await readOutcomeSummary('foreign')).status).toBe(404)
    expect(h.summary).not.toHaveBeenCalled()
  })
  it('uses credential scope for a valid signed owned event', async () => {
    expect((await ingestOutcomeRequest(request(), 'analytics')).status).toBe(200)
    expect(h.ingest).toHaveBeenCalledWith(scope, [expect.objectContaining({ pageUrl: event.pageUrl })])
  })
  it.each(['bad-signature', 'missing-key', 'wrong-scope', 'foreign-url', 'account-payload', 'malformed-json'])('refuses %s before rate reservation or writes', async scenario => {
    let req = request()
    if (scenario === 'bad-signature') req = request(undefined, 'v1=' + '0'.repeat(64))
    if (scenario === 'missing-key') h.load.mockResolvedValue(null)
    if (scenario === 'wrong-scope') h.load.mockResolvedValue({ scopes: ['deployments'] })
    if (scenario === 'foreign-url') req = request(JSON.stringify({ events: [{ ...event, pageUrl: 'https://foreign.example/a' }] }))
    if (scenario === 'account-payload') req = request(JSON.stringify({ accountId: 'foreign', events: [event] }))
    if (scenario === 'malformed-json') req = request('{')
    expect((await ingestOutcomeRequest(req, 'analytics')).status).toBe(scenario.includes('key') || scenario.includes('signature') || scenario === 'wrong-scope' ? 401 : 400)
    expect(h.rate).not.toHaveBeenCalled(); expect(h.ingest).not.toHaveBeenCalled()
  })
  it('propagates rate refusal without ingestion', async () => {
    h.rate.mockRejectedValueOnce(new OutcomeError('OUTCOME_RATE_LIMITED', 429))
    expect((await ingestOutcomeRequest(request(), 'analytics')).status).toBe(429)
    expect(h.ingest).not.toHaveBeenCalled()
  })
  it('denies a foreign owned read and does not query outcomes', async () => {
    h.authorize.mockRejectedValue(new OutcomeError('OUTCOME_NOT_FOUND', 404))
    expect((await readOutcomes('foreign', request())).status).toBe(404)
    expect(h.read).not.toHaveBeenCalled()
  })
})
