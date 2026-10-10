import {beforeEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({read:vi.fn(),owned:vi.fn(),page:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({requireAuth:async()=>({account_id:'account-a',id:'actor-a'})}))
vi.mock('@/lib/sources/store',()=>({readSource:state.read}))
vi.mock('@/lib/sources/pagination',()=>({listSourcePage:state.page}))
vi.mock('@/lib/work-items/store',()=>({loadOwnedDraftClient:state.owned}))
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('NOT_FOUND')}}))
import SourcesPage from '@/app/[lang]/dashboard/[clientId]/sources/page'
const source='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222'
beforeEach(()=>{vi.clearAllMocks();state.owned.mockResolvedValue({id:'client-a'});state.page.mockResolvedValue({items:[],total:0,nextCursor:null,asOf:'now'});state.read.mockResolvedValue({id:source,revokedAt:null,current:{id:version}})})
describe('exact source review destination',()=>{
 const render=()=>SourcesPage({params:Promise.resolve({lang:'en',clientId:'client-a'}),searchParams:Promise.resolve({source,version})})
 it('reads requested detail with session tenant before displaying it',async()=>{
  const element=await render();expect(state.read).toHaveBeenCalledWith({accountId:'account-a',clientId:'client-a',actorId:'actor-a'},source)
  expect(element.props).toMatchObject({initialReview:{current:{id:version}},initialReviewStale:false})
 })
 it('does not substitute or approve the latest changed/revoked version',async()=>{
  state.read.mockResolvedValue({id:source,revokedAt:null,current:{id:source}})
  expect((await render()).props).toMatchObject({initialReview:null,initialReviewStale:true})
  state.read.mockResolvedValue({id:source,revokedAt:'now',current:{id:version}})
  expect((await render()).props).toMatchObject({initialReview:null,initialReviewStale:true})
 })
 it('denies foreign clients before source detail',async()=>{
  state.owned.mockResolvedValue(null);await expect(render()).rejects.toThrow('NOT_FOUND');expect(state.read).not.toHaveBeenCalled()
 })
})
