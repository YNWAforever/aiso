import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const {load} = vi.hoisted(() => ({load:vi.fn()}))
vi.mock('@/lib/opportunities/service', async importOriginal => ({...await importOriginal<typeof import('@/lib/opportunities/service')>(),loadAuthenticatedOpportunities:load}))
import { GET } from '@/app/api/clients/[clientId]/opportunities/route'
import { OpportunityServiceError } from '@/lib/opportunities/service'
it('returns authenticated DTO with no-store and generic failures', async () => {
  load.mockResolvedValue({schemaVersion:1,suggestions:[]})
  const request = new Request('http://localhost/api/clients/client/opportunities')
  const context = {params:Promise.resolve({clientId:'client'})}
  const response = await GET(request,context)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(load).toHaveBeenCalledWith('client')
  load.mockRejectedValue(new OpportunityServiceError('UNAUTHENTICATED'))
  expect((await GET(request,context)).status).toBe(401)
  load.mockRejectedValue(new Error('SECRET'))
  const failed = await GET(request,context)
  expect(failed.status).toBe(503)
  expect(failed.headers.get('Cache-Control')).toBe('no-store')
  expect(await failed.json()).toEqual({error:'OPPORTUNITIES_UNAVAILABLE'})
})
