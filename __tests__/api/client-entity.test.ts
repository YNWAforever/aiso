import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ profile: vi.fn(), owned: vi.fn(), read: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth', () => ({getProfile: h.profile}))
vi.mock('@/lib/entities/store', () => ({loadOwnedEntityClient: h.owned, loadEntity: h.read, saveEntity: h.save}))
import { GET, PUT } from '@/app/api/clients/[clientId]/entity/route'
import { loadAuthenticatedEntityPage } from '@/lib/entities/service'
const id = '11111111-1111-4111-8111-111111111111'
const context = {params: Promise.resolve({clientId: id})}
const dto = {clientId: id, displayName: 'Brand', aliases: [], revision: 1, verification: 'unverified', updatedAt: '2026-09-06T00:00:00Z'}
const request = (value: unknown) => new Request('http://localhost/api/entity', {method: 'PUT', body: JSON.stringify(value)})
describe('private entity API and service', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); h.profile.mockResolvedValue({id:'actor',account_id:'account'}); h.owned.mockResolvedValue({id,brand_name:'Suggestion'}); h.read.mockResolvedValue(null); h.save.mockResolvedValue(dto) })
  it('returns missing entity and suggested client without writes', async () => {
    expect(await loadAuthenticatedEntityPage(id)).toEqual({client:{id,brand_name:'Suggestion'},entity:null})
    expect(await (await GET(new Request('http://localhost'),context)).json()).toEqual({entity:null})
    expect(h.save).not.toHaveBeenCalled()
  })
  it('authenticates before ownership', async () => { h.profile.mockResolvedValue(null); expect((await GET(new Request('http://localhost'),context)).status).toBe(401); expect(h.owned).not.toHaveBeenCalled() })
  it('rejects invalid UUID before database access', async () => { expect((await GET(new Request('http://localhost'),{params:Promise.resolve({clientId:'bad'})})).status).toBe(400); expect(h.owned).not.toHaveBeenCalled() })
  it('hides missing and foreign client before entity read or write', async () => { h.owned.mockResolvedValue(null); expect((await PUT(request({displayName:'x',aliases:[],expectedRevision:0}),context)).status).toBe(404); expect(h.read).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled() })
  it('normalizes input and derives actor and account from auth', async () => { const response = await PUT(request({displayName:' Brand ',aliases:['brand','Other'],expectedRevision:0}),context); expect(response.status).toBe(200); expect(h.save).toHaveBeenCalledWith('account',id,'actor',{displayName:'Brand',aliases:['Other'],expectedRevision:0}); expect(await response.json()).toEqual({entity:dto}) })
  it('returns conflict if CAS produces no entity', async () => {h.save.mockResolvedValue(null); expect((await PUT(request({displayName:'x',aliases:[],expectedRevision:1}),context)).status).toBe(409)})
  it.each(['read','save'] as const)('never reports success for failed %s or exposes diagnostics', async op => {h[op].mockRejectedValue(new Error('postgresql://secret')); const response = op === 'read' ? await GET(new Request('http://localhost'),context) : await PUT(request({displayName:'x',aliases:[],expectedRevision:0}),context); expect(response.status).toBe(500); expect(await response.json()).toEqual({error:'ENTITY_UNAVAILABLE'})})
  it('bounds streamed body even without content-length', async () => {const response = await PUT(request({displayName:'x'.repeat(17000),aliases:[],expectedRevision:0}),context); expect(response.status).toBe(400); expect(h.save).not.toHaveBeenCalled()})
  it('records only operation and allowlisted diagnostics for failed writes', async () => {
    const secret = 'synthetic-secret-never-log'
    h.save.mockRejectedValue(Object.assign(new Error(secret), {code:'23503',detail:secret,query:secret,cause:{password:secret}}))
    const response = await PUT(request({displayName:'x',aliases:[],expectedRevision:0}),context)
    expect(response.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith({event:'entity_operation_failed',operation:'save',correlationId:expect.any(String),database:{code:'23503',category:'foreign_key_violation'}})
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret)
  })
  it('rejects malformed JSON and injected fields', async () => { expect((await PUT(new Request('http://localhost',{method:'PUT',body:'{'}),context)).status).toBe(400); expect((await PUT(request({displayName:'x',aliases:[],expectedRevision:0,verification:'verified'}),context)).status).toBe(400); expect(h.save).not.toHaveBeenCalled() })
})
