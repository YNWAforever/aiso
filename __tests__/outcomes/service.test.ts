import { beforeEach, expect, test, vi } from 'vitest'
import { input } from './fixtures'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ profile: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/outcomes/store', () => ({ readOutcomeInput: mocks.read }))

import { getOutcomes } from '@/lib/outcomes/service'

const accountId = '123e4567-e89b-42d3-a456-426614174004'
const actorId = '123e4567-e89b-42d3-a456-426614174005'
const clientId = '123e4567-e89b-42d3-a456-426614174006'
const itemId = '123e4567-e89b-42d3-a456-426614174007'
const versionId = '123e4567-e89b-42d3-a456-426614174008'
const params = { clientId, workItemId: itemId, versionId }
const scope = { accountId, actorId, clientId, itemId, versionId }
const outcomeInput = () => input({ clientId, itemId, versionId })
const request = (query = '') => new Request(`https://example.test/outcomes${query}`)

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ error: code })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.profile.mockResolvedValue({ id: actorId, account_id: accountId, is_admin: true })
  mocks.read.mockResolvedValue({ kind: 'ok', value: outcomeInput() })
})

test('authenticates before caller-controlled validation or reads', async () => {
  mocks.profile.mockResolvedValue(null)
  await expectError(await getOutcomes(request('?clock=forged'), { clientId: 'bad', workItemId: 'bad', versionId: 'bad' }), 401, 'OUTCOMES_UNAUTHENTICATED')
  expect(mocks.read).not.toHaveBeenCalled()
})

test('maps authentication dependency failure to an allowlisted unavailable response', async () => {
  mocks.profile.mockRejectedValue(new Error('password SQL SECRET'))
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
  expect(mocks.read).not.toHaveBeenCalled()
  expect(console.error).toHaveBeenCalledWith({ event: 'outcomes_unavailable', category: 'authentication' })
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/password|SQL|SECRET/)
})

test.each([0, 1, 2])('rejects malformed path identifier %i before reading', async position => {
  const values = [clientId, itemId, versionId]
  values[position] = 'bad'
  await expectError(await getOutcomes(request(), { clientId: values[0], workItemId: values[1], versionId: values[2] }), 400, 'OUTCOMES_INVALID_INPUT')
  expect(mocks.read).not.toHaveBeenCalled()
})

test.each(['?clock=2026-09-07T00%3A00%3A00Z', '?source=scan', '?x=1&x=2'])('rejects every query key: %s', async query => {
  await expectError(await getOutcomes(request(query), params), 400, 'OUTCOMES_INVALID_INPUT')
  expect(mocks.read).not.toHaveBeenCalled()
})

test('normalizes paths and derives account and actor scope only from the session', async () => {
  const response = await getOutcomes(request(), {
    clientId: clientId.toUpperCase(), workItemId: itemId.toUpperCase(), versionId: versionId.toUpperCase(),
  })
  expect(response.status).toBe(200)
  expect(mocks.read).toHaveBeenCalledWith(scope)
})

test.each([['not_found', 404, 'OUTCOMES_NOT_FOUND'], ['denied', 403, 'OUTCOMES_DENIED']] as const)(
  'maps %s without disclosing ownership details', async (kind, status, code) => {
    mocks.read.mockResolvedValue({ kind })
    await expectError(await getOutcomes(request(), params), status, code)
  },
)

test('maps reader and projection failures to unavailable without exposing details', async () => {
  const secret = 'SQL source SECRET'
  mocks.read.mockRejectedValue(new Error(secret))
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
  expect(console.error).toHaveBeenCalledWith({ event: 'outcomes_unavailable', category: 'read' })
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret)
})

test('maps an explicit unavailable reader result to 503', async () => {
  mocks.read.mockResolvedValue({ kind: 'unavailable' })
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
  expect(console.error).toHaveBeenCalledWith({ event: 'outcomes_unavailable', category: 'read' })
})

test.each([
  ['client', { clientId: '123e4567-e89b-42d3-a456-426614174099' }],
  ['item', { itemId: '123e4567-e89b-42d3-a456-426614174099' }],
  ['version', { versionId: '123e4567-e89b-42d3-a456-426614174099' }],
] as const)('rejects returned %s scope mismatch as unavailable', async (_field, mismatch) => {
  mocks.read.mockResolvedValue({ kind: 'ok', value: input({ clientId, itemId, versionId, ...mismatch }) })
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
})

test('does not let identical item and version IDs under another requested client bypass scope', async () => {
  const otherClientId = '123e4567-e89b-42d3-a456-426614174009'
  mocks.read.mockResolvedValue({ kind: 'ok', value: outcomeInput() })
  await expectError(await getOutcomes(request(), { ...params, clientId: otherClientId }), 503, 'OUTCOMES_UNAVAILABLE')
  expect(mocks.read).toHaveBeenCalledWith({ ...scope, clientId: otherClientId })
})

test.each([
  ['denied', 403, 'OUTCOMES_DENIED'],
  ['not_found', 404, 'OUTCOMES_NOT_FOUND'],
] as const)('binds identical client/item/version IDs to a second session account before mapping %s', async (kind, status, code) => {
  const otherAccountId = '123e4567-e89b-42d3-a456-426614174010'
  mocks.profile.mockResolvedValue({ id: actorId, account_id: otherAccountId, is_admin: true })
  mocks.read.mockResolvedValue({ kind })

  await expectError(await getOutcomes(request(), params), status, code)

  expect(mocks.read).toHaveBeenCalledWith({ ...scope, accountId: otherAccountId })
})

test('returns a parsed server-generated DTO with private no-store caching', async () => {
  const response = await getOutcomes(request(), params)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toMatchObject({
    schemaVersion: 1, policyVersion: 'stored-outcomes.v1', clientId, itemId, versionId,
  })
})

test('rejects malformed server-generated output as unavailable rather than caller input', async () => {
  mocks.read.mockResolvedValue({ kind: 'ok', value: { ...outcomeInput(), contentHash: 'malformed' } })
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
  expect(console.error).toHaveBeenCalledWith({ event: 'outcomes_unavailable', category: 'projection' })
})

test.each([
  { id: 'bad', account_id: accountId },
  { id: actorId, account_id: 'bad' },
])('fails closed when the session contains invalid server-owned identity', async profile => {
  mocks.profile.mockResolvedValue(profile)
  await expectError(await getOutcomes(request(), params), 503, 'OUTCOMES_UNAVAILABLE')
  expect(mocks.read).not.toHaveBeenCalled()
})
